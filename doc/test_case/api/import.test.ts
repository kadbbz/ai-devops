import test from "node:test";
import assert from "node:assert/strict";
import { exec } from "../../../src/git.js";
import { createApp } from "../../../src/server.js";
import { MemoryStore } from "../../../src/store.js";
import { FakeGitea, seed } from "./fixtures.js";
async function archive(entries: any[], tar = false) {
  return (
    await exec("python3", [
      "-c",
      `import io,zipfile,tarfile,json,base64,sys
b=io.BytesIO()
entries=json.loads(sys.argv[1])
if sys.argv[2]=='true':
 with tarfile.open(fileobj=b,mode='w:gz') as a:
  for n,v,m in entries:
   data=base64.b64decode(v);i=tarfile.TarInfo(n);i.size=len(data);i.mode=m;a.addfile(i,io.BytesIO(data))
else:
 with zipfile.ZipFile(b,'w') as a:
  for n,v,m in entries:
   i=zipfile.ZipInfo(n);i.external_attr=m<<16;a.writestr(i,base64.b64decode(v))
print(base64.b64encode(b.getvalue()).decode())`,
      JSON.stringify(entries),
      String(tar),
    ])
  ).stdout.trim();
}
const entry = (p: string, v: string | Buffer, m = 0o100644) => [
  p,
  Buffer.from(v).toString("base64"),
  m,
];
test("无关后缀 ZIP/TAR 导入保留源码、二进制、执行位和原始 agent.md", async () => {
  const git = new FakeGitea(),
    app = await createApp({
      store: new MemoryStore(seed()),
      git,
      testing: true,
    });
  try {
    for (const tar of [false, true]) {
      const files = [
        entry("repo/agent.md", "# 原项目约定\n"),
        entry("repo/src/main.ts", "export const ok=true"),
        entry("repo/picture.bin", Buffer.from([0, 255, 1])),
        entry("repo/run.sh", "echo ok", 0o100755),
        entry("repo/.git/config", "ignored"),
      ];
      const r = await app.inject({
        method: "POST",
        url: "/api/actions/project.import",
        headers: {
          authorization: "Bearer owner",
          "idempotency-key": crypto.randomUUID(),
        },
        payload: {
          name: "源码导入",
          archiveName: "source.anything",
          archiveBase64: await archive(files, tar),
        },
      });
      assert.equal(r.statusCode, 200, r.body);
      assert.equal(
        git.initialFiles["agent.md"].data.toString(),
        "# 原项目约定\n",
      );
      assert.deepEqual(
        git.initialFiles["picture.bin"].data,
        Buffer.from([0, 255, 1]),
      );
      assert.equal(git.initialFiles["run.sh"].mode, "100755");
      assert.equal(git.initialFiles[".git/config"], undefined);
    }
  } finally {
    await app.close();
  }
});
test("无 agent.md、路径穿越、链接、重复与大小写碰撞在创建仓库前拒绝", async () => {
  const git = new FakeGitea(),
    app = await createApp({
      store: new MemoryStore(seed()),
      git,
      testing: true,
    });
  try {
    for (const files of [
      [entry("readme.md", "missing")],
      [entry("agent.md", "ok"), entry("../outside", "bad")],
      [entry("agent.md", "ok"), entry("link", "outside", 0o120777)],
      [entry("agent.md", "ok"), entry("agent.md", "duplicate")],
      [entry("agent.md", "ok"), entry("AGENT.md", "collision")],
    ]) {
      const r = await app.inject({
        method: "POST",
        url: "/api/actions/project.import",
        headers: {
          authorization: "Bearer owner",
          "idempotency-key": crypto.randomUUID(),
        },
        payload: {
          name: "错误导入",
          archiveName: "any",
          archiveBase64: await archive(files),
        },
      });
      assert.equal(r.statusCode, 400, r.body);
    }
    assert.equal(git.projectsCreated, 0);
  } finally {
    await app.close();
  }
});
