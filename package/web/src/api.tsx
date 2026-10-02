import { createContext, useContext } from 'react'
export type Row = Record<string, any>
let csrf = ''
export const setCsrf = (value: string) => {
  csrf = value
}
export async function api<T = any>(url: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: {
      ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'x-csrf-token': csrf } : {})
    },
    body: data === undefined ? undefined : JSON.stringify(data)
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message || `请求失败 (${response.status})`)
  return body as T
}
export const Session = createContext<{ user: Row; refresh: () => Promise<void> }>({
  user: {},
  refresh: async () => {}
})
export const useSession = () => useContext(Session)
export const states: Record<string, string> = {
  inbox: '收件箱',
  ready: '就绪',
  in_progress: '开发中',
  awaiting_acceptance: '待验收',
  completed: '已完成',
  queued: '排队中',
  running: '执行中',
  succeeded: '已生成建议',
  failed: '失败',
  cancelled: '已取消',
  expired: '已过期',
  passed: '通过',
  not_executed: '未执行',
  pending_human: '待人工审查',
  reviewed: '已审查',
  awaiting_evidence: '等待核验证据',
  verified: '已核验',
  candidate: '候选',
  open: '未处置',
  fixed: '已修复',
  accepted: '接受例外',
  false_positive: '误报'
}
export const roles: Record<string, string> = {
  platform_admin: '平台管理员',
  platform_auditor: '平台审计员',
  platform_security_admin: '平台安全管理员',
  project_owner: '项目负责人',
  project_member: '项目成员',
  project_stakeholder: '项目干系人'
}
export async function uploadEvidence(changeId: string, file: File) {
  const data = new FormData()
  data.append('file', file)
  const response = await fetch(`/api/changes/${changeId}/evidence`, {
    method: 'POST',
    headers: { 'x-csrf-token': csrf },
    body: data
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.message || '上传失败')
  return result
}
