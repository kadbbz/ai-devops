import test from "node:test";
import assert from "node:assert/strict";
import {
  nextBackup,
  retainedBackups,
  safeArchiveEntry,
} from "../../../src/backup.js";
import { parsePush } from "../../../src/gateway.js";

test("北京时间 03:00 调度与错过计划后的唯一补跑点", () => {
  assert.equal(
    nextBackup(new Date("2026-10-05T18:00:00Z"), "03:00", "Asia/Shanghai"),
    "2026-10-05T19:00:00.000Z",
  );
  assert.equal(
    nextBackup(new Date("2026-10-05T20:00:00Z"), "03:00", "Asia/Shanghai"),
    "2026-10-06T19:00:00.000Z",
  );
});
test("保留完整恢复点并排除半成品，升级前备份单独保留", () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({
    id: `b${i}`,
    createdAt: new Date(Date.UTC(2026, 8, i + 1)).toISOString(),
    status: "COMPLETED",
    reason: i === 1 ? "upgrade" : "scheduled",
  }));
  rows.push({
    id: "broken",
    createdAt: "2026-11-01T00:00:00Z",
    status: "FAILED",
    reason: "scheduled",
  });
  const keep = retainedBackups(rows);
  assert.equal(keep.has("broken"), false);
  assert.equal(keep.has("b39"), true);
  assert.equal(keep.has("b1"), true);
  assert.ok(keep.size >= 7 && keep.size <= 12);
});
test("恢复归档禁止路径逃逸与根目录覆盖", () => {
  for (const p of [
    "/etc/passwd",
    "../secrets",
    "data/../../etc/passwd",
    "data\\..\\evil",
  ])
    assert.equal(safeArchiveEntry(p), false);
  for (const p of [
    "./mysql/ibdata1",
    "./gitea/repos/a.git/objects/ab/123",
    "config/gitea.ini",
  ])
    assert.equal(safeArchiveEntry(p), true);
});
test("Git smart HTTP 拒绝多 ref 与非法长度", () => {
  const packet = (v: string) =>
    (Buffer.byteLength(v) + 4).toString(16).padStart(4, "0") + v;
  const command =
    "a".repeat(40) + " " + "b".repeat(40) + " refs/heads/work/abc\n";
  assert.equal(
    parsePush(Buffer.from(packet(command) + "0000")).command.ref,
    "refs/heads/work/abc",
  );
  assert.throws(
    () => parsePush(Buffer.from(packet(command) + packet(command) + "0000")),
    /一个/,
  );
  assert.throws(() => parsePush(Buffer.from("ffffinvalid")), /截断/);
});
