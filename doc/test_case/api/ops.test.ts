import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../../src/server.js";
import { MemoryStore } from "../../../src/store.js";
import { seed, FakeGitea } from "./fixtures.js";
test("仅管理员可提交有效备份计划，拒绝非法时间与时区", async () => {
  const root = await mkdtemp(join(tmpdir(), "devops-ops-test-"));
  const app = await createApp({
    store: new MemoryStore(seed()),
    git: new FakeGitea(),
    testing: true,
    opsRoot: root,
  });
  const call = (token: string, payload: any) =>
    app.inject({
      method: "POST",
      url: "/api/ops/schedule",
      headers: {
        authorization: "Bearer " + token,
        "idempotency-key": crypto.randomUUID(),
      },
      payload,
    });
  assert.equal(
    (await call("ide", { time: "04:30", zone: "Asia/Shanghai" })).statusCode,
    403,
  );
  assert.equal(
    (await call("owner", { time: "25:00", zone: "Mars" })).statusCode,
    400,
  );
  assert.equal(
    (await call("owner", { time: "04:30", zone: "Asia/Shanghai" })).statusCode,
    200,
  );
  assert.equal(
    JSON.parse(await readFile(root + "/schedule.request", "utf8")).time,
    "04:30",
  );
  await app.close();
  await rm(root, { recursive: true });
});
