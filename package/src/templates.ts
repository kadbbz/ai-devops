import { check, entity, fingerprint, type Entity, type State } from './domain.js'
import { saveFile } from './files.js'
export function previewTemplate(project: Entity, files: Record<string, string> = {}) {
  const generated: Record<string, string> = {
    'AGENTS.md': `# ${project.name}\n\n仅处理已确认范围；不得自动合并或发布。验收标准与固定提交必须关联。\n`,
    '.project/project.json': JSON.stringify(
      {
        code: project.code,
        name: project.name,
        template: project.template,
        version: project.templateVersion,
        environments: ['test', 'prod']
      },
      null,
      2
    ),
    '.agents/skills/requirements/SKILL.md':
      '# 需求澄清\n\n输出用户故事、验收标准、NFR、风险和待确认问题。输出仅为草稿。\n',
    '.workspace/glossary.md': '# 项目术语\n\n由项目团队维护业务术语。\n'
  }
  const rows = Object.entries(generated).map(([path, after]) => ({
    path,
    before: files[path] ?? null,
    after,
    action: files[path] === undefined ? 'create' : 'skip',
    conflict: files[path] !== undefined && files[path] !== after
  }))
  const sensitiveMatches = Object.entries(files)
    .filter(([, content]) => /(?:password|api[_-]?key|token|secret)\s*[:=]\s*["']?[^\s"']{8,}/i.test(content))
    .map(([path]) => ({ path, reason: '检测到可能的凭证，必须先脱敏' }))
  return {
    files: rows,
    conflicts: rows.filter((f) => f.conflict).map((f) => f.path),
    sensitiveMatches,
    fingerprint: fingerprint({ generated, files })
  }
}
export async function applyTemplate(
  s: State,
  project: Entity,
  preview: ReturnType<typeof previewTemplate>,
  actions: Record<string, string>,
  confirmed: boolean
) {
  check(!preview.sensitiveMatches.length, 'SENSITIVE_DATA', '模板输入包含疑似凭证', 400)
  const output: Record<string, string> = {}
  for (const row of preview.files) {
    const action = actions[row.path] || row.action
    check(['create', 'merge', 'skip'].includes(action), 'TEMPLATE_ACTION', '无效模板动作', 400)
    check(
      !row.conflict || action === 'skip' || confirmed,
      'CONFIRMATION_REQUIRED',
      '模板合并必须二次确认',
      400
    )
    output[row.path] =
      action === 'skip'
        ? (row.before ?? row.after)
        : action === 'merge' && row.before
          ? `${row.before}\n${row.after}`
          : row.after
    check(!(action === 'create' && row.before !== null), 'TEMPLATE_CONFLICT', '现有文件必须选择合并或跳过')
  }
  const file = await saveFile(s, project.id, JSON.stringify(output, null, 2), 'template-files.json')
  const instance = entity('template_instance', {
    projectId: project.id,
    templateId: s.templates.find((t) => t.code === project.template)?.id,
    version: project.templateVersion,
    variables: { name: project.name, code: project.code },
    fileManifest: preview.files.map((f) => ({
      path: f.path,
      action: actions[f.path] || f.action,
      sha256: fingerprint(output[f.path])
    })),
    conflictSummary: preview.conflicts,
    fileId: file.id
  })
  s.template_instances.push(instance)
  project.templateInstanceId = instance.id
  return instance
}
