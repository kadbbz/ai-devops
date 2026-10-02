import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const envPath = new URL('../docker/.env', import.meta.url)
const config = Object.fromEntries(
  (await readFile(envPath, 'utf8'))
    .trim()
    .split('\n')
    .filter((l) => !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1)]
    })
)
const base = `http://localhost:${config.DEVOPS_PORT || 8080}`
const report = { startedAt: new Date().toISOString(), checks: [] }
async function login(username, password) {
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
  const b = await r.json()
  assert.equal(r.status, 200, JSON.stringify(b))
  return { cookie: r.headers.get('set-cookie').split(';')[0], csrf: b.csrf, user: b.user }
}
async function request(session, path, method = 'GET', body) {
  const r = await fetch(base + path, {
    method,
    headers: {
      cookie: session.cookie,
      'x-csrf-token': session.csrf,
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const b = await r.json()
  assert.ok(r.ok, JSON.stringify({ path, status: r.status, body: b }))
  return b
}
let admin = await login('admin', config.BOOTSTRAP_PASSWORD)
if (admin.user.mustChangePassword) {
  const password = randomBytes(20).toString('hex')
  await request(admin, '/api/auth/password', 'POST', { currentPassword: config.BOOTSTRAP_PASSWORD, password })
  config.BOOTSTRAP_PASSWORD = password
  await writeFile(
    envPath,
    Object.entries(config)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n',
    { mode: 0o600 }
  )
  admin = await login('admin', password)
}
report.checks.push('production-session-bootstrap-password-change')
const suffix = Date.now()
const ownerPass = randomBytes(20).toString('hex')
const owner = await request(admin, '/api/users', 'POST', {
  username: `owner-${suffix}`,
  displayName: 'P0 验收负责人',
  password: ownerPass
})
let session = await login(owner.username, ownerPass)
const newPass = randomBytes(20).toString('hex')
await request(session, '/api/auth/password', 'POST', { currentPassword: ownerPass, password: newPass })
session = await login(owner.username, newPass)
const p = await request(admin, '/api/projects', 'POST', {
  code: `P0-${suffix}`,
  name: 'P0 容器验收项目',
  ownerUserId: owner.id,
  template: 'phoenix-resource'
})
const c = await request(session, `/api/projects/${p.id}/changes`, 'POST', { title: '验证 Git PR 与持久化' })
report.projectId = p.id
report.changeId = c.id
report.checks.push('mysql-project-change-persistence')
const gitName = `p0-${suffix}`,
  gitPass = randomBytes(20).toString('hex')
const gitBase = `http://localhost:${config.GIT_PORT || 3000}`
execFileSync(
  'docker',
  [
    'compose',
    '--env-file',
    new URL('../docker/.env', import.meta.url).pathname,
    '-f',
    new URL('../docker/docker-compose.yml', import.meta.url).pathname,
    'exec',
    '-T',
    'git-service',
    'gitea',
    'admin',
    'user',
    'create',
    '--username',
    gitName,
    '--password',
    gitPass,
    '--email',
    `${gitName}@example.invalid`,
    '--must-change-password=false'
  ],
  { stdio: 'pipe' }
)
const gitHeaders = {
  Authorization: `Basic ${Buffer.from(`${gitName}:${gitPass}`).toString('base64')}`,
  'Content-Type': 'application/json'
}
const repoResponse = await fetch(gitBase + '/api/v1/user/repos', {
  method: 'POST',
  headers: gitHeaders,
  body: JSON.stringify({ name: 'p0-fixture', private: false, auto_init: true, default_branch: 'main' })
})
const repo = await repoResponse.json()
assert.ok(repoResponse.ok, JSON.stringify(repo))
const directory = await mkdtemp(join(tmpdir(), 'devops-gitea-'))
const git = (...args) =>
  execFileSync('git', args, {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.extraHeader',
      GIT_CONFIG_VALUE_0: gitHeaders.Authorization ? 'Authorization: ' + gitHeaders.Authorization : ''
    }
  }).trim()
git('clone', '-q', `${gitBase}/${gitName}/p0-fixture.git`, '.')
git('config', 'user.email', 'p0@example.invalid')
git('config', 'user.name', 'P0 Acceptance')
const baseRevision = git('rev-parse', 'HEAD')
git('checkout', '-qb', 'feature')
await writeFile(
  join(directory, 'ask.ts'),
  'export function ask(hits: unknown[]) { return hits.length ? "answer" : "no result" }\n'
)
git('add', '.')
git('commit', '-qm', 'Add empty-result guard')
git('push', '-q', 'origin', 'feature')
const head = git('rev-parse', 'HEAD')
const prResponse = await fetch(`${gitBase}/api/v1/repos/${gitName}/p0-fixture/pulls`, {
  method: 'POST',
  headers: gitHeaders,
  body: JSON.stringify({ base: 'main', head: 'feature', title: 'P0 本地验收 PR' })
})
const pr = await prResponse.json()
assert.ok(prResponse.ok, JSON.stringify(pr))
await request(session, `/api/projects/${p.id}/repository`, 'PUT', {
  url: `http://git-service:3000/${gitName}/p0-fixture.git`,
  repoKey: `${gitName}/p0-fixture`,
  defaultBranch: 'main'
})
const linked = await request(session, `/api/changes/${c.id}/git-link`, 'POST', { prNumber: pr.number })
assert.equal(linked.headRevision, head)
assert.ok(linked.semanticDiff.nodes.some((n) => n.label === 'ask'))
report.checks.push('gitea-api-pr-and-git-cli-diff')
const file = await request(session, `/api/changes/${c.id}/evidence`, 'POST', {
  name: 'compose-evidence.txt',
  content: '容器恢复检查文件'
})
report.fileId = file.id
const compose = [
  'compose',
  '--env-file',
  new URL('../docker/.env', import.meta.url).pathname,
  '-f',
  new URL('../docker/docker-compose.yml', import.meta.url).pathname
]
execFileSync('docker', [...compose, 'stop', 'devops-worker'], { stdio: 'pipe' })
const run = await request(session, `/api/changes/${c.id}/ai-runs`, 'POST', { agentType: 'monitor-agent' })
execFileSync('docker', [...compose, 'restart', 'devops-app'], { stdio: 'pipe' })
execFileSync('docker', [...compose, 'start', 'devops-worker'], { stdio: 'pipe' })
for (let i = 0; i < 40; i++) {
  try {
    const q = await request(session, `/api/changes/${c.id}`)
    const task = q.aiRuns.find((r) => r.id === run.id)
    if (task.status === 'failed') {
      assert.equal(task.error, 'AI_UNAVAILABLE')
      report.checks.push('queued-task-survives-app-worker-restart')
      break
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500))
}
assert.ok(report.checks.includes('queued-task-survives-app-worker-restart'))
const downloaded = await fetch(base + `/api/files/${file.id}`, { headers: { cookie: session.cookie } })
assert.equal(await downloaded.text(), '容器恢复检查文件')
report.checks.push('named-volume-file-survives-restart')
const auditor = await request(admin, '/api/users', 'POST', {
  username: `auditor-${suffix}`,
  displayName: 'P0 验收审计员',
  password: ownerPass
})
await request(admin, `/api/users/${auditor.id}`, 'PUT', {
  platformRole: 'platform_auditor',
  reason: 'P0 验收',
  confirmed: true
})
let auditSession = await login(auditor.username, ownerPass)
await request(auditSession, '/api/auth/password', 'POST', { currentPassword: ownerPass, password: newPass })
auditSession = await login(auditor.username, newPass)
const auditRows = await request(auditSession, `/api/audit/events?project_id=${p.id}&page_size=100`)
assert.ok(auditRows.items.some((e) => e.actor.type === 'system'))
assert.ok(auditRows.items.every((e) => e.integrity === 'verified'))
report.checks.push('app-worker-jsonl-query-after-restart')
report.finishedAt = new Date().toISOString()
await mkdir(new URL('../doc/validation/', import.meta.url), { recursive: true })
await writeFile(
  new URL('../doc/validation/compose-smoke.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n'
)
console.log(JSON.stringify(report, null, 2))
