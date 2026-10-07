export type Row = { id: string; [key: string]: any };
export type Workspace = {
  projects: Row[];
  requirements: Row[];
  branches: Row[];
  pulls: Row[];
  versions: Row[];
  credentials: Row[];
  users: Row[];
  requests: Row[];
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
  INITIALIZING: "初始化中",
  OPEN: "待处理",
  IN_PROGRESS: "进行中",
  DONE: "已完成",
  CANCELLED: "已取消",
  MERGED: "已合并",
  DELETED: "已删除",
  UNKNOWN: "待核对",
  FAILED: "失败",
  SUCCEEDED: "已完成",
  COMPLETED: "已完成",
  READY: "已就绪",
  MAINTENANCE: "备份维护",
  UNAVAILABLE: "暂不可用",
  feature: "功能",
  defect: "缺陷",
  change: "变更",
  low: "低",
  normal: "普通",
  high: "高",
  human: "人类 · IDE Git",
  ide_agent: "IDE Agent",
  devops_agent: "DevOps Agent",
  owner: "项目负责人",
  member: "项目成员",
  observer: "观察者",
  remove: "移出项目",
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
