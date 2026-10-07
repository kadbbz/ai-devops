import test from "node:test";
import assert from "node:assert/strict";
import { recoverState } from "../../../src/safety.js";
import { emptyState } from "../../../src/model.js";
import { migrateLegacy } from "../../../src/migration.js";
test("恢复只撤销凭证和会话并标记未决 Git 请求，不修改需求和版本", () => {
  const s = emptyState();
  s.sessions.push({ id: "s" });
  s.credentials.push({ id: "c" });
  s.requirements.push({ id: "r", status: "DONE" });
  s.versions.push({ id: "v", sha: "abc" });
  s.requests.push(
    { id: "pending", status: "RUNNING" },
    { id: "done", status: "SUCCEEDED" },
  );
  recoverState(s, true);
  assert.equal(s.sessions.length, 0);
  assert.equal(s.credentials[0].revoked, true);
  assert.equal(s.requests[0].status, "UNKNOWN");
  assert.equal(s.requests[1].status, "SUCCEEDED");
  assert.equal(s.requirements[0].status, "DONE");
  assert.equal(s.versions[0].sha, "abc");
});
test("旧数据转换保留需求正文和项目，撤销执行器凭证，移除执行配置", () => {
  const s = migrateLegacy({
    users: [{ id: "u" }],
    projects: [
      {
        id: "p",
        name: "项目",
        slug: "project",
        members: { u: "reviewer" },
        runnerId: "runner",
        environment: "production",
      },
    ],
    intents: [
      {
        id: "i",
        projectId: "p",
        title: "历史需求",
        description: "用户正文",
        stage: "A_SIGNED",
        branch: "work/i",
        baseSha: "abc",
      },
    ],
  });
  assert.equal(s.projects[0].runnerId, undefined);
  assert.equal(s.projects[0].members.u, "member");
  assert.equal(s.requirements[0].description, "用户正文");
  assert.equal(s.requirements[0].status, "IN_PROGRESS");
  assert.equal(s.branches[0].name, "work/i");
  assert.equal(s.credentials.length, 0);
  assert.equal("approvals" in s, false);
});
