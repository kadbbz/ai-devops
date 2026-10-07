export type Row = { id: string; [key: string]: any };
export type Workspace = {
  projects: Row[];
  intents: Row[];
  deliveries: Row[];
  approvals: Row[];
  evidence: Row[];
  operations: Row[];
  credentials: Row[];
  users: Row[];
  syncTasks: Row[];
};
let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export async function api(path: string, body?: any, key?: string) {
  const res = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers:
      body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
            "Idempotency-Key": key || crypto.randomUUID(),
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res
    .json()
    .catch(() => ({ message: "服务正在初始化或维护，请稍后刷新" }));
  if (!res.ok)
    throw Object.assign(new Error(data.message), {
      code: data.code,
      status: res.status,
    });
  return data;
}
export const act = async (name: string, body: any, key?: string) =>
  (await api("/actions/" + name, body, key)).result;
export const labels: Record<string, string> = {
  ACTIVE: "正常",
  DRAFT: "方案草稿",
  A_SIGNED: "工作区已确认",
  IMPLEMENTING: "开发中",
  PR_OPEN: "等待合并",
  MERGED: "已合并",
  COMPOSITION_PENDING: "等待组合验证",
  C_SIGNED: "发布输入已签发",
  RELEASE_REQUESTED: "发布执行中",
  CLOSED: "已核验关闭",
  RELEASE_FAILED: "发布待处理",
  UNKNOWN: "结果未知",
  FAIL_CLOSED: "已阻断",
  HUMAN_RECOVERY: "等待人类恢复",
  STALE: "已失效",
  PASSED: "通过",
  FAILED: "失败",
  SUCCEEDED: "已完成",
  REGISTERED: "等待执行",
  RUNNING: "执行中",
  QUEUED: "等待领取",
  OPEN: "等待合并",
  REVERIFY_REQUIRED: "需要重新验证",
  VALID: "有效",
  COMPLETED: "已完成",
  SYNC_REQUIRED: "需要同步",
  WAIVED: "已豁免",
  READY: "已就绪",
  MAINTENANCE: "备份维护",
  UNAVAILABLE: "暂不可用",
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  feature: "功能",
  defect: "缺陷",
  hotfix: "生产热修复",
  migration: "数据迁移",
  config: "配置变更",
  security: "安全",
  sync: "热修复同步",
  human: "人类 · IDE Git",
  ide_agent: "IDE agent",
  devops_agent: "DevOps agent",
  ide_control: "IDE 预设逻辑",
  runner: "隔离 Runner",
  owner: "项目负责人",
  reviewer: "项目审查人",
  member: "项目成员",
  observer: "观察者",
};
export const label = (s: string) => labels[s] || s;
export const shortSha = (s?: string) =>
  s ? s.replace("sha256:", "").slice(0, 12) : "尚未确认";
export const date = (s?: string) =>
  s
    ? new Date(s).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      }) + " CST"
    : "—";
