import { createHash, randomUUID } from 'node:crypto'
import type { PlatformRole, ProjectRole } from './shared/contracts.js'

// 各表的扩展字段随领域版本保存；稳定关联字段在 MySQL 中投影为可索引列。
export interface Entity {
  id: string
  createdAt: string
  updatedAt: string
  [key: string]: any
}
export interface User extends Entity {
  username: string
  displayName: string
  passwordHash: string
  platformRole?: PlatformRole
  status: string
  mustChangePassword: boolean
}
export interface Project extends Entity {
  code: string
  name: string
  ownerUserId: string
  members: Record<string, ProjectRole>
  template: string
  templateVersion: string
}
export const TABLES = [
  'users',
  'roles',
  'user_platform_roles',
  'projects',
  'project_role_bindings',
  'templates',
  'template_instances',
  'repositories',
  'stack_profiles',
  'changes',
  'change_versions',
  'change_links',
  'agent_runs',
  'agent_outputs',
  'semantic_diffs',
  'reviews',
  'review_findings',
  'test_definitions',
  'test_runs',
  'environments',
  'releases',
  'deployments',
  'file_objects',
  'sessions',
  'policies',
  'worker_heartbeats'
] as const
export type Table = (typeof TABLES)[number]
export type State = Record<Table, Entity[]>
export const now = () => new Date().toISOString()
export const fingerprint = (value: unknown) =>
  `sha256:${createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex')}`
export const entity = (prefix: string, data: Record<string, any> = {}): Entity => ({
  id: `${prefix}_${randomUUID()}`,
  createdAt: now(),
  updatedAt: now(),
  ...data
})
export const emptyState = () => Object.fromEntries(TABLES.map((name) => [name, []])) as unknown as State
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: unknown = null
  ) {
    super(message)
  }
}
export function check(condition: unknown, code: string, message: string, status = 409): asserts condition {
  if (!condition) throw new ApiError(status, code, message)
}
export function find(s: State, table: Table, id: string) {
  const value = s[table].find((item) => item.id === id)
  if (!value) throw new ApiError(404, 'NOT_FOUND', `${table} 对象不存在`)
  return value
}
export function role(user: User, project?: Project) {
  return user.platformRole || project?.members[user.id] || 'unassigned'
}
export function allowed(user: User, project: Project, action: string) {
  if (user.status !== 'active') return false
  if (user.platformRole === 'platform_auditor') return action === 'read'
  if (user.platformRole === 'platform_security_admin') return action === 'security'
  if (user.platformRole === 'platform_admin') return ['read', 'manage', 'write', 'owner'].includes(action)
  const r = project.members[user.id]
  return (
    r === 'project_owner' ||
    (r === 'project_member' && ['read', 'write', 'execute'].includes(action)) ||
    (r === 'project_stakeholder' && action === 'read')
  )
}
export function publicUser(user: Entity) {
  const { passwordHash, ...safe } = user
  return safe
}
export function evidenceFingerprint(s: State, change: Entity) {
  return fingerprint({
    requirementsVersion: change.requirementsVersion,
    designVersion: change.designVersion,
    baseRevision: change.baseRevision,
    headRevision: change.headRevision,
    findings: s.review_findings
      .filter((f) => f.changeId === change.id)
      .map((f) => [f.id, f.state, f.exceptionReason])
  })
}
export function invalidate(s: State, change: Entity) {
  change.updatedAt = now()
  for (const row of [...s.test_runs, ...s.reviews, ...s.agent_runs])
    if (row.changeId === change.id && row.inputFingerprint !== evidenceFingerprint(s, change))
      row.stale = true
  for (const release of s.releases)
    if (release.changeIds.includes(change.id)) {
      release.approvals = {}
      release.preflights = {}
      release.stale = true
    }
}
