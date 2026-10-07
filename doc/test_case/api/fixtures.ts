import { randomBytes, createHash } from "node:crypto";
import { emptyState, Fault } from "../../../src/model.js";
import type { Snapshot } from "../../../src/archive.js";
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
  }))
    state.credentials.push({
      id: name,
      hash: createHash("sha256").update(name).digest("hex"),
      userId: role === "human" ? name : "owner",
      role,
      name: name === "runner" ? "acceptance" : name,
      projectId: "*",
      expiresAt: "2099-01-01T00:00:00Z",
    });
  return state;
}
export class FakeGitea {
  branchesCreated = 0;
  mergeCalls = 0;
  conflictReport: any = {
    hasConflicts: false,
    targetSha: "",
    headSha: "",
    conflicts: [],
  };
  refs = new Map<string, string>();
  prs = new Map<number, any>();
  sha() {
    return randomBytes(20).toString("hex");
  }
  key(p: any, b: string) {
    return `${p.id}/${b}`;
  }
  projectsCreated = 0;
  initialFiles: Snapshot = {};
  tagRefs = new Map<string, string>();
  async createProject(p: any, files: Snapshot) {
    this.projectsCreated++;
    this.initialFiles = files;
    this.refs.set(this.key(p, "main"), this.sha());
    this.refs.set(this.key(p, "devops/control"), this.sha());
    return { id: this.projectsCreated };
  }
  async finishProject(p: any) {}
  async deleteBranch(p: any, name: string) {
    this.refs.delete(this.key(p, name));
  }
  async createTag(p: any, name: string, sha: string) {
    this.tagRefs.set(this.key(p, name), sha);
  }
  async tags(p: any) {
    return [...this.tagRefs]
      .filter(([k]) => k.startsWith(p.id + "/"))
      .map(([k, sha]) => ({ name: k.slice(p.id.length + 1), sha }));
  }
  async activeUser(id: string, username?: string) {
    return { id, login: id, active: true, is_admin: id === "owner" };
  }
  async head(p: any, b: string) {
    const value = this.refs.get(this.key(p, b));
    if (!value) throw new Fault("GITEA_NOT_FOUND", "branch missing");
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
    this.mergeCalls++;
    const sha = this.sha();
    this.refs.set(this.key(p, pr.base.ref), sha);
    pr.merged = true;
    pr.merge_commit_sha = sha;
    return sha;
  }
  async file(p: any, b: string, path: string) {
    return "# agent.md";
  }
  async branches(p: any) {
    return [...this.refs]
      .filter(([k]) => k.startsWith(p.id + "/"))
      .map(([k, sha]) => ({ name: k.slice(p.id.length + 1), sha }));
  }
  async conflicts(p: any, targetSha: string, headSha: string) {
    return {
      ...this.conflictReport,
      targetSha,
      headSha,
    };
  }
}
