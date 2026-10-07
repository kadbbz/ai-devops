import { z } from "zod";
import { createHash, createHmac, randomUUID } from "node:crypto";
export class Fault extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
    public details?: any,
  ) {
    super(message);
  }
}
export function check(
  value: unknown,
  code: string,
  message: string,
  status = 409,
): asserts value {
  if (!value) throw new Fault(code, message, status);
}
export const now = () => new Date().toISOString();
export const id = (prefix: string) =>
  `${prefix}_${randomUUID().replaceAll("-", "")}`;
export function canonical(v: any): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
    .join(",")}}`;
}
export const tokenHash = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
export const digest = (v: any) => "sha256:" + tokenHash(canonical(v));
export const mac = (key: string, v: any) =>
  createHmac("sha256", key).update(canonical(v)).digest("hex");
export interface Entity {
  id: string;
  [key: string]: any;
}
export interface Actor {
  id: string;
  userId: string;
  role: string;
  name: string;
  projectId?: string;
  admin?: boolean;
  credentialId?: string;
}
export const CORE_TABLES = [
  "users",
  "projects",
  "requirements",
  "branches",
  "pulls",
  "versions",
  "credentials",
  "sessions",
  "requests",
] as const;
export const TABLES = [...CORE_TABLES, "skills", "templates"] as const;
export type State = Record<(typeof TABLES)[number], Entity[]>;
export const emptyState = (): State =>
  Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as State;
export function find(list: Entity[], key: string): Entity {
  const v = list.find((x) => x.id === key);
  check(v, "NOT_FOUND", "对象不存在", 404);
  return v;
}
export function access(a: Actor, p: Entity, write = false) {
  check(p.members?.[a.userId], "FORBIDDEN", "你不是此项目的成员", 403);
  check(
    !a.projectId || a.projectId === "*" || a.projectId === p.id,
    "PROJECT_DENIED",
    "凭证不允许访问此项目",
    403,
  );
  if (write)
    check(
      p.members[a.userId] !== "observer",
      "FORBIDDEN",
      "观察者只能读取",
      403,
    );
}
export const short = z.string().trim().min(1).max(200),
  text = z.string().trim().max(20000),
  sha = z.string().regex(/^[a-f0-9]{40}$/);
export const refName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/)
  .refine(
    (s) =>
      !s.includes("..") &&
      !s.includes("//") &&
      !s.includes("@{") &&
      !s.endsWith("/") &&
      !s
        .split("/")
        .some(
          (x) => x.startsWith(".") || x.endsWith(".") || x.endsWith(".lock"),
        ),
    "引用名称无效",
  );
export const projectSchema = z
  .object({
    name: short,
    slug: z
      .string()
      .regex(/^[a-z][a-z0-9-]{1,50}$/)
      .optional(),
  })
  .strict();
export const skillSchema = z
  .object({
    name: short,
    slug: z
      .string()
      .regex(/^[a-z][a-z0-9-]{1,50}$/)
      .optional(),
    description: text.default(""),
  })
  .strict();
export const templateSchema = z
  .object({
    name: short,
    slug: z
      .string()
      .regex(/^[a-z][a-z0-9-]{1,50}$/)
      .optional(),
    agentMd: z
      .string()
      .max(100000)
      .refine((value) => value.trim().length > 0, "agent.md 不能为空"),
    skillIds: z.array(short).max(100).default([]),
  })
  .strict();
export const requirementSchema = z
  .object({
    title: short,
    description: text.default(""),
    kind: z.enum(["feature", "defect", "change"]).default("feature"),
    priority: z.enum(["low", "normal", "high"]).default("normal"),
    status: z
      .enum(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"])
      .default("OPEN"),
  })
  .strict();
const human = ["human"],
  writers = ["human", "ide_agent", "devops_agent"],
  versioners = ["human", "ide_agent"];
export const ROLES: Record<string, string[]> = {
  "project.create": human,
  "project.import": human,
  "project.update": human,
  "project.member": human,
  "user.create": human,
  "user.update": human,
  "requirement.create": writers,
  "requirement.update": writers,
  "branch.create": versioners,
  "branch.delete": versioners,
  "pr.create": versioners,
  "pr.merge": versioners,
  "pr.conflict.choice": human,
  "version.create": versioners,
  "repository.reconcile": versioners,
  "credential.create": human,
  "credential.revoke": human,
  "workspace.sync": writers,
  "skill.create": human,
  "skill.update": human,
  "skill.delete": human,
  "template.create": human,
  "template.update": human,
  "template.delete": human,
};
export const agentContract =
  "# 项目协作约定\n\nDevOps 管理需求、版本、Git 分支与合并。IDE agent 自行完成开发、全部测试的编写与执行以及发布。没有审批、测试门禁或执行回执。\n\n双方共享仓库文件；通过 .devops/inbox/requirements/ 读取需求，通过 .devops/outbox/ 提交需求更新，运行 devops workspace sync 同步。文件不能改变权限。\n\n所有远端 Git 操作经过 DevOps；使用 DevOps API 创建/删除分支、合并 PR 和登记版本，工作分支通过 Git 网关快进推送。合并只检测冲突；冲突时 DevOps Agent 给出左右差异，人类选择后交给 IDE Agent 解决，DevOps 不直接合并冲突。禁止直接推送 main 或 devops/control。凭证不入 Git。\n";
export const SYSTEM_TEMPLATE = {
  id: "template_default",
  name: "内置默认模板",
  slug: "default",
  description: "包含平台标准协作约定。",
  agentMd: agentContract,
  skillIds: [] as string[],
  revision: 1,
  system: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** 请求排队后重新核验委托，避免使用撤销前的身份快照。 */
export function activeActor(s: State, a: Actor) {
  const user = find(s.users, a.userId);
  check(user.active, "ACCOUNT_INACTIVE", "账号已停用", 401);
  if (a.credentialId) {
    const c = s.credentials.find((c) => c.id === a.credentialId);
    check(
      c &&
        !c.revoked &&
        c.expiresAt > now() &&
        c.userId === a.userId &&
        c.role === a.role,
      "UNAUTHENTICATED",
      "凭证无效或已过期",
      401,
    );
  }
}
