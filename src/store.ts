import mysql from "mysql2/promise";
import {
  TABLES,
  emptyState,
  canonical,
  mac,
  check,
  now,
  type State,
} from "./model.js";
export interface Store {
  read(): Promise<State>;
  change<T>(
    actor: string,
    action: string,
    fn: (s: State) => T,
    details?: any,
  ): Promise<T>;
  audit(): Promise<any[]>;
  close(): Promise<void>;
}
export class MemoryStore implements Store {
  private state: State;
  private events: any[] = [];
  constructor(state = emptyState()) {
    check(
      process.env.NODE_ENV === "test",
      "TEST_ONLY",
      "内存存储仅供测试",
      500,
    );
    this.state = structuredClone(state);
  }
  async read() {
    return structuredClone(this.state);
  }
  async change<T>(
    actor: string,
    action: string,
    fn: (s: State) => T,
    details: any = {},
  ) {
    const s = await this.read();
    const result = fn(s);
    this.state = s;
    this.events.push({ actor, action, details, at: now() });
    return structuredClone(result);
  }
  async audit() {
    return structuredClone(this.events);
  }
  async close() {}
}
export class MysqlStore implements Store {
  private pool: mysql.Pool;
  constructor(
    url: string,
    private key: string,
  ) {
    check(key.length >= 32, "CONFIG_REQUIRED", "审计密钥缺失", 503);
    this.pool = mysql.createPool({
      uri: url,
      connectionLimit: 4,
      charset: "utf8mb4",
    });
  }
  async init() {
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS control_meta (id INT PRIMARY KEY, version INT NOT NULL, signature VARCHAR(64) NOT NULL, audit_head VARCHAR(64) NOT NULL)",
    );
    for (const table of TABLES)
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS ${table} (id VARCHAR(128) PRIMARY KEY, project_id VARCHAR(128), data JSON NOT NULL, INDEX idx_${table}_project (project_id))`,
      );
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS audit_events (sequence BIGINT PRIMARY KEY AUTO_INCREMENT, data JSON NOT NULL)",
    );
    const [rows]: any = await this.pool.query(
      "SELECT id FROM control_meta WHERE id=1",
    );
    if (!rows.length)
      await this.pool.query("INSERT INTO control_meta VALUES (1,1,?,?)", [
        mac(this.key, { state: emptyState(), head: "" }),
        "",
      ]);
  }
  private async load(c: mysql.PoolConnection) {
    const [meta]: any = await c.query(
      "SELECT * FROM control_meta WHERE id=1 FOR UPDATE",
    );
    check(meta[0]?.version === 1, "SCHEMA_VERSION", "数据库版本不兼容", 503);
    const state = emptyState();
    for (const table of TABLES) {
      const [rows]: any = await c.query(
        `SELECT data FROM ${table} ORDER BY id`,
      );
      state[table] = rows.map((r: any) =>
        typeof r.data === "string" ? JSON.parse(r.data) : r.data,
      );
    }
    const sorted = (s: State) =>
      Object.fromEntries(
        TABLES.map((t) => [
          t,
          [...s[t]].sort((a, b) => a.id.localeCompare(b.id)),
        ]),
      );
    check(
      meta[0].signature ===
        mac(this.key, { state: sorted(state), head: meta[0].audit_head }),
      "AUDIT_INTEGRITY",
      "权威状态完整性失败，系统已关闭写入",
      503,
    );
    let previous = "";
    const [events]: any = await c.query(
      "SELECT sequence,data FROM audit_events ORDER BY sequence",
    );
    for (const [i, row] of events.entries()) {
      const e = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      const { hash, ...content } = e;
      check(
        Number(row.sequence) === i + 1 &&
          content.previous === previous &&
          hash === mac(this.key, content),
        "AUDIT_INTEGRITY",
        "审计链校验失败",
        503,
      );
      previous = hash;
    }
    check(
      previous === meta[0].audit_head,
      "AUDIT_INTEGRITY",
      "审计链被截断",
      503,
    );
    return { state, head: previous, sorted };
  }
  async read() {
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      const { state } = await this.load(c);
      await c.commit();
      return state;
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
  async change<T>(
    actor: string,
    action: string,
    fn: (s: State) => T,
    details: any = {},
  ) {
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      const { state, head, sorted } = await this.load(c);
      const before = structuredClone(state);
      const result = fn(state);
      const entry = { at: now(), actor, action, details, previous: head };
      const signature = mac(this.key, entry);
      await c.query("INSERT INTO audit_events (data) VALUES (?)", [
        canonical({ ...entry, hash: signature }),
      ]);
      for (const table of TABLES) {
        for (const row of state[table]) {
          const prior = before[table].find((r) => r.id === row.id);
          if (canonical(prior) !== canonical(row))
            await c.query(
              `INSERT INTO ${table} (id,project_id,data) VALUES (?,?,?) ON DUPLICATE KEY UPDATE project_id=VALUES(project_id),data=VALUES(data)`,
              [row.id, row.projectId || null, canonical(row)],
            );
        }
        for (const row of before[table])
          if (!state[table].some((r) => r.id === row.id))
            await c.query(`DELETE FROM ${table} WHERE id=?`, [row.id]);
      }
      await c.query(
        "UPDATE control_meta SET signature=?,audit_head=? WHERE id=1",
        [mac(this.key, { state: sorted(state), head: signature }), signature],
      );
      await c.commit();
      return structuredClone(result);
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
  async audit() {
    await this.read();
    const [rows]: any = await this.pool.query(
      "SELECT sequence,data FROM audit_events ORDER BY sequence DESC LIMIT 500",
    );
    return rows.map((r: any) => ({
      sequence: r.sequence,
      ...(typeof r.data === "string" ? JSON.parse(r.data) : r.data),
    }));
  }
  async close() {
    await this.pool.end();
  }
}
