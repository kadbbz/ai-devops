import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { Control } from "../../../src/control.js";
import { MemoryStore } from "../../../src/store.js";
import { canonical, digest, inputFingerprint } from "../../../src/model.js";
import { recoverState, verifyReceipt } from "../../../src/safety.js";
import { seed, FakeGitea, build } from "./fixtures.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const exec = promisify(execFile);

test("恢复撤销会话和委托，未知操作不重放，历史已关闭交付保持可读", () => {
  const s = seed();
  s.sessions.push({ id: "session" });
  s.intents.push({ id: "intent", control: "ACTIVE", stage: "A_SIGNED" });
  s.deliveries.push({ id: "done", control: "ACTIVE", stage: "CLOSED" });
  s.operations.push({
    id: "op",
    subjectId: "intent",
    kind: "release",
    status: "RUNNING",
  });
  s.approvals.push({ id: "a", subjectId: "intent", status: "VALID" });
  recoverState(s, true);
  assert.equal(s.sessions.length, 0);
  assert.ok(s.credentials.every((c) => c.revoked));
  assert.equal(s.operations[0].status, "UNKNOWN");
  assert.equal(s.intents[0].control, "UNKNOWN");
  assert.equal(s.approvals[0].status, "STALE");
  assert.equal(s.deliveries[0].stage, "CLOSED");
});
test("机器回执签名绑定动作、请求和幂等键，篡改后无法验签", () => {
  const key = generateKeyPairSync("ed25519");
  const publicKey = key.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const input = {
    action: "tests.complete",
    body: { id: "op", outcome: "PASSED" },
    key: "request-key",
  };
  const signature = sign(
    null,
    Buffer.from(canonical(input)),
    key.privateKey,
  ).toString("base64");
  assert.doesNotThrow(() => verifyReceipt(publicKey, signature, input));
  assert.throws(() =>
    verifyReceipt(publicKey, signature, {
      ...input,
      body: { id: "other", outcome: "PASSED" },
    }),
  );
  assert.throws(() => verifyReceipt(publicKey, "", input));
});
test("发布领取前控制配置发生变化，必须拒绝旧签发", async () => {
  const s = seed(),
    git = new FakeGitea();
  const p = {
    id: "p",
    slug: "project",
    control: "ACTIVE",
    members: { owner: "owner" },
    configVersion: "1",
    environment: "production",
    runnerId: "acceptance",
  };
  s.projects.push(p);
  await git.createProject(p);
  const sourceSha = await git.head(p, "main");
  const d = {
    id: "d",
    projectId: "p",
    intentIds: [],
    sourceSha,
    targetSha: sourceSha,
    targetBranch: "main",
    control: "ACTIVE",
    stage: "RELEASE_REQUESTED",
    system: { sourceSha },
    build: build(sourceSha),
  };
  s.deliveries.push(d);
  const fp = digest({ input: inputFingerprint(s, d, p), system: d.system });
  s.approvals.push({
    id: "a",
    subjectId: "d",
    projectId: "p",
    gate: "C",
    status: "VALID",
    fingerprint: fp,
  });
  s.operations.push({
    id: "op",
    subjectId: "d",
    projectId: "p",
    kind: "release",
    status: "QUEUED",
    fingerprint: fp,
  });
  p.configVersion = "2";
  const service = new Control(new MemoryStore(s), git);
  await assert.rejects(
    service.execute(
      {
        id: "control",
        userId: "owner",
        role: "ide_control",
        name: "control",
        projectId: "p",
      },
      "operation.claim",
      { id: "op" },
      "claim-request",
    ),
    /签发|变化/,
  );
});
test("外部操作期间新增登录会话不被旧业务快照覆盖", async () => {
  const store = new MemoryStore(seed()),
    git = new FakeGitea();
  const original = git.createProject.bind(git);
  git.createProject = async (p) => {
    await store.change("user", "session.login", (s) =>
      s.sessions.push({ id: "concurrent-login" }),
    );
    return original(p);
  };
  const control = new Control(store, git);
  await control.execute(
    { id: "owner", userId: "owner", role: "human", name: "owner", admin: true },
    "project.create",
    {
      name: "项目",
      slug: "project",
      configVersion: "1",
      policyVersion: "1",
      toolVersion: "node22",
      runnerId: "acceptance",
      apiCommand: "api",
      e2eCommand: "e2e",
      environment: "production",
      testEnvironment: "acceptance",
    },
    "create-project",
  );
  assert.ok(
    (await store.read()).sessions.some((s) => s.id === "concurrent-login"),
  );
});
test("授权后的跨项目成员撤销立即使 agent 请求失败", async () => {
  const s = seed();
  s.projects.push({
    id: "p",
    members: { owner: "observer" },
    control: "ACTIVE",
  });
  const service = new Control(new MemoryStore(s), new FakeGitea());
  await assert.rejects(
    service.execute(
      {
        id: "ide",
        userId: "owner",
        role: "ide_agent",
        name: "ide",
        projectId: "p",
      },
      "build.request",
      { id: "missing", projectId: "p" },
      "revoked-membership",
    ),
    /权限/,
  );
});
test("Gate C 必须有已确认的生产基线", async () => {
  const s = seed(),
    git = new FakeGitea();
  const p = {
    id: "p",
    slug: "project",
    control: "ACTIVE",
    members: { owner: "owner" },
  };
  s.projects.push(p);
  await git.createProject(p);
  const sourceSha = await git.head(p, "main");
  s.deliveries.push({
    id: "d",
    projectId: "p",
    intentIds: [],
    sourceSha,
    targetSha: sourceSha,
    targetBranch: "main",
    control: "ACTIVE",
  });
  const control = new Control(new MemoryStore(s), git);
  const preview = await control.preview(
    { id: "owner", userId: "owner", role: "human", name: "owner" },
    "delivery",
    "d",
    "C",
  );
  assert.ok(preview.gaps.some((g) => g.includes("生产基线")));
});
test("迁移恢复证明只能由受信 IDE 控制面登记，并绑定当前 SHA", async () => {
  const s = seed(),
    git = new FakeGitea();
  const p = {
    id: "p",
    slug: "project",
    control: "ACTIVE",
    members: { owner: "owner" },
  };
  s.projects.push(p);
  await git.createProject(p);
  const sourceSha = await git.head(p, "main");
  s.intents.push({
    id: "i",
    projectId: "p",
    stage: "A_SIGNED",
    control: "ACTIVE",
    kind: "migration",
    branch: "main",
    targetBranch: "main",
    sourceSha,
    targetSha: sourceSha,
  });
  const service = new Control(new MemoryStore(s), git),
    actor = {
      id: "control",
      userId: "owner",
      name: "control",
      projectId: "p",
      role: "ide_control",
    };
  const body = {
    id: "i",
    evidence: {
      sourceSha,
      backupLocation: "artifact://backup/123",
      restoreVerified: true,
      invariantsVerified: true,
      permissionsVerified: true,
      forwardFix: "暂停入口并执行修复迁移",
      log: "隔离环境恢复与权限检查通过",
    },
  };
  await assert.rejects(
    service.execute(
      { ...actor, role: "ide_agent" },
      "risk.register",
      body,
      "risk-invalid-role",
    ),
    /权限/,
  );
  const result = await service.execute(
    actor,
    "risk.register",
    body,
    "risk-proof",
  );
  assert.equal(result.riskEvidence.sourceSha, sourceSha);
  await assert.rejects(
    service.execute(
      actor,
      "risk.register",
      { ...body, evidence: { ...body.evidence, sourceSha: "f".repeat(40) } },
      "risk-stale-sha",
    ),
    /提交/,
  );
});
test("不能用声明项目覆盖真实对象所属项目", async () => {
  const s = seed();
  s.projects.push(
    { id: "a", control: "ACTIVE", members: { owner: "owner" } },
    { id: "b", control: "ACTIVE", members: { reviewer: "owner" } },
  );
  s.intents.push({
    id: "foreign",
    projectId: "b",
    stage: "DRAFT",
    control: "ACTIVE",
  });
  const store = new MemoryStore(s),
    service = new Control(store, new FakeGitea());
  await assert.rejects(
    service.execute(
      {
        id: "devops",
        userId: "owner",
        role: "devops_agent",
        name: "devops",
        projectId: "a",
      },
      "plan.save",
      { id: "foreign", projectId: "a", plan: {} },
      "cross-project-attack",
    ),
    /项目不一致/,
  );
  assert.equal((await store.read()).intents[0].plan, undefined);
});
test("项目配置不能把仓库标识改成其他仓库", async () => {
  const s = seed(),
    settings = {
      name: "项目",
      slug: "project",
      configVersion: "1",
      policyVersion: "1",
      toolVersion: "node22",
      runnerId: "acceptance",
      apiCommand: "api",
      e2eCommand: "e2e",
      environment: "production",
      testEnvironment: "acceptance",
    };
  s.projects.push({
    id: "p",
    ...settings,
    members: { owner: "owner" },
    control: "ACTIVE",
  });
  const store = new MemoryStore(s),
    service = new Control(store, new FakeGitea());
  await assert.rejects(
    service.execute(
      { id: "owner", userId: "owner", role: "human", name: "owner" },
      "project.update",
      { projectId: "p", settings: { ...settings, slug: "other-project" } },
      "repo-substitution",
    ),
    /仓库标识不能变更/,
  );
  assert.equal((await store.read()).projects[0].slug, "project");
});

test("项目导入校验压缩包中的根目录 agent.md", async () => {
  const s = seed();
  const service = new Control(new MemoryStore(s), new FakeGitea());
  const actor = {
    id: "owner",
    userId: "owner",
    role: "human",
    name: "owner",
    admin: true,
  };
  const temp = await mkdtemp(join(tmpdir(), "import-test-"));
  await writeFile(join(temp, "agent.md"), "# 协作协议\n");
  const archive = (await exec("bsdtar", ["-cf", "-", "-C", temp, "agent.md"]))
    .stdout;
  const missingTemp = await mkdtemp(join(tmpdir(), "import-missing-test-"));
  await writeFile(join(missingTemp, "README.md"), "项目说明\n");
  const missingArchive = (
    await exec("bsdtar", ["-cf", "-", "-C", missingTemp, "README.md"])
  ).stdout;
  const valid = await service.execute(
    actor,
    "project.import",
    {
      name: "导入项目",
      slug: "imported-project",
      configVersion: "1",
      policyVersion: "1",
      toolVersion: "node22",
      runnerId: "acceptance",
      apiCommand: "api",
      e2eCommand: "e2e",
      environment: "production",
      testEnvironment: "acceptance",
      archiveName: "project.any-extension",
      archiveBase64: Buffer.from(archive, "binary").toString("base64"),
    },
    "import-valid",
  );
  assert.equal(valid.agentContractValidated, true);
  await assert.rejects(
    service.execute(
      actor,
      "project.import",
      {
        name: "缺少协议",
        slug: "missing-agent",
        configVersion: "1",
        policyVersion: "1",
        toolVersion: "node22",
        runnerId: "acceptance",
        apiCommand: "api",
        e2eCommand: "e2e",
        environment: "production",
        testEnvironment: "acceptance",
        archiveName: "project.bin",
        archiveBase64: Buffer.from(missingArchive, "binary").toString("base64"),
      },
      "import-missing",
    ),
    /agent\.md/,
  );
  await rm(temp, { recursive: true, force: true });
  await rm(missingTemp, { recursive: true, force: true });
});
