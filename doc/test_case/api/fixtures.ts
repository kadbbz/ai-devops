import {
  randomBytes,
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { emptyState, canonical } from "../../../src/model.js";
export const machineKeys = generateKeyPairSync("ed25519");
export const publicKey = machineKeys.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
export function receiptHeaders(action: string, body: any, key: string) {
  return {
    "x-receipt-signature": sign(
      null,
      Buffer.from(canonical({ action, body, key })),
      machineKeys.privateKey,
    ).toString("base64"),
  };
}
export const digest = "sha256:" + "a".repeat(64);
export const plan = () => ({
  point: {
    goal: "避免重复工单",
    scope: ["工单创建接口"],
    nonGoals: ["不改查询"],
    risks: ["并发写入"],
    owner: "业务负责人",
    references: [],
  },
  application: {
    changes: [
      { object: "tickets", operation: "write", scope: "同一请求一次写入" },
    ],
    preconditions: ["账号已登录"],
    invariants: ["幂等键唯一"],
    acceptance: ["重复请求返回同一结果"],
    documentation: ["说明书"],
    apiCases: ["重复提交"],
    e2eCases: ["双击创建"],
    permissions: ["create-ticket"],
    idempotency: "request-id",
    transaction: "单事务",
    rollback: "恢复上一制品",
    migration: "无",
    idePaths: [
      "src/",
      "tests/unit/",
      "tests/component/",
      "package.json",
      "package-lock.json",
    ],
  },
  context: {
    dataClass: "internal",
    forbidden: ["不得直接发布"],
    entries: [],
    hotfixRefs: [],
  },
});
export const materials = () => ({
  manual: "用户提交一次工单",
  changelog: "修复重复写入",
  apiContract: "POST /tickets 接受幂等键",
  apiCases: ["重复提交"],
  e2eCases: ["双击提交"],
  dataPreparation: "创建隔离用户",
  dataCleanup: "删除隔离用户",
  dataDigest: digest,
  deviations: "无偏离",
});
export const build = (sourceSha: string) => ({
  sourceSha,
  dependencyHash: digest,
  configVersion: "1",
  policyVersion: "1",
  toolVersion: "node22",
  environment: "acceptance",
  artifactDigest: digest,
  sbomDigest: digest,
  provenanceDigest: digest,
  operationId: crypto.randomUUID(),
  command: "build",
  log: "固定环境构建与单元组件安全检查通过",
  checks: { unit: true, component: true, security: true },
});
export function seed() {
  const state = emptyState();
  for (const who of ["owner", "reviewer", "viewer"])
    state.users.push({
      id: who,
      giteaId: who,
      username: who,
      admin: who === "owner",
      active: true,
    });
  for (const [name, role] of Object.entries({
    owner: "human",
    reviewer: "human",
    viewer: "human",
    devops: "devops_agent",
    ide: "ide_agent",
    control: "ide_control",
    runner: "runner",
  }))
    state.credentials.push({
      id: name,
      hash: createHash("sha256").update(name).digest("hex"),
      userId: role === "human" ? name : "owner",
      role,
      publicKey,
      name: name === "runner" ? "acceptance" : name,
      projectId: "*",
      expiresAt: "2099-01-01T00:00:00Z",
    });
  return state;
}
export class FakeGitea {
  branchesCreated = 0;
  refs = new Map<string, string>();
  prs = new Map<number, any>();
  sha() {
    return randomBytes(20).toString("hex");
  }
  key(p: any, b: string) {
    return `${p.id}/${b}`;
  }
  async createProject(p: any) {
    this.refs.set(this.key(p, "main"), this.sha());
    this.refs.set(
      this.key(p, "production"),
      this.refs.get(this.key(p, "main"))!,
    );
    return { id: 1, owner: "service", name: p.slug };
  }
  async activeUser(id: string, username?: string) {
    return { id, login: id, active: true, is_admin: id === "owner" };
  }
  async head(p: any, b: string) {
    const value = this.refs.get(this.key(p, b));
    if (!value) throw new Error("branch missing");
    return value;
  }
  async createBranch(p: any, b: string, sha: string) {
    this.branchesCreated++;
    this.refs.set(this.key(p, b), sha);
  }
  async commitFiles(p: any, b: string, files: any, expected?: string) {
    const sha = this.sha();
    this.refs.set(this.key(p, b), sha);
    return sha;
  }
  async archive(p: any, files: any) {
    return this.sha();
  }
  async protection(p: any, b: string) {
    return true;
  }
  async ancestor(p: any, a: string, b: string) {
    return true;
  }
  async diff(p: any, a: string, b: string) {
    return "diff --git a/src/tickets.ts b/src/tickets.ts\n+idempotentWrite()";
  }
  async createPr(p: any, b: string, t: string, title: string) {
    const number = this.prs.size + 1;
    const pr = {
      number,
      head: { sha: await this.head(p, b), ref: b },
      base: { ref: t },
      state: "open",
      mergeable: true,
    };
    this.prs.set(number, pr);
    return pr;
  }
  async pr(p: any, id: number) {
    return this.prs.get(id);
  }
  async merge(p: any, pr: any) {
    const sha = this.sha();
    this.refs.set(this.key(p, pr.base.ref), sha);
    pr.merged = true;
    pr.merge_commit_sha = sha;
    return sha;
  }
  async file(p: any, b: string, path: string) {
    return "# agent.md";
  }
  async recordProduction(p: any, branch: string, sha: string) {
    this.refs.set(this.key(p, "production"), sha);
  }
  async branches(p: any) {
    return [...this.refs]
      .filter(([k]) => k.startsWith(p.id + "/"))
      .map(([k, sha]) => ({ name: k.slice(p.id.length + 1), sha }));
  }
}
