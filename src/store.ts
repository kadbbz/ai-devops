import mysql from "mysql2/promise";
import { LEGACY_TABLES, migrateLegacy } from "./migration.js";
import {
  CORE_TABLES,
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
      await this.pool.query("INSERT INTO control_meta VALUES (1,3,?,?)", [
        mac(this.key, { state: emptyState(), head: "" }),
        "",
      ]);
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS legacy_archive (id INT PRIMARY KEY, data JSON NOT NULL)",
    );
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      const [meta]: any = await c.query(
        "SELECT * FROM control_meta WHERE id=1 FOR UPDATE",
      );
      if (meta[0].version === 1) {
        const { state: legacy, head } = await this.load(c, LEGACY_TABLES, 1);
        // 归档表在事务外预先建立，迁移正文和状态转换在同一事务中完成。
        const state = migrateLegacy(legacy);
        await c.query("INSERT INTO legacy_archive (id,data) VALUES (1,?)", [
          canonical(legacy),
        ]);
        for (const table of TABLES) {
          await c.query(`DELETE FROM ${table}`);
          for (const row of state[table])
            await c.query(
              `INSERT INTO ${table} (id,project_id,data) VALUES (?,?,?)`,
              [row.id, row.projectId || null, canonical(row)],
            );
        }
        const entry = {
          at: now(),
          actor: "migration",
          action: "schema.requirements_versions",
        details: { from: 1, to: 3 },
          previous: head,
        };
        const signature = mac(this.key, entry);
        await c.query("INSERT INTO audit_events (data) VALUES (?)", [
          canonical({ ...entry, hash: signature }),
        ]);
        const sorted = Object.fromEntries(
          TABLES.map((t) => [
            t,
            [...state[t]].sort((a, b) => a.id.localeCompare(b.id)),
          ]),
        );
        await c.query(
          "UPDATE control_meta SET version=2,signature=?,audit_head=? WHERE id=1",
          [mac(this.key, { state: sorted, head: signature }), signature],
        );
        await c.query("UPDATE control_meta SET version=3 WHERE id=1");
      } else if (meta[0].version === 2) {
        // schema 2 的业务数据不变，只补充技能库和项目模板表。
        const { state: oldState, head } = await this.load(c, CORE_TABLES, 2);
        const state = { ...oldState, skills: [], templates: [] } as State;
        const entry = {
          at: now(),
          actor: "migration",
          action: "schema.skills_templates",
          details: { from: 2, to: 3 },
          previous: head,
        };
        const signature = mac(this.key, entry);
        await c.query("INSERT INTO audit_events (data) VALUES (?)", [
          canonical({ ...entry, hash: signature }),
        ]);
        const sorted = Object.fromEntries(
          TABLES.map((t) => [
            t,
            [...state[t]].sort((a, b) => a.id.localeCompare(b.id)),
          ]),
        );
        await c.query(
          "UPDATE control_meta SET version=3,signature=?,audit_head=? WHERE id=1",
          [mac(this.key, { state: sorted, head: signature }), signature],
        );
      }
      await c.commit();
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }

  private async load(
    c: mysql.PoolConnection,
    tables: readonly string[] = TABLES,
    version = 3,
  ) {
    const [meta]: any = await c.query(
      "SELECT * FROM control_meta WHERE id=1 FOR UPDATE",
    );
    check(
      meta[0]?.version === version,
      "SCHEMA_VERSION",
      "数据库版本不兼容",
      503,
    );
    const state: any = Object.fromEntries(tables.map((t) => [t, []]));
    for (const table of tables) {
      const [rows]: any = await c.query(
        `SELECT data FROM ${table} ORDER BY id`,
      );
      state[table] = rows.map((r: any) =>
        typeof r.data === "string" ? JSON.parse(r.data) : r.data,
      );
    }
    const sorted = (s: any) =>
      Object.fromEntries(
        tables.map((t) => [
          t,
          [...s[t]].sort((a: any, b: any) => a.id.localeCompare(b.id)),
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
      return state as State;
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
      const before: State = structuredClone(state);
      const result = fn(state as State);
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
          if (!state[table].some((r: any) => r.id === row.id))
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
