import { Database } from './db.js'
import { now } from './domain.js'
const db = new Database()
try {
  await db.init()
  const alive = await db.transaction((s) => s.worker_heartbeats.some((h) => h.leaseUntil > now()))
  process.exitCode = alive ? 0 : 1
} finally {
  await db.close()
}
