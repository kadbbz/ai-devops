import argon2 from 'argon2'
import { entity, type State, check } from './domain.js'
import { platformRoles, projectRoles } from './shared/contracts.js'
export async function bootstrap(s: State) {
  if (!s.roles.length)
    s.roles.push(
      ...[...platformRoles, ...projectRoles].map((code) =>
        entity('role', {
          code,
          scope: code.startsWith('platform') ? 'platform' : 'project',
          readOnly: ['platform_auditor', 'project_stakeholder'].includes(code)
        })
      )
    )
  if (!s.templates.length)
    s.templates.push(
      entity('template', {
        code: 'phoenix-resource',
        version: '1.0.0',
        status: 'active',
        manifest: [
          'AGENTS.md',
          '.project/project.json',
          '.agents/skills/requirements/SKILL.md',
          '.workspace/glossary.md'
        ]
      })
    )
  if (s.users.length) return
  const demo = process.env.DEMO_SEED === 'true' && process.env.NODE_ENV !== 'production'
  const password = demo ? process.env.DEMO_PASSWORD : process.env.BOOTSTRAP_PASSWORD
  check(
    password && password.length >= 12,
    'BOOTSTRAP_REQUIRED',
    '首次启动需设置不少于 12 位的 BOOTSTRAP_PASSWORD',
    503
  )
  const passwordHash = await argon2.hash(password!, { type: argon2.argon2id })
  for (const name of demo ? ['admin', 'auditor', 'security', 'owner', 'member', 'stakeholder'] : ['admin']) {
    const platformRole = (
      { admin: 'platform_admin', auditor: 'platform_auditor', security: 'platform_security_admin' } as Record<
        string,
        string
      >
    )[name]
    s.users.push(
      entity('user', {
        id: `u-${name}`,
        username: name === 'admin' ? process.env.BOOTSTRAP_USERNAME || name : name,
        displayName: name,
        passwordHash,
        platformRole,
        status: 'active',
        mustChangePassword: !demo
      })
    )
    if (platformRole)
      s.user_platform_roles.push(entity('binding', { userId: `u-${name}`, roleId: platformRole }))
  }
  if (!demo) return
  const project = entity('project', {
    id: 'prj-phoenix',
    code: 'IKKYU',
    name: '内部知识库',
    description: 'Phoenix 资源型项目 P0 试点',
    application: '知识问答',
    customer: '内部团队',
    businessDomain: '知识管理',
    ownerUserId: 'u-owner',
    template: 'phoenix-resource',
    templateVersion: '1.0.0',
    members: {
      'u-owner': 'project_owner',
      'u-member': 'project_member',
      'u-stakeholder': 'project_stakeholder'
    },
    status: 'active',
    stackProfiles: []
  })
  s.projects.push(project)
  for (const [userId, roleId] of Object.entries(project.members))
    s.project_role_bindings.push(
      entity('binding', { projectId: project.id, userId, roleId, assignedBy: 'u-admin' })
    )
  for (const code of ['test', 'prod'])
    s.environments.push(
      entity('env', {
        projectId: project.id,
        code,
        kind: code,
        configVersion: '1',
        targetRef: '',
        currentRevision: null,
        currentArtifactRef: null,
        safetyBlocked: false
      })
    )
  s.changes.push(
    entity('change', {
      id: 'chg-demo',
      projectId: project.id,
      key: 'CHG-001',
      title: '问答无命中时返回提示并跳过模型调用',
      type: 'improvement',
      ownerUserId: 'u-member',
      status: 'inbox',
      blocked: false,
      requirementsVersion: 1,
      designVersion: 0,
      requirements: {
        summary: '检索无命中时直接返回固定提示',
        userStory: '用户希望无资料时收到明确提示',
        acceptanceCriteria: [
          '空结果不调用模型',
          '有命中保持原链路',
          '无权限不泄露资料',
          '检索故障与无资料区分'
        ],
        nfr: ['权限隔离'],
        scope: ''
      },
      links: []
    })
  )
}
