import { z } from 'zod'
import argon2 from 'argon2'
import {
  ApiError,
  entity,
  evidenceFingerprint,
  find,
  fingerprint,
  invalidate,
  now,
  check,
  publicUser,
  type Entity
} from './domain.js'
import { saveFile, readObject } from './files.js'
import { enqueue, sensitive } from './agents.js'
import { analyze, GitRepositoryAdapter } from './repository.js'
import { previewTemplate, applyTemplate } from './templates.js'
import { change, project, owner, confirm, type Route, type Context } from './http.js'
import {
  agentTypes,
  findingSchema,
  requirementsSchema,
  revision,
  text,
  platformRoles,
  statuses
} from './shared/contracts.js'
const securityActions = /security|policy|outbound|permission|auth\./
function scope(ctx: Context, event: any) {
  if (['platform_admin', 'platform_auditor'].includes(ctx.user.platformRole || '')) return true
  if (ctx.user.platformRole === 'platform_security_admin') return securityActions.test(event.action)
  return !!ctx.s.projects.find((p) => p.id === event.resource.projectId)?.members[ctx.user.id]
}
function snapshot(ctx: Context, c: Entity, kind: string, content: unknown, confirmed = false) {
  ctx.s.change_versions.push(
    entity('version', {
      changeId: c.id,
      projectId: c.projectId,
      kind,
      versionNo: kind === 'requirements' ? c.requirementsVersion : c.designVersion,
      content,
      confirmedBy: confirmed ? ctx.user.id : null,
      confirmedAt: confirmed ? now() : null
    })
  )
}
export function coreRoutes(route: Route) {
  route('GET', '/api/users', (ctx) => {
    check(!!ctx.user.platformRole, 'FORBIDDEN', '需要平台角色', 403)
    return { items: ctx.s.users.map(publicUser) }
  })
  route(
    'POST',
    '/api/users',
    async (ctx) => {
      check(ctx.user.platformRole === 'platform_admin', 'FORBIDDEN', '仅平台管理员可以创建用户', 403)
      const b = ctx.req.body
      check(!ctx.s.users.some((u) => u.username === b.username), 'USER_EXISTS', '用户名已存在')
      const user = entity('user', {
        username: b.username,
        displayName: b.displayName,
        passwordHash: await argon2.hash(b.password, { type: argon2.argon2id }),
        status: 'active',
        mustChangePassword: true
      })
      ctx.s.users.push(user)
      await ctx.log('user.create', { ...user, type: 'user' })
      ctx.reply.code(201)
      return publicUser(user)
    },
    z.object({
      username: z.string().regex(/^[\w.-]{1,128}$/),
      displayName: text.max(255),
      password: z.string().min(12).max(256)
    })
  )
  route(
    'PUT',
    '/api/users/:userId',
    async (ctx) => {
      check(ctx.user.platformRole === 'platform_admin', 'FORBIDDEN', '仅平台管理员可以管理用户', 403)
      confirm(ctx)
      const user = find(ctx.s, 'users', ctx.req.params.userId)
      const b = ctx.req.body
      check(user.id !== ctx.user.id || b.status !== 'disabled', 'LAST_ADMIN', '不能停用当前管理账号')
      const before = publicUser(user)
      if (b.platformRole !== undefined) {
        check(
          platformRoles.includes(b.platformRole) || b.platformRole === null,
          'ROLE_INVALID',
          '平台角色无效',
          400
        )
        check(
          user.id !== ctx.user.id || b.platformRole === 'platform_admin',
          'LAST_ADMIN',
          '不能撤销当前管理员'
        )
        user.platformRole = b.platformRole || undefined
        ctx.s.user_platform_roles = ctx.s.user_platform_roles.filter((r) => r.userId !== user.id)
        if (b.platformRole)
          ctx.s.user_platform_roles.push(entity('binding', { userId: user.id, roleId: b.platformRole }))
      }
      if (b.status) {
        check(['active', 'disabled'].includes(b.status), 'STATUS_INVALID', '用户状态无效', 400)
        user.status = b.status
      }
      ctx.s.sessions = ctx.s.sessions.filter((s) => s.userId !== user.id)
      await ctx.log(
        'user.role.update',
        { ...user, type: 'user' },
        { before, after: publicUser(user), reason: b.reason }
      )
      return publicUser(user)
    },
    z.object({
      platformRole: z.enum(platformRoles).nullable().optional(),
      status: z.enum(['active', 'disabled']).optional(),
      reason: text,
      confirmed: z.boolean()
    })
  )
  route('GET', '/api/projects', (ctx) => ({
    items: ctx.s.projects
      .filter(
        (p) =>
          ['platform_admin', 'platform_auditor'].includes(ctx.user.platformRole || '') ||
          p.members[ctx.user.id]
      )
      .map((p) => ({ ...p, environments: ctx.s.environments.filter((e) => e.projectId === p.id) }))
  }))
  route(
    'POST',
    '/api/projects',
    async (ctx) => {
      check(ctx.user.platformRole === 'platform_admin', 'FORBIDDEN', '仅平台管理员可以创建项目', 403)
      const b = ctx.req.body
      check(!ctx.s.projects.some((p) => p.code === b.code.toUpperCase()), 'PROJECT_EXISTS', '项目代码已存在')
      const user = find(ctx.s, 'users', b.ownerUserId)
      check(user.status === 'active' && !user.platformRole, 'OWNER_INVALID', '负责人需为启用的业务用户', 400)
      const p = entity('project', {
        ...b,
        code: b.code.toUpperCase(),
        templateVersion: '1.0.0',
        members: { [user.id]: 'project_owner' },
        status: 'active',
        stackProfiles: []
      })
      ctx.s.projects.push(p)
      ctx.s.project_role_bindings.push(
        entity('binding', {
          projectId: p.id,
          userId: user.id,
          roleId: 'project_owner',
          assignedBy: ctx.user.id
        })
      )
      for (const code of ['test', 'prod'])
        ctx.s.environments.push(
          entity('env', {
            projectId: p.id,
            code,
            kind: code,
            configVersion: '1',
            targetRef: '',
            currentRevision: null,
            currentArtifactRef: null,
            safetyBlocked: false
          })
        )
      await ctx.log('project.create', { ...p, type: 'project' }, { ownerUserId: user.id })
      ctx.reply.code(201)
      return p
    },
    z.object({
      code: z.string().regex(/^[\w-]{1,32}$/),
      name: text.max(255),
      description: z.string().default(''),
      application: z.string().default(''),
      customer: z.string().default(''),
      businessDomain: z.string().default(''),
      ownerUserId: text,
      template: z.literal('phoenix-resource').default('phoenix-resource')
    })
  )
  route('GET', '/api/projects/:projectId', (ctx) => {
    const p = project(ctx, ctx.req.params.projectId)
    return {
      ...p,
      changes: ctx.s.changes.filter((c) => c.projectId === p.id),
      environments: ctx.s.environments.filter((e) => e.projectId === p.id),
      repositories: ctx.s.repositories.filter((r) => r.projectId === p.id),
      aiRuns: ctx.s.agent_runs.filter((r) => r.projectId === p.id).map(({ input, policy, ...r }) => r)
    }
  })
  route(
    'PUT',
    '/api/projects/:projectId/owner',
    async (ctx) => {
      check(ctx.user.platformRole === 'platform_admin', 'FORBIDDEN', '仅平台管理员可以指定负责人', 403)
      confirm(ctx)
      const p = project(ctx, ctx.req.params.projectId, 'manage')
      const target = find(ctx.s, 'users', ctx.req.body.userId)
      check(!target.platformRole && target.status === 'active', 'OWNER_INVALID', '负责人需为业务用户', 400)
      const previous = p.ownerUserId
      p.members[previous] = 'project_member'
      p.ownerUserId = target.id
      p.members[target.id] = 'project_owner'
      ctx.s.project_role_bindings = ctx.s.project_role_bindings.filter(
        (b) => b.projectId !== p.id || ![previous, target.id].includes(b.userId)
      )
      for (const userId of new Set([previous, target.id]))
        ctx.s.project_role_bindings.push(
          entity('binding', { projectId: p.id, userId, roleId: p.members[userId], assignedBy: ctx.user.id })
        )
      for (const r of ctx.s.releases.filter((r) => r.projectId === p.id)) r.approvals = {}
      await ctx.log(
        'project.owner.assign',
        { ...p, type: 'project' },
        { previous, next: target.id, reason: ctx.req.body.reason }
      )
      return p
    },
    z.object({ userId: text, reason: text, confirmed: z.boolean() })
  )
  route('GET', '/api/projects/:projectId/roles', (ctx) => {
    const p = project(ctx, ctx.req.params.projectId)
    return {
      items: Object.entries(p.members).map(([userId, role]) => ({
        user: publicUser(find(ctx.s, 'users', userId)),
        role
      }))
    }
  })
  route(
    'PUT',
    '/api/projects/:projectId/roles/:userId',
    async (ctx) => {
      const p = project(ctx, ctx.req.params.projectId, 'manage')
      confirm(ctx)
      const b = ctx.req.body
      check(
        ctx.req.params.userId !== p.ownerUserId && b.role !== 'project_owner',
        'OWNER_IMMUTABLE',
        '负责人由平台管理员通过专用接口指定',
        403
      )
      const target = find(ctx.s, 'users', ctx.req.params.userId)
      check(target.status === 'active', 'USER_DISABLED', '账号已停用', 400)
      const previous = p.members[target.id]
      if (b.role === null) delete p.members[target.id]
      else p.members[target.id] = b.role
      ctx.s.project_role_bindings = ctx.s.project_role_bindings.filter(
        (r) => r.projectId !== p.id || r.userId !== target.id
      )
      if (b.role)
        ctx.s.project_role_bindings.push(
          entity('binding', { projectId: p.id, userId: target.id, roleId: b.role, assignedBy: ctx.user.id })
        )
      const event = await ctx.log(
        'project_role.assign',
        { ...p, type: 'project' },
        { userId: target.id, previous, next: b.role }
      )
      return { userId: target.id, role: b.role, auditEventId: event.eventId }
    },
    z.object({ role: z.enum(['project_member', 'project_stakeholder']).nullable(), confirmed: z.boolean() })
  )
  route('POST', '/api/projects/:projectId/template-preview', (ctx) => {
    const p = project(ctx, ctx.req.params.projectId, 'manage')
    return {
      ...previewTemplate(p, ctx.req.body?.files || {}),
      template: p.template,
      version: p.templateVersion
    }
  })
  route('POST', '/api/projects/:projectId/template-apply', async (ctx) => {
    const p = project(ctx, ctx.req.params.projectId, 'manage')
    const preview = previewTemplate(p, ctx.req.body?.files || {})
    check(ctx.req.body?.fingerprint === preview.fingerprint, 'PREVIEW_STALE', '请重新预览模板')
    if (ctx.req.body?.dryRun) return { ...preview, applied: false }
    const instance = await applyTemplate(
      ctx.s,
      p,
      preview,
      ctx.req.body.actions || {},
      ctx.req.body.confirmed === true
    )
    await ctx.log(
      'template.apply',
      { ...instance, type: 'template_instance' },
      { fingerprint: preview.fingerprint }
    )
    return { ...instance, applied: true }
  })
  route(
    'PUT',
    '/api/projects/:projectId/policy',
    async (ctx) => {
      check(
        ctx.user.platformRole === 'platform_security_admin',
        'FORBIDDEN',
        '仅安全管理员可修改出站策略',
        403
      )
      find(ctx.s, 'projects', ctx.req.params.projectId)
      confirm(ctx)
      const p =
        ctx.s.policies.find((p) => p.projectId === ctx.req.params.projectId) ||
        entity('policy', { projectId: ctx.req.params.projectId })
      Object.assign(p, ctx.req.body)
      if (!ctx.s.policies.includes(p)) ctx.s.policies.push(p)
      await ctx.log('security.policy.update', { ...p, type: 'policy' }, { fingerprint: fingerprint(p) })
      return p
    },
    z.object({
      allowedProviders: z.array(text),
      allowedFileTypes: z.array(z.enum(['json', 'md', 'ts', 'js', 'css', 'sql'])),
      maxContextBytes: z.number().int().min(100).max(1000000),
      maxOutputTokens: z.number().int().min(100).max(16000),
      budgetUsd: z.number().min(0),
      maxRunCostUsd: z.number().positive(),
      confirmed: z.boolean()
    })
  )
  route(
    'POST',
    '/api/projects/:projectId/changes',
    async (ctx) => {
      const p = project(ctx, ctx.req.params.projectId, 'write')
      const c = entity('change', {
        ...ctx.req.body,
        projectId: p.id,
        key: `CHG-${String(ctx.s.changes.filter((c) => c.projectId === p.id).length + 1).padStart(3, '0')}`,
        ownerUserId: ctx.user.id,
        status: 'inbox',
        blocked: false,
        requirements: {
          summary: ctx.req.body.title,
          acceptanceCriteria: [],
          userStory: '',
          nfr: [],
          scope: ''
        },
        requirementsVersion: 1,
        designVersion: 0,
        links: []
      })
      ctx.s.changes.push(c)
      snapshot(ctx, c, 'requirements', c.requirements)
      await ctx.log('change.create', { ...c, type: 'change' })
      ctx.reply.code(201)
      return c
    },
    z.object({
      title: text.max(255),
      type: z.enum(['requirement', 'defect', 'improvement']).default('improvement'),
      priority: z.enum(['low', 'medium', 'high']).default('medium')
    })
  )
  route('GET', '/api/projects/:projectId/changes', (ctx) => {
    const p = project(ctx, ctx.req.params.projectId)
    return { items: ctx.s.changes.filter((c) => c.projectId === p.id) }
  })
  route('GET', '/api/changes/:changeId', (ctx) => {
    const c = change(ctx)
    return {
      ...c,
      evidence: ctx.s.file_objects.filter((f) => f.changeId === c.id),
      versions: ctx.s.change_versions.filter((v) => v.changeId === c.id),
      reviews: ctx.s.reviews
        .filter((r) => r.changeId === c.id)
        .map((r) => ({ ...r, findings: ctx.s.review_findings.filter((f) => f.reviewId === r.id) })),
      tests: ctx.s.test_runs.filter((t) => t.changeId === c.id),
      aiRuns: ctx.s.agent_runs
        .filter((r) => r.changeId === c.id)
        .map(({ input, policy, ...r }) => ({
          ...r,
          output: ctx.s.agent_outputs.find((o) => o.agentRunId === r.id)?.output
        }))
    }
  })
  route(
    'PUT',
    '/api/changes/:changeId/requirements',
    async (ctx) => {
      const c = change(ctx, 'write')
      c.requirements = ctx.req.body
      c.requirementsVersion++
      c.confirmedRequirementsVersion = null
      c.confirmedDesignVersion = null
      invalidate(ctx.s, c)
      snapshot(ctx, c, 'requirements', c.requirements)
      await ctx.log(
        'change.requirements.update',
        { ...c, type: 'change' },
        { version: c.requirementsVersion }
      )
      return c
    },
    requirementsSchema
  )
  route('POST', '/api/changes/:changeId/confirm-requirements', async (ctx) => {
    const c = change(ctx, 'read')
    owner(ctx, project(ctx, c.projectId))
    confirm(ctx)
    requirementsSchema.parse(c.requirements)
    c.confirmedRequirementsVersion = c.requirementsVersion
    snapshot(ctx, c, 'requirements', c.requirements, true)
    await ctx.log('change.requirements.confirm', { ...c, type: 'change' }, { version: c.requirementsVersion })
    return c
  })
  route(
    'PUT',
    '/api/changes/:changeId/design',
    async (ctx) => {
      const c = change(ctx, 'write')
      c.design = ctx.req.body
      c.designVersion++
      c.confirmedDesignVersion = null
      invalidate(ctx.s, c)
      snapshot(ctx, c, 'design', c.design)
      await ctx.log('change.design.update', { ...c, type: 'change' }, { version: c.designVersion })
      return c
    },
    z.object({ summary: text, impact: z.array(text), risks: z.array(text), unknowns: z.array(text) })
  )
  route('POST', '/api/changes/:changeId/confirm-design', async (ctx) => {
    const c = change(ctx)
    owner(ctx, project(ctx, c.projectId))
    confirm(ctx)
    check(
      c.confirmedRequirementsVersion === c.requirementsVersion && c.designVersion > 0,
      'DESIGN_NOT_READY',
      '请先确认需求并保存设计'
    )
    c.confirmedDesignVersion = c.designVersion
    c.status = 'ready'
    snapshot(ctx, c, 'design', c.design, true)
    await ctx.log('change.design.confirm', { ...c, type: 'change' }, { version: c.designVersion })
    return { status: 'confirmed', change: c }
  })
  route(
    'PATCH',
    '/api/changes/:changeId/status',
    async (ctx) => {
      const c = change(ctx, 'write')
      const b = ctx.req.body
      if (b.blocked !== undefined) {
        check(!b.blocked || b.reason, 'REASON_REQUIRED', '阻塞需要原因', 400)
        c.blocked = b.blocked
        c.blockedReason = b.reason
      }
      if (b.status && b.status !== c.status) {
        const transitions: Record<string, string[]> = {
          inbox: ['ready'],
          ready: ['in_progress', 'inbox'],
          in_progress: ['awaiting_acceptance', 'ready'],
          awaiting_acceptance: ['completed', 'in_progress'],
          completed: []
        }
        check(transitions[c.status].includes(b.status), 'TRANSITION_INVALID', '不允许跳过变更阶段')
        check(!c.blocked, 'CHANGE_BLOCKED', '变更仍处于阻塞状态')
        if (b.status === 'ready')
          check(
            c.confirmedDesignVersion === c.designVersion &&
              c.designVersion > 0 &&
              c.confirmedRequirementsVersion === c.requirementsVersion,
            'CONFIRMATION_REQUIRED',
            '需要确认需求与设计'
          )
        if (b.status === 'awaiting_acceptance') {
          check(
            !ctx.s.review_findings.some(
              (f) => f.changeId === c.id && ['critical', 'high'].includes(f.severity) && f.state === 'open'
            ),
            'FINDINGS_OPEN',
            '仍有未处置的高风险项'
          )
          const t = ctx.s.test_runs.filter((t) => t.changeId === c.id).at(-1)
          check(
            t?.status === 'passed' && !t.stale && t.inputFingerprint === evidenceFingerprint(ctx.s, c),
            'TEST_REQUIRED',
            '需要当前版本通过的测试'
          )
          check(
            ctx.s.reviews.some((r) => r.changeId === c.id && r.status === 'reviewed' && !r.stale),
            'REVIEW_REQUIRED',
            '需要人工审查'
          )
        }
        if (b.status === 'completed') {
          owner(ctx, project(ctx, c.projectId))
          confirm(ctx)
          check(
            ctx.s.deployments.some(
              (d) =>
                d.status === 'verified' &&
                d.environment === 'prod' &&
                d.verifiedRevision === c.headRevision &&
                find(ctx.s, 'releases', d.releaseId).changeIds.includes(c.id)
            ),
            'DEPLOYMENT_REQUIRED',
            '需要生产发布核验证据'
          )
        }
        c.status = b.status
      }
      await ctx.log(
        'change.status.update',
        { ...c, type: 'change' },
        { status: c.status, blocked: c.blocked }
      )
      return c
    },
    z.object({
      status: z.enum(statuses).optional(),
      blocked: z.boolean().optional(),
      reason: z.string().optional(),
      confirmed: z.boolean().optional()
    })
  )
  route('POST', '/api/changes/:changeId/context-package', async (ctx) => {
    const c = change(ctx, 'write')
    check(
      c.confirmedRequirementsVersion === c.requirementsVersion &&
        c.confirmedDesignVersion === c.designVersion &&
        c.designVersion > 0,
      'CONFIRMATION_REQUIRED',
      '请先确认当前需求与设计'
    )
    const files = {
      'requirements.json': c.requirements,
      'design.json': c.design,
      'handoff.md': `# ${c.key}\n\n基线：${c.baseRevision || '待关联'}\n提交：${c.headRevision || '待关联'}\n禁止自动合并、生产发布、凭证读取。\n`
    }
    check(!sensitive.test(JSON.stringify(files)), 'SENSITIVE_DATA', '上下文包含疑似凭证', 400)
    const file = await saveFile(
      ctx.s,
      c.projectId,
      JSON.stringify(files, null, 2),
      `${c.key}-context-v${c.requirementsVersion}-${c.designVersion}.json`
    )
    c.links.push({
      type: 'context_package',
      fileId: file.id,
      fingerprint: evidenceFingerprint(ctx.s, c),
      version: c.links.filter((l: any) => l.type === 'context_package').length + 1
    })
    await ctx.log('context_package.create', { ...file, type: 'file_object' }, { fingerprint: file.sha256 })
    ctx.reply.code(201)
    return { ...file, files: Object.keys(files), mode: 'manual' }
  })
  route(
    'POST',
    '/api/changes/:changeId/ai-runs',
    async (ctx) => {
      const c = change(ctx, 'execute')
      const run = enqueue(
        ctx.s,
        c,
        ctx.req.body.agentType,
        ctx.user.id,
        ctx.req.headers['idempotency-key'] as string
      )
      await ctx.log(
        'agent.enqueue',
        { ...run, type: 'agent_run' },
        { agentType: run.agentType, inputFingerprint: run.inputFingerprint }
      )
      ctx.reply.code(202)
      const { input, policy, ...safe } = run
      return safe
    },
    z.object({ agentType: z.enum(agentTypes) })
  )
  route('POST', '/api/ai-runs/:runId/retry', async (ctx) => {
    const r = find(ctx.s, 'agent_runs', ctx.req.params.runId)
    project(ctx, r.projectId, 'execute')
    check(
      ['expired', 'failed', 'cancelled'].includes(r.status),
      'RETRY_INVALID',
      '仅失败、取消或过期任务可以重试'
    )
    const run = enqueue(ctx.s, find(ctx.s, 'changes', r.changeId), r.agentType, ctx.user.id)
    run.retryCount = r.retryCount + 1
    run.retryOf = r.id
    await ctx.log('agent.retry', { ...run, type: 'agent_run' })
    ctx.reply.code(202)
    const { input, policy, ...safe } = run
    return safe
  })
  route('POST', '/api/ai-runs/:runId/cancel', async (ctx) => {
    const r = find(ctx.s, 'agent_runs', ctx.req.params.runId)
    project(ctx, r.projectId, 'execute')
    check(['queued', 'running'].includes(r.status), 'CANCEL_INVALID', '任务已结束')
    r.status = 'cancelled'
    r.finishedAt = now()
    await ctx.log('agent.cancel', { ...r, type: 'agent_run' })
    return { id: r.id, status: r.status }
  })
  route('POST', '/api/ai-runs/:runId/apply', async (ctx) => {
    const r = find(ctx.s, 'agent_runs', ctx.req.params.runId)
    project(ctx, r.projectId, 'write')
    const c = find(ctx.s, 'changes', r.changeId)
    check(
      r.status === 'succeeded' && !r.stale && r.inputFingerprint === evidenceFingerprint(ctx.s, c),
      'AI_OUTPUT_STALE',
      '输出不可用或已过期'
    )
    const output = ctx.s.agent_outputs.find((o) => o.agentRunId === r.id)!.output
    if (r.agentType === 'intake-agent') {
      c.requirements = requirementsSchema.parse({
        ...c.requirements,
        userStory: output.userStory,
        acceptanceCriteria: output.acceptanceCriteria
      })
      c.requirementsVersion++
      c.confirmedRequirementsVersion = null
      snapshot(ctx, c, 'requirements', c.requirements)
    } else if (r.agentType === 'design-impact-agent') {
      c.design = {
        summary: output.design,
        impact: output.impact,
        risks: output.risks,
        unknowns: output.questions
      }
      c.designVersion++
      c.confirmedDesignVersion = null
      snapshot(ctx, c, 'design', c.design)
    } else throw new ApiError(400, 'DRAFT_ONLY', '该 Agent 的输出在对应 Review/测试/发布入口引用')
    invalidate(ctx.s, c)
    await ctx.log('agent.output.apply', { ...r, type: 'agent_run' }, { changeId: c.id })
    return c
  })
  route(
    'PUT',
    '/api/projects/:projectId/repository',
    async (ctx) => {
      const p = project(ctx, ctx.req.params.projectId, 'manage')
      const b = ctx.req.body
      check(
        !sensitive.test(JSON.stringify(b)) && (!b.credentialRef || /^GIT_[A-Z0-9_]+$/.test(b.credentialRef)),
        'CREDENTIAL_REF_INVALID',
        '只能使用 Git 凭证环境变量引用',
        400
      )
      const repo = ctx.s.repositories.find((r) => r.projectId === p.id) || entity('repo', { projectId: p.id })
      Object.assign(repo, b)
      if (!ctx.s.repositories.includes(repo)) ctx.s.repositories.push(repo)
      await ctx.log('repository.bind', { ...repo, type: 'repository' }, { repoKey: b.repoKey })
      return repo
    },
    z.object({
      url: text.max(512),
      repoKey: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
      defaultBranch: text.default('main'),
      credentialRef: z.string().optional(),
      provider: z.literal('gitea').default('gitea')
    })
  )
  route(
    'POST',
    '/api/changes/:changeId/git-link',
    async (ctx) => {
      const c = change(ctx, 'write')
      const repo = ctx.s.repositories.find((r) => r.projectId === c.projectId)
      check(repo, 'REPOSITORY_REQUIRED', '请先绑定仓库')
      let b = ctx.req.body
      const adapter = new GitRepositoryAdapter()
      if (b.prNumber) b = { ...b, ...(await adapter.getPullRequest(repo, b.prNumber)) }
      const baseRevision = revision.parse(b.baseRevision)
      const headRevision = revision.parse(b.headRevision)
      const compared = await adapter.compare({ repository: repo, baseRevision, headRevision })
      const graph = analyze(compared.base, compared.head, baseRevision, headRevision)
      const raw = await saveFile(ctx.s, c.projectId, compared.rawDiff, `${c.key}.diff`, 'text/plain')
      Object.assign(c, {
        repositoryId: repo.id,
        baseRevision,
        headRevision,
        branch: b.branch || '',
        prNumber: b.prNumber || null
      })
      invalidate(ctx.s, c)
      ctx.s.semantic_diffs.push(
        entity('diff', {
          projectId: c.projectId,
          changeId: c.id,
          baseRevision,
          headRevision,
          graph,
          rawDiffRef: raw.id
        })
      )
      ctx.s.stack_profiles = ctx.s.stack_profiles.filter((p) => p.repositoryId !== repo.id || p.overrideBy)
      for (const detection of graph.detections)
        ctx.s.stack_profiles.push(entity('profile', { repositoryId: repo.id, ...detection }))
      project(ctx, c.projectId).stackProfiles = graph.profiles
      const link = entity('link', {
        changeId: c.id,
        projectId: c.projectId,
        linkType: b.prNumber ? 'pr' : 'commit',
        externalKey: String(b.prNumber || headRevision),
        metadata: { baseRevision, headRevision, branch: b.branch, url: b.url }
      })
      ctx.s.change_links.push(link)
      c.links.push(link)
      for (const agent of ['review-agent', 'test-agent', 'design-impact-agent'])
        enqueue(ctx.s, c, agent, ctx.user.id)
      await ctx.log(
        'change.git.link',
        { ...c, type: 'change' },
        { baseRevision, headRevision, prNumber: b.prNumber }
      )
      return { ...c, semanticDiff: graph }
    },
    z.object({
      baseRevision: revision.optional(),
      headRevision: revision.optional(),
      branch: z.string().optional(),
      prNumber: z.number().int().positive().optional()
    })
  )
  route(
    'PUT',
    '/api/projects/:projectId/stack-profiles',
    async (ctx) => {
      const p = project(ctx, ctx.req.params.projectId, 'manage')
      const repo = ctx.s.repositories.find((r) => r.projectId === p.id)
      check(repo, 'REPOSITORY_REQUIRED', '请先绑定仓库')
      ctx.s.stack_profiles.push(
        entity('profile', {
          repositoryId: repo.id,
          profileCode: ctx.req.body.profileCode,
          confidence: 1,
          detectedFiles: [],
          overrideBy: ctx.user.id,
          reason: ctx.req.body.reason
        })
      )
      p.stackProfiles = [...new Set([...p.stackProfiles, ctx.req.body.profileCode])]
      await ctx.log('stack.override', { ...p, type: 'project' }, ctx.req.body)
      return { profiles: p.stackProfiles }
    },
    z.object({ profileCode: z.enum(['phoenix_dsl', 'typescript', 'javascript', 'css', 'sql']), reason: text })
  )
  route('GET', '/api/changes/:changeId/semantic-diff', (ctx) => {
    const c = change(ctx)
    const diff = ctx.s.semantic_diffs
      .filter(
        (d) => d.changeId === c.id && d.baseRevision === c.baseRevision && d.headRevision === c.headRevision
      )
      .at(-1)
    return diff
      ? { ...diff.graph, rawDiffRef: diff.rawDiffRef }
      : {
          profiles: [],
          nodes: [],
          edges: [],
          unknowns: [{ path: '', reason: '尚未关联固定 Git 提交' }],
          coverage: 0,
          baseRevision: null,
          headRevision: null
        }
  })
  route(
    'POST',
    '/api/changes/:changeId/reviews',
    async (ctx) => {
      const c = change(ctx, 'execute')
      check(revision.safeParse(c.headRevision).success, 'REVISION_REQUIRED', '先关联固定提交')
      const b = ctx.req.body
      let findings = b.findings || []
      if (b.agentRunId) {
        const run = find(ctx.s, 'agent_runs', b.agentRunId)
        check(
          run.changeId === c.id &&
            run.agentType === 'review-agent' &&
            run.status === 'succeeded' &&
            !run.stale &&
            run.inputFingerprint === evidenceFingerprint(ctx.s, c),
          'AI_OUTPUT_STALE',
          'Review 输出不可用'
        )
        findings = ctx.s.agent_outputs.find((o) => o.agentRunId === run.id)!.output.findings
      }
      const review = entity('review', {
        projectId: c.projectId,
        changeId: c.id,
        revision: c.headRevision,
        status: 'pending_human',
        reviewerUserId: null,
        stale: false
      })
      ctx.s.reviews.push(review)
      const rows = findings.map((f: any) =>
        entity('finding', {
          ...findingSchema.parse(f),
          projectId: c.projectId,
          reviewId: review.id,
          changeId: c.id,
          state: 'open'
        })
      )
      ctx.s.review_findings.push(...rows)
      invalidate(ctx.s, c)
      review.stale = false
      review.inputFingerprint = evidenceFingerprint(ctx.s, c)
      await ctx.log(
        'review.create',
        { ...review, type: 'review' },
        { revision: c.headRevision, findingCount: rows.length }
      )
      ctx.reply.code(201)
      return { ...review, findings: rows }
    },
    z.object({ agentRunId: z.string().optional(), findings: z.array(findingSchema).optional() })
  )
  route(
    'PATCH',
    '/api/reviews/:reviewId/findings/:findingId',
    async (ctx) => {
      const r = find(ctx.s, 'reviews', ctx.req.params.reviewId)
      project(ctx, r.projectId, 'write')
      const c = find(ctx.s, 'changes', r.changeId)
      const f = find(ctx.s, 'review_findings', ctx.req.params.findingId)
      check(
        f.reviewId === r.id && r.revision === c.headRevision,
        'REVIEW_STALE',
        '发现项不属于当前 Review 或版本已变化'
      )
      const b = ctx.req.body
      if (['accepted', 'false_positive'].includes(b.state)) {
        owner(ctx, project(ctx, c.projectId))
        check(b.reason?.trim(), 'REASON_REQUIRED', '例外处理需要负责人说明原因', 400)
      }
      f.state = b.state
      f.exceptionReason = b.reason
      f.resolvedBy = ctx.user.id
      r.status = 'pending_human'
      invalidate(ctx.s, c)
      r.stale = false
      r.inputFingerprint = evidenceFingerprint(ctx.s, c)
      await ctx.log(
        'review.finding.update',
        { ...f, type: 'review_finding' },
        { state: f.state, reason: b.reason }
      )
      return f
    },
    z.object({
      state: z.enum(['open', 'accepted', 'fixed', 'false_positive']),
      reason: z.string().optional()
    })
  )
  route('POST', '/api/reviews/:reviewId/confirm', async (ctx) => {
    const r = find(ctx.s, 'reviews', ctx.req.params.reviewId)
    const p = project(ctx, r.projectId)
    owner(ctx, p)
    confirm(ctx)
    const c = find(ctx.s, 'changes', r.changeId)
    check(
      r.revision === c.headRevision && r.inputFingerprint === evidenceFingerprint(ctx.s, c),
      'REVIEW_STALE',
      'Review 输入已变化'
    )
    check(
      !ctx.s.review_findings.some((f) => f.reviewId === r.id && f.state === 'open'),
      'FINDINGS_OPEN',
      '请处置所有发现项'
    )
    r.status = 'reviewed'
    r.reviewerUserId = ctx.user.id
    r.stale = false
    await ctx.log('review.confirm', { ...r, type: 'review' })
    return r
  })
  route(
    'POST',
    '/api/projects/:projectId/test-definitions',
    async (ctx) => {
      const p = project(ctx, ctx.req.params.projectId, 'manage')
      const d = entity('test_definition', { ...ctx.req.body, projectId: p.id })
      ctx.s.test_definitions.push(d)
      await ctx.log('test.definition.create', { ...d, type: 'test_definition' })
      ctx.reply.code(201)
      return d
    },
    z.object({
      name: text.max(255),
      kind: z.enum(['unit', 'integration', 'e2e']),
      commandRef: z.string().regex(/^[\w.-]+$/),
      environmentRef: text
    })
  )
  route('GET', '/api/projects/:projectId/test-definitions', (ctx) => {
    project(ctx, ctx.req.params.projectId)
    return { items: ctx.s.test_definitions.filter((t) => t.projectId === ctx.req.params.projectId) }
  })
  route(
    'POST',
    '/api/changes/:changeId/test-runs',
    async (ctx) => {
      const c = change(ctx, 'execute')
      check(revision.safeParse(c.headRevision).success, 'REVISION_REQUIRED', '请先关联固定提交')
      const b = ctx.req.body
      const run = entity('test', {
        projectId: c.projectId,
        changeId: c.id,
        revision: c.headRevision,
        inputFingerprint: evidenceFingerprint(ctx.s, c),
        stale: false,
        requestedBy: ctx.user.id
      })
      if (b.definitionId) {
        const d = find(ctx.s, 'test_definitions', b.definitionId)
        check(d.projectId === c.projectId, 'TEST_SCOPE', '测试定义不属于本项目', 403)
        Object.assign(run, {
          source: 'registered',
          status: 'queued',
          commandRef: d.commandRef,
          definitionId: d.id,
          repository: find(ctx.s, 'repositories', c.repositoryId)
        })
      } else {
        check(
          b.status && b.result && b.reportRef,
          'EVIDENCE_REQUIRED',
          '人工报告需要状态、计数和已上传文件',
          400
        )
        const report = find(ctx.s, 'file_objects', b.reportRef)
        check(report.projectId === c.projectId, 'EVIDENCE_SCOPE', '报告不属于本项目', 403)
        await readObject(report)
        const r = b.result
        check(
          r.total > 0 && r.total === r.passed + r.failed + r.skipped,
          'TEST_COUNTS',
          '测试计数不一致',
          400
        )
        check(
          b.status !== 'passed' || (r.failed === 0 && r.passed === r.total),
          'TEST_RESULT_INVALID',
          '通过要求所有用例执行成功',
          400
        )
        check(b.status !== 'failed' || r.failed > 0, 'TEST_RESULT_INVALID', '失败必须对应失败用例', 400)
        Object.assign(run, { source: 'manual', status: b.status, result: r, reportRef: report.id })
        if (b.status === 'failed') {
          c.blocked = true
          c.blockedReason = '测试失败'
        }
        if (b.status === 'passed' && c.blockedReason === '测试失败') {
          c.blocked = false
          c.blockedReason = null
        }
      }
      ctx.s.test_runs.push(run)
      for (const r of ctx.s.releases.filter((r) => r.changeIds.includes(c.id))) {
        r.approvals = {}
        r.preflights = {}
      }
      await ctx.log(
        'test.run.record',
        { ...run, type: 'test_run' },
        { source: run.source, status: run.status }
      )
      ctx.reply.code(201)
      return run
    },
    z.object({
      definitionId: z.string().optional(),
      status: z.enum(['passed', 'failed', 'not_executed']).optional(),
      result: z
        .object({
          total: z.number().int().min(0),
          passed: z.number().int().min(0),
          failed: z.number().int().min(0),
          skipped: z.number().int().min(0)
        })
        .optional(),
      reportRef: z.string().optional()
    })
  )
  route('POST', '/api/changes/:changeId/evidence', async (ctx) => {
    const c = change(ctx, 'write')
    let data: Buffer | string
    let name: string
    let contentType: string
    if (ctx.req.isMultipart()) {
      const part = await ctx.req.file()
      check(part, 'EVIDENCE_REQUIRED', '缺少附件', 400)
      data = await part.toBuffer()
      name = part.filename
      contentType = part.mimetype
    } else {
      const b = z
        .object({ content: text, name: text.max(255), contentType: text.default('text/plain') })
        .parse(ctx.req.body)
      data = b.content
      name = b.name
      contentType = b.contentType
    }
    const file = await saveFile(ctx.s, c.projectId, data, name, contentType)
    file.changeId = c.id
    await ctx.log(
      'test.evidence.upload',
      { ...file, type: 'file_object' },
      { sha256: file.sha256, sizeBytes: file.sizeBytes }
    )
    ctx.reply.code(201)
    return file
  })
  route('GET', '/api/files/:fileId', async (ctx) => {
    const f = find(ctx.s, 'file_objects', ctx.req.params.fileId)
    project(ctx, f.projectId)
    const data = await readObject(f)
    ctx.reply
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`)
      .header('x-content-type-options', 'nosniff')
      .type(f.contentType)
    return data
  })
  route('GET', '/api/audit/events', async (ctx) => {
    const q = ctx.req.query
    if (!ctx.user.platformRole) {
      check(q.project_id, 'PROJECT_REQUIRED', '项目角色必须指定项目审计范围', 403)
      project(ctx, q.project_id)
    }
    const events = await ctx.audit.query(q, (event) => scope(ctx, event))
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .parse(q.page || 1)
    const pageSize = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(q.page_size || 20)
    await ctx.log('audit.query', entity('audit', { projectId: q.project_id, type: 'audit' }), {
      filters: q,
      count: events.length
    })
    return {
      items: events.slice((page - 1) * pageSize, page * pageSize),
      page: { page, pageSize, total: events.length },
      filters: q
    }
  })
  route('GET', '/api/audit/events/:eventId', async (ctx) => {
    const events = await ctx.audit.query({ event_id: ctx.req.params.eventId }, (event) => scope(ctx, event))
    check(events[0], 'NOT_FOUND', '审计事件不存在或无权访问', 404)
    return events[0]
  })
  route('GET', '/api/audit/export', async (ctx) => {
    check(ctx.req.query.confirmed === 'true', 'CONFIRMATION_REQUIRED', '导出需要二次确认', 400)
    check(
      ctx.user.platformRole === 'platform_auditor' || (!ctx.user.platformRole && !!ctx.req.query.project_id),
      'FORBIDDEN',
      '仅审计员可全局导出，项目角色仅可导出自身项目',
      403
    )
    if (!ctx.user.platformRole) project(ctx, ctx.req.query.project_id)
    const events = await ctx.audit.query(ctx.req.query, (event) => scope(ctx, event))
    await ctx.log('audit.export', entity('export', { projectId: ctx.req.query.project_id, type: 'audit' }), {
      count: events.length,
      filters: ctx.req.query
    })
    ctx.reply.type('application/x-ndjson').header('content-disposition', 'attachment; filename="audit.jsonl"')
    return events.map((e) => JSON.stringify(e)).join('\n')
  })
}
