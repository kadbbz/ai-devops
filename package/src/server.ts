import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import swagger from '@fastify/swagger'
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import argon2 from 'argon2'
import { z } from 'zod'
import { Database } from './db.js'
import { AuditLog } from './audit.js'
import { ApiError, check, entity, find, fingerprint, now, publicUser, type User } from './domain.js'
import { bootstrap } from './seed.js'
import { type Route, type Request } from './http.js'
import { coreRoutes } from './routes.js'
import { releaseRoutes } from './releases.js'
export async function createApp(database?: Database, log?: AuditLog) {
  const db = database || new Database()
  const audit = log || new AuditLog()
  await db.init()
  await db.transaction(bootstrap)
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    genReqId: () => entity('req').id,
    bodyLimit: 6 * 1024 * 1024
  })
  await app.register(cookie)
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
  await app.register(swagger, { openapi: { info: { title: 'AI DevOps P0', version: '0.1.0' } } })
  const sameOrigin = (req: Request) => {
    const origin = req.headers.origin
    if (origin)
      check(
        origin === (process.env.PUBLIC_ORIGIN || `${req.protocol}://${req.headers.host}`),
        'ORIGIN_DENIED',
        '请求来源不匹配',
        403
      )
  }
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) sameOrigin(req as Request)
  })
  app.setErrorHandler(async (error: any, req, reply) => {
    const status =
      error instanceof ApiError
        ? error.status
        : error.validation || error instanceof z.ZodError
          ? 400
          : error.statusCode || 500
    const code =
      error instanceof ApiError ? error.code : status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR'
    if (status >= 500) req.log.error({ code, error: error.name }, 'request failed')
    await audit.write(
      { ...entity('actor'), id: (req as any).actorId || 'anonymous', role: (req as any).actorRole },
      status === 403
        ? code.startsWith('AI_')
          ? 'agent.outbound.blocked'
          : 'permission.deny'
        : 'request.failed',
      { type: 'http', id: req.id, projectId: (req as any).projectId },
      status === 403 ? 'denied' : 'failed',
      { code, method: req.method, path: req.routeOptions.url },
      req.id
    )
    reply.code(status).send({
      request_id: req.id,
      code,
      message: status >= 500 && !(error instanceof ApiError) ? '服务暂时不可用' : error.message,
      details:
        error instanceof z.ZodError
          ? error.issues.map((i) => ({ path: i.path, message: i.message }))
          : error.details || null
    })
  })
  const route: Route = (method, path, handler, bodySchema) => {
    const apiSchema = bodySchema ? { body: z.toJSONSchema(bodySchema, { target: 'draft-7' }) } : {}
    app.route({
      method,
      url: path,
      schema: apiSchema,
      handler: async (raw, reply) => {
        const req = raw as Request
        return db.transaction(async (s) => {
          const hash = fingerprint(req.cookies.devops_session || '')
          const session = s.sessions.find((r) => r.id === hash.slice(7) && r.expiresAt > now())
          check(session, 'UNAUTHENTICATED', '请先登录', 401)
          const user = find(s, 'users', session.userId) as User
          check(user.status === 'active', 'UNAUTHENTICATED', '账号已停用', 401)
          ;(req as any).actorId = user.id
          ;(req as any).actorRole = user.platformRole
          check(
            !user.mustChangePassword || ['/api/me', '/api/auth/password', '/api/auth/logout'].includes(path),
            'PASSWORD_CHANGE_REQUIRED',
            '首次登录必须修改密码',
            403
          )
          if (!['GET', 'HEAD'].includes(method)) {
            const csrf = String(req.headers['x-csrf-token'] || '')
            check(
              /^[a-f0-9]{64}$/.test(csrf) &&
                csrf.length === session.csrf.length &&
                timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf)),
              'CSRF_INVALID',
              'CSRF 校验失败',
              403
            )
          }
          if (bodySchema) req.body = bodySchema.parse(req.body) as Record<string, any>
          const result = await handler({
            s,
            user,
            req,
            reply,
            audit,
            log: async (action, resource, metadata = {}) => {
              ;(req as any).projectId = resource.projectId
              const p = s.projects.find((p) => p.id === resource.projectId)
              const event = await audit.write(
                { ...user, role: p?.members[user.id] },
                action,
                resource,
                'succeeded',
                metadata,
                req.id
              )
              resource.auditEventId = event.eventId
              return event
            }
          })
          if (user.platformRole === 'platform_admin' && method === 'GET')
            await audit.write(user, 'admin.read', { type: 'http', id: req.id }, 'succeeded', { path }, req.id)
          return result && typeof result === 'object' && !Buffer.isBuffer(result)
            ? { ...result, request_id: req.id }
            : result
        })
      }
    })
  }
  const loginAttempts = new Map<string, { count: number; expires: number }>()
  app.post(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', maxLength: 128 },
            password: { type: 'string', maxLength: 256 }
          },
          additionalProperties: false
        }
      }
    },
    async (raw, reply) => {
      const req = raw as Request
      const attempt = loginAttempts.get(req.ip)
      check(
        !attempt || attempt.expires < Date.now() || attempt.count < 10,
        'LOGIN_RATE_LIMIT',
        '登录尝试过多，请稍后重试',
        429
      )
      // 失败次数不放在业务事务里，登录失败回滚也不会取消限流。
      loginAttempts.set(req.ip, {
        count: attempt && attempt.expires > Date.now() ? attempt.count + 1 : 1,
        expires: Date.now() + 60000
      })
      return db.transaction(async (s) => {
        const user = s.users.find((u) => u.username === req.body.username)
        const valid = user?.status === 'active' && (await argon2.verify(user.passwordHash, req.body.password))
        if (!valid) {
          await audit.write(
            { ...entity('actor'), id: user?.id || 'anonymous' },
            'auth.login',
            { type: 'session', id: req.id },
            'denied',
            {},
            req.id
          )
          throw new ApiError(401, 'AUTH_INVALID', '用户名或密码错误')
        }
        loginAttempts.delete(req.ip)
        const token = randomBytes(32).toString('hex')
        const csrf = randomBytes(32).toString('hex')
        const expiresAt = new Date(Date.now() + 8 * 3600000).toISOString()
        s.sessions.push(
          entity('session', { id: fingerprint(token).slice(7), userId: user!.id, csrf, expiresAt })
        )
        s.sessions = s.sessions.filter((r) => r.expiresAt > now())
        reply.setCookie('devops_session', token, {
          httpOnly: true,
          secure: process.env.COOKIE_SECURE === 'true',
          sameSite: 'lax',
          path: '/',
          maxAge: 8 * 3600
        })
        await audit.write(user!, 'auth.login', { type: 'session', id: req.id }, 'succeeded', {}, req.id)
        return { user: publicUser(user!), csrf, request_id: req.id }
      })
    }
  )
  route('GET', '/api/me', (ctx) => ({
    user: publicUser(ctx.user),
    csrf: ctx.s.sessions.find((r) => r.id === fingerprint(ctx.req.cookies.devops_session!).slice(7))!.csrf,
    projects: ctx.s.projects
      .filter(
        (p) =>
          ctx.user.platformRole === 'platform_admin' ||
          ctx.user.platformRole === 'platform_auditor' ||
          p.members[ctx.user.id]
      )
      .map((p) => ({ id: p.id, name: p.name, role: p.members[ctx.user.id] || ctx.user.platformRole }))
  }))
  route(
    'POST',
    '/api/auth/password',
    async (ctx) => {
      check(
        await argon2.verify(ctx.user.passwordHash, ctx.req.body.currentPassword),
        'AUTH_INVALID',
        '当前密码错误',
        401
      )
      ctx.user.passwordHash = await argon2.hash(ctx.req.body.password, { type: argon2.argon2id })
      ctx.user.mustChangePassword = false
      ctx.s.sessions = ctx.s.sessions.filter((s) => s.userId !== ctx.user.id)
      ctx.reply.clearCookie('devops_session', { path: '/' })
      await ctx.log('auth.password.change', { ...ctx.user, type: 'user' })
      return { ok: true }
    },
    z.object({ currentPassword: z.string(), password: z.string().min(12).max(256) })
  )
  route('POST', '/api/auth/logout', async (ctx) => {
    ctx.s.sessions = ctx.s.sessions.filter(
      (r) => r.id !== fingerprint(ctx.req.cookies.devops_session!).slice(7)
    )
    ctx.reply.clearCookie('devops_session', { path: '/' })
    await ctx.log('auth.logout', { ...ctx.user, type: 'user' })
    return { ok: true }
  })
  app.get('/api/health', async (_req, reply) => {
    const health = await db.transaction((s) => ({
      storage: db.mode,
      worker: s.worker_heartbeats.some((h) => h.leaseUntil > now()) ? 'ok' : 'unavailable'
    }))
    let git = 'not_configured'
    if (process.env.GIT_BASE_URL) {
      try {
        git = (await fetch(`${process.env.GIT_BASE_URL}/api/healthz`, { signal: AbortSignal.timeout(2000) }))
          .ok
          ? 'ok'
          : 'unavailable'
      } catch {
        git = 'unavailable'
      }
    }
    const ready = process.env.NODE_ENV !== 'production' || (health.worker === 'ok' && git === 'ok')
    return reply
      .code(ready ? 200 : 503)
      .send({ status: ready ? 'ok' : 'degraded', ...health, git, time: now() })
  })
  route('GET', '/api/openapi.json', () => app.swagger())
  coreRoutes(route)
  releaseRoutes(route)
  const webRoot = fileURLToPath(new URL('../web/dist/', import.meta.url))
  if (existsSync(webRoot)) await app.register(fastifyStatic, { root: webRoot })
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/') && existsSync(webRoot))
      return reply.sendFile('index.html')
    throw new ApiError(404, 'NOT_FOUND', '接口不存在')
  })
  app.addHook('onClose', async () => {
    await db.close()
  })
  return { app, db, audit }
}
if (process.env.NODE_ENV !== 'test' || process.env.START_SERVER === 'true') {
  const { app } = await createApp()
  await app.listen({ port: Number(process.env.PORT || 8080), host: process.env.HOST || '0.0.0.0' })
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => {
      void app.close()
    })
}
