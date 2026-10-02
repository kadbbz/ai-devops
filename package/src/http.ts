import type { FastifyInstance, FastifyReply, FastifyRequest, HTTPMethods } from 'fastify'
import type { z } from 'zod'
import type { Database } from './db.js'
import type { AuditLog } from './audit.js'
import { allowed, check, find, type Entity, type Project, type State, type User } from './domain.js'
export type Request = FastifyRequest & {
  params: Record<string, string>
  body: Record<string, any>
  query: Record<string, string>
}
export interface Context {
  s: State
  user: User
  req: Request
  reply: FastifyReply
  audit: AuditLog
  log: (action: string, resource: Entity, metadata?: Record<string, unknown>) => Promise<any>
}
export type Handler = (ctx: Context) => Promise<any> | any
export type Route = (method: HTTPMethods, path: string, handler: Handler, schema?: z.ZodType) => void
export function project(ctx: Context, id: string, action = 'read') {
  const p = find(ctx.s, 'projects', id) as Project
  ;(ctx.req as any).projectId = p.id
  ;(ctx.req as any).actorRole = ctx.user.platformRole || p.members[ctx.user.id]
  check(allowed(ctx.user, p, action), 'FORBIDDEN', '当前角色无权执行此操作', 403)
  return p
}
export function change(ctx: Context, action = 'read') {
  const c = find(ctx.s, 'changes', ctx.req.params.changeId)
  const p = project(ctx, c.projectId, 'read')
  check(allowed(ctx.user, p, action), 'FORBIDDEN', '当前角色无权执行此操作', 403)
  return c
}
export function confirm(ctx: Context) {
  check(
    ctx.req.body?.confirmed === true,
    'CONFIRMATION_REQUIRED',
    '请核对对象、版本、环境、执行人与恢复方式后确认',
    400
  )
}
export function owner(ctx: Context, p: Entity) {
  check(
    !ctx.user.platformRole && p.members[ctx.user.id] === 'project_owner',
    'FORBIDDEN',
    '仅项目负责人可以形成业务批准',
    403
  )
}
