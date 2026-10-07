import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../../src/server.js";
import { MemoryStore } from "../../../src/store.js";
import {
  FakeGitea,
  seed,
  plan,
  materials,
  build,
  receiptHeaders,
} from "./fixtures.js";

// 先验证权限与业务结果；测试适配器不进入生产启动路径。
async function setup() {
  const store = new MemoryStore(seed());
  const git = new FakeGitea();
  const app = await createApp({ store, git, testing: true });
  const call = async (
    action: string,
    body: object = {},
    who = "owner",
    key = crypto.randomUUID(),
  ) => {
    const r = await app.inject({
      method: "POST",
      url: `/api/actions/${action}`,
      headers: {
        authorization: `Bearer ${who}`,
        "idempotency-key": key,
        ...receiptHeaders(action, body, key),
      },
      payload: body,
    });
    return { status: r.statusCode, ...r.json() };
  };
  const project = await call("project.create", {
    name: "工单服务",
    slug: "tickets",
    configVersion: "1",
    policyVersion: "1",
    toolVersion: "node22",
    runnerId: "acceptance",
    apiCommand: "api",
    e2eCommand: "e2e",
    environment: "production",
    testEnvironment: "acceptance",
  });
  assert.equal(project.status, 200);
  const report = {
    actualSha: await git.head(project.result, "production"),
    artifactDigest: "sha256:" + "a".repeat(64),
    environment: "production",
    healthy: true,
    operationId: crypto.randomUUID(),
    log: "隔离测试执行器基线",
  };
  const attested = await call(
    "production.attest",
    { projectId: project.result.id, report },
    "control",
  );
  assert.equal(
    (
      await call("production.confirm", {
        projectId: project.result.id,
        fingerprint: attested.result.fingerprint,
      })
    ).status,
    200,
  );

  return { app, store, git, call, p: project.result };
}

test("同账号会话、未登录、CSRF 与 agent 签发边界", async () => {
  const f = await setup();
  assert.equal((await f.app.inject("/api/workspace")).statusCode, 401);
  for (const action of ["gate.a", "gate.b", "gate.c", "merge", "recovery"])
    assert.equal((await f.call(action, { id: "missing" }, "ide")).status, 403);
  assert.equal(
    (await f.call("project.create", { name: "越权" }, "devops")).status,
    403,
  );
  assert.equal(
    (await f.call("project.create", { name: "只读" }, "viewer")).status,
    403,
  );
  await f.app.close();
});

test("A 快照同源、幂等、目标变化导致批准失效", async () => {
  const f = await setup();
  const i = (
    await f.call("intent.create", {
      projectId: f.p.id,
      title: "防止重复工单",
      description: "并发请求不能产生重复记录",
      kind: "feature",
      risk: "low",
    })
  ).result;
  assert.equal(
    (await f.call("gate.a", { id: i.id, fingerprint: "wrong", reason: "确认" }))
      .status,
    409,
  );
  assert.equal(
    (await f.call("plan.save", { id: i.id, plan: plan() }, "devops")).status,
    200,
  );
  const preview = await f.app.inject({
    url: `/api/preview/intent/${i.id}/A`,
    headers: { authorization: "Bearer owner" },
  });
  const input = {
    id: i.id,
    fingerprint: preview.json().fingerprint,
    reason: "目标和恢复方式已确认",
  };
  const a = await f.call("gate.a", input, "owner", "gate-a-key");
  assert.equal(a.status, 200);
  assert.deepEqual(
    (await f.call("gate.a", input, "owner", "gate-a-key")).result,
    a.result,
  );
  assert.equal(
    (
      await f.call(
        "gate.a",
        { ...input, reason: "changed" },
        "owner",
        "gate-a-key",
      )
    ).status,
    409,
  );
  const snapshot = await f.app.inject({
    url: `/api/intents/${i.id}/workspace`,
    headers: { authorization: "Bearer ide" },
  });
  assert.equal(snapshot.statusCode, 200);
  assert.equal(snapshot.json().plan.point.goal, "避免重复工单");
  assert.equal(f.git.branchesCreated, 1);
  await f.call(
    "plan.save",
    {
      id: i.id,
      plan: { ...plan(), point: { ...plan().point, goal: "扩展需求" } },
    },
    "devops",
  );
  assert.equal(
    (await f.store.read()).approvals.filter((a) => a.status === "VALID").length,
    0,
  );
  assert.equal((await f.call("tests.request", { id: i.id })).status, 409);
  await f.app.close();
});

test("真实执行证据才可 B；最终合并提交必须重验后 C；精确发布回执", async () => {
  const f = await setup();
  const i = (
    await f.call("intent.create", {
      projectId: f.p.id,
      title: "幂等写入",
      description: "避免重复记录",
      kind: "feature",
      risk: "low",
    })
  ).result;
  await f.call("plan.save", { id: i.id, plan: plan() }, "devops");
  const sign = async (id: string, kind: string, gate: string) => {
    const r = await f.app.inject({
      url: `/api/preview/${kind}/${id}/${gate}`,
      headers: { authorization: "Bearer owner" },
    });
    return f.call(`gate.${gate.toLowerCase()}`, {
      id,
      fingerprint: r.json().fingerprint,
      reason: "已检查全部材料",
    });
  };
  assert.equal((await sign(i.id, "intent", "A")).status, 200);
  await f.call(
    "materials.save",
    { id: i.id, materials: materials() },
    "devops",
  );
  assert.equal((await sign(i.id, "intent", "B")).status, 409);
  const verify = async (id: string) => {
    const state = await f.store.read();
    const subject =
      state.intents.find((x) => x.id === id) ||
      state.deliveries.find((x) => x.id === id)!;
    const sourceSha =
      subject.sourceSha || (await f.git.head(f.p, subject.branch!));
    const queued=(await f.call('build.request',{id},'ide')).result;
    assert.equal((await f.call('operation.claim',{id:queued.id},'control')).status,200);
    const receipt = {...build(sourceSha),operationId:queued.id};
    assert.equal(
      (await f.call("build.register", { id, build: receipt }, "ide")).status,
      403,
    );
    const registered = await f.call(
      "build.register",
      { id, build: receipt },
      "control",
    );
    assert.equal(registered.status, 200, JSON.stringify(registered));
    assert.equal((await f.store.read()).operations.find(o=>o.id===queued.id)!.status,"SUCCEEDED");
    const requested = await f.call("tests.request", { id }, "devops");
    assert.equal(requested.status, 200, JSON.stringify(requested));
    for (const op of requested.result) {
      assert.equal(
        (await f.call("operation.claim", { id: op.id }, "runner")).status,
        200,
      );
      const complete = await f.call(
        "tests.complete",
        {
          id: op.id,
          fingerprint: op.fingerprint,
          outcome: "PASSED",
          command: op.payload.command,
          environment: "acceptance",
          toolVersion: "node22",
          dataDigest: op.payload.dataDigest,
          prepared: true,
          cleaned: true,
          beforeDigest: "sha256:" + "b".repeat(64),
          afterDigest: "sha256:" + "c".repeat(64),
          log: "请求、响应与清理记录",
        },
        "runner",
      );
      assert.equal(complete.status, 200, JSON.stringify(complete));
    }
  };
  await verify(i.id);
  const b = await sign(i.id, "intent", "B");
  assert.equal(b.status, 200, JSON.stringify(b));
  const merged = await f.call("merge", {
    ids: [i.id],
    targetSha: await f.git.head(f.p, "main"),
    reason: "同意合并",
  });
  assert.equal(merged.status, 200, JSON.stringify(merged));
  const d = merged.result;
  assert.equal((await sign(d.id, "delivery", "C")).status, 409);
  await verify(d.id);
  const current = (await f.store.read()).deliveries.find((x) => x.id === d.id)!;
  await f.call(
    "system.save",
    {
      id: d.id,
      system: {
        sourceSha: d.sourceSha,
        artifactDigest: current.build!.artifactDigest,
        environment: "production",
        configVersion: "1",
        applications: [i.id],
        sequence: ["发布同一制品"],
        migrations: ["无"],
        healthChecks: ["健康接口"],
        rollback: "恢复上一制品",
        scope: ["工单服务"],
      },
    },
    "devops",
  );
  assert.equal((await sign(d.id, "delivery", "C")).status, 200);
  const op = (await f.call("release.request", { id: d.id }, "ide")).result;
  assert.equal(
    (await f.call("operation.claim", { id: op.id }, "control")).status,
    200,
  );
  const result = await f.call(
    "release.complete",
    {
      id: op.id,
      fingerprint: op.fingerprint,
      outcome: "SUCCEEDED",
      actualSha: d.sourceSha,
      artifactDigest: current.build!.artifactDigest,
      environment: "production",
      healthy: true,
      log: "实际版本核验一致",
    },
    "control",
  );
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(
    (await f.store.read()).deliveries.find((x) => x.id === d.id)!.stage,
    "CLOSED",
  );
  await f.app.close();
});

test("项目外委托、伪造文件签发和跨角色回执被阻断", async () => {
  const f = await setup();
  assert.equal(
    (
      await f.call(
        "workspace.sync",
        { projectId: f.p.id, requestId: "fake", action: "gate.a", payload: {} },
        "ide",
      )
    ).status,
    403,
  );
  assert.equal(
    (await f.call("build.register", { id: "missing", build: {} }, "devops"))
      .status,
    403,
  );
  assert.equal(
    (await f.call("release.complete", { id: "missing" }, "ide")).status,
    403,
  );
  await f.app.close();
});
