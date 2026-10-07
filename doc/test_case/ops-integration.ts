/** 只操作本次验收的容器与命名卷，不接触旧平台。 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
const exec = promisify(execFile),
  container = process.env.DEVOPS_TEST_CONTAINER || "ai-native-verify-devops-1";
const image = "ai-native-devops:local",
  backupVolume = "ai-native-verify_backup";
const docker = async (args: string[]) =>
  (await exec("docker", args, { timeout: 240000, maxBuffer: 8 * 1024 * 1024 }))
    .stdout;
const read = async (path: string) =>
  JSON.parse(await docker(["exec", container, "cat", path]));
// 最终镜像在全新空卷一次启动，无提前写入配置或账号。
const fresh = "ai-native-firstboot-" + Date.now().toString(36);
try {
  await docker([
    "run",
    "-d",
    "--name",
    fresh,
    "-v",
    fresh + "-data:/data",
    "-v",
    fresh + "-backup:/backup",
    image,
  ]);
  let first: any;
  for (let n = 0; n < 90; n++) {
    try {
      first = JSON.parse(
        await docker(["exec", fresh, "cat", "/data/ops/status.json"]),
      );
      if (first.phase === "READY") break;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  assert.equal(first.phase, "READY");
  assert.ok(
    first.backups.some(
      (b: any) => b.reason === "initial" && b.status === "COMPLETED",
    ),
  );
  assert.equal(first.schedule.time, "03:00");
  await docker(["exec", fresh, "devopsctl", "health", "--ready"]);
  const manifest = JSON.parse(await docker(["inspect", fresh]))[0];
  assert.deepEqual(manifest.Mounts.map((m: any) => m.Destination).sort(), [
    "/backup",
    "/data",
  ]);
  await writeFile(
    "doc/test_case/results/firstboot.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: first,
        checks: [
          "全新空卷一次启动",
          "内置 MySQL/Gitea/DevOps",
          "自动管理员/OAuth",
          "自动首备",
          "两个 named volume",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await docker(["rm", "-f", fresh]).catch(() => {});
  await docker(["volume", "rm", fresh + "-data", fresh + "-backup"]).catch(
    () => {},
  );
}
const status = await read("/data/ops/status.json"),
  before = status.backups.map((b: any) => b.id);
await docker(["exec", container, "devopsctl", "backup"]);
let latest: any;
for (let n = 0; n < 90; n++) {
  const s = await read("/data/ops/status.json");
  latest = s.backups.find((b: any) => !before.includes(b.id));
  if (latest && s.phase === "READY") break;
  await new Promise((r) => setTimeout(r, 2000));
}
assert.ok(latest?.sha256, "手动备份没有完成");
const inspect = JSON.parse(await docker(["inspect", container]))[0];
assert.deepEqual(inspect.Mounts.map((m: any) => m.Destination).sort(), [
  "/backup",
  "/data",
]);
assert.deepEqual(Object.keys(inspect.HostConfig.PortBindings), ["8080/tcp"]);
const restored = "ai-native-restore-" + Date.now().toString(36),
  restoreData = restored + "-data";
await docker(["volume", "create", restoreData]);
try {
  await docker([
    "run",
    "--rm",
    "--entrypoint",
    "devopsctl",
    "-v",
    restoreData + ":/data",
    "-v",
    backupVolume + ":/backup:ro",
    image,
    "restore",
    latest.id,
  ]);
  await docker([
    "run",
    "-d",
    "--name",
    restored,
    "-e",
    "DEVOPS_RESTORE_DRILL=1",
    "-v",
    restoreData + ":/data",
    "-v",
    backupVolume + ":/backup",
    image,
  ]);
  let restoredStatus: any;
  for (let n = 0; n < 90; n++) {
    try {
      restoredStatus = JSON.parse(
        await docker(["exec", restored, "cat", "/data/ops/status.json"]),
      );
      if (restoredStatus.phase === "RESTORE_VERIFIED") break;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  assert.equal(restoredStatus.phase, "RESTORE_VERIFIED");
  assert.equal(restoredStatus.restore.backupId, latest.id);
  assert.ok(restoredStatus.restore.checks.includes("git_fsck"));
  const web = {
    servicePresent: Boolean(restoredStatus.services.web),
    ...JSON.parse(
      await docker([
        "exec",
        restored,
        "node",
        "--input-type=module",
        "-e",
        `import net from 'node:net';
const apiPortListening = await new Promise((resolve, reject) => {
  const socket = net.createConnection({host: '127.0.0.1', port: 8081});
  socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('连接超时')); });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve(false) : reject(error));
});
const response = await fetch('http://127.0.0.1:8080/api/session', {signal: AbortSignal.timeout(5000)});
console.log(JSON.stringify({apiPortListening, gatewayStatus: response.status}));`,
      ]),
    ),
  };
  assert.equal(web.servicePresent, false);
  assert.equal(web.apiPortListening, false);
  assert.equal(web.gatewayStatus, 503);
  const counts = JSON.parse(
    await docker([
      "exec",
      restored,
      "node",
      "--input-type=module",
      "-e",
      `import fs from 'node:fs';import {MysqlStore} from '/app/dist/store.js';const c=JSON.parse(fs.readFileSync('/data/secrets/devops.json'));const store=new MysqlStore(c.databaseUrl,c.auditKey);const s=await store.read();console.log(JSON.stringify({sessions:s.sessions.length,activeCredentials:s.credentials.filter(x=>!x.revoked).length,projects:s.projects.length,intents:s.intents.length,closed:s.deliveries.filter(x=>x.stage==='CLOSED').length,confirmed:s.projects.filter(x=>x.production?.confirmed).length}));await store.close();`,
    ]),
  );
  assert.equal(counts.sessions, 0);
  assert.equal(counts.activeCredentials, 0);
  assert.equal(counts.confirmed, 0);
  assert.ok(counts.projects > 0);
  assert.ok(counts.closed > 0);
  const report = {
    at: new Date().toISOString(),
    backupId: latest.id,
    archiveSha256: latest.sha256,
    restore: restoredStatus.restore,
    counts,
    web,
    checks: [
      "手动冷备",
      "双 named volume",
      "仅公开 DevOps 端口",
      "新空卷恢复",
      "MySQL/HMAC审计链",
      "Git fsck/refs",
      "撤销会话与委托",
      "生产基线暂停",
      "历史关闭交付保留",
      "演练不启动Web",
    ],
  };
  await writeFile(
    "doc/test_case/results/restore.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    "真实冷备与隔离恢复通过，报告见 doc/test_case/results/restore.json",
  );
} finally {
  await docker(["rm", "-f", restored]).catch(
    () => {},
  ); /* 保留恢复卷供人工复核，不删除数据。 */
}
