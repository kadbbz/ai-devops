import { z } from "zod";
import { createHash, createHmac, randomUUID } from "node:crypto";

export class Fault extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
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
export const digest = (v: any) =>
  "sha256:" + createHash("sha256").update(canonical(v)).digest("hex");
export const tokenHash = (v: string) =>
  createHash("sha256").update(v).digest("hex");
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
export const TABLES = [
  "users",
  "projects",
  "intents",
  "snapshots",
  "approvals",
  "evidence",
  "deliveries",
  "operations",
  "sync_tasks",
  "credentials",
  "sessions",
  "requests",
] as const;
export type State = Record<(typeof TABLES)[number], Entity[]>;
export const emptyState = (): State =>
  Object.fromEntries(TABLES.map((k) => [k, []])) as unknown as State;
export function find(list: Entity[], key: string): Entity {
  const item = list.find((i) => i.id === key);
  check(item, "NOT_FOUND", "对象不存在", 404);
  return item;
}
export const text = z.string().trim().min(1).max(20000),
  short = z.string().trim().min(1).max(200);
export const sha = z.string().regex(/^[a-f0-9]{40}$/),
  hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const list = z.array(text).min(1).max(100);
export const branch = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,100}$/)
  .refine((v) => !v.includes("//") && !v.startsWith("devops/"));
export const planSchema = z
  .object({
    point: z
      .object({
        goal: text,
        scope: list,
        nonGoals: list,
        risks: list,
        owner: short,
        references: z
          .array(
            z
              .object({
                source: text,
                scope: text,
                content: text,
                adoption: z.enum(["proposed", "accepted", "rejected"]),
              })
              .strict(),
          )
          .max(100),
      })
      .strict(),
    application: z
      .object({
        changes: z
          .array(
            z
              .object({
                object: text,
                operation: z.enum([
                  "read",
                  "write",
                  "update",
                  "delete",
                  "migrate",
                  "configure",
                  "permission",
                ]),
                scope: text,
              })
              .strict(),
          )
          .min(1),
        preconditions: list,
        invariants: list,
        acceptance: list,
        documentation: list,
        apiCases: list,
        e2eCases: list,
        permissions: list,
        idempotency: text,
        transaction: text,
        rollback: text,
        migration: text,
        idePaths: z
          .array(
            z
              .string()
              .regex(
                /^(?!\/)(?!.*\.\.)(?!agent\.md)(?!tasks\/)(?!\.devops\/)[a-zA-Z0-9_./-]+$/,
              ),
          )
          .min(1),
      })
      .strict(),
    context: z
      .object({
        dataClass: z.enum(["public", "internal", "restricted"]),
        forbidden: list,
        entries: z.array(z.object({ path: short, digest: hash }).strict()),
        hotfixRefs: z.array(short),
      })
      .strict(),
  })
  .strict();
export const materialSchema = z
  .object({
    manual: text,
    changelog: text,
    apiContract: text,
    apiCases: list,
    e2eCases: list,
    dataPreparation: text,
    dataCleanup: text,
    dataDigest: hash,
    deviations: text,
  })
  .strict();
export const buildSchema = z
  .object({
    sourceSha: sha,
    dependencyHash: hash,
    configVersion: short,
    policyVersion: short,
    toolVersion: short,
    environment: short,
    artifactDigest: hash,
    sbomDigest: hash,
    provenanceDigest: hash,
    operationId: short,
    command: short,
    log: text,
    checks: z
      .object({
        unit: z.boolean(),
        component: z.boolean(),
        security: z.boolean(),
      })
      .strict(),
  })
  .strict();
export const systemSchema = z
  .object({
    sourceSha: sha,
    artifactDigest: hash,
    configVersion: short,
    environment: short,
    applications: z.array(short).min(1),
    sequence: list,
    migrations: list,
    healthChecks: list,
    rollback: text,
    scope: list,
  })
  .strict();
export const projectSchema = z
  .object({
    name: short,
    slug: z.string().regex(/^[a-z][a-z0-9-]{1,50}$/),
    configVersion: short,
    policyVersion: short,
    toolVersion: short,
    runnerId: short,
    apiCommand: short,
    e2eCommand: short,
    environment: short,
    testEnvironment: short,
  })
  .strict()
  .refine(
    (p) => p.environment !== p.testEnvironment,
    "验收环境必须与发布环境隔离",
  );
export const human = ["human"],
  docs = ["human", "devops_agent"];
export const ROLES: Record<string, string[]> = {
  "project.create": human,
  "project.import": human,
  "project.update": human,
  "project.member": human,
  "user.create": human,
  "user.update": human,
  "intent.create": human,
  "plan.save": docs,
  "materials.save": docs,
  "gate.a": human,
  "gate.b": human,
  "gate.c": human,
  "gate.c.review": human,
  "risk.register": ["ide_control"],
  merge: human,
  "build.request": ["ide_agent"],
  "build.register": ["ide_control"],
  "tests.request": docs,
  "operation.claim": ["runner", "ide_control"],
  "tests.complete": ["runner"],
  "system.save": docs,
  "release.request": ["ide_agent"],
  "release.complete": ["ide_control"],
  "production.attest": ["ide_control"],
  "production.confirm": human,
  recovery: human,
  "operation.reconcile": human,
  "sync.waive": human,
  "workspace.sync": [
    "human",
    "devops_agent",
    "ide_agent",
    "ide_control",
    "runner",
  ],
  "agent.draft": docs,
  "credential.create": human,
  "credential.revoke": human,
};
export function invalidate(s: State, subject: Entity, all = false) {
  for (const a of s.approvals)
    if (a.subjectId === subject.id && (all || a.gate !== "A"))
      a.status = "STALE";
  for (const e of s.evidence)
    if (e.subjectId === subject.id) e.status = "STALE";
  if (subject.pr) subject.pr.status = "REVERIFY_REQUIRED";
  subject.build = undefined;
  subject.updatedAt = now();
}
export function access(a: Actor, p: Entity, write = false) {
  check(
    a.projectId === "*" || !a.projectId || a.projectId === p.id,
    "PROJECT_DENIED",
    "没有该项目权限",
    403,
  );
  check(
    p.members[a.userId] && (!write || p.members[a.userId] !== "observer"),
    "PROJECT_DENIED",
    "没有该项目权限",
    403,
  );
}
export function gateRole(a: Actor, p: Entity, gate: string) {
  access(a, p, true);
  check(
    a.role === "human" &&
      (gate === "B" ? ["owner", "reviewer"] : ["owner"]).includes(
        p.members[a.userId],
      ),
    "FORBIDDEN",
    "权限不足：需要人类签发角色",
    403,
  );
}
export function controls(p: Entity) {
  return Object.fromEntries(
    [
      "configVersion",
      "policyVersion",
      "toolVersion",
      "runnerId",
      "apiCommand",
      "e2eCommand",
      "environment",
      "testEnvironment",
    ].map((k) => [k, p[k]]),
  );
}
export function inputFingerprint(s: State, subject: Entity, p: Entity) {
  return digest({
    subjectId: subject.id,
    plan: subject.plan,
    planVersion: subject.planVersion,
    snapshot: subject.snapshotId,
    materials: subject.materials,
    sourceSha: subject.sourceSha,
    targetSha: subject.targetSha,
    branch: subject.branch,
    build: subject.build,
    buildActor: subject.buildActor,
    riskEvidence: subject.riskEvidence,
    controls: controls(p),
    intentIds: subject.intentIds,
    production: subject.intentIds ? p.production : undefined,
  });
}

export const highRisk = (sub: Entity) =>
  sub.risk === "high" ||
  ["hotfix", "migration", "config", "security"].includes(sub.kind) ||
  sub.plan?.application.changes.some((c: any) =>
    ["migrate", "permission", "configure", "delete"].includes(c.operation),
  );
