/** 真实 MySQL/Gitea/Git HTTP 集成；外部 IDE/Runner 用本脚本模拟受信控制器，不代表实际生产部署。 */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateKeyPairSync, sign, createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { canonical, digest } from "../../src/model.js";
import { plan, materials, build } from "./api/fixtures.js";
const exec = promisify(execFile),
  origin = process.env.DEVOPS_TEST_URL || "http://localhost:18082";
const storage = JSON.parse(await readFile(".data/test/session.json", "utf8"));
const cookie = storage.cookies
  .map((c: any) => `${c.name}=${c.value}`)
  .join("; ");
async function api(path: string, body?: any, credential?: any, status = 200) {
  const key = randomUUID(),
    headers: any = credential
      ? { Authorization: "Bearer " + credential.token }
      : { Cookie: cookie };
  if (body) {
    headers["Content-Type"] = "application/json";
    headers["Idempotency-Key"] = key;
    if (credential?.privateKey)
      headers["X-Receipt-Signature"] = sign(
        null,
        Buffer.from(canonical({ action: path.split("/").at(-1), body, key })),
        credential.privateKey,
      ).toString("base64");
    else headers["X-CSRF-Token"] = csrf;
  }
  const r = await fetch(origin + "/api" + path, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  assert.equal(r.status, status, JSON.stringify(data));
  return data;
}
let csrf = (await api("/session")).csrf;
const act = async (action: string, body: any, cred?: any, status = 200) =>
  (await api("/actions/" + action, body, cred, status)).result;
const slug = "integration-" + Date.now().toString(36);
const p = await act("project.create", {
  name: "真实 Git 集成验收",
  slug,
  configVersion: "1",
  policyVersion: "1",
  toolVersion: "node22",
  runnerId: "acceptance",
  apiCommand: "api",
  e2eCommand: "e2e",
  environment: "production",
  testEnvironment: "acceptance",
});
const credentials: any = {};
for (const role of [
  "human",
  "devops_agent",
  "ide_agent",
  "ide_control",
  "runner",
]) {
  const pair = generateKeyPairSync("ed25519");
  credentials[role] = {
    ...(await act("credential.create", {
      projectId: p.id,
      name: role === "runner" ? "acceptance" : role,
      role,
      hours: 1,
      ...(["runner", "ide_control"].includes(role)
        ? {
            publicKey: pair.publicKey
              .export({ type: "spki", format: "pem" })
              .toString(),
          }
        : {}),
    })),
    privateKey: pair.privateKey,
  };
}
const workspace = async () => api("/workspace");
const subject = async (id: string) => {
  const w = await workspace();
  return [...w.intents, ...w.deliveries].find((x: any) => x.id === id);
};
const signGate = async (kind: string, id: string, gate: string) => {
  const preview = await api(`/preview/${kind}/${id}/${gate}`);
  assert.deepEqual(preview.gaps, []);
  return act("gate." + gate.toLowerCase(), {
    id,
    fingerprint: preview.fingerprint,
    reason: "真实集成验证已检查来源与恢复",
  });
};
const i = await act("intent.create", {
  projectId: p.id,
  title: "幂等工单",
  description: "重复请求只产生一个结果",
  kind: "feature",
  risk: "low",
});
const actor = (await api("/session", undefined, credentials.devops_agent))
  .actor;
const view = (
  await api(
    "/projects/" + p.id + "/workspace",
    undefined,
    credentials.devops_agent,
  )
).files["state.json"];
const requestId = "file_" + randomUUID().replaceAll("-", "");
const envelope = {
  protocolVersion: 1,
  projectId: p.id,
  intentId: i.id,
  requestId,
  operationId: requestId,
  actorId: actor.id,
  action: "plan.save",
  sourceSha: i.baseSha,
  inputFingerprint: view.intents.find((x: any) => x.id === i.id)
    .inputFingerprint,
  createdAt: new Date().toISOString(),
  payload: { id: i.id, plan: plan() },
};
const accepted = await act(
  "workspace.sync",
  envelope,
  credentials.devops_agent,
);
assert.equal(accepted.status, "ACCEPTED");
assert.deepEqual(
  await act("workspace.sync", envelope, credentials.devops_agent),
  accepted,
);
await act(
  "workspace.sync",
  { ...envelope, createdAt: new Date(Date.now() + 1000).toISOString() },
  credentials.devops_agent,
  409,
);
const snapshot = await signGate("intent", i.id, "A");
assert.ok(snapshot.sourceSha);
const baseline = await act(
  "production.attest",
  {
    projectId: p.id,
    report: {
      actualSha: snapshot.baseSha,
      artifactDigest: "sha256:" + "a".repeat(64),
      environment: "production",
      healthy: true,
      operationId: randomUUID(),
      log: "测试执行器初始版本文件",
    },
  },
  credentials.ide_control,
);
await act("production.confirm", {
  projectId: p.id,
  fingerprint: baseline.fingerprint,
});
await act(
  "gate.a",
  { id: i.id, fingerprint: snapshot.fingerprint, reason: "伪造审批" },
  credentials.ide_agent,
  403,
);
const dir = resolve(".data/test/" + slug);
await mkdir(dir, { recursive: true });
const gitEnv = {
  ...process.env,
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "http.extraHeader",
  GIT_CONFIG_VALUE_0:
    "Authorization: Basic " +
    Buffer.from("admin:" + credentials.human.token).toString("base64"),
  GIT_TERMINAL_PROMPT: "0",
};
const git = async (args: string[], cred = credentials.human) =>
  exec("git", args, {
    cwd: dir,
    env: {
      ...gitEnv,
      GIT_CONFIG_VALUE_0:
        "Authorization: Basic " +
        Buffer.from("admin:" + cred.token).toString("base64"),
    },
    timeout: 30000,
  });
await git(["clone", origin + "/git/" + slug + ".git", "."]);
await git(["config", "user.name", "集成测试"]);
await git(["config", "user.email", "integration@devops.local"]);
await git(["checkout", snapshot.branch]);
await exec(process.execPath, [resolve("cli/devops.mjs"), "workspace", "init"], {
  cwd: dir,
  env: {
    ...process.env,
    DEVOPS_URL: origin,
    DEVOPS_PROJECT: p.id,
    DEVOPS_TOKEN: credentials.human.token,
  },
});
const archived = JSON.parse(
  (
    await git([
      "show",
      "origin/devops/control:.devops/receipts/" + requestId + ".json",
    ])
  ).stdout,
);
assert.deepEqual(archived, accepted);
assert.deepEqual(
  JSON.parse(
    await readFile(
      resolve(dir, ".devops/receipts/" + requestId + ".json"),
      "utf8",
    ),
  ),
  accepted,
);
assert.equal((await git(["status", "--porcelain"])).stdout.trim(), "");

await mkdir(resolve(dir, "src"), { recursive: true });
await mkdir(resolve(dir, "tests/unit"), { recursive: true });
const source =
  'export function createTickets(){const rows=new Map();return (key,value,user)=>{if(!user)throw new Error("unauthorized");if(!rows.has(key))rows.set(key,value);return rows.get(key)}}\n';
await writeFile(resolve(dir, "src/tickets.mjs"), source);
await writeFile(
  resolve(dir, "tests/unit/tickets.test.mjs"),
  `import test from 'node:test';import assert from 'node:assert/strict';import {createTickets} from '../../src/tickets.mjs';test('重复请求保持幂等',()=>{const create=createTickets();assert.equal(create('a','first','user'),'first');assert.equal(create('a','second','user'),'first')});test('未认证请求拒绝',()=>assert.throws(()=>createTickets()('a','x',null),/unauthorized/));`,
);
await git(["add", "src", "tests"]);
await git(["commit", "-m", "实现幂等写入"]);
await git(["push", "origin", "HEAD"], credentials.ide_agent);
await assert.rejects(git(["push", "origin", "HEAD:refs/heads/bypass"]));
await assert.rejects(git(["push", "origin", "HEAD:refs/heads/main"]));
await writeFile(resolve(dir, "agent.md"), "越权修改协议");
await git(["add", "agent.md"]);
await git(["commit", "-m", "禁止协议改写测试"]);
await assert.rejects(git(["push", "origin", "HEAD"], credentials.ide_agent));
await git(["reset", "--hard", "HEAD~1"]);
await act(
  "materials.save",
  { id: i.id, materials: materials() },
  credentials.devops_agent,
);
await git(["pull", "--ff-only"]);
const unit = await exec(
  process.execPath,
  ["--test", "tests/unit/tickets.test.mjs"],
  { cwd: dir },
);
assert.match(unit.stdout, /fail 0/);
const artifactDigest =
  "sha256:" + createHash("sha256").update(source).digest("hex");
const verify = async (id: string) => {
  const sub = await subject(id);
  await git(["fetch", "origin"]);
  await git(["checkout", "--detach", sub.sourceSha]);
  const checked = await exec(
    process.execPath,
    ["--test", "tests/unit/tickets.test.mjs"],
    { cwd: dir },
  );
  assert.match(checked.stdout, /fail 0/);
  const queued = await act("build.request", { id }, credentials.ide_agent);
  await act("operation.claim", { id: queued.id }, credentials.ide_control);
  const receipt = {
    ...build(sub.sourceSha),
    operationId: queued.id,
    artifactDigest,
    log: checked.stdout,
  };
  await act("build.register", { id, build: receipt }, credentials.ide_control);
  assert.equal(
    (await workspace()).operations.find((o: any) => o.id === queued.id).status,
    "SUCCEEDED",
  );
  const ops = await act("tests.request", { id }, credentials.devops_agent);
  for (const op of ops) {
    await act("operation.claim", { id: op.id }, credentials.runner);
    await act(
      "tests.complete",
      {
        id: op.id,
        fingerprint: op.fingerprint,
        outcome: "PASSED",
        command: op.payload.command,
        environment: op.payload.environment,
        toolVersion: op.payload.toolVersion,
        dataDigest: op.payload.dataDigest,
        prepared: true,
        cleaned: true,
        beforeDigest: digest([]),
        afterDigest: digest([]),
        log: "集成契约执行器：隔离夹具准备、请求断言、清理检查通过",
      },
      credentials.runner,
    );
  }
};
await verify(i.id);
const pr = await signGate("intent", i.id, "B");
assert.ok(pr.number);
await new Promise((r) => setTimeout(r, 1500));
const current = await subject(i.id);
const d = await act("merge", {
  ids: [i.id],
  targetSha: current.targetSha,
  reason: "确认真实 Git 差异",
});
assert.ok(d.sourceSha);
assert.notEqual(d.sourceSha, current.sourceSha);
await verify(d.id);
await act(
  "system.save",
  {
    id: d.id,
    system: {
      sourceSha: d.sourceSha,
      artifactDigest,
      configVersion: "1",
      environment: "production",
      applications: d.intentIds,
      sequence: ["发布固定制品"],
      migrations: ["无"],
      healthChecks: ["版本文件与制品一致"],
      rollback: "恢复上一版本文件",
      scope: ["幂等工单"],
    },
  },
  credentials.devops_agent,
);
await signGate("delivery", d.id, "C");
const release = await act(
  "release.request",
  { id: d.id },
  credentials.ide_agent,
);
await act("operation.claim", { id: release.id }, credentials.ide_control);
await writeFile(
  resolve(dir, "actual-release.json"),
  JSON.stringify({ sha: d.sourceSha, artifactDigest }),
);
const actual = JSON.parse(
  await readFile(resolve(dir, "actual-release.json"), "utf8"),
);
await act(
  "release.complete",
  {
    id: release.id,
    fingerprint: release.fingerprint,
    outcome: "SUCCEEDED",
    actualSha: actual.sha,
    artifactDigest: actual.artifactDigest,
    environment: "production",
    healthy: true,
    log: "集成测试模拟发布：已读取实际版本文件，与签发制品一致",
  },
  credentials.ide_control,
);
assert.equal((await subject(d.id)).stage, "CLOSED");
await act("credential.revoke", { id: credentials.ide_agent.id });
await api("/workspace", undefined, credentials.ide_agent, 401);
for (const path of [
  "/identity/api/v1/repos",
  "/identity/admin",
  "/identity/devops-service/" + slug,
]) {
  assert.equal((await fetch(origin + path)).status, 403);
}
const audit = await api("/audit");
assert.ok(audit.some((e: any) => e.action === "git.push.completed"));
assert.ok(audit.some((e: any) => e.action === "release.complete"));
await writeFile(
  "doc/test_case/results/integration.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      project: p.id,
      intent: i.id,
      delivery: d.id,
      sourceSha: d.sourceSha,
      checks: [
        "真实仓库",
        "Gateway clone/push",
        "拒绝分支创建/主线/协议写入",
        "签名证据契约",
        "真实 PR/merge",
        "最终 SHA 重验",
        "模拟执行端发布对账",
        "撤销委托",
        "身份代理白名单",
        "审计链",
      ],
    },
    null,
    2,
  ),
);
console.log(
  "真实 Git 与控制面闭环通过，结果见 doc/test_case/results/integration.json",
);
