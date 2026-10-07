/** 真实 Git 路径；测试在本地 IDE 工作区执行，不向 DevOps 上报执行证明。 */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
const exec = promisify(execFile),
  origin = process.env.DEVOPS_TEST_URL || "http://localhost:18083";
const storage = JSON.parse(await readFile(".data/test/session.json", "utf8")),
  cookie = storage.cookies.map((c: any) => `${c.name}=${c.value}`).join("; ");
let csrf = "";
async function api(path: string, body?: any, token?: string, status = 200) {
  const r = await fetch(origin + "/api" + path, {
    method: body ? "POST" : "GET",
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : { Cookie: cookie }),
      ...(body
        ? {
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
            "X-CSRF-Token": csrf,
          }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  assert.equal(r.status, status, JSON.stringify(data));
  return data;
}
csrf = (await api("/session")).csrf;
const act = async (action: string, body: any, token?: string, status = 200) =>
  (await api("/actions/" + action, body, token, status)).result;
const archive = (
  await exec("python3", [
    "-c",
    `import io,zipfile,base64
b=io.BytesIO()
with zipfile.ZipFile(b,'w') as z:
 z.writestr('project/agent.md','# IDE 负责实现、测试和发布\\n')
 z.writestr('project/assets/logo.bin',bytes([0,255,1,128]))
 z.writestr('project/.hidden','keep')
 i=zipfile.ZipInfo('project/run.sh');i.external_attr=0o100755<<16;z.writestr(i,'echo hello\\n')
print(base64.b64encode(b.getvalue()).decode())`,
  ])
).stdout.trim();
const slug = "integration-" + Date.now().toString(36),
  p = await act("project.import", {
    name: "真实 Git 需求版本验收",
    slug,
    archiveName: "project.custom",
    archiveBase64: archive,
  });
const ide = await act("credential.create", {
    projectId: p.id,
    name: "IDE",
    role: "ide_agent",
    hours: 1,
  }),
  docs = await act("credential.create", {
    projectId: p.id,
    name: "需求助手",
    role: "devops_agent",
    hours: 1,
  });
const requirement = await act(
  "requirement.create",
  {
    projectId: p.id,
    title: "支持导入",
    description: "IDE 编写并运行测试",
    kind: "feature",
    priority: "normal",
  },
  docs.token,
);
const repository = await api("/projects/" + p.id + "/repository"),
  baseSha = repository.branches.find((b: any) => b.name === "main").sha;
assert.equal(
  repository.branches.some((b: any) => b.name === "production"),
  false,
);
const branch = await act(
  "branch.create",
  {
    projectId: p.id,
    name: "feature/import",
    requirementId: requirement.id,
    baseSha,
  },
  ide.token,
);
await act(
  "branch.create",
  { projectId: p.id, name: "forbidden", baseSha },
  docs.token,
  403,
);
const dir = resolve(".data/test/" + slug);
await mkdir(dir, { recursive: true });
const git = async (args: string[], token = ide.token) =>
  exec("git", args, {
    cwd: dir,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0:
        "Authorization: Basic " +
        Buffer.from("admin:" + token).toString("base64"),
      GIT_CONFIG_KEY_1: "core.hooksPath",
      GIT_CONFIG_VALUE_1: "/dev/null",
    },
    timeout: 45000,
  });
await git(["clone", origin + "/git/" + slug + ".git", "."]);
assert.deepEqual(
  await readFile(resolve(dir, "assets/logo.bin")),
  Buffer.from([0, 255, 1, 128]),
);
assert.equal(await readFile(resolve(dir, ".hidden"), "utf8"), "keep");
assert.match((await git(["ls-files", "--stage", "run.sh"])).stdout, /100755/);
await git(["config", "user.name", "IDE 集成验证"]);
await git(["config", "user.email", "ide@localhost"]);
await git(["checkout", branch.name]);
const cliEnv = {
  ...process.env,
  DEVOPS_URL: origin,
  DEVOPS_PROJECT: p.id,
  DEVOPS_TOKEN: ide.token,
};
const sync = async (op = "sync") =>
  exec(process.execPath, [resolve("cli/devops.mjs"), "workspace", op], {
    cwd: dir,
    env: cliEnv,
    timeout: 45000,
  });
await sync("init");
const requestId = randomUUID(),
  envelope = {
    protocolVersion: 2,
    projectId: p.id,
    requestId,
    action: "requirement.update",
    payload: {
      id: requirement.id,
      revision: 1,
      title: requirement.title,
      description: requirement.description,
      kind: "feature",
      priority: "normal",
      status: "IN_PROGRESS",
    },
  };
await writeFile(
  resolve(dir, ".devops/outbox/" + requestId + ".json"),
  JSON.stringify(envelope),
);
await sync();
await sync();
assert.equal(
  JSON.parse(
    await readFile(
      resolve(dir, ".devops/receipts/" + requestId + ".json"),
      "utf8",
    ),
  ).status,
  "SUCCEEDED",
);
await git(["fetch", "origin"]);
assert.equal(
  JSON.parse(
    (
      await git([
        "show",
        "origin/devops/control:.devops/receipts/" + requestId + ".json",
      ])
    ).stdout,
  ).status,
  "SUCCEEDED",
);
assert.equal((await git(["status", "--porcelain"])).stdout.trim(), "");
await mkdir(resolve(dir, "tests/api"), { recursive: true });
await mkdir(resolve(dir, "tests/e2e"), { recursive: true });
await writeFile(resolve(dir, "agent.md"), "# IDE 自主负责实现和全部测试\n");
await writeFile(
  resolve(dir, "tests/api/import.test.mjs"),
  "import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';test('二进制导入无损',()=>assert.deepEqual(readFileSync('assets/logo.bin'),Buffer.from([0,255,1,128])));",
);
await writeFile(
  resolve(dir, "tests/e2e/import.spec.ts"),
  "// 项目 E2E 由 IDE 维护\n",
);
const testRun = await exec(
  process.execPath,
  ["--test", "tests/api/import.test.mjs"],
  { cwd: dir },
);
assert.match(testRun.stdout, /fail 0/);
await git(["add", "agent.md", "tests"]);
await git(["commit", "-m", "IDE：编写测试并更新约定"]);
await git(["push", "origin", "HEAD"]);
await assert.rejects(git(["push", "origin", "HEAD:refs/heads/bypass"]));
await assert.rejects(git(["push", "origin", "HEAD:refs/heads/main"]));
await assert.rejects(git(["push", "origin", "HEAD:refs/tags/bypass"]));
await writeFile(resolve(dir, "second.txt"), "scope");
await git(["add", "second.txt"]);
await git(["commit", "-m", "第二次变更"]);
await assert.rejects(git(["push", "origin", "HEAD"], docs.token));
await git(["push", "origin", "HEAD"]);
const mainBranch = await act(
  "branch.create",
  { projectId: p.id, name: "feature/main-conflict", baseSha },
  ide.token,
);
await git(["fetch", "origin"]);
await git(["checkout", "-b", mainBranch.name, "origin/main"]);
await writeFile(resolve(dir, "agent.md"), "# main 分支的约定\n");
await git(["add", "agent.md"]);
await git(["commit", "-m", "主线并行修改约定"]);
await git(["push", "origin", "HEAD"]);
const mainPr = await act(
  "pr.create",
  {
    projectId: p.id,
    branchId: mainBranch.id,
    title: "主线并行修改",
    description: "制造冲突检测样本",
  },
  ide.token,
);
let mainView: any;
for (let n = 0; n < 30; n++) {
  mainView = await api("/pulls/" + mainPr.id);
  if (!mainView.conflicts?.length) break;
  await new Promise((r) => setTimeout(r, 500));
}
await act(
  "pr.merge",
  { id: mainPr.id, headSha: mainView.headSha, targetSha: mainView.targetSha },
  ide.token,
);
await git(["checkout", branch.name]);
const pr = await act(
  "pr.create",
  {
    projectId: p.id,
    branchId: branch.id,
    title: "支持导入",
    description: "IDE 自行完成验证",
  },
  ide.token,
);
let view: any;
for (let n = 0; n < 30; n++) {
  view = await api("/pulls/" + pr.id);
  if (view.conflicts?.length) break;
  await new Promise((r) => setTimeout(r, 500));
}
assert.ok(view.conflicts?.length);
assert.equal(view.conflicts[0].path, "agent.md");
const conflictChoice = await act("pr.conflict.choice", {
  id: pr.id,
  headSha: view.headSha,
  targetSha: view.targetSha,
  choices: [{ path: "agent.md", choice: "left" }],
});
assert.equal(conflictChoice.next, "IDE_AGENT_MUST_RESOLVE_AND_PUSH");
await act(
  "pr.merge",
  { id: pr.id, headSha: view.headSha, targetSha: view.targetSha },
  ide.token,
  409,
);
await writeFile(resolve(dir, "agent.md"), "# main 分支的约定\n");
await git(["add", "agent.md"]);
await git(["commit", "-m", "IDE：按人类选择解决冲突"]);
await git(["push", "origin", "HEAD"]);
for (let n = 0; n < 30; n++) {
  view = await api("/pulls/" + pr.id);
  if (!view.conflicts?.length) break;
  await new Promise((r) => setTimeout(r, 500));
}
assert.equal(view.conflicts?.length || 0, 0);
assert.match(view.diff, /tests\/api/);
await act(
  "pr.merge",
  { id: pr.id, headSha: "0".repeat(40), targetSha: baseSha },
  ide.token,
  409,
);
const merged = await act(
  "pr.merge",
  { id: pr.id, headSha: view.headSha, targetSha: view.targetSha },
  ide.token,
);
const version = await act(
  "version.create",
  {
    projectId: p.id,
    name: "v1.0.0",
    sha: merged.mergeSha,
    notes: "首个版本",
    requirementIds: [requirement.id],
  },
  ide.token,
);
await git(["fetch", "--tags", "origin"]);
assert.equal(
  (await git(["rev-parse", "v1.0.0^{commit}"])).stdout.trim(),
  merged.mergeSha,
);
await act("branch.delete", { id: branch.id, headSha: view.headSha }, ide.token);
const workspace = await api("/workspace");
assert.equal(
  workspace.requirements.find((r: any) => r.id === requirement.id).status,
  "IN_PROGRESS",
);
for (const name of ["operations", "evidence", "approvals", "deliveries"])
  assert.equal(workspace[name], undefined);
for (const action of [
  "gate.a",
  "tests.request",
  "tests.complete",
  "build.request",
  "release.request",
  "operation.claim",
  "production.confirm",
])
  await act(action, {}, ide.token, 404);
await act("credential.revoke", { id: ide.id });
await api("/workspace", undefined, ide.token, 401);
for (const path of [
  "/identity/api/v1/repos",
  "/identity/admin",
  "/identity/devops-service/" + slug,
])
  assert.equal((await fetch(origin + path)).status, 403);
const audit = await api("/audit");
for (const action of [
  "git.push.completed",
  "pr.merge.completed",
  "version.create.completed",
])
  assert.ok(audit.some((e: any) => e.action === action));
await mkdir("doc/test_case/results", { recursive: true });
await writeFile(
  "doc/test_case/results/integration.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      project: p.id,
      requirement: requirement.id,
      version: version.id,
      sha: merged.mergeSha,
      checks: [
        "真实压缩包与二进制导入",
        "IDE Gateway clone/push",
        "API/E2E 与 agent.md 可推送",
        "拒绝绕过分支/主线/tag",
        "需求文件同步及控制分支回执",
        "无审批或执行证明合并",
        "真实不可变标签",
        "旧执行接口关闭",
        "权限撤销",
        "审计",
      ],
    },
    null,
    2,
  ),
);
console.log("真实需求与 Git 版本路径全部通过");
