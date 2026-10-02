import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
process.env.NODE_ENV = 'test'
process.env.DEMO_SEED = 'true'
process.env.DEMO_PASSWORD = 'test-password-12345'
process.env.ALLOW_LOCAL_REPOSITORIES = 'true'
const root = await mkdtemp(join(tmpdir(), 'devops-api-'))
process.env.AUDIT_ROOT = join(root, 'audit')
process.env.FILE_ROOT = join(root, 'files')
process.env.WORKSPACE_ROOT = join(root, 'workspaces')
const { createApp } = await import('../package/src/server.ts')
const { Worker } = await import('../package/src/agents.ts')
const { Database } = await import('../package/src/db.ts')
const { AuditLog } = await import('../package/src/audit.ts')
const { analyze } = await import('../package/src/repository.ts')
const { app, db, audit } = await createApp()
const sessions: Record<string, { cookie: string; csrf: string }> = {}
const req = async (url: string, method = 'GET', data?: any, user = 'owner') =>
  app.inject({
    method: method as any,
    url,
    headers: {
      cookie: sessions[user]?.cookie || '',
      'x-csrf-token': sessions[user]?.csrf || '',
      ...(data !== undefined ? { 'content-type': 'application/json' } : {})
    },
    payload: data
  })
const ok = (response: any, status = 200) => {
  assert.equal(response.statusCode, status, response.body)
  return response.json()
}
const repoPath = join(root, 'repo')
await mkdir(repoPath)
const git = (...args: string[]) => execFileSync('git', args, { cwd: repoPath, encoding: 'utf8' }).trim()
git('init', '-q')
git('config', 'user.email', 'test@example.invalid')
git('config', 'user.name', 'Test')
await mkdir(join(repoPath, 'documents/logic'), { recursive: true })
await writeFile(join(repoPath, 'app.pxproj'), '{}')
await writeFile(
  join(repoPath, 'documents/logic/ask.json'),
  JSON.stringify({ name: 'ask', nodes: [{ id: 'llm', apiRef: 'llm' }] })
)
await writeFile(join(repoPath, 'ask.ts'), 'export function ask() { return 1 }\n')
await writeFile(join(repoPath, 'app.js'), 'export const run = () => 1;')
await writeFile(join(repoPath, 'app.css'), '.answer { color: red; }')
await writeFile(join(repoPath, 'schema.sql'), 'CREATE TABLE answers (id INT, PRIMARY KEY (id));')
git('add', '.')
git('commit', '-qm', 'base')
const base = git('rev-parse', 'HEAD')
await writeFile(
  join(repoPath, 'documents/logic/ask.json'),
  JSON.stringify({
    name: 'ask',
    nodes: [{ id: 'empty' }, { id: 'llm', apiRef: 'llm' }],
    dynamicRef: '${resolve()}'
  })
)
await writeFile(
  join(repoPath, 'ask.ts'),
  'import { run } from "./app.js"; export function ask() { return run() }\n'
)
await writeFile(join(repoPath, 'app.css'), '.answer { color: green; } .empty { display: block; }')
await writeFile(
  join(repoPath, 'schema.sql'),
  'CREATE TABLE answers (id INT, title VARCHAR(100), INDEX idx_title (title));'
)
await writeFile(join(repoPath, 'bad.sql'), 'nonsense sql ???')
git('add', '.')
git('commit', '-qm', 'head')
const head = git('rev-parse', 'HEAD')
const artifact = `sha256:${'a'.repeat(64)}`
let releaseId: string
let reportId: string
before(async () => {
  for (const username of ['admin', 'owner', 'member', 'stakeholder', 'auditor', 'security']) {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password: process.env.DEMO_PASSWORD }
    })
    const data = ok(login)
    sessions[username] = { cookie: String(login.headers['set-cookie']).split(';')[0], csrf: data.csrf }
    assert.match(String(login.headers['set-cookie']), /HttpOnly/)
    assert.match(String(login.headers['set-cookie']), /SameSite=Lax/)
  }
})
after(async () => {
  await app.close()
})
test('会话与 CSRF：请求头不能伪造用户，同源限制生效', async () => {
  assert.equal(
    (await app.inject({ url: '/api/projects', headers: { 'x-demo-user': 'admin' } })).statusCode,
    401
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/projects/prj-phoenix/changes',
        headers: { cookie: sessions.member.cookie },
        payload: { title: 'x' }
      })
    ).statusCode,
    403
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: 'https://evil.invalid' },
        payload: { username: 'admin', password: process.env.DEMO_PASSWORD }
      })
    ).statusCode,
    403
  )
  ok(await req('/api/me'))
  assert.equal((await req('/api/no-such-route')).statusCode, 404)
})
test('六角色职责分离与跨项目隔离', async () => {
  assert.equal(
    (await req('/api/projects/prj-phoenix/changes', 'POST', { title: '拒绝写' }, 'stakeholder')).statusCode,
    403
  )
  assert.equal(
    (await req('/api/changes/chg-demo/ai-runs', 'POST', { agentType: 'intake-agent' }, 'admin')).statusCode,
    403
  )
  assert.equal(
    (await req('/api/changes/chg-demo/ai-runs', 'POST', { agentType: 'intake-agent' }, 'auditor')).statusCode,
    403
  )
  assert.equal((await req('/api/projects/prj-phoenix', 'GET', undefined, 'security')).statusCode, 403)
  assert.equal(
    (
      await req(
        '/api/projects/prj-phoenix/roles/u-member',
        'PUT',
        { role: 'project_member', confirmed: true },
        'member'
      )
    ).statusCode,
    403
  )
  assert.equal(
    (await req('/api/projects/prj-phoenix/roles/u-owner', 'PUT', { role: 'project_member', confirmed: true }))
      .statusCode,
    403
  )
  const p = ok(
    await req('/api/projects', 'POST', { name: '隔离项目', code: 'OTHER', ownerUserId: 'u-owner' }, 'admin'),
    201
  )
  assert.equal((await req(`/api/projects/${p.id}`, 'GET', undefined, 'member')).statusCode, 403)
  ok(await req(`/api/projects/${p.id}/roles/u-member`, 'PUT', { role: 'project_member', confirmed: true }))
  ok(await req(`/api/projects/${p.id}`, 'GET', undefined, 'member'))
})
test('模板预览、实际文件、干运行和版本化需求/设计/上下文', async () => {
  const preview = ok(
    await req('/api/projects/prj-phoenix/template-preview', 'POST', {
      files: { 'AGENTS.md': '团队既有规则' }
    })
  )
  assert.deepEqual(preview.conflicts, ['AGENTS.md'])
  assert.equal(
    (
      await req('/api/projects/prj-phoenix/template-apply', 'POST', {
        files: { 'AGENTS.md': '团队既有规则' },
        fingerprint: preview.fingerprint,
        actions: { 'AGENTS.md': 'merge' }
      })
    ).statusCode,
    400
  )
  const applied = ok(
    await req('/api/projects/prj-phoenix/template-apply', 'POST', {
      files: { 'AGENTS.md': '团队既有规则' },
      fingerprint: preview.fingerprint,
      actions: { 'AGENTS.md': 'merge' },
      confirmed: true
    })
  )
  const contents = await req(`/api/files/${applied.fileId}`)
  assert.match(contents.body, /团队既有规则/)
  assert.equal((await req('/api/changes/chg-demo/context-package', 'POST', {})).statusCode, 409)
  ok(await req('/api/changes/chg-demo/confirm-requirements', 'POST', { confirmed: true }))
  ok(
    await req('/api/changes/chg-demo/design', 'PUT', {
      summary: '增加空集合判断',
      impact: ['ask'],
      risks: [],
      unknowns: []
    })
  )
  ok(await req('/api/changes/chg-demo/confirm-design', 'POST', { confirmed: true }))
  const context = ok(await req('/api/changes/chg-demo/context-package', 'POST', {}), 201)
  assert.ok(context.files.length)
  assert.match((await req(`/api/files/${context.id}`)).body, /禁止自动合并/)
})
test('Git 固定提交分析五类栈，动态引用/解析失败保留原始 diff', async () => {
  ok(
    await req('/api/projects/prj-phoenix/repository', 'PUT', {
      url: repoPath,
      repoKey: 'test/demo',
      defaultBranch: 'main'
    })
  )
  const linked = ok(
    await req(
      '/api/changes/chg-demo/git-link',
      'POST',
      { baseRevision: base, headRevision: head, branch: 'feature' },
      'member'
    )
  )
  const diff = linked.semanticDiff
  assert.deepEqual(diff.profiles.sort(), ['css', 'javascript', 'phoenix_dsl', 'sql', 'typescript'])
  for (const [kind, label] of [
    ['logic_node', 'empty'],
    ['function', 'ask'],
    ['import', './app.js'],
    ['selector', '.empty'],
    ['column', 'answers.title']
  ])
    assert.ok(
      diff.nodes.some((n: any) => n.kind === kind && n.label === label && n.change !== 'unchanged'),
      `${kind}:${label}`
    )
  assert.ok(diff.coverage < 1)
  assert.ok(diff.unknowns.some((u: any) => u.path === 'bad.sql'))
  const read = ok(await req('/api/changes/chg-demo/semantic-diff'))
  assert.match((await req(`/api/files/${read.rawDiffRef}`)).body, /diff --git/)
})
test('AI 不可用记失败；worker 认领、租约、幂等与人工重试', async () => {
  const run = ok(await req('/api/changes/chg-demo/ai-runs', 'POST', { agentType: 'intake-agent' }), 202)
  assert.equal(run.status, 'queued')
  const worker = new Worker(db, audit)
  while (await worker.tick()) {}
  const data = ok(await req('/api/changes/chg-demo'))
  assert.ok(data.aiRuns.every((r: any) => r.status === 'failed'))
  assert.ok(data.aiRuns.every((r: any) => !r.output))
  const retry = ok(await req(`/api/ai-runs/${run.id}/retry`, 'POST', {}), 202)
  assert.equal(retry.retryCount, 1)
  const fake = new Worker(db, audit, {
    async run() {
      return {
        output: {
          summary: '需求草稿',
          confidence: 0.8,
          evidence: ['change.requirements'],
          risks: [],
          questions: [],
          userStory: '作为用户...',
          acceptanceCriteria: ['空结果调用次数为零']
        },
        provider: 'fixture',
        model: 'fixture'
      }
    }
  })
  await fake.tick()
  const done = ok(await req('/api/changes/chg-demo')).aiRuns.find((r: any) => r.id === retry.id)
  assert.equal(done.status, 'succeeded')
  assert.equal(done.output.summary, '需求草稿')
})
test('人工 Review、证据上传、失败测试阻塞、通过测试恢复', async () => {
  const finding = {
    severity: 'high',
    category: 'logic',
    path: 'ask.ts',
    message: '空集合需提前返回',
    evidence: ['ask.ts:1'],
    impact: '额外模型调用',
    suggestion: '加入分支',
    confidence: 0.9
  }
  const r = ok(await req('/api/changes/chg-demo/reviews', 'POST', { findings: [finding] }, 'member'), 201)
  assert.equal((await req(`/api/reviews/${r.id}/confirm`, 'POST', { confirmed: true })).statusCode, 409)
  ok(await req(`/api/reviews/${r.id}/findings/${r.findings[0].id}`, 'PATCH', { state: 'fixed' }, 'member'))
  ok(await req(`/api/reviews/${r.id}/confirm`, 'POST', { confirmed: true }))
  assert.equal(
    (
      await req('/api/changes/chg-demo/test-runs', 'POST', {
        status: 'passed',
        result: { total: 1, passed: 1, failed: 0, skipped: 0 }
      })
    ).statusCode,
    400
  )
  const report = ok(
    await req(
      '/api/changes/chg-demo/evidence',
      'POST',
      { name: 'report.txt', content: '人工执行：空结果模型调用次数 0；有结果继续问答' },
      'member'
    ),
    201
  )
  reportId = report.id
  ok(
    await req(
      '/api/changes/chg-demo/test-runs',
      'POST',
      { status: 'failed', result: { total: 1, passed: 0, failed: 1, skipped: 0 }, reportRef: report.id },
      'member'
    ),
    201
  )
  assert.equal(ok(await req('/api/changes/chg-demo')).blocked, true)
  ok(
    await req(
      '/api/changes/chg-demo/test-runs',
      'POST',
      { status: 'passed', result: { total: 1, passed: 1, failed: 0, skipped: 0 }, reportRef: report.id },
      'member'
    ),
    201
  )
  assert.equal(ok(await req('/api/changes/chg-demo')).blocked, false)
})
test('同一制品 test → prod 人工发布/核验，环境锁与审批角色校验', async () => {
  ok(await req('/api/changes/chg-demo/status', 'PATCH', { status: 'in_progress' }, 'member'))
  ok(await req('/api/changes/chg-demo/status', 'PATCH', { status: 'awaiting_acceptance' }, 'member'))
  const r = ok(
    await req(
      '/api/projects/prj-phoenix/releases',
      'POST',
      {
        version: '1.0.0',
        sourceRevision: head,
        artifactRef: artifact,
        configRef: 'config:v1',
        changeIds: ['chg-demo'],
        runbook: '人工导入候选，执行健康检查',
        recovery: '恢复备份版本'
      },
      'member'
    ),
    201
  )
  releaseId = r.id
  for (const env of ['test', 'prod']) {
    ok(
      await req(`/api/projects/prj-phoenix/environments/${env}`, 'PUT', {
        configVersion: '1',
        targetRef: `manual://${env}`,
        confirmed: true
      })
    )
    const preflight = ok(await req(`/api/releases/${r.id}/preflight`, 'POST', { environment: env }))
    assert.equal(preflight.status, 'passed', JSON.stringify(preflight))
    assert.equal(
      (await req(`/api/releases/${r.id}/approve`, 'POST', { environment: env, confirmed: true }, 'admin'))
        .statusCode,
      403
    )
    ok(await req(`/api/releases/${r.id}/approve`, 'POST', { environment: env, confirmed: true }))
    const d = ok(
      await req(`/api/releases/${r.id}/deployments`, 'POST', { environment: env, confirmed: true }, 'member'),
      201
    )
    assert.equal(d.status, 'awaiting_evidence')
    assert.equal(
      (
        await req(
          `/api/releases/${r.id}/deployments`,
          'POST',
          { environment: env, confirmed: true },
          'member'
        )
      ).statusCode,
      409
    )
    const verified = ok(
      await req(
        `/api/deployments/${d.id}/verify`,
        'POST',
        {
          status: 'verified',
          verifiedRevision: head,
          verifiedArtifactRef: artifact,
          configVersion: '1',
          environment: env,
          reportRef: reportId,
          externalOperationId: `manual-${env}`
        },
        'member'
      )
    )
    assert.equal(verified.status, 'verified')
    assert.equal(ok(await req(`/api/deployments/${d.id}/rollback-plan`, 'POST', {})).mode, 'manual')
  }
})
test('版本改变使测试与批准失效；安全管理员不能批准但可否决环境', async () => {
  ok(await req('/api/changes/chg-demo/status', 'PATCH', { status: 'completed', confirmed: true }))
  ok(
    await req(
      '/api/projects/prj-phoenix/environments/prod',
      'PUT',
      { safetyBlocked: true, reason: '安全检查未完成', confirmed: true },
      'security'
    )
  )
  assert.equal(
    ok(await req(`/api/releases/${releaseId}/preflight`, 'POST', { environment: 'prod' })).status,
    'failed'
  )
  assert.equal(
    (
      await req(
        `/api/releases/${releaseId}/approve`,
        'POST',
        { environment: 'prod', confirmed: true },
        'security'
      )
    ).statusCode,
    403
  )
  ok(
    await req('/api/changes/chg-demo/requirements', 'PUT', {
      summary: '新增验收条件',
      acceptanceCriteria: ['空结果调用为零', '无权限返回 403']
    })
  )
  const c = ok(await req('/api/changes/chg-demo'))
  assert.ok(c.tests.every((t: any) => t.stale))
  assert.equal(
    (
      await req(
        `/api/releases/${releaseId}/deployments`,
        'POST',
        { environment: 'prod', confirmed: true },
        'member'
      )
    ).statusCode,
    409
  )
})
test('审计文件过滤/权限/哈希验证以及防篡改', async () => {
  const events = ok(
    await req('/api/audit/events?action=permission.deny&result=denied', 'GET', undefined, 'auditor')
  )
  assert.ok(events.items.length)
  assert.ok(events.items.every((e: any) => e.sourceFile && e.integrity === 'verified'))
  assert.equal((await req('/api/audit/events', 'GET', undefined, 'member')).statusCode, 403)
  const projectEvents = ok(
    await req('/api/audit/events?project_id=prj-phoenix', 'GET', undefined, 'stakeholder')
  )
  assert.ok(projectEvents.items.length)
  assert.equal((await req('/api/audit/export?confirmed=true', 'GET', undefined, 'member')).statusCode, 403)
  const exported = await req(
    '/api/audit/export?confirmed=true&action=release.approve',
    'GET',
    undefined,
    'auditor'
  )
  assert.equal(exported.statusCode, 200)
  assert.equal(exported.body.split('\n').length, 2)
  const local = new AuditLog(join(root, 'tamper'), 'fixture')
  await local.write(entityActor(), 'one', { id: 'a' })
  await local.write(entityActor(), 'two', { id: 'b' })
  const rows = await local.query({}, () => true)
  const file = join(root, 'tamper', rows[0].sourceFile)
  await writeFile(file, (await readFile(file, 'utf8')).replace('"one"', '"changed"'))
  assert.ok((await local.query({}, () => true)).every((e: any) => e.integrity === 'invalid'))
})
function entityActor() {
  return { id: 'test', createdAt: '', updatedAt: '' }
}
test('开发持久化重启与 worker 过期租约恢复', async () => {
  const file = join(root, 'state.json')
  const first = new Database(undefined, file)
  await first.init()
  await first.transaction((s) => {
    s.agent_runs.push({
      id: 'expired',
      createdAt: '',
      updatedAt: '',
      status: 'running',
      leaseUntil: '2000-01-01',
      projectId: 'p'
    })
  })
  await first.close()
  const second = new Database(undefined, file)
  await second.init()
  const w = new Worker(second, audit)
  await w.tick()
  assert.equal(await second.transaction((s) => s.agent_runs[0].status), 'expired')
  await second.close()
})
test('HTTP 模型适配器验证七类输出和非法 JSON，策略在 worker 执行时复核', async () => {
  const { createServer } = await import('node:http')
  const { HttpAiProvider } = await import('../package/src/agents.ts')
  let invalid = false
  const fixture = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const payload = JSON.parse(Buffer.concat(chunks).toString())
    assert.equal(request.url, '/v1/chat/completions')
    assert.equal(payload.response_format.type, 'json_object')
    assert.equal(payload.tools, undefined)
    response.setHeader('content-type', 'application/json')
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: invalid
                ? '{"summary":12}'
                : JSON.stringify({
                    summary: '模型契约测试输出',
                    confidence: 0.8,
                    evidence: ['source'],
                    risks: [],
                    questions: [],
                    userStory: '用户故事',
                    acceptanceCriteria: ['验收条件'],
                    design: '设计草稿',
                    impact: ['ask'],
                    tasks: ['开发交接'],
                    findings: [],
                    tests: ['测试草稿'],
                    configuration: { API_KEY: '${API_KEY}' },
                    runbook: ['人工发布'],
                    recovery: ['恢复版本'],
                    hypotheses: ['假设']
                  })
            }
          }
        ],
        usage: { total_tokens: 100 }
      })
    )
  })
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
  const port = (fixture.address() as any).port
  Object.assign(process.env, {
    AI_BASE_URL: `http://127.0.0.1:${port}/v1`,
    AI_API_KEY: 'fixture-only',
    AI_MODEL: 'fixture-model',
    AI_PROVIDER: 'fixture'
  })
  try {
    const provider = new HttpAiProvider()
    const policy = { allowedProviders: ['fixture'], budgetUsd: 10, maxRunCostUsd: 1, maxOutputTokens: 100 }
    for (const agentType of [
      'intake-agent',
      'design-impact-agent',
      'context-agent',
      'review-agent',
      'test-agent',
      'release-agent',
      'monitor-agent'
    ]) {
      const result = await provider.run({
        id: 'fixture',
        createdAt: '',
        updatedAt: '',
        agentType,
        policy,
        input: { summary: '不可信输入' },
        spentUsd: 0
      })
      assert.equal(result.output.summary, '模型契约测试输出')
    }
    invalid = true
    await assert.rejects(() =>
      provider.run({
        id: 'fixture',
        createdAt: '',
        updatedAt: '',
        agentType: 'intake-agent',
        policy,
        input: {}
      })
    )
    invalid = false
    const policyBody = {
      allowedProviders: ['fixture'],
      allowedFileTypes: ['json', 'md', 'ts', 'js', 'css', 'sql'],
      maxContextBytes: 64000,
      maxOutputTokens: 2000,
      budgetUsd: 10,
      maxRunCostUsd: 1,
      confirmed: true
    }
    ok(await req('/api/projects/prj-phoenix/policy', 'PUT', policyBody, 'security'))
    const run = ok(await req('/api/changes/chg-demo/ai-runs', 'POST', { agentType: 'intake-agent' }), 202)
    ok(
      await req(
        '/api/projects/prj-phoenix/policy',
        'PUT',
        { ...policyBody, allowedProviders: [] },
        'security'
      )
    )
    await new Worker(db, audit).tick()
    const r = ok(await req('/api/changes/chg-demo')).aiRuns.find((r: any) => r.id === run.id)
    assert.equal(r.status, 'failed')
    assert.equal(r.error, 'AI_POLICY_DENIED')
  } finally {
    await new Promise<void>((resolve) => fixture.close(() => resolve()))
    for (const key of ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'AI_PROVIDER']) delete process.env[key]
  }
})
test('登记测试执行真实进程，退出码失败不会被当作通过', async () => {
  const commands = join(root, 'commands.json')
  await writeFile(
    commands,
    JSON.stringify({
      pass: { executable: process.execPath, args: ['-e', 'console.log("ok")'] },
      fail: { executable: process.execPath, args: ['-e', 'process.exit(1)'] }
    })
  )
  process.env.TEST_COMMANDS_FILE = commands
  const worker = new Worker(db, audit)
  for (const [commandRef, expected] of [
    ['pass', 'passed'],
    ['fail', 'failed']
  ]) {
    const d = ok(
      await req('/api/projects/prj-phoenix/test-definitions', 'POST', {
        name: commandRef,
        commandRef,
        kind: 'unit',
        environmentRef: 'isolated'
      }),
      201
    )
    const t = ok(await req('/api/changes/chg-demo/test-runs', 'POST', { definitionId: d.id }, 'member'), 201)
    await worker.tick()
    const run = ok(await req('/api/changes/chg-demo')).tests.find((r: any) => r.id === t.id)
    assert.equal(run.status, expected)
    assert.ok(run.reportRef)
  }
})
test('审计按保留期限归档后仍能校验和查询', async () => {
  const { archiveAudit } = await import('../package/src/retention.ts')
  const local = new AuditLog(join(root, 'rotation'), 'fixture')
  await local.write(entityActor(), 'retained.event', { type: 'record', id: 'test' })
  const rows = await local.query({}, () => true)
  const { rename } = await import('node:fs/promises')
  await rename(join(local.root, rows[0].sourceFile), join(local.root, 'audit-2000-01-01-fixture.jsonl'))
  assert.equal(await archiveAudit(local, 30), 1)
  const archived = await local.query({ action: 'retained.event' }, () => true)
  assert.equal(archived.length, 1)
  assert.equal(archived[0].integrity, 'verified')
  assert.match(archived[0].sourceFile, /^archive\//)
})
