import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import { drizzle } from 'drizzle-orm/mysql2'
import { mysqlTable, varchar, json } from 'drizzle-orm/mysql-core'
import { eq } from 'drizzle-orm'
import { TABLES, emptyState, type State, type Table, type Entity, check } from './domain.js'

const tableSchema = (name: Table) =>
  mysqlTable(name, {
    id: varchar('id', { length: 64 }).primaryKey(),
    data: json('data').$type<Entity>().notNull()
  })
const schema = Object.fromEntries(TABLES.map((name) => [name, tableSchema(name)])) as Record<
  Table,
  ReturnType<typeof tableSchema>
>
export class Database {
  private _state = emptyState()
  private _tail: Promise<unknown> = Promise.resolve()
  private _pool?: mysql.Pool
  private _file?: string
  mode: string
  constructor(url = process.env.DATABASE_URL, file = process.env.STATE_FILE) {
    this.mode = url ? 'mysql' : file ? 'file-development' : 'memory-test'
    if (url) this._pool = mysql.createPool({ uri: url, connectionLimit: 6 })
    else if (file) this._file = resolve(file)
    else
      check(
        process.env.NODE_ENV === 'test',
        'DATABASE_REQUIRED',
        '必须配置 DATABASE_URL；本地开发可显式设置 STATE_FILE',
        503
      )
  }
  async init() {
    if (this._pool) {
      const connection = await this._pool.getConnection()
      try {
        await connection.query("SELECT GET_LOCK('devops_migration', 30)")
        await connection.query(
          'CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(64) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'
        )
        const [rows]: any = await connection.query('SELECT version FROM schema_migrations')
        if (!rows.some((r: any) => r.version === '001_p0')) {
          // 已有未知旧表时停止，让操作者先备份并执行显式迁移，禁止静默覆盖。
          const [tables]: any = await connection.query("SHOW TABLES LIKE 'projects'")
          check(tables.length === 0, 'MIGRATION_REQUIRED', '发现旧 schema，请备份后按运行手册迁移', 503)
          const sql = await readFile(
            fileURLToPath(new URL('../migrations/001_p0.sql', import.meta.url)),
            'utf8'
          )
          for (const statement of sql.split(';').filter((s) => s.trim())) await connection.query(statement)
          await connection.query("INSERT INTO schema_migrations(version) VALUES ('001_p0')")
        }
      } finally {
        await connection.query("SELECT RELEASE_LOCK('devops_migration')")
        connection.release()
      }
    } else if (this._file) {
      try {
        this._state = { ...emptyState(), ...JSON.parse(await readFile(this._file, 'utf8')) }
      } catch (error: any) {
        if (error.code !== 'ENOENT') throw error
      }
    }
  }
  async transaction<T>(fn: (s: State) => Promise<T> | T): Promise<T> {
    const execute = async () => {
      if (this._pool) {
        const connection = await this._pool.getConnection()
        try {
          // P0 小团队用同一数据库锁串行化状态变更，包含环境发布和 worker 认领。
          const [locks]: any = await connection.query("SELECT GET_LOCK('devops_state', 30) AS acquired")
          check(locks[0].acquired === 1, 'DATABASE_BUSY', '数据库繁忙，请重试', 503)
          await connection.beginTransaction()
          const orm = drizzle(connection)
          const state = emptyState()
          for (const name of TABLES) {
            const rows = await orm.select().from(schema[name])
            state[name] = rows.map((r: any) => r.data)
          }
          const before = structuredClone(state)
          const result = await fn(state)
          for (const name of TABLES) {
            const old = new Map(before[name].map((row) => [row.id, JSON.stringify(row)]))
            for (const row of state[name])
              if (old.get(row.id) !== JSON.stringify(row))
                await orm
                  .insert(schema[name])
                  .values({ id: row.id, data: row })
                  .onDuplicateKeyUpdate({ set: { data: row } })
            const ids = new Set(state[name].map((row) => row.id))
            for (const row of before[name])
              if (!ids.has(row.id)) await orm.delete(schema[name]).where(eq(schema[name].id, row.id))
          }
          await connection.commit()
          return result
        } catch (error) {
          await connection.rollback()
          throw error
        } finally {
          await connection.query("SELECT RELEASE_LOCK('devops_state')")
          connection.release()
        }
      }
      const next = structuredClone(this._state)
      const result = await fn(next)
      if (this._file) {
        await mkdir(dirname(this._file), { recursive: true })
        const temp = `${this._file}.tmp`
        await writeFile(temp, JSON.stringify(next), { mode: 0o600 })
        await rename(temp, this._file)
      }
      this._state = next
      return structuredClone(result)
    }
    const task = this._tail.then(execute)
    this._tail = task.catch(() => {})
    return task
  }
  async close() {
    await this._pool?.end()
  }
}
