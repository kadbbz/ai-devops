import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'
import postcss from 'postcss'
import scss from 'postcss-scss'
import less from 'postcss-less'
import sqlParser from 'node-sql-parser'
import { check, fingerprint } from './domain.js'
const exec = promisify(execFile)
const { Parser } = sqlParser
export type Snapshot = Record<string, string>
export interface Node {
  id: string
  kind: string
  label: string
  path: string
  confidence: number
  riskTags: string[]
  signature: string
  change?: string
  line?: number
}
export interface Edge {
  from: string
  to: string
  kind: string
  change?: string
}
const git = async (cwd: string, args: string[]) =>
  (
    await exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd,
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' }
    })
  ).stdout
export interface RepositoryAdapter {
  compare(input: {
    repository: any
    baseRevision: string
    headRevision: string
  }): Promise<{ base: Snapshot; head: Snapshot; rawDiff: string; mode: string }>
}
export class GitRepositoryAdapter implements RepositoryAdapter {
  async withCheckout<T>(repository: any, task: (directory: string) => Promise<T>) {
    const root = process.env.WORKSPACE_ROOT || '.data/workspaces'
    await mkdir(root, { recursive: true })
    const directory = await mkdtemp(join(root, 'repo-'))
    try {
      const url = repository.url as string
      if (url.startsWith('/'))
        check(
          process.env.ALLOW_LOCAL_REPOSITORIES === 'true' && process.env.NODE_ENV !== 'production',
          'REPOSITORY_FORBIDDEN',
          '生产仅支持登记的 Git 服务',
          403
        )
      else {
        const target = new URL(url)
        const base = new URL(process.env.GIT_BASE_URL || 'http://git-service:3000')
        check(
          target.origin === base.origin && !target.username && !target.password,
          'REPOSITORY_FORBIDDEN',
          '仅允许配置的 Git 服务地址且不能包含凭证',
          403
        )
      }
      const token = repository.credentialRef ? process.env[repository.credentialRef] : undefined
      const configEnv: NodeJS.ProcessEnv = token
        ? {
            GIT_CONFIG_COUNT: '1',
            GIT_CONFIG_KEY_0: 'http.extraHeader',
            GIT_CONFIG_VALUE_0: `Authorization: token ${token}`
          }
        : {}
      await exec('git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--no-checkout', '--', url, directory], {
        cwd: directory,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
        env: { PATH: process.env.PATH, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', ...configEnv }
      })
      return await task(directory)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
  async compare(input: { repository: any; baseRevision: string; headRevision: string }) {
    return this.withCheckout(input.repository, async (directory) => {
      const snapshot = async (revision: string) => {
        check(/^[a-f0-9]{40}$/.test(revision), 'REVISION_INVALID', '必须指定固定提交', 400)
        await git(directory, ['cat-file', '-e', `${revision}^{commit}`])
        const paths = (await git(directory, ['ls-tree', '-r', '--name-only', revision]))
          .trim()
          .split('\n')
          .filter(Boolean)
        check(paths.length <= 3000, 'REPOSITORY_TOO_LARGE', 'P0 仓库最多分析 3000 个文件', 400)
        const files: Snapshot = {}
        for (const path of paths) {
          if (/(^|\/)(node_modules|vendor|\.env)(\/|$)/.test(path) || /lock\.json$/.test(path)) continue
          const content = await git(directory, ['show', `${revision}:${path}`])
          if (!content.includes('\0') && content.length <= 300000) files[path] = content
        }
        return files
      }
      return {
        base: await snapshot(input.baseRevision),
        head: await snapshot(input.headRevision),
        rawDiff: await git(directory, [
          'diff',
          '--no-ext-diff',
          input.baseRevision,
          input.headRevision,
          '--'
        ]),
        mode: 'automatic'
      }
    })
  }
  async getPullRequest(repository: any, number: number) {
    check(Number.isInteger(number) && number > 0, 'PR_INVALID', 'PR 编号无效', 400)
    const base = process.env.GIT_BASE_URL || 'http://git-service:3000'
    check(/^[\w.-]+\/[\w.-]+$/.test(repository.repoKey), 'REPO_KEY_INVALID', '仓库标识需要 owner/repo', 400)
    const token = repository.credentialRef ? process.env[repository.credentialRef] : undefined
    const response = await fetch(`${base}/api/v1/repos/${repository.repoKey}/pulls/${number}`, {
      headers: token ? { Authorization: `token ${token}` } : {},
      signal: AbortSignal.timeout(15000),
      redirect: 'error'
    })
    check(response.ok, 'GIT_UNAVAILABLE', '无法读取 Gitea PR', 502)
    const pr: any = await response.json()
    return {
      number: pr.number,
      baseRevision: pr.base.sha,
      headRevision: pr.head.sha,
      branch: pr.head.ref,
      url: pr.html_url,
      state: pr.state,
      merged: pr.merged,
      mode: 'automatic'
    }
  }
}
export function detect(files: Snapshot) {
  const patterns: Record<string, (path: string) => boolean> = {
    phoenix_dsl: (p) => /(^|\/)app\.pxproj$|^documents\/.*\.json$/.test(p),
    typescript: (p) => /\.tsx?$|tsconfig.*\.json$/.test(p),
    javascript: (p) => /\.jsx?$|(^|\/)package\.json$/.test(p),
    css: (p) => /\.(css|scss|less)$/.test(p),
    sql: (p) => /\.sql$/.test(p)
  }
  return Object.entries(patterns)
    .map(([profileCode, matches]) => ({
      profileCode,
      confidence: 0.95,
      detectedFiles: Object.keys(files).filter(matches),
      version: '1.0.0'
    }))
    .filter((p) => p.detectedFiles.length)
}
function parse(files: Snapshot) {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const unknowns: { path: string; reason: string }[] = []
  let supported = 0
  let parsed = 0
  for (const [path, source] of Object.entries(files)) {
    if (!/\.(json|pxproj|[cm]?[jt]sx?|css|scss|less|sql)$/.test(path)) continue
    supported++
    const add = (kind: string, label: string, signature: unknown, line = 1) => {
      const node = {
        id: `${path}:${kind}:${label}`,
        kind,
        label,
        path,
        confidence: 0.95,
        riskTags: /permission|auth|password|token/i.test(source) ? ['permission'] : [],
        signature: fingerprint(signature),
        line
      }
      nodes.push(node)
      return node.id
    }
    try {
      if (/\.[jt]sx?$/.test(path)) {
        const file = ts.createSourceFile(
          path,
          source,
          ts.ScriptTarget.Latest,
          true,
          path.endsWith('x') ? ts.ScriptKind.TSX : path.endsWith('js') ? ts.ScriptKind.JS : ts.ScriptKind.TS
        )
        check(!(file as any).parseDiagnostics?.length, 'PARSE', 'TypeScript 语法无法完整解析')
        const module = add(/test|spec/.test(path) ? 'test' : 'module', path, source)
        const visit = (node: ts.Node) => {
          const name = (node as ts.NamedDeclaration).name?.getText(file)
          if (
            name &&
            (ts.isFunctionDeclaration(node) ||
              ts.isClassDeclaration(node) ||
              ts.isInterfaceDeclaration(node) ||
              ts.isTypeAliasDeclaration(node) ||
              ts.isVariableDeclaration(node))
          )
            add(
              ts.isClassDeclaration(node)
                ? 'class'
                : ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
                  ? 'type'
                  : 'function',
              name,
              node.getText(file),
              file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
            )
          if (ts.isImportDeclaration(node)) {
            const target = node.moduleSpecifier.getText(file).replace(/['"]/g, '')
            const id = add('import', target, node.getText(file))
            edges.push({ from: module, to: id, kind: 'imports' })
          }
          if (
            ts.isCallExpression(node) &&
            /\.(get|post|put|delete|patch)$/.test(node.expression.getText(file))
          )
            add(
              'route',
              node.arguments[0]?.getText(file) || node.expression.getText(file),
              node.getText(file)
            )
          ts.forEachChild(node, visit)
        }
        visit(file)
      } else if (/\.(css|scss|less)$/.test(path)) {
        const ast: postcss.Root = path.endsWith('.scss')
          ? scss.parse(source)
          : path.endsWith('.less')
            ? less.parse(source)
            : postcss.parse(source)
        ast.walkRules((rule) => {
          const id = add('selector', rule.selector, rule.toString(), rule.source?.start?.line)
          rule.walkDecls((decl) => {
            const child = add(
              decl.prop.startsWith('--') ? 'variable' : 'rule',
              `${rule.selector}:${decl.prop}`,
              decl.value,
              decl.source?.start?.line
            )
            edges.push({ from: id, to: child, kind: 'contains' })
          })
        })
        ast.walkAtRules((rule) => {
          add('media', `${rule.name} ${rule.params}`, rule.toString(), rule.source?.start?.line)
        })
      } else if (path.endsWith('.sql')) {
        const statements: any = new Parser().astify(source, { database: 'MySQL' })
        for (const [statementIndex, stmt] of (Array.isArray(statements)
          ? statements
          : [statements]
        ).entries()) {
          const tables = stmt.table || stmt.from || []
          for (const table of Array.isArray(tables) ? tables : [tables]) {
            const tableName = table.table || table.name || 'migration'
            const id = add('table', tableName, stmt)
            for (const def of stmt.create_definitions || stmt.expr || []) {
              const col = def.column?.column || def.index || def.name || def.resource
              if (col) {
                const child = add(
                  def.resource === 'column'
                    ? 'column'
                    : /index|key/.test(def.resource || def.constraint_type || '')
                      ? 'index'
                      : 'constraint',
                  `${tableName}.${typeof col === 'string' ? col : JSON.stringify(col)}`,
                  def
                )
                edges.push({ from: id, to: child, kind: 'contains' })
              }
            }
          }
          add('migration', `${stmt.type}:${statementIndex}`, stmt)
        }
      } else if (path.startsWith('documents/') || path.endsWith('.pxproj')) {
        const data = JSON.parse(source)
        const kind = /\/logic\//.test(path)
          ? 'logic'
          : /\/page\//.test(path)
            ? 'page'
            : /permission/i.test(path)
              ? 'permission'
              : /external|api/i.test(path)
                ? 'external_api'
                : /type/i.test(path)
                  ? 'type'
                  : 'global'
        const root = add(
          kind,
          data.name ||
            path
              .split('/')
              .pop()!
              .replace(/\.json$/, ''),
          data
        )
        const walk = (value: any, trail: string) => {
          if (!value || typeof value !== 'object') return
          if (value.id || value.nodeId) {
            const id = add('logic_node', String(value.id || value.nodeId), value)
            edges.push({ from: root, to: id, kind: 'contains' })
          }
          for (const [key, child] of Object.entries(value)) {
            if (typeof child === 'string' && /ref|logic|api|target|call/i.test(key)) {
              if (/\$\{|\{\{|eval\(/.test(child)) unknowns.push({ path, reason: `动态引用 ${trail}.${key}` })
              else {
                const target = add('reference', child, child)
                edges.push({ from: root, to: target, kind: 'calls' })
                if (/llm|模型/i.test(child)) nodes.find((n) => n.id === root)!.riskTags.push('llm-call')
              }
            }
            walk(child, `${trail}.${key}`)
          }
        }
        walk(data, '$')
      } else {
        JSON.parse(source)
        add('config', path, source)
      }
      parsed++
    } catch {
      unknowns.push({ path, reason: '语义解析失败，保留原始 diff' })
    }
  }
  return { nodes, edges, unknowns, supported, parsed }
}
export function analyze(base: Snapshot, head: Snapshot, baseRevision: string, headRevision: string) {
  const before = parse(base)
  const after = parse(head)
  const old = new Map(before.nodes.map((n) => [n.id, n]))
  const current = new Map(after.nodes.map((n) => [n.id, n]))
  const nodes = [...current.values()].map((n) => ({
    ...n,
    change: !old.has(n.id) ? 'added' : old.get(n.id)!.signature === n.signature ? 'unchanged' : 'modified'
  }))
  nodes.push(...before.nodes.filter((n) => !current.has(n.id)).map((n) => ({ ...n, change: 'deleted' })))
  const edgeKey = (e: Edge) => `${e.from}:${e.to}:${e.kind}`
  const oldEdges = new Set(before.edges.map(edgeKey))
  const newEdges = new Set(after.edges.map(edgeKey))
  return {
    baseRevision,
    headRevision,
    profiles: detect({ ...base, ...head }).map((p) => p.profileCode),
    detections: detect(head),
    nodes,
    edges: [
      ...after.edges.map((e) => ({ ...e, change: oldEdges.has(edgeKey(e)) ? 'unchanged' : 'added' })),
      ...before.edges.filter((e) => !newEdges.has(edgeKey(e))).map((e) => ({ ...e, change: 'deleted' }))
    ],
    unknowns: [...before.unknowns, ...after.unknowns],
    coverage:
      before.supported + after.supported
        ? (before.parsed + after.parsed) / (before.supported + after.supported)
        : 0
  }
}
