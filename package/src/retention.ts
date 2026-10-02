import { mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { AuditLog } from './audit.js'
import { entity, fingerprint } from './domain.js'
// 系统轮转保留可验证压缩副本；原始事件不经业务接口修改。
export async function archiveAudit(log: AuditLog, days = 30) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  const directory = join(log.root, 'archive')
  await mkdir(directory, { recursive: true })
  let count = 0
  for (const file of (await readdir(log.root)).filter(
    (f) => /^audit-\d{4}-\d{2}-\d{2}-.*\.jsonl$/.test(f) && f.slice(6, 16) < cutoff
  )) {
    const content = await readFile(join(log.root, file))
    const archived = join(directory, `${file}.gz`)
    await writeFile(archived, gzipSync(content), { mode: 0o600 })
    if (fingerprint(gunzipSync(await readFile(archived))) !== fingerprint(content))
      throw new Error('AUDIT_ARCHIVE_INTEGRITY')
    await log.write(
      { ...entity('system'), id: 'worker', role: 'worker' },
      'audit.rotate',
      { type: 'audit_file', id: file },
      'succeeded',
      { sha256: fingerprint(content), archive: `archive/${file}.gz`, retentionDays: days }
    )
    await unlink(join(log.root, file))
    count++
  }
  return count
}
