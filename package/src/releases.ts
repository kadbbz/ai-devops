import { z } from 'zod'
import {
  check,
  entity,
  evidenceFingerprint,
  find,
  fingerprint,
  now,
  type Entity,
  type State
} from './domain.js'
import { project, owner, confirm, type Route, type Context } from './http.js'
import { digest, revision, text } from './shared/contracts.js'
export function releaseFingerprint(s: State, release: Entity, env: Entity) {
  return fingerprint({
    revision: release.sourceRevision,
    artifact: release.artifactRef,
    config: env.configVersion,
    target: env.targetRef,
    currentRevision: env.currentRevision,
    currentArtifact: env.currentArtifactRef,
    safetyBlocked: env.safetyBlocked,
    changes: release.changeIds.map((id: string) => {
      const c = find(s, 'changes', id)
      return evidenceFingerprint(s, c)
    }),
    tests: s.test_runs
      .filter((t) => release.changeIds.includes(t.changeId))
      .map((t) => [t.id, t.status, t.stale]),
    reviews: s.reviews
      .filter((r) => release.changeIds.includes(r.changeId))
      .map((r) => [r.id, r.status, r.stale]),
    runbook: release.runbook,
    recovery: release.recovery
  })
}
const environment = (s: State, projectId: string, code: string) => {
  const env = s.environments.find((e) => e.projectId === projectId && e.code === code)
  check(env, 'ENVIRONMENT_INVALID', '环境必须为本项目 test 或 prod', 400)
  return env
}
function checks(s: State, r: Entity, env: Entity) {
  const changes = r.changeIds.map((id: string) => find(s, 'changes', id)) as Entity[]
  return [
    {
      name: '固定提交和制品摘要',
      passed: revision.safeParse(r.sourceRevision).success && digest.safeParse(r.artifactRef).success
    },
    { name: '每项变更对应源提交', passed: changes.every((c) => c.headRevision === r.sourceRevision) },
    {
      name: '变更进入待验收',
      passed: changes.every((c) => ['awaiting_acceptance', 'completed'].includes(c.status))
    },
    {
      name: '逐项验收和设计确认',
      passed: changes.every(
        (c) =>
          c.confirmedRequirementsVersion === c.requirementsVersion &&
          c.confirmedDesignVersion === c.designVersion &&
          c.designVersion > 0 &&
          !c.blocked
      )
    },
    {
      name: '人工 Review 已完成且证据有效',
      passed: changes.every((c) =>
        s.reviews.some(
          (review) =>
            review.changeId === c.id &&
            review.revision === r.sourceRevision &&
            review.status === 'reviewed' &&
            !review.stale &&
            review.inputFingerprint === evidenceFingerprint(s, c)
        )
      )
    },
    {
      name: '高风险发现项已处置',
      passed: !s.review_findings.some(
        (f) =>
          r.changeIds.includes(f.changeId) && ['critical', 'high'].includes(f.severity) && f.state === 'open'
      )
    },
    {
      name: '每项变更最新测试均通过',
      passed: changes.every((c) => {
        const t = s.test_runs.filter((t) => t.changeId === c.id).at(-1)
        return (
          t?.status === 'passed' &&
          !t.stale &&
          t.revision === r.sourceRevision &&
          t.inputFingerprint === evidenceFingerprint(s, c) &&
          !!t.reportRef
        )
      })
    },
    {
      name: '配置与运行/恢复手册',
      passed: !!env.targetRef && !!env.configVersion && !!r.runbook && !!r.recovery
    },
    { name: '安全预检', passed: !env.safetyBlocked },
    {
      name: '生产前 test 核验',
      passed:
        env.code !== 'prod' ||
        s.deployments.some(
          (d) =>
            d.releaseId === r.id &&
            d.environment === 'test' &&
            d.status === 'verified' &&
            d.verifiedArtifactRef === r.artifactRef
        )
    }
  ]
}
export function releaseRoutes(route: Route) {
  route('GET', '/api/projects/:projectId/releases', (ctx) => {
    project(ctx, ctx.req.params.projectId)
    return {
      items: ctx.s.releases.filter((r) => r.projectId === ctx.req.params.projectId),
      deployments: ctx.s.deployments.filter((d) => d.projectId === ctx.req.params.projectId),
      environments: ctx.s.environments.filter((e) => e.projectId === ctx.req.params.projectId)
    }
  })
  route('PUT', '/api/projects/:projectId/environments/:code', async (ctx) => {
    const p = project(
      ctx,
      ctx.req.params.projectId,
      ctx.user.platformRole === 'platform_security_admin' ? 'security' : 'manage'
    )
    confirm(ctx)
    const env = environment(ctx.s, p.id, ctx.req.params.code)
    const body = ctx.req.body
    const before = {
      configVersion: env.configVersion,
      targetRef: env.targetRef,
      safetyBlocked: env.safetyBlocked
    }
    if (ctx.user.platformRole === 'platform_security_admin') {
      check(
        typeof body.safetyBlocked === 'boolean' && !!body.reason,
        'VALIDATION_ERROR',
        '安全否决需要状态和原因',
        400
      )
      env.safetyBlocked = body.safetyBlocked
      env.safetyReason = body.reason
    } else {
      check(
        typeof body.configVersion === 'string' && typeof body.targetRef === 'string',
        'VALIDATION_ERROR',
        '需要配置版本和目标引用',
        400
      )
      env.configVersion = body.configVersion
      env.targetRef = body.targetRef
    }
    for (const r of ctx.s.releases.filter((r) => r.projectId === p.id)) {
      delete r.approvals[env.code]
      delete r.preflights[env.code]
    }
    await ctx.log(
      'environment.update',
      { ...env, type: 'environment' },
      {
        before,
        after: {
          configVersion: env.configVersion,
          targetRef: env.targetRef,
          safetyBlocked: env.safetyBlocked
        }
      }
    )
    return env
  })
  route(
    'POST',
    '/api/projects/:projectId/releases',
    async (ctx) => {
      const p = project(ctx, ctx.req.params.projectId, 'write')
      const b = ctx.req.body
      check(
        b.changeIds.every((id: string) => find(ctx.s, 'changes', id).projectId === p.id),
        'CHANGE_SCOPE',
        '候选只能关联本项目变更',
        400
      )
      check(
        !ctx.s.releases.some((r) => r.projectId === p.id && r.version === b.version),
        'VERSION_EXISTS',
        '候选版本号已存在'
      )
      const r = entity('release', {
        ...b,
        projectId: p.id,
        requestedBy: ctx.user.id,
        status: 'candidate',
        approvals: {},
        preflights: {}
      })
      ctx.s.releases.push(r)
      await ctx.log(
        'release.create',
        { ...r, type: 'release' },
        { revision: r.sourceRevision, artifactRef: r.artifactRef }
      )
      ctx.reply.code(201)
      return r
    },
    z.object({
      version: text,
      sourceRevision: revision,
      artifactRef: digest,
      changeIds: z.array(text).min(1),
      configRef: text,
      runbook: text,
      recovery: text
    })
  )
  route(
    'POST',
    '/api/releases/:releaseId/preflight',
    async (ctx) => {
      const r = find(ctx.s, 'releases', ctx.req.params.releaseId)
      project(ctx, r.projectId, ctx.user.platformRole === 'platform_security_admin' ? 'security' : 'read')
      check(
        ctx.user.platformRole !== 'platform_auditor' &&
          ctx.s.projects.find((p) => p.id === r.projectId)?.members[ctx.user.id] !== 'project_stakeholder',
        'FORBIDDEN',
        '只读角色不能执行预检',
        403
      )
      const env = environment(ctx.s, r.projectId, ctx.req.body.environment)
      const results = checks(ctx.s, r, env)
      const preflight = {
        status: results.every((c) => c.passed) ? 'passed' : 'failed',
        checks: results,
        fingerprint: releaseFingerprint(ctx.s, r, env),
        createdAt: now()
      }
      r.preflights[env.code] = preflight
      await ctx.log(
        'release.preflight',
        { ...r, type: 'release' },
        { environment: env.code, status: preflight.status }
      )
      return preflight
    },
    z.object({ environment: z.enum(['test', 'prod']) })
  )
  route(
    'POST',
    '/api/releases/:releaseId/approve',
    async (ctx) => {
      const r = find(ctx.s, 'releases', ctx.req.params.releaseId)
      const p = project(ctx, r.projectId)
      owner(ctx, p)
      confirm(ctx)
      const env = environment(ctx.s, r.projectId, ctx.req.body.environment)
      const fp = releaseFingerprint(ctx.s, r, env)
      check(
        r.preflights[env.code]?.status === 'passed' &&
          r.preflights[env.code].fingerprint === fp &&
          checks(ctx.s, r, env).every((c) => c.passed),
        'PREFLIGHT_REQUIRED',
        '预检未通过或证据已过期'
      )
      if (env.code === 'prod')
        check(r.requestedBy !== ctx.user.id, 'SELF_APPROVAL', '不能独自批准自己提出的生产发布', 403)
      const approval = { approvedBy: ctx.user.id, approvedAt: now(), fingerprint: fp, environment: env.code }
      r.approvals[env.code] = approval
      await ctx.log('release.approve', { ...r, type: 'release' }, approval)
      return { status: 'approved', ...approval }
    },
    z.object({ environment: z.enum(['test', 'prod']), confirmed: z.boolean() })
  )
  route(
    'POST',
    '/api/releases/:releaseId/deployments',
    async (ctx) => {
      const r = find(ctx.s, 'releases', ctx.req.params.releaseId)
      const p = project(ctx, r.projectId, 'execute')
      confirm(ctx)
      const env = environment(ctx.s, p.id, ctx.req.body.environment)
      const approval = r.approvals[env.code]
      check(
        approval &&
          approval.fingerprint === releaseFingerprint(ctx.s, r, env) &&
          checks(ctx.s, r, env).every((c) => c.passed),
        'APPROVAL_STALE',
        '缺少有效批准或批准已失效'
      )
      check(
        !ctx.s.deployments.some((d) => d.environmentId === env.id && d.status === 'awaiting_evidence'),
        'DEPLOYMENT_LOCKED',
        '该环境已有待核验发布'
      )
      const d = entity('deployment', {
        projectId: p.id,
        releaseId: r.id,
        environmentId: env.id,
        environment: env.code,
        approvalFingerprint: approval.fingerprint,
        approvedBy: approval.approvedBy,
        executor: ctx.user.id,
        status: 'awaiting_evidence',
        mode: 'manual',
        expectedRevision: r.sourceRevision,
        expectedArtifactRef: r.artifactRef,
        expectedConfigVersion: env.configVersion,
        previousRevision: env.currentRevision,
        previousArtifactRef: env.currentArtifactRef,
        previousConfigVersion: env.currentConfigVersion
      })
      ctx.s.deployments.push(d)
      await ctx.log(
        'release.deploy',
        { ...d, type: 'deployment' },
        { environment: env.code, mode: 'manual', status: d.status }
      )
      ctx.reply.code(201)
      return d
    },
    z.object({ environment: z.enum(['test', 'prod']), confirmed: z.boolean() })
  )
  route(
    'POST',
    '/api/deployments/:deploymentId/verify',
    async (ctx) => {
      const d = find(ctx.s, 'deployments', ctx.req.params.deploymentId)
      project(ctx, d.projectId, 'execute')
      const b = ctx.req.body
      check(d.status === 'awaiting_evidence', 'DEPLOYMENT_FINAL', '部署已核验或失败')
      const file = find(ctx.s, 'file_objects', b.reportRef)
      check(file.projectId === d.projectId, 'EVIDENCE_SCOPE', '证据不属于本项目', 403)
      const r = find(ctx.s, 'releases', d.releaseId)
      const env = find(ctx.s, 'environments', d.environmentId)
      const matches =
        b.verifiedRevision === d.expectedRevision &&
        b.verifiedArtifactRef === d.expectedArtifactRef &&
        b.configVersion === d.expectedConfigVersion &&
        env.configVersion === d.expectedConfigVersion &&
        b.environment === d.environment &&
        !env.safetyBlocked &&
        d.approvalFingerprint === releaseFingerprint(ctx.s, r, env)
      d.status = b.status === 'verified' && matches ? 'verified' : 'failed'
      d.reportRef = file.id
      d.externalOperationId = b.externalOperationId
      d.verifiedRevision = b.verifiedRevision
      d.verifiedArtifactRef = b.verifiedArtifactRef
      if (d.status === 'verified') {
        env.currentRevision = b.verifiedRevision
        env.currentArtifactRef = b.verifiedArtifactRef
        env.currentConfigVersion = b.configVersion
        env.updatedAt = now()
      }
      await ctx.log(
        'deployment.verify',
        { ...d, type: 'deployment' },
        { status: d.status, revision: b.verifiedRevision, evidenceId: file.id }
      )
      return d
    },
    z.object({
      status: z.enum(['verified', 'failed']),
      verifiedRevision: revision,
      verifiedArtifactRef: digest,
      configVersion: text,
      environment: z.enum(['test', 'prod']),
      reportRef: text,
      externalOperationId: text
    })
  )
  route('POST', '/api/deployments/:deploymentId/rollback-plan', async (ctx) => {
    const d = find(ctx.s, 'deployments', ctx.req.params.deploymentId)
    project(ctx, d.projectId, 'execute')
    const r = find(ctx.s, 'releases', d.releaseId)
    const result = {
      deploymentId: d.id,
      mode: 'manual',
      previousRevision: d.previousRevision,
      previousArtifactRef: d.previousArtifactRef,
      previousConfigVersion: d.previousConfigVersion,
      recovery: r.recovery,
      status: d.previousRevision ? 'plan_ready' : 'manual_recovery_required',
      steps: [
        '停止目标环境流量',
        '按恢复手册恢复制品与配置',
        '核验实际提交/制品/配置',
        '上传恢复报告并重新核验'
      ]
    }
    d.rollbackPlan = result
    await ctx.log('deployment.rollback_plan', { ...d, type: 'deployment' })
    return result
  })
}
