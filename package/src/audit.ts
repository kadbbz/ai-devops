import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hostname } from 'node:os'
import { gunzipSync } from 'node:zlib'
import { entity, fingerprint, type Entity } from './domain.js'

export class AuditLog {
  private _tail: Promise<unknown> = Promise.resolve()
  constructor(
    public root = process.env.AUDIT_ROOT || '.data/audit',
    private _process = `${hostname()}-${process.pid}`
  ) {}
  async write(
    actor: Entity,
    action: string,
    resource: Entity | Record<string, unknown>,
    result = 'succeeded',
    metadata: Record<string, unknown> = {},
    correlationId?: string
  ) {
    const task = this._tail.then(async () => {
      await mkdir(this.root, { recursive: true })
      const file = join(this.root, `audit-${new Date().toISOString().slice(0, 10)}-${this._process}.jsonl`)
      let previous = ''
      try {
        const lines = (await readFile(file, 'utf8')).trim().split('\n')
        previous = JSON.parse(lines.at(-1)!).eventHash
      } catch (error: any) {
        if (error.code !== 'ENOENT') throw error
      }
      const event = {
        eventId: entity('ae').id,
        occurredAt: new Date().toISOString(),
        actor: {
          type: actor.id === 'worker' ? 'system' : 'user',
          id: actor.id,
          role: actor.platformRole || actor.role || 'unassigned'
        },
        action,
        resource: { type: resource.type || 'resource', id: resource.id, projectId: resource.projectId },
        result,
        correlationId: correlationId || entity('op').id,
        inputFingerprint: fingerprint(metadata),
        metadata,
        prevHash: previous
      }
      const row = { ...event, eventHash: fingerprint(event) }
      await appendFile(file, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: 0o600 })
      return row
    })
    this._tail = task.catch(() => {})
    return task
  }
  async query(filters: Record<string, string | undefined>, scope: (event: any) => boolean) {
    await mkdir(this.root, { recursive: true })
    const events: any[] = []
    const active = (await readdir(this.root)).filter((f) => /^audit-.*\.jsonl$/.test(f))
    const archived = (await readdir(join(this.root, 'archive')).catch(() => []))
      .filter((f) => f.endsWith('.jsonl.gz'))
      .map((f) => `archive/${f}`)
    for (const file of [...active, ...archived]) {
      let prevHash = ''
      let chainValid = true
      for (const line of (file.endsWith('.gz')
        ? gunzipSync(await readFile(join(this.root, file))).toString('utf8')
        : await readFile(join(this.root, file), 'utf8')
      )
        .split('\n')
        .filter(Boolean)) {
        try {
          const parsed = JSON.parse(line)
          const { eventHash, ...base } = parsed
          chainValid = chainValid && parsed.prevHash === prevHash && fingerprint(base) === eventHash
          prevHash = eventHash
          if (!scope(parsed)) continue
          const mapping: Record<string, string> = {
            actor: parsed.actor.id,
            role: parsed.actor.role,
            project_id: parsed.resource.projectId,
            action: parsed.action,
            result: parsed.result,
            resource_type: parsed.resource.type,
            correlation_id: parsed.correlationId,
            event_id: parsed.eventId
          }
          if (Object.entries(mapping).some(([key, value]) => filters[key] && filters[key] !== value)) continue
          if (
            (filters.from && parsed.occurredAt < filters.from) ||
            (filters.to && parsed.occurredAt > filters.to)
          )
            continue
          if (filters.keyword && !JSON.stringify(base).toLowerCase().includes(filters.keyword.toLowerCase()))
            continue
          events.push({ ...parsed, sourceFile: file, integrity: chainValid ? 'verified' : 'invalid' })
        } catch {
          chainValid = false
        }
      }
    }
    return events.sort((a, b) => `${b.occurredAt}${b.eventId}`.localeCompare(`${a.occurredAt}${a.eventId}`))
  }
}
