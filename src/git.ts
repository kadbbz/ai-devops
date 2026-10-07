import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Snapshot } from "./archive.js";
import { check, Fault, type Entity } from "./model.js";
export const exec = promisify(execFile);
export interface GitService {
  activeUser(id: string, username?: string): Promise<any>;
  createProject(p: Entity, files: Snapshot): Promise<any>;
  finishProject(p: Entity): Promise<void>;
  head(p: Entity, b: string): Promise<string>;
  createBranch(p: Entity, b: string, sha: string): Promise<void>;
  commitFiles(
    p: Entity,
    b: string,
    files: Record<string, string>,
    expected?: string,
  ): Promise<string>;
  archive(p: Entity, files: Record<string, string>): Promise<string>;
  protection(p: Entity, b: string): Promise<boolean>;
  ancestor(p: Entity, a: string, b: string): Promise<boolean>;
  diff(p: Entity, a: string, b: string): Promise<string>;
  createPr(
    p: Entity,
    b: string,
    target: string,
    title: string,
    description?: string,
  ): Promise<any>;
  pr(p: Entity, n: number): Promise<any>;
  merge(p: Entity, pr: any): Promise<string>;
  conflicts(
    p: Entity,
    targetSha: string,
    headSha: string,
  ): Promise<ConflictReport>;
  file(p: Entity, b: string, path: string): Promise<string>;
  branches(p: Entity): Promise<any[]>;
  deleteBranch(p: Entity, name: string): Promise<void>;
  createTag(p: Entity, name: string, sha: string): Promise<void>;
  tags(p: Entity): Promise<any[]>;
}
export interface ConflictPoint {
  id: string;
  path: string;
  kind: "content" | "delete" | "rename" | "binary" | "unknown";
  summary: string;
  base: string | null;
  left: string | null;
  right: string | null;
}
export interface ConflictReport {
  hasConflicts: boolean;
  targetSha: string;
  headSha: string;
  conflicts: ConflictPoint[];
  generatedBy: "devops-agent";
}
export class Gitea implements GitService {
  constructor(
    public base: string,
    public token: string,
    public owner = "devops-service",
  ) {}
  async api(path: string, method = "GET", body?: any) {
    const r = await fetch(this.base + "/api/v1" + path, {
      method,
      headers: {
        Authorization: `token ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    const bodyText = await r.text();
    if (!r.ok) {
      let upstream: any = bodyText;
      try {
        upstream = bodyText.trim() ? JSON.parse(bodyText) : null;
      } catch {}
      throw new Fault(
        r.status === 404 ? "GITEA_NOT_FOUND" : "GITEA_ERROR",
        `Git 服务拒绝操作 (${r.status})`,
        r.status >= 500 ? 503 : 409,
        { status: r.status, upstream },
      );
    }
    return bodyText.trim() ? JSON.parse(bodyText) : null;
  }
  repo(p: Entity) {
    return `/repos/${this.owner}/${p.slug}`;
  }
  async activeUser(id: string, username?: string) {
    const users = await this.list("/admin/users");
    const user = users.find(
      (u: any) => String(u.id) === id && (!username || u.login === username),
    );
    check(
      user && user.active !== false && !user.prohibit_login,
      "ACCOUNT_INACTIVE",
      "账号已停用",
      401,
    );
    return user;
  }
  async list(path: string) {
    const all: any[] = [];
    for (let page = 1; ; page++) {
      const rows = await this.api(
        path + (path.includes("?") ? "&" : "?") + "limit=100&page=" + page,
      );
      all.push(...rows);
      if (rows.length < 100) return all;
    }
  }
  async createProject(p: Entity, files: Snapshot) {
    const repo = await this.api("/user/repos", "POST", {
      name: p.slug,
      private: true,
      auto_init: false,
      default_branch: "main",
    });
    const cwd = await mkdtemp(join(tmpdir(), "devops-initial-"));
    try {
      const run = (args: string[], input?: Buffer) =>
        new Promise<string>((resolve, reject) => {
          const proc = spawn("git", args, {
            cwd,
            env: {
              ...this.env(),
              GIT_AUTHOR_NAME: "DevOps",
              GIT_AUTHOR_EMAIL: "devops@localhost",
              GIT_COMMITTER_NAME: "DevOps",
              GIT_COMMITTER_EMAIL: "devops@localhost",
            },
            timeout: 60000,
          });
          const chunks: Buffer[] = [];
          proc.stdout.on("data", (c) => chunks.push(c));
          proc.stderr.resume();
          proc.on("error", reject);
          proc.on("close", (c) =>
            c === 0
              ? resolve(Buffer.concat(chunks).toString().trim())
              : reject(new Error("初始快照写入失败")),
          );
          proc.stdin.on("error", reject);
          proc.stdin.end(input);
        });
      await run(["init", "--bare", "--initial-branch=main", "."]);
      const index = [];
      for (const [path, file] of Object.entries(files)) {
        const hash = await run(["hash-object", "-w", "--stdin"], file.data);
        index.push(`${file.mode} ${hash}\t${path}\0`);
      }
      await run(
        ["update-index", "-z", "--index-info"],
        Buffer.from(index.join("")),
      );
      const tree = await run(["write-tree"]);
      const commit = await run([
        "commit-tree",
        tree,
        "-m",
        "DevOps：项目初始快照",
      ]);
      await run([
        "push",
        `${this.base}/${this.owner}/${p.slug}.git`,
        `${commit}:refs/heads/main`,
      ]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
    await this.finishProject(p);
    return repo;
  }
  async finishProject(p: Entity) {
    // Gitea 首次推送的仓库索引异步更新，等待可读后再建控制分支。
    let main: string | undefined;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const repository = await this.api(this.repo(p));
        if (!repository.empty) main = await this.head(p, "main");
        if (main) break;
      } catch (e) {
        if (
          !(e instanceof Fault) ||
          !["GITEA_ERROR", "GITEA_NOT_FOUND"].includes(e.code)
        )
          throw e;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    check(
      main,
      "INITIALIZATION_PENDING",
      "初始提交尚未可读，请稍后核对仓库",
      503,
    );
    const branches = await this.branches(p);
    if (!branches.some((b) => b.name === "devops/control"))
      await this.createBranch(p, "devops/control", main);
    const rules = await this.api(this.repo(p) + "/branch_protections");
    if (!rules.some((r: any) => r.branch_name === "main"))
      await this.api(this.repo(p) + "/branch_protections", "POST", {
        branch_name: "main",
        enable_push: false,
        enable_force_push: false,
        enable_status_check: false,
        required_approvals: 0,
        block_on_rejected_reviews: false,
        // 合并阶段只检查实际冲突，不把主线是否最新作为额外门禁。
        block_on_outdated_branch: false,
      });
    else
      await this.api(
        this.repo(p) + "/branch_protections/main",
        "PATCH",
        { block_on_outdated_branch: false },
      );
    if (!rules.some((r: any) => r.branch_name === "devops/control"))
      await this.api(this.repo(p) + "/branch_protections", "POST", {
        branch_name: "devops/control",
        enable_push: true,
        enable_push_whitelist: true,
        push_whitelist_usernames: [this.owner],
        enable_force_push: false,
      });
    check(
      await this.protection(p, "main"),
      "PROTECTION_MISSING",
      "主线保护未就绪",
      503,
    );
  }
  async head(p: Entity, b: string) {
    return (await this.api(this.repo(p) + "/branches/" + encodeURIComponent(b)))
      .commit.id;
  }
  async createBranch(p: Entity, b: string, sha: string) {
    await this.api(this.repo(p) + "/branches", "POST", {
      new_branch_name: b,
      old_ref_name: sha,
    });
  }
  async file(p: Entity, b: string, path: string) {
    const item = await this.api(
      this.repo(p) +
        "/contents/" +
        path.split("/").map(encodeURIComponent).join("/") +
        "?ref=" +
        encodeURIComponent(b),
    );
    return Buffer.from(item.content, "base64").toString("utf8");
  }
  async commitFiles(
    p: Entity,
    b: string,
    files: Record<string, string>,
    expected?: string,
  ) {
    check(
      !expected || (await this.head(p, b)) === expected,
      "HEAD_MOVED",
      "提交已变化，请重新读取",
    );
    const changes = [];
    for (const [path, content] of Object.entries(files)) {
      let old: any;
      try {
        old = await this.api(
          this.repo(p) + "/contents/" + path + "?ref=" + encodeURIComponent(b),
        );
      } catch (e) {
        if (!(e instanceof Fault) || e.code !== "GITEA_NOT_FOUND") throw e;
      }
      changes.push({
        path,
        operation: old ? "update" : "create",
        sha: old?.sha,
        content: Buffer.from(content).toString("base64"),
      });
    }
    const result = await this.api(this.repo(p) + "/contents", "POST", {
      branch: b,
      message: "DevOps：同步需求与版本记录",
      files: changes,
    });
    return result.commit.sha;
  }
  async archive(p: Entity, files: Record<string, string>) {
    return this.commitFiles(
      p,
      "devops/control",
      files,
      await this.head(p, "devops/control"),
    );
  }
  async protection(p: Entity, b: string) {
    const rules = await this.api(this.repo(p) + "/branch_protections");
    const rule = rules.find((r: any) => r.branch_name === b);
    if (b === "main" && rule?.block_on_outdated_branch)
      await this.api(
        this.repo(p) + "/branch_protections/main",
        "PATCH",
        { block_on_outdated_branch: false },
      );
    return rules.some(
      (r: any) => r.branch_name === b && !r.enable_push && !r.enable_force_push,
    );
  }
  async withRepo<T>(p: Entity, fn: (cwd: string) => Promise<T>) {
    const dir = await mkdtemp(join(tmpdir(), "devops-git-"));
    try {
      await exec(
        "git",
        [
          "-c",
          "core.hooksPath=/dev/null",
          "clone",
          "--bare",
          "--",
          `${this.base}/${this.owner}/${p.slug}.git`,
          dir,
        ],
        { env: this.env(), timeout: 30000, maxBuffer: 1024 * 1024 },
      );
      return await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  env() {
    return {
      PATH: process.env.PATH,
      HOME: tmpdir(),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "3",
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0:
        "Authorization: Basic " +
        Buffer.from(`${this.owner}:${this.token}`).toString("base64"),
      GIT_CONFIG_KEY_1: "core.hooksPath",
      GIT_CONFIG_VALUE_1: "/dev/null",
      GIT_CONFIG_KEY_2: "protocol.file.allow",
      GIT_CONFIG_VALUE_2: "never",
    };
  }
  async ancestor(p: Entity, a: string, b: string) {
    return this.withRepo(p, async (cwd) => {
      try {
        await exec("git", ["merge-base", "--is-ancestor", a, b], {
          cwd,
          env: this.env(),
          timeout: 10000,
        });
        return true;
      } catch {
        return false;
      }
    });
  }
  async diff(p: Entity, a: string, b: string) {
    return this.withRepo(
      p,
      async (cwd) =>
        (
          await exec(
            "git",
            ["diff", "--no-ext-diff", "--no-textconv", a, b, "--"],
            {
              cwd,
              env: this.env(),
              timeout: 10000,
              maxBuffer: 2 * 1024 * 1024,
            },
          )
        ).stdout,
    );
  }
  async createPr(
    p: Entity,
    b: string,
    target: string,
    title: string,
    description = "",
  ) {
    return this.api(this.repo(p) + "/pulls", "POST", {
      head: b,
      base: target,
      title,
      body: description,
    });
  }
  async pr(p: Entity, n: number) {
    return this.api(this.repo(p) + "/pulls/" + n);
  }
  async merge(p: Entity, pr: any) {
    const path = this.repo(p) + "/pulls/" + pr.number + "/merge",
      payload = {
        Do: "merge",
        head_commit_id: pr.head.sha,
        delete_branch_after_merge: false,
      };
    // Gitea 在创建或更新 PR 后会异步计算 mergeable，短时间内可能返回 405。
    // 本地冲突检查已经完成，因此这里只对这个瞬态响应做有限重试。
    let last: unknown;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        await this.api(path, "POST", payload);
        last = undefined;
        break;
      } catch (error) {
        last = error;
        if (
          !(error instanceof Fault) ||
          error.code !== "GITEA_ERROR" ||
          error.details?.status !== 405 ||
          attempt === 7
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    if (last) throw last;
    const actual = await this.pr(p, pr.number);
    check(
      actual.merged && actual.merge_commit_sha,
      "MERGE_UNKNOWN",
      "Git 合并结果未知",
      503,
    );
    return actual.merge_commit_sha;
  }
  async conflicts(
    p: Entity,
    targetSha: string,
    headSha: string,
  ): Promise<ConflictReport> {
    return this.withRepo(p, async (cwd) => {
      let output = "";
      let conflicted = false;
      try {
        const result = await exec(
          "git",
          ["merge-tree", "--write-tree", targetSha, headSha],
          { cwd, env: this.env(), timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
        );
        output = result.stdout;
      } catch (error: any) {
        output = String(error?.stdout || "") + String(error?.stderr || "");
        conflicted = error?.code === 1;
      }
      const stages = new Map<string, Map<number, string>>();
      for (const line of output.split("\n")) {
        const match = line.match(/^\d{6} ([a-f0-9]{40}) ([123])\t(.+)$/);
        if (!match) continue;
        const [, oid, stage, path] = match;
        if (!stages.has(path)) stages.set(path, new Map());
        stages.get(path)!.set(Number(stage), oid);
      }
      const messages = output
        .split("\n")
        .filter((line) => line.startsWith("CONFLICT "));
      const paths = new Set<string>([
        ...stages.keys(),
        ...messages
          .map((line) => line.match(/ in (.+)$/)?.[1])
          .filter((path): path is string => Boolean(path)),
      ]);
      const readBlob = async (oid?: string) => {
        if (!oid) return null;
        try {
          const result: any = await exec("git", ["cat-file", "-p", oid], {
            cwd,
            env: this.env(),
            timeout: 10000,
            maxBuffer: 256 * 1024,
          });
          const value = Buffer.from(result.stdout);
          if (value.includes(0)) return "[二进制文件，无法以内联文本展示]";
          return value.toString("utf8").slice(0, 64 * 1024);
        } catch {
          return null;
        }
      };
      const conflicts: ConflictPoint[] = [];
      for (const path of paths) {
        const stage = stages.get(path) || new Map<number, string>();
        const message = messages.find((line) => line.endsWith(` in ${path}`));
        const kind: ConflictPoint["kind"] = message?.includes("delete")
          ? "delete"
          : message?.includes("rename")
            ? "rename"
            : "content";
        conflicts.push({
          id: `${targetSha.slice(0, 12)}:${headSha.slice(0, 12)}:${path}`,
          path,
          kind,
          summary:
            message?.replace(/^CONFLICT .*?:\s*/, "") ||
            "同一路径在目标分支和工作分支中存在不可自动合并的修改",
          base: await readBlob(stage.get(1)),
          left: await readBlob(stage.get(2)),
          right: await readBlob(stage.get(3)),
        });
      }
      return {
        hasConflicts: conflicted || conflicts.length > 0,
        targetSha,
        headSha,
        conflicts,
        generatedBy: "devops-agent",
      };
    });
  }
  async deleteBranch(p: Entity, name: string) {
    await this.api(
      this.repo(p) + "/branches/" + encodeURIComponent(name),
      "DELETE",
    );
  }
  async createTag(p: Entity, name: string, sha: string) {
    await this.api(this.repo(p) + "/tags", "POST", {
      tag_name: name,
      target: sha,
    });
  }
  async tags(p: Entity) {
    return (await this.list(this.repo(p) + "/tags")).map((t: any) => ({
      name: t.name,
      sha: t.commit.sha,
    }));
  }
  async branches(p: Entity) {
    return (await this.list(this.repo(p) + "/branches")).map((b: any) => ({
      name: b.name,
      sha: b.commit.id,
    }));
  }
}
