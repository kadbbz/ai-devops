import test from "node:test";
import assert from "node:assert/strict";
import { exec } from "../../../src/git.js";
import { createApp } from "../../../src/server.js";
import { MemoryStore } from "../../../src/store.js";
import { FakeGitea, seed } from "./fixtures.js";

async function archive(entries: [string, string][]) {
  return (
    await exec("python3", [
      "-c",
      `import io,zipfile,base64,json,sys
b=io.BytesIO()
with zipfile.ZipFile(b,'w') as z:
 for name,value in json.loads(sys.argv[1]): z.writestr(name,value)
print(base64.b64encode(b.getvalue()).decode())`,
      JSON.stringify(entries),
    ])
  ).stdout.trim();
}

test("技能库与项目模板管理，并将模板技能复制到初始仓库", async () => {
  const git = new FakeGitea();
  const app = await createApp({
    store: new MemoryStore(seed()),
    git,
    testing: true,
  });
  const call = async (action: string, body: any, who = "owner") => {
    const response = await app.inject({
      method: "POST",
      url: "/api/actions/" + action,
      headers: {
        authorization: "Bearer " + who,
        "idempotency-key": crypto.randomUUID(),
      },
      payload: body,
    });
    return { status: response.statusCode, ...response.json() };
  };
  try {
    const skill = await call("skill.create", {
      name: "Node API",
      description: "API 编码约定",
      archiveName: "node.skill",
      archiveBase64: await archive([
        ["SKILL.md", "# Node API\n"],
        ["rules.md", "返回结构必须稳定\n"],
      ]),
    });
    assert.equal(skill.status, 200, JSON.stringify(skill));
    assert.match(skill.result.slug, /^node-api$/);
    assert.equal(
      (await call("skill.create", {
        name: "缺少说明",
        archiveName: "bad.bin",
        archiveBase64: await archive([["README.md", "bad"]]),
      })).code,
      "SKILL_INVALID",
    );
    const template = await call("template.create", {
      name: "Node 服务模板",
      agentMd: "# 项目协作\n由 IDE 负责实现和全部测试。\n",
      skillIds: [skill.result.id],
    });
    assert.equal(template.status, 200, JSON.stringify(template));
    assert.equal(template.result.skillIds[0], skill.result.id);
    const project = await call("project.create", {
      name: "模板项目",
      templateId: template.result.id,
    });
    assert.equal(project.status, 200, JSON.stringify(project));
    assert.equal(project.result.templateId, template.result.id);
    assert.deepEqual(
      Object.keys(git.initialFiles).sort(),
      ["agent.md", "skill/manifest.json", "skill/node-api/SKILL.md", "skill/node-api/rules.md"].sort(),
    );
    assert.equal(
      git.initialFiles["agent.md"].data.toString(),
      "# 项目协作\n由 IDE 负责实现和全部测试。\n",
    );
    const manifest = JSON.parse(
      git.initialFiles["skill/manifest.json"].data.toString(),
    );
    assert.deepEqual(manifest.skills.map((item: any) => item.slug), ["node-api"]);
    assert.equal((await call("template.create", {
      name: "不完整模板",
      agentMd: "",
      skillIds: [],
    })).code, "VALIDATION");
    assert.equal((await call("skill.delete", { id: skill.result.id })).code, "SKILL_IN_USE");
  } finally {
    await app.close();
  }
});

test("技能和模板只能由管理员维护，项目成员可以读取可选清单", async () => {
  const app = await createApp({
    store: new MemoryStore(seed()),
    git: new FakeGitea(),
    testing: true,
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/actions/template.create",
      headers: {
        authorization: "Bearer reviewer",
        "idempotency-key": crypto.randomUUID(),
      },
      payload: { name: "越权模板", agentMd: "# agent", skillIds: [] },
    });
    assert.equal(response.statusCode, 403);
    const workspace = await app.inject({
      url: "/api/workspace",
      headers: { authorization: "Bearer owner" },
    });
    assert.equal(workspace.statusCode, 200);
    assert.ok(Array.isArray(workspace.json().skills));
    assert.ok(Array.isArray(workspace.json().templates));
  } finally {
    await app.close();
  }
});
