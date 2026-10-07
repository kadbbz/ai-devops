import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, Fault, type Entity } from "./model.js";
export const exec = promisify(execFile);
export interface GitService {
  activeUser(id: string, username?: string): Promise<any>;
  createProject(p: Entity): Promise<any>;
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
  createPr(p: Entity, b: string, target: string, title: string): Promise<any>;
  pr(p: Entity, n: number): Promise<any>;
  merge(p: Entity, pr: any): Promise<string>;
  file(p: Entity, b: string, path: string): Promise<string>;
  branches(p: Entity): Promise<any[]>;
  recordProduction(p: Entity, branch: string, sha: string): Promise<void>;
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
    if (!r.ok)
      throw new Fault(
        r.status === 404 ? "GITEA_NOT_FOUND" : "GITEA_ERROR",
        `Git 服务拒绝操作 (${r.status})`,
        r.status >= 500 ? 503 : 409,
      );
    const bodyText = await r.text();
    return bodyText.trim() ? JSON.parse(bodyText) : null;
  }
  repo(p: Entity) {
    return `/repos/${this.owner}/${p.slug}`;
  }
  async activeUser(id: string, username?: string) {
    // 服务令牌只负责 DevOps 的内部操作，不具备站点管理员权限；按用户名读取用户状态即可完成登录前校验。
    const user = username
      ? await this.api("/users/" + encodeURIComponent(username))
      : null;
    check(
      user && String(user.id) === id && !user.prohibit_login,
      "ACCOUNT_INACTIVE",
      "账号已停用",
      401,
    );
    return user;
  }
  async createProject(p: Entity) {
    const repo = await this.api("/user/repos", "POST", {
      name: p.slug,
      private: true,
      auto_init: true,
      default_branch: "main",
      readme: "Default",
    });
    await this.createBranch(p, "production", await this.head(p, "main"));
    await this.createBranch(p, "devops/control", await this.head(p, "main"));
    for (const branch of ["main", "production"])
      await this.api(this.repo(p) + "/branch_protections", "POST", {
        branch_name: branch,
        enable_push: false,
        enable_force_push: false,
        enable_status_check: false,
        required_approvals: 0,
        block_on_rejected_reviews: true,
        block_on_outdated_branch: true,
      });
    await this.api(this.repo(p) + "/branch_protections", "POST", {
      branch_name: "devops/control",
      enable_push: true,
      enable_push_whitelist: true,
      push_whitelist_usernames: [this.owner],
      enable_force_push: false,
    });
    return repo;
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
      message: "DevOps：登记方案与交接材料",
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
  async createPr(p: Entity, b: string, target: string, title: string) {
    return this.api(this.repo(p) + "/pulls", "POST", {
      head: b,
      base: target,
      title,
      body: "由 DevOps Gate B 签发创建；合并必须在 DevOps 中操作。",
    });
  }
  async pr(p: Entity, n: number) {
    return this.api(this.repo(p) + "/pulls/" + n);
  }
  async merge(p: Entity, pr: any) {
    await this.api(this.repo(p) + "/pulls/" + pr.number + "/merge", "POST", {
      Do: "merge",
      head_commit_id: pr.head.sha,
      delete_branch_after_merge: false,
    });
    const actual = await this.pr(p, pr.number);
    check(
      actual.merged && actual.merge_commit_sha,
      "MERGE_UNKNOWN",
      "Git 合并结果未知",
      503,
    );
    return actual.merge_commit_sha;
  }
  async recordProduction(p: Entity, branch: string, sha: string) {
    if ((await this.head(p, "production")) === sha) return;
    check(
      (await this.head(p, branch)) === sha,
      "PRODUCTION_REF_MOVED",
      "来源在发布后变化，需人工对账",
    );
    check(
      await this.ancestor(p, await this.head(p, "production"), sha),
      "PRODUCTION_LINEAGE",
      "生产引用只能前移到已核验提交",
    );
    await this.api(this.repo(p), "PATCH", {
      allow_fast_forward_only_merge: true,
    });
    const pr = await this.createPr(
      p,
      branch,
      "production",
      "记录已签发且实际核验的生产版本",
    );
    for (let attempt = 0; attempt < 20; attempt++) {
      const state = await this.pr(p, pr.number);
      if (state.mergeable) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await this.api(this.repo(p) + "/pulls/" + pr.number + "/merge", "POST", {
      Do: "fast-forward-only",
      head_commit_id: sha,
      delete_branch_after_merge: false,
    });
    check(
      (await this.head(p, "production")) === sha,
      "PRODUCTION_RECORD_UNKNOWN",
      "生产引用记录结果未知",
    );
  }
  async branches(p: Entity) {
    return (await this.api(this.repo(p) + "/branches?limit=100")).map(
      (b: any) => ({ name: b.name, sha: b.commit.id }),
    );
  }
}
