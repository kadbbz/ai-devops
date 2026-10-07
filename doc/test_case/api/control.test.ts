import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../../src/server.js";
import { MemoryStore } from "../../../src/store.js";
import { FakeGitea, seed } from "./fixtures.js";
async function setup() {
  const store = new MemoryStore(seed()),
    git = new FakeGitea();
  const app = await createApp({ store, git, testing: true });
  const call = async (
    action: string,
    body: any = {},
    who = "owner",
    key = crypto.randomUUID(),
  ) => {
    const r = await app.inject({
      method: "POST",
      url: "/api/actions/" + action,
      headers: { authorization: "Bearer " + who, "idempotency-key": key },
      payload: body,
    });
    return { status: r.statusCode, ...r.json() };
  };
  return { store, git, app, call };
}
test("仅名称建项目，无执行参数；需求可直接改状态且检查修订", async () => {
  const f = await setup();
  try {
    const p = await f.call("project.create", { name: "客户管理" });
    assert.equal(p.status, 200, JSON.stringify(p));
    assert.ok(p.result.slug);
    assert.equal(p.result.runnerId, undefined);
    const r = await f.call("requirement.create", {
      projectId: p.result.id,
      title: "支持批量导入",
      description: "上传客户文件",
      kind: "feature",
      priority: "normal",
    });
    assert.equal(r.status, 200);
    assert.equal(r.result.revision, 1);
    const update = {
      id: r.result.id,
      revision: 1,
      title: "支持批量导入",
      description: "上传客户文件",
      kind: "feature",
      priority: "normal",
      status: "DONE",
    };
    const done = await f.call("requirement.update", update);
    assert.equal(done.result.status, "DONE");
    assert.equal(
      (await f.call("requirement.update", update)).code,
      "REVISION_CONFLICT",
    );
    const w = (
      await f.app.inject({
        url: "/api/workspace",
        headers: { authorization: "Bearer owner" },
      })
    ).json();
    for (const key of [
      "approvals",
      "evidence",
      "operations",
      "deliveries",
      "intents",
    ])
      assert.equal(w[key], undefined);
  } finally {
    await f.app.close();
  }
});
test("旧审批与执行 API 全部关闭，不创建任务", async () => {
  const f = await setup();
  try {
    for (const action of [
      "gate.a",
      "gate.b",
      "gate.c",
      "gate.c.review",
      "tests.request",
      "tests.complete",
      "build.request",
      "build.register",
      "release.request",
      "release.complete",
      "operation.claim",
      "production.confirm",
      "production.attest",
      "risk.register",
    ])
      assert.equal((await f.call(action)).status, 404, action);
    assert.equal((await f.store.read()).requests.length, 0);
  } finally {
    await f.app.close();
  }
});
test("需求分支、PR、版本不依赖审批和执行证明；幂等与漂移检查", async () => {
  const f = await setup();
  try {
    const p = (
      await f.call("project.create", {
        name: "版本项目",
        slug: "version-project",
      })
    ).result;
    const baseSha = await f.git.head(p, "main");
    const input = { projectId: p.id, name: "feature/import", baseSha };
    const key = crypto.randomUUID();
    const branch = await f.call("branch.create", input, "owner", key);
    assert.equal(branch.status, 200, JSON.stringify(branch));
    assert.deepEqual(
      (await f.call("branch.create", input, "owner", key)).result,
      branch.result,
    );
    assert.equal(
      (
        await f.call(
          "branch.create",
          { ...input, name: "different" },
          "owner",
          key,
        )
      ).status,
      409,
    );
    const pr = await f.call("pr.create", {
      projectId: p.id,
      branchId: branch.result.id,
      title: "支持导入",
      description: "需求实现",
    });
    assert.equal(pr.status, 200, JSON.stringify(pr));
    assert.equal(
      (
        await f.call("pr.merge", {
          id: pr.result.id,
          headSha: "0".repeat(40),
          targetSha: baseSha,
        })
      ).code,
      "HEAD_MOVED",
    );
    const merged = await f.call("pr.merge", {
      id: pr.result.id,
      headSha: await f.git.head(p, input.name),
      targetSha: baseSha,
    });
    assert.equal(merged.status, 200, JSON.stringify(merged));
    const ver = await f.call("version.create", {
      projectId: p.id,
      name: "v1.0.0",
      sha: await f.git.head(p, "main"),
      notes: "首个版本",
      requirementIds: [],
    });
    assert.equal(ver.status, 200, JSON.stringify(ver));
    assert.equal(ver.result.deploymentStatus, undefined);
    assert.equal(
      (
        await f.call("branch.delete", {
          id: branch.result.id,
          headSha: await f.git.head(p, input.name),
        })
      ).status,
      200,
    );
  } finally {
    await f.app.close();
  }
});
test("观察者、越权项目和 DevOps agent 不能操作版本；IDE agent 可按委托操作", async () => {
  const f = await setup();
  try {
    const p = (await f.call("project.create", { name: "权限项目" })).result;
    await f.call("project.member", {
      projectId: p.id,
      userId: "viewer",
      role: "observer",
    });
    assert.equal(
      (
        await f.call(
          "requirement.create",
          { projectId: p.id, title: "越权" },
          "viewer",
        )
      ).status,
      403,
    );
    const cred = await f.call("credential.create", {
      projectId: p.id,
      name: "IDE",
      role: "ide_agent",
      hours: 1,
    });
    assert.equal(cred.status, 200);
    const branch = await f.call(
      "branch.create",
      {
        projectId: p.id,
        name: "ide/work",
        baseSha: await f.git.head(p, "main"),
      },
      cred.result.token,
    );
    assert.equal(branch.status, 200, JSON.stringify(branch));
    const docs = await f.call("credential.create", {
      projectId: p.id,
      name: "需求助手",
      role: "devops_agent",
      hours: 1,
    });
    assert.equal(
      (
        await f.call(
          "branch.create",
          {
            projectId: p.id,
            name: "docs/work",
            baseSha: await f.git.head(p, "main"),
          },
          docs.result.token,
        )
      ).status,
      403,
    );
    const other = (await f.call("project.create", { name: "另一项目" })).result;
    assert.equal(
      (
        await f.call(
          "requirement.create",
          { projectId: other.id, title: "越界" },
          cred.result.token,
        )
      ).status,
      403,
    );
    await f.call("credential.revoke", { id: cred.result.id });
    assert.equal(
      (
        await f.call(
          "requirement.create",
          { projectId: p.id, title: "已撤销" },
          cred.result.token,
        )
      ).status,
      401,
    );
  } finally {
    await f.app.close();
  }
});
test("文件同步只维护需求；拒绝执行动作和伪造角色", async () => {
  const f = await setup();
  try {
    const p = (await f.call("project.create", { name: "共享项目" })).result;
    const envelope = {
      protocolVersion: 2,
      projectId: p.id,
      requestId: crypto.randomUUID(),
      action: "requirement.create",
      payload: {
        title: "共享需求",
        description: "IDE 自动测试",
        kind: "feature",
        priority: "normal",
      },
    };
    const key = crypto.randomUUID(),
      ok = await f.call("workspace.sync", envelope, "owner", key);
    assert.equal(ok.status, 200, JSON.stringify(ok));
    assert.deepEqual(
      (await f.call("workspace.sync", envelope, "owner", key)).result,
      ok.result,
    );
    assert.equal(
      (
        await f.call("workspace.sync", {
          ...envelope,
          requestId: crypto.randomUUID(),
          action: "tests.complete",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.call("workspace.sync", {
          ...envelope,
          requestId: crypto.randomUUID(),
          actorId: "admin",
        })
      ).status,
      400,
    );
    const files = (
      await f.app.inject({
        url: "/api/projects/" + p.id + "/workspace",
        headers: { authorization: "Bearer owner" },
      })
    ).json().files;
    assert.ok(
      Object.keys(files).some((k) => k.startsWith("inbox/requirements/")),
    );
    assert.ok(!Object.keys(files).some((k) => k.includes("runner")));
  } finally {
    await f.app.close();
  }
});

test("Git 成功但响应丢失：不盲重试，按实际分支对账后恢复", async () => {
  const f = await setup();
  try {
    const p = (await f.call("project.create", { name: "恢复项目" })).result,
      baseSha = await f.git.head(p, "main"),
      original = f.git.createBranch.bind(f.git);
    f.git.createBranch = async (p, b, sha) => {
      await original(p, b, sha);
      throw Error("响应丢失");
    };
    const body = { projectId: p.id, name: "feature/recover", baseSha },
      key = crypto.randomUUID();
    assert.equal(
      (await f.call("branch.create", body, "owner", key)).status,
      500,
    );
    assert.equal(
      (await f.call("branch.create", body, "owner", key)).code,
      "REQUEST_UNRESOLVED",
    );
    assert.equal(f.git.branchesCreated, 1);
    assert.equal(
      (await f.call("repository.reconcile", { projectId: p.id })).status,
      200,
    );
    assert.equal(
      (await f.call("branch.create", body, "owner", key)).result.name,
      body.name,
    );
    assert.equal(f.git.branchesCreated, 1);
  } finally {
    await f.app.close();
  }
});
test("成员移除即时取消代理访问，项目管理员也不能跨项目读取正文", async () => {
  const f = await setup();
  try {
    const p = (await f.call("project.create", { name: "可见性" })).result;
    await f.call("project.member", {
      projectId: p.id,
      userId: "reviewer",
      role: "member",
    });
    const c = (
      await f.call(
        "credential.create",
        { projectId: p.id, name: "共享 IDE", role: "ide_agent", hours: 1 },
        "reviewer",
      )
    ).result;
    await f.call("project.member", {
      projectId: p.id,
      userId: "reviewer",
      role: "remove",
    });
    assert.equal(
      (
        await f.call(
          "requirement.create",
          { projectId: p.id, title: "失去权限" },
          c.token,
        )
      ).status,
      403,
    );
    const w = await f.app.inject({
      url: "/api/workspace",
      headers: { authorization: "Bearer " + c.token },
    });
    assert.equal(w.json().projects.length, 0);
    const other = (
      await f.call("project.create", { name: "成员私有" }, "reviewer")
    ).result;
    const ownerView = (
      await f.app.inject({
        url: "/api/workspace",
        headers: { authorization: "Bearer owner" },
      })
    ).json();
    assert.ok(!ownerView.projects.some((p: any) => p.id === other.id));
  } finally {
    await f.app.close();
  }
});

test("等待写锁期间撤销的凭证，不能使用旧身份继续写入", async () => {
  const f = await setup();
  try {
    const p = (await f.call("project.create", { name: "排队权限" })).result;
    const credential = (
      await f.call("credential.create", {
        projectId: p.id,
        name: "IDE",
        role: "ide_agent",
        hours: 1,
      })
    ).result;
    // Controller 的调用方可能已验证过令牌；执行时仍须检查最新委托。
    const { Control } = await import("../../../src/control.js");
    const c = new Control(f.store, f.git);
    await f.call("credential.revoke", { id: credential.id });
    await assert.rejects(
      () =>
        c.run(
          {
            id: credential.id,
            userId: "owner",
            role: "ide_agent",
            name: "IDE",
            projectId: p.id,
            credentialId: credential.id,
          },
          "requirement.create",
          { projectId: p.id, title: "撤销后的请求" },
          crypto.randomUUID(),
        ),
      (e: any) => e.status === 401,
    );
  } finally {
    await f.app.close();
  }
});

test("有冲突时只返回 DevOps Agent 差异报告，记录左右选择但绝不合并", async () => {
  const f = await setup();
  try {
    const p = (await f.call("project.create", { name: "冲突项目" })).result;
    const baseSha = await f.git.head(p, "main");
    const branch = (
      await f.call("branch.create", {
        projectId: p.id,
        name: "feature/conflict",
        baseSha,
      })
    ).result;
    const pr = (
      await f.call("pr.create", {
        projectId: p.id,
        branchId: branch.id,
        title: "冲突变更",
        description: "并行修改同一文件",
      })
    ).result;
    f.git.conflictReport = {
      hasConflicts: true,
      targetSha: baseSha,
      headSha: await f.git.head(p, branch.name),
      conflicts: [
        {
          id: "conflict_1",
          path: "src/config.ts",
          kind: "content",
          summary: "同一配置项在 main 与工作分支中都被修改",
          base: "const mode = 'base';",
          left: "const mode = 'main';",
          right: "const mode = 'feature';",
        },
      ],
    };
    const view = await f.app.inject({
      url: "/api/pulls/" + pr.id,
      headers: { authorization: "Bearer owner" },
    });
    assert.equal(view.statusCode, 200);
    assert.equal(view.json().conflicts[0].path, "src/config.ts");
    assert.equal(view.json().conflicts[0].left, "const mode = 'main';");
    assert.equal(view.json().conflicts[0].right, "const mode = 'feature';");
    const blocked = await f.call("pr.merge", {
      id: pr.id,
      headSha: f.git.conflictReport.headSha,
      targetSha: baseSha,
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.code, "MERGE_CONFLICT");
    assert.equal(blocked.details.conflicts[0].id, "conflict_1");
    assert.equal(f.git.mergeCalls, 0);
    const choice = await f.call("pr.conflict.choice", {
      id: pr.id,
      headSha: f.git.conflictReport.headSha,
      targetSha: baseSha,
      choices: [{ path: "src/config.ts", choice: "left" }],
    });
    assert.deepEqual(choice.result.choices, [
      { path: "src/config.ts", choice: "left" },
    ]);
    assert.equal((await f.store.read()).pulls[0].status, "OPEN");
    assert.equal(f.git.mergeCalls, 0);
  } finally {
    await f.app.close();
  }
});

test("中断的初始化可通过对账补齐控制分支和保护，不重复导入", async () => {
  const f = await setup();
  try {
    const original = f.git.createProject.bind(f.git);
    f.git.createProject = async (p, files) => {
      const r = await original(p, files);
      throw Error("初始化响应丢失");
    };
    assert.equal(
      (await f.call("project.create", { name: "初始化恢复" })).status,
      500,
    );
    const p = (await f.store.read()).projects[0];
    assert.equal(p.status, "UNKNOWN");
    assert.equal(
      (await f.call("repository.reconcile", { projectId: p.id })).status,
      200,
    );
    assert.equal((await f.store.read()).projects[0].status, "ACTIVE");
    assert.equal(f.git.projectsCreated, 1);
  } finally {
    await f.app.close();
  }
});
