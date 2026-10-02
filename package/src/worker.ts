import { setTimeout } from 'node:timers/promises'
import { Database } from './db.js'
import { AuditLog } from './audit.js'
import { Worker } from './agents.js'
import { archiveAudit } from './retention.js'
const db = new Database()
await db.init()
const audit = new AuditLog()
const worker = new Worker(db, audit)
let lastArchive = ''
let stopping = false
process.on('SIGTERM', () => {
  stopping = true
})
process.on('SIGINT', () => {
  stopping = true
})
while (!stopping) {
  const day = new Date().toISOString().slice(0, 10)
  if (lastArchive !== day) {
    await archiveAudit(audit, Number(process.env.AUDIT_RETENTION_DAYS || 30)).catch(() =>
      console.error({ code: 'AUDIT_ROTATION_FAILED' })
    )
    lastArchive = day
  }
  await worker.tick().catch((error) => console.error({ code: error.code || 'WORKER_ERROR' }))
  await setTimeout(1000)
}
await db.close()
