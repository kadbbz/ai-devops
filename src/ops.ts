import { spawn, type ChildProcess } from "node:child_process";
import { createServer, request as proxyRequest } from "node:http";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  stat,
  chown,
  chmod,
  unlink,
  statfs,
  rm,
} from "node:fs/promises";
import { existsSync, appendFileSync, renameSync } from "node:fs";
import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { exec, Gitea } from "./git.js";
import { MysqlStore } from "./store.js";
import { check, now, id } from "./model.js";
import {
  nextBackup,
  retainedBackups,
  safeArchiveEntry,
  fileDigest,
} from "./backup.js";
import { recoverState } from "./safety.js";
const DATA = "/data",
  BACKUP = "/backup",
  CONFIG = "/data/config/devops.json",
  SECRET = "/data/secrets/devops.json",
  ROOT_SECRET = "/data/secrets/root.json";
const VERSION = {
  app: "2.0.0",
  mysql: "8.4.6",
  gitea: "1.24.6",
  node: "22.20.0",
  architecture: process.arch,
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function json(path: string, fallback: any = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}
async function atomic(path: string, value: any, mode = 0o600) {
  await writeFile(path + ".tmp", JSON.stringify(value, null, 2), { mode });
  await rename(path + ".tmp", path);
}
async function waitFor(fn: () => Promise<any>, seconds = 90) {
  let error: any;
  for (let i = 0; i < seconds; i++) {
    try {
      return await fn();
    } catch (e) {
      error = e;
      await sleep(1000);
    }
  }
  throw error || new Error("服务启动超时");
}
async function dir(path: string, uid = 0, gid = 0, mode = 0o700) {
  await mkdir(path, { recursive: true, mode });
  await chown(path, uid, gid);
  await chmod(path, mode);
}
export class Manager {
  private children = new Map<string, ChildProcess>();
  private phase = "STARTING";
  private busy = false;
  private shutting = false;
  private activeRequests = 0;
  private config: any;
  private secrets: any;
  private root: any;
  private timer?: NodeJS.Timeout;
  async status(extra: any = {}) {
    await atomic("/data/ops/status.json", {
      phase: this.phase,
      at: now(),
      services: Object.fromEntries(
        [...this.children].map(([k, p]) => [
          k,
          { running: p.exitCode === null, pid: p.pid },
        ]),
      ),
      backups: await this.backups(),
      schedule: await json("/data/ops/schedule.json"),
      lastBackup: await json("/data/ops/last-backup.json"),
      restore: await json("/data/ops/restore.json"),
      ...extra,
    });
    await chown("/data/ops/status.json", 1002, 1002);
  }
  private log(name: string, chunk: Buffer) {
    const path = `/data/logs/${name}.log`;
    try {
      if (
        existsSync(path) &&
        Buffer.byteLength(chunk) + Number(requireSize(path)) > 20 * 1024 * 1024
      ) {
        for (let i = 9; i >= 1; i--)
          if (existsSync(path + "." + i))
            renameSync(path + "." + i, path + "." + (i + 1));
        renameSync(path, path + ".1");
      }
      appendFileSync(path, chunk, { mode: 0o600 });
    } catch {}
  }
  private child(
    name: string,
    command: string,
    args: string[],
    uid: number,
    gid: number,
    env: any = {},
  ) {
    const p = spawn(command, args, {
      cwd: "/app",
      uid,
      gid,
      env: {
        PATH: process.env.PATH,
        TZ: "Asia/Shanghai",
        HOME: uid === 1001 ? "/data/gitea" : "/tmp",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.children.set(name, p);
    p.stdout?.on("data", (c) => this.log(name, c));
    p.stderr?.on("data", (c) => this.log(name, c));
    p.once("error", () => {
      this.phase = "FAILED";
    });
    p.once("close", () => {
      if (this.children.get(name) === p) this.children.delete(name);
      if (!this.busy && !this.shutting) {
        this.phase = "FAILED";
        void this.status({ message: `${name} 意外退出` });
        this.shutting = true;
        void this.stopAll().finally(() => process.exit(1));
      }
    });
    return p;
  }
  private async stop(name: string, seconds = 100) {
    const p = this.children.get(name);
    if (!p) return;
    p.kill("SIGTERM");
    for (let i = 0; i < seconds * 10; i++) {
      if (!this.children.has(name)) return;
      await sleep(100);
    }
    throw new Error(`${name} 未正常停止，禁止冷备`);
  }
  private async stopAll() {
    await this.stop("web");
    await this.stop("gitea");
    await this.stop("mysql");
  }
  private async startMysql() {
    if (this.children.has("mysql")) return;
    this.child(
      "mysql",
      "/usr/sbin/mysqld",
      [
        "--user=mysql",
        "--datadir=/data/mysql",
        "--socket=/run/devops/mysql.sock",
        "--pid-file=/run/devops/mysql.pid",
        "--bind-address=127.0.0.1",
        "--port=3306",
        "--mysqlx=0",
      ],
      999,
      999,
    );
    await waitFor(async () => {
      const c = await mysql
        .createConnection({
          socketPath: "/run/devops/mysql.sock",
          user: "root",
          password: this.root.mysqlPassword,
        })
        .catch(async (e) => {
          if (this.root.initialized) throw e;
          return mysql.createConnection({
            socketPath: "/run/devops/mysql.sock",
            user: "root",
          });
        });
      await c.query("SELECT 1");
      await c.end();
    });
  }
  private async giteaCli(args: string[]) {
    return exec(
      "/usr/local/bin/gitea",
      ["--config", "/data/config/gitea.ini", ...args],
      {
        uid: 1001,
        gid: 1001,
        env: {
          PATH: process.env.PATH,
          HOME: "/data/gitea",
          GITEA_WORK_DIR: "/data/gitea",
        },
        timeout: 120000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
  }
  private async startGitea() {
    if (this.children.has("gitea")) return;
    this.child(
      "gitea",
      "/usr/local/bin/gitea",
      ["--config", "/data/config/gitea.ini", "web"],
      1001,
      1001,
      { GITEA_WORK_DIR: "/data/gitea" },
    );
    await waitFor(async () => {
      const r = await fetch(this.config.giteaUrl + "/api/healthz");
      check(r.ok, "GITEA_START", "Gitea 尚未就绪");
    });
  }
  private async startWeb() {
    if (this.children.has("web")) return;
    this.child(
      "web",
      "/usr/local/bin/node",
      ["/app/dist/server.js"],
      1002,
      1002,
      {
        NODE_ENV: "production",
        DEVOPS_CONFIG: CONFIG,
      },
    );
    await waitFor(async () => {
      const r = await fetch("http://127.0.0.1:8081/api/health");
      check(r.ok, "APP_START", "控制面尚未就绪");
    });
  }
  async bootstrap() {
    await dir(DATA, 0, 0, 0o711);
    await dir(BACKUP);
    await dir("/run/devops", 0, 0, 0o777);
    await dir("/data/ops", 1002, 1002);
    await dir("/data/config", 0, 0, 0o755);
    await dir("/data/secrets", 0, 0, 0o711);
    await dir("/data/logs");
    await dir("/data/mysql", 999, 999);
    await dir("/data/gitea", 1001, 1001);
    await dir("/data/devops", 1002, 1002);
    await dir("/data/devops/objects", 1002, 1002);
    await dir("/backup/snapshots");
    await dir("/backup/.partial");
    await dir("/backup/reports");
    const mounts = await readFile("/proc/self/mountinfo", "utf8");
    check(
      mounts.includes(" /data ") && mounts.includes(" /backup "),
      "VOLUMES_REQUIRED",
      "必须挂载 data 与 backup 两个独立卷",
      503,
    );
    const dataStat = await stat(DATA),
      backupStat = await stat(BACKUP);
    check(
      dataStat.dev !== backupStat.dev || dataStat.ino !== backupStat.ino,
      "VOLUME_CONFLICT",
      "data 与 backup 不能是同一目录",
    );
    check(
      !existsSync("/data/.restore-incomplete"),
      "RESTORE_INCOMPLETE",
      "恢复未完整完成，拒绝启动",
    );
    this.busy = true;
    this.root = await json(ROOT_SECRET);
    if (!this.root) {
      check(
        !(await readdir("/data/mysql")).length,
        "UNKNOWN_DATA",
        "存在未知 MySQL 数据，拒绝初始化",
      );
      this.root = {
        installationId: id("installation"),
        mysqlPassword: randomBytes(32).toString("hex"),
        appPassword: randomBytes(32).toString("hex"),
        gitPassword: randomBytes(32).toString("hex"),
        adminPassword: "admin",
        adminPasswordDefault: true,
        servicePassword: randomBytes(24).toString("hex"),
        auditKey: randomBytes(32).toString("hex"),
      };
      await atomic(ROOT_SECRET, this.root);
    }
    this.config = await json(CONFIG);
    if (!this.config) {
      this.config = {
        origin: process.env.PUBLIC_ORIGIN || "http://localhost:8080",
        giteaUrl: "http://127.0.0.1:3000",
        port: 8081,
        secretsFile: SECRET,
        version: VERSION,
      };
      await atomic(CONFIG, this.config, 0o644);
    }
    this.config.giteaUrl = "http://127.0.0.1:3000";
    await atomic(CONFIG, this.config, 0o644);
    await this.status({ message: "初始化数据库与统一身份" });
    if (!existsSync("/data/mysql/auto.cnf"))
      await exec(
        "/usr/sbin/mysqld",
        ["--initialize-insecure", "--user=mysql", "--datadir=/data/mysql"],
        { timeout: 120000 },
      );
    await this.startMysql();
    const connection = await mysql
      .createConnection({
        socketPath: "/run/devops/mysql.sock",
        user: "root",
        password: this.root.mysqlPassword,
      })
      .catch(async (e) => {
        if (this.root.initialized) throw e;
        return mysql.createConnection({
          socketPath: "/run/devops/mysql.sock",
          user: "root",
        });
      });
    for (const [db, password] of [
      ["devops", this.root.appPassword],
      ["gitea", this.root.gitPassword],
    ]) {
      await connection.query(
        `CREATE DATABASE IF NOT EXISTS ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
      await connection.query(
        `CREATE USER IF NOT EXISTS '${db}'@'127.0.0.1' IDENTIFIED BY '${password}'`,
      );
      await connection.query(`GRANT ALL ON ${db}.* TO '${db}'@'127.0.0.1'`);
    }
    if (!this.root.initialized) {
      await connection.query(
        `ALTER USER 'root'@'localhost' IDENTIFIED BY '${this.root.mysqlPassword}'`,
      );
      this.root.initialized = true;
      await atomic(ROOT_SECRET, this.root);
    }
    await connection.end();
    if (!existsSync("/data/config/gitea.ini")) {
      await writeFile(
        "/data/config/gitea.ini",
        `APP_NAME = DevOps Identity\nRUN_USER = git\nWORK_PATH = /data/gitea\n[database]\nDB_TYPE = mysql\nHOST = 127.0.0.1:3306\nNAME = gitea\nUSER = gitea\nPASSWD = ${this.root.gitPassword}\n[repository]\nROOT = /data/gitea/repositories\n[server]\nAPP_DATA_PATH = /data/gitea/data\nROOT_URL = ${this.config.origin}/identity/\nHTTP_ADDR = 127.0.0.1\nHTTP_PORT = 3000\nDISABLE_SSH = true\nOFFLINE_MODE = true\n[security]\nINSTALL_LOCK = true\nENABLE_PASSKEY_AUTHENTICATION = false\nSECRET_KEY = ${randomBytes(32).toString("hex")}\nINTERNAL_TOKEN = ${randomBytes(48).toString("hex")}\n[service]\nDISABLE_REGISTRATION = true\nREQUIRE_SIGNIN_VIEW = true\n[session]\nPROVIDER = db\nCOOKIE_SECURE = ${this.config.origin.startsWith("https:")}\n[log]\nMODE = console\nLEVEL = warn\n`,
        { mode: 0o600 },
      );
      await chown("/data/config/gitea.ini", 1001, 1001);
    }
    const giteaConfig = await readFile("/data/config/gitea.ini", "utf8");
    const passkeyLine = "ENABLE_PASSKEY_AUTHENTICATION = false";
    const securedGiteaConfig = /^\s*ENABLE_PASSKEY_AUTHENTICATION\s*=.*$/m.test(
      giteaConfig,
    )
      ? giteaConfig.replace(
          /^\s*ENABLE_PASSKEY_AUTHENTICATION\s*=.*$/m,
          passkeyLine,
        )
      : giteaConfig.replace("[security]\n", `[security]\n${passkeyLine}\n`);
    if (securedGiteaConfig !== giteaConfig) {
      await writeFile("/data/config/gitea.ini", securedGiteaConfig, {
        mode: 0o600,
      });
      await chown("/data/config/gitea.ini", 1001, 1001);
    }
    await this.giteaCli(["migrate"]);
    const users = (await this.giteaCli(["admin", "user", "list"])).stdout;
    for (const [username, password] of [
      ["admin", this.root.adminPassword],
      ["devops-service", this.root.servicePassword],
    ])
      if (!users.split("\n").some((l) => l.split(/\s+/).includes(username)))
        await this.giteaCli([
          "admin",
          "user",
          "create",
          "--username",
          username,
          "--password",
          password,
          "--email",
          `${username}@devops.local`,
          ...(username === "admin" || username === "devops-service"
            ? ["--admin"]
            : []),
          "--must-change-password=false",
        ]);
    // 服务身份需要调用 Gitea 管理 API；对已有卷补齐管理员标记，保持重启幂等。
    const identityDb = await mysql.createConnection({
      socketPath: "/run/devops/mysql.sock",
      user: "root",
      password: this.root.mysqlPassword,
      database: "gitea",
    });
    await identityDb.query(
      "UPDATE `user` SET is_admin = 1 WHERE lower_name = 'devops-service'",
    );
    await identityDb.end();
    if (!this.root.servicePasswordFixed) {
      await this.giteaCli([
        "admin",
        "user",
        "change-password",
        "--username",
        "devops-service",
        "--password",
        this.root.servicePassword,
        "--must-change-password=false",
      ]);
      this.root.servicePasswordFixed = true;
      await atomic(ROOT_SECRET, this.root);
    }
    this.secrets = await json(SECRET);
    if (!this.secrets) {
      const token = (
        await this.giteaCli([
          "admin",
          "user",
          "generate-access-token",
          "--username",
          "devops-service",
          "--token-name",
          "devops-internal-" + Date.now(),
          "--scopes",
          "all",
          "--raw",
        ])
      ).stdout
        .trim()
        .split("\n")
        .at(-1);
      check(
        token && /^[a-f0-9]{40}$/.test(token),
        "TOKEN_INIT",
        "内部令牌生成失败",
      );
      this.secrets = {
        databaseUrl: `mysql://devops:${this.root.appPassword}@127.0.0.1:3306/devops`,
        auditKey: this.root.auditKey,
        giteaToken: token,
        adminPasswordDefault: this.root.adminPasswordDefault === true,
      };
      await atomic(SECRET, this.secrets);
      await chown(SECRET, 1002, 1002);
    } else if (typeof this.secrets.adminPasswordDefault !== "boolean") {
      this.secrets.adminPasswordDefault =
        this.root.adminPasswordDefault === true;
      await atomic(SECRET, this.secrets);
      await chown(SECRET, 1002, 1002);
    }
    await this.startGitea();
    const git = new Gitea(this.config.giteaUrl, this.secrets.giteaToken);
    if (!this.secrets.oauth) {
      const oauth = await git.api("/user/applications/oauth2", "POST", {
        name: "DevOps",
        confidential_client: true,
        skip_secondary_authorization: true,
        redirect_uris: [this.config.origin + "/api/auth/callback"],
      });
      this.secrets.oauth = {
        clientId: oauth.client_id,
        clientSecret: oauth.client_secret,
      };
      await atomic(SECRET, this.secrets);
      await chown(SECRET, 1002, 1002);
    }
    const store = new MysqlStore(
      this.secrets.databaseUrl,
      this.secrets.auditKey,
    );
    await store.init();
    const s = await store.read();
    if (!s.users.length) {
      const admin = await git.api("/users/admin");
      await store.change("bootstrap", "installation.identity", (s) =>
        s.users.push({
          id: String(admin.id),
          giteaId: String(admin.id),
          username: admin.login,
          admin: true,
          active: true,
        }),
      );
      await atomic("/data/secrets/bootstrap.json", {
        username: "admin",
        password: this.root.adminPassword,
        origin: this.config.origin,
      });
    }
    const restoreMarker = await json("/data/ops/restore.json");
    const firstRestore =
      restoreMarker?.requiresReconciliation && !restoreMarker.processedAt;
    if (firstRestore) {
      for (const project of s.projects) {
        await git.withRepo(project, async (cwd) => {
          await exec("git", ["fsck", "--full", "--no-reflogs"], {
            cwd,
            env: git.env(),
            timeout: 60000,
          });
        });
        const expectedTags = restoreMarker.tags?.[project.id];
        if (expectedTags)
          check(
            JSON.stringify(
              (await git.tags(project)).sort((a: any, b: any) =>
                a.name.localeCompare(b.name),
              ),
            ) ===
              JSON.stringify(
                expectedTags.sort((a: any, b: any) =>
                  a.name.localeCompare(b.name),
                ),
              ),
            "RESTORE_TAGS",
            "仓库标签与归档清单不一致",
          );
        const expected = restoreMarker.refs?.[project.id];
        if (expected)
          check(
            JSON.stringify(
              (await git.branches(project)).sort((a: any, b: any) =>
                a.name.localeCompare(b.name),
              ),
            ) ===
              JSON.stringify(
                expected.sort((a: any, b: any) => a.name.localeCompare(b.name)),
              ),
            "RESTORE_REFS",
            "仓库引用与归档清单不一致",
          );
      }
    }
    await store.change(
      "ops",
      firstRestore ? "installation.restore" : "installation.restart",
      (state) => recoverState(state, !!firstRestore),
    );
    if (firstRestore)
      await atomic("/data/ops/restore.json", {
        ...restoreMarker,
        processedAt: now(),
        checks: ["mysql", "audit_chain", "git_fsck", "git_refs", "identity"],
        status: "RESTORE_VERIFIED",
        requiresReconciliation: true,
      });
    await store.close();
    if (!(await json("/data/ops/schedule.json")))
      await atomic("/data/ops/schedule.json", {
        time: "03:00",
        zone: "Asia/Shanghai",
        nextAt: nextBackup(new Date()),
        lastSuccess: null,
      });
    if (process.env.DEVOPS_RESTORE_DRILL === "1") {
      this.busy = false;
      this.phase = "RESTORE_VERIFIED";
      await this.status({ message: "隔离恢复验证完成；未开放登录与操作派发" });
      return;
    }
    await this.startWeb();
    this.busy = false;
    if (!(await this.backups()).some((x) => x.status === "COMPLETED"))
      await this.backup("initial");
    this.phase = "READY";
    await this.status({ message: "已就绪" });
  }
  private async backups() {
    const rows = [];
    for (const name of await readdir("/backup/snapshots").catch(() => [])) {
      const item = await json(`/backup/snapshots/${name}/manifest.json`);
      if (item) rows.push(item);
    }
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async backup(reason = "manual") {
    check(!this.busy, "OPS_BUSY", "已有运维操作");
    this.busy = true;
    const backupId = id("bk"),
      work = `/backup/.partial/${backupId}`;
    let stopped = false,
      completed = false;
    const schedule = await json("/data/ops/schedule.json");
    const report: any = {
      id: backupId,
      reason,
      createdAt: now(),
      version: VERSION,
      status: "RUNNING",
    };
    try {
      const size = Number(
          (await exec("du", ["-sb", DATA])).stdout.split(/\s/)[0],
        ),
        capacity = await statfs(BACKUP);
      check(
        capacity.bavail * capacity.bsize > size * 1.1 + 64 * 1024 * 1024,
        "BACKUP_SPACE",
        "backup 可用空间不足",
      );
      report.dataBytes = size;
      await mkdir(work, { mode: 0o700 });
      this.phase = "MAINTENANCE";
      await this.status({ message: "正在排空写入并创建一致性备份" });
      for (let i = 0; i < 600 && this.activeRequests; i++) await sleep(100);
      check(!this.activeRequests, "DRAIN_TIMEOUT", "请求排空超时");
      await this.stop("web");
      const store = new MysqlStore(
        this.secrets.databaseUrl,
        this.secrets.auditKey,
      );
      await store.change("ops", "backup.cutoff", () => null, {
        backupId,
        reason,
      });
      const audit = await store.audit();
      report.auditHead = audit[0]?.hash;
      const state = await store.read(),
        git = new Gitea(this.config.giteaUrl, this.secrets.giteaToken);
      report.refs = {};
      report.tags = {};
      for (const project of state.projects) {
        report.refs[project.id] = await git.branches(project);
        report.tags[project.id] = await git.tags(project);
      }
      report.schema = 2;
      report.installationId = this.root.installationId;
      report.cutoff = now();
      await store.close();
      await atomic("/data/ops/maintenance.json", {
        backupId,
        at: report.cutoff,
      });
      await this.stopAll();
      stopped = true;
      await exec(
        "tar",
        [
          "--zstd",
          "--numeric-owner",
          "-cpf",
          work + "/data.tar.zst",
          "-C",
          DATA,
          ".",
        ],
        { timeout: 3600000, maxBuffer: 1024 * 1024 },
      );
      await exec("tar", ["--zstd", "-tf", work + "/data.tar.zst"], {
        timeout: 3600000,
        maxBuffer: 16 * 1024 * 1024,
      });
      report.sha256 = await fileDigest(work + "/data.tar.zst");
      report.bytes = (await stat(work + "/data.tar.zst")).size;
      report.status = "COMPLETED";
      await atomic(work + "/manifest.json", report);
      await writeFile(
        work + "/checksums.sha256",
        report.sha256 + "  data.tar.zst\n",
        { mode: 0o600 },
      );
      await exec("sync", []);
      await rename(work, `/backup/snapshots/${backupId}`);
      completed = true;
    } catch (e) {
      report.status = "FAILED";
      schedule.retryAt = new Date(Date.now() + 3600000).toISOString();
      await atomic("/data/ops/schedule.json", schedule);
      report.message = e instanceof Error ? e.message : "备份失败";
      await atomic("/backup/reports/" + backupId + ".json", report).catch(
        () => {},
      );
    } finally {
      try {
        if (stopped || this.phase === "MAINTENANCE") {
          await this.startMysql();
          await this.startGitea();
          await this.startWeb();
        }
        if (completed) {
          delete schedule.retryAt;
          schedule.lastSuccess = report.cutoff;
          schedule.nextAt = nextBackup(
            new Date(),
            schedule.time,
            schedule.zone,
          );
          await atomic("/data/ops/schedule.json", schedule);
          await unlink("/data/ops/maintenance.json").catch(() => {});
          const rows = await this.backups(),
            keep = retainedBackups(rows);
          for (const r of rows)
            if (!keep.has(r.id))
              await rm("/backup/snapshots/" + r.id, { recursive: true });
        }
        this.phase = "READY";
        await this.status({ lastBackup: report });
      } catch (e) {
        this.phase = "FAILED";
        await this.status({
          lastBackup: report,
          message: "归档结束后服务恢复失败",
        });
      }
      await atomic("/data/ops/last-backup.json", report);
      this.busy = false;
    }
    check(completed, "BACKUP_FAILED", report.message || "备份未完成", 503);
    return report;
  }
  async serve() {
    const gateway = createServer((req, res) => {
      if (this.phase !== "READY") {
        res.writeHead(503, {
          "content-type": "text/html; charset=utf-8",
          "Retry-After": "30",
        });
        res.end(
          `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="refresh" content="10"><title>DevOps · 初始化与维护</title><body style="font:16px system-ui;background:#f7f5fc;color:#33234f;padding:12vh 12vw"><h1>DevOps 正在${this.phase === "MAINTENANCE" ? "备份维护" : "准备工作区"}</h1><p>当前阶段：${this.phase}。页面每 10 秒刷新。</p><p>初始化自动完成数据库、统一账号和首份备份，无需另开 Gitea 安装页。</p></body></html>`,
        );
        return;
      }
      this.activeRequests++;
      let finished = false;
      const done = () => {
        if (!finished) {
          finished = true;
          this.activeRequests--;
        }
      };
      res.once("close", done);
      const upstream = proxyRequest(
        {
          hostname: "127.0.0.1",
          port: 8081,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        (out) => {
          res.writeHead(out.statusCode || 502, out.headers);
          out.pipe(res);
        },
      );
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(503);
        res.end("服务暂时不可用");
      });
      req.pipe(upstream);
    });
    gateway.listen(8080, "0.0.0.0");
    try {
      await this.bootstrap();
    } catch (e) {
      this.busy = true;
      this.phase = "FAILED";
      await this.status({
        message: e instanceof Error ? e.message : "初始化失败",
      });
      await this.stopAll().catch(() => {});
      gateway.close();
      throw e;
    }
    this.timer =
      process.env.DEVOPS_RESTORE_DRILL === "1"
        ? undefined
        : setInterval(() => {
            void this.tick();
          }, 15000);
    for (const signal of ["SIGTERM", "SIGINT"])
      process.once(signal, async () => {
        this.shutting = true;
        this.busy = true;
        this.phase = "STOPPING";
        if (this.timer) clearInterval(this.timer);
        gateway.close();
        for (let i = 0; i < 600 && this.activeRequests; i++) await sleep(100);
        try {
          await this.stopAll();
          process.exit(0);
        } catch {
          process.exit(1);
        }
      });
  }
  private async tick() {
    if (this.busy || this.shutting) return;
    try {
      const updated = await json("/data/ops/schedule.request");
      if (updated) {
        const prior = await json("/data/ops/schedule.json");
        await atomic("/data/ops/schedule.json", {
          ...prior,
          time: updated.time,
          zone: updated.zone,
          nextAt: nextBackup(new Date(), updated.time, updated.zone),
        });
        await unlink("/data/ops/schedule.request");
      }
      const request = await json("/data/ops/backup.request");
      const schedule = await json("/data/ops/schedule.json");
      if (
        request ||
        (schedule.nextAt <= now() &&
          (!schedule.retryAt || schedule.retryAt <= now()))
      ) {
        await unlink("/data/ops/backup.request").catch(() => {});
        await this.backup(request ? "manual" : "scheduled");
      } else await this.status();
      const latestSecrets = await json(SECRET);
      if (latestSecrets) this.secrets = { ...this.secrets, ...latestSecrets };
      if (
        existsSync("/data/secrets/bootstrap.json") &&
        this.secrets.adminPasswordDefault === false
      ) {
        const git = new Gitea(this.config.giteaUrl, this.secrets.giteaToken);
        await git.api("/admin/users");
        await unlink("/data/secrets/bootstrap.json");
        this.root.adminPasswordDefault = false;
        await atomic(ROOT_SECRET, this.root);
      }
    } catch (e) {
      await this.status({
        message: e instanceof Error ? e.message : "运维检查失败",
      });
    }
  }
}
function requireSize(path: string) {
  try {
    return requireStat(path).size;
  } catch {
    return 0;
  }
}
import { statSync as requireStat } from "node:fs";
async function restore(backupId: string) {
  check(/^bk_[a-f0-9]+$/.test(backupId), "BACKUP_ID", "备份 ID 无效");
  const folder = BACKUP + "/snapshots/" + backupId,
    manifest = await json(folder + "/manifest.json");
  check(manifest?.status === "COMPLETED", "BACKUP_INVALID", "归档不完整");
  check(
    JSON.stringify(manifest.version) === JSON.stringify(VERSION),
    "VERSION_MISMATCH",
    "请使用备份对应的同版本镜像",
  );
  check(
    (await fileDigest(folder + "/data.tar.zst")) === manifest.sha256,
    "BACKUP_CHECKSUM",
    "备份摘要不符",
  );
  check(
    (await readdir(DATA)).length === 0,
    "RESTORE_NOT_EMPTY",
    "恢复只允许全新空 data 卷",
  );
  const list = (
    await exec("tar", ["--zstd", "-tf", folder + "/data.tar.zst"], {
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout
    .split("\n")
    .filter(Boolean);
  check(list.every(safeArchiveEntry), "ARCHIVE_PATH", "归档路径不安全");
  const verbose = (
    await exec("tar", ["--zstd", "-tvf", folder + "/data.tar.zst"], {
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout;
  check(
    !verbose.split("\n").some((l) => /^[lh]/.test(l)),
    "ARCHIVE_LINK",
    "恢复归档不允许符号/硬链接",
  );
  await writeFile("/data/.restore-incomplete", backupId, { mode: 0o600 });
  await exec(
    "tar",
    ["--zstd", "--numeric-owner", "-xpf", folder + "/data.tar.zst", "-C", DATA],
    { timeout: 3600000 },
  );
  await atomic("/data/ops/restore.json", {
    backupId,
    archiveSha256: manifest.sha256,
    refs: manifest.refs,
    tags: manifest.tags,
    at: now(),
    requiresReconciliation: true,
  });
  await unlink("/data/.restore-incomplete");
  console.log("归档已恢复；下一次启动将撤销短时凭证并标记未决 Git 操作。");
}
async function cli() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "serve") {
    const manager = new Manager();
    await manager.serve();
  } else if (command === "health") {
    const status = await json("/data/ops/status.json");
    check(
      status?.phase === "READY" && Date.now() - Date.parse(status.at) < 60000,
      "NOT_READY",
      "服务尚未就绪",
      503,
    );
    const response = await fetch("http://127.0.0.1:8081/api/health");
    check(response.ok, "NOT_READY", "控制面不可用");
    console.log("ready");
  } else if (command === "bootstrap" && args[0] === "show") {
    const bootstrap = await json("/data/secrets/bootstrap.json");
    check(bootstrap, "BOOTSTRAP_CONSUMED", "引导凭证已使用或尚未初始化");
    console.log(JSON.stringify(bootstrap, null, 2));
  } else if (command === "backup") {
    const path = "/data/ops/backup.request";
    await atomic(path, { id: id("backup"), at: now(), actor: "host-admin" });
    console.log("备份已登记，请在系统运维查看结果。");
  } else if (command === "restore") {
    await restore(args[0]);
  } else {
    console.log(
      "devopsctl health --ready | bootstrap show | backup | restore <backupId>",
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  cli().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
