import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Store } from "./store.js";
import { Gitea, type GitService } from "./git.js";
import { readArchive, type Snapshot } from "./archive.js";
import {
  activeActor,
  canonical,
  type Actor,
  type Entity,
  type State,
  TABLES,
  ROLES,
  Fault,
  check,
  id,
  now,
  digest,
  tokenHash,
  find,
  access,
  projectSchema,
  requirementSchema,
  skillSchema,
  templateSchema,
  refName,
  text,
  short,
  sha,
  SYSTEM_TEMPLATE,
} from "./model.js";

const slugify = (value: string, prefix: string) => {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return slug.length >= 2 ? slug : `${prefix}-${randomBytes(5).toString("hex")}`;
};
const encodeFiles = (files: Snapshot) =>
  Object.fromEntries(
    Object.entries(files).map(([path, file]) => [
      path,
      { data: file.data.toString("base64"), mode: file.mode },
    ]),
  );
const decodeFiles = (files: Record<string, any>): Snapshot =>
  Object.fromEntries(
    Object.entries(files || {}).map(([path, file]) => [
      path,
      { data: Buffer.from(file.data, "base64"), mode: file.mode },
    ]),
  ) as Snapshot;
const defaultTemplate = SYSTEM_TEMPLATE;
async function readSkillArchive(encoded: string) {
  try {
    return await readArchive(encoded, "SKILL.md");
  } catch (error) {
    if (error instanceof Fault)
      throw new Fault("SKILL_INVALID", error.message, error.status, error.details);
    throw error;
  }
}
export class Control {
  private baselines = new WeakMap<State, State>();
  async read() {
    const s = await this.store.read();
    this.baselines.set(s, structuredClone(s));
    return s;
  }
  private tail: Promise<any> = Promise.resolve();
  constructor(
    public store: Store,
    public git: GitService,
  ) {}
  private template(s: State, templateId?: string): any {
    if (!templateId || templateId === defaultTemplate.id) return defaultTemplate;
    return find(s.templates, templateId);
  }
  private templateFiles(s: State, templateId?: string): Snapshot {
    const template = this.template(s, templateId),
      skills: Entity[] = template.skillIds.map((skillId: string) =>
        find(s.skills, skillId),
      ),
      files: Snapshot = {
        "agent.md": { data: Buffer.from(template.agentMd), mode: "100644" },
        "skill/manifest.json": {
          data: Buffer.from(
            JSON.stringify(
              {
                template: {
                  id: template.id,
                  name: template.name,
                  slug: template.slug,
                },
                skills: skills.map(({ id, name, slug, description }) => ({
                  id,
                  name,
                  slug,
                  description,
                })),
              },
              null,
              2,
            ) + "\n",
          ),
          mode: "100644",
        },
      };
    for (const skill of skills)
      for (const [path, file] of Object.entries(decodeFiles(skill.files)))
        files[`skill/${skill.slug}/${path}`] = file;
    return files;
  }
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => {});
    return next;
  }
  async save(s: State, actor: Actor, action: string, details: any = {}) {
    await this.store.change(
      actor.id,
      action,
      (current) => {
        const baseline = this.baselines.get(s);
        check(baseline, "STATE_BASELINE", "缺少事务基线", 500);
        for (const t of TABLES) {
          for (const row of s[t]) {
            const before = baseline[t].find((x) => x.id === row.id);
            if (canonical(before) === canonical(row)) continue;
            const actual = current[t].find((x) => x.id === row.id);
            check(
              canonical(actual) === canonical(before) ||
                canonical(actual) === canonical(row),
              "CONCURRENT_CHANGE",
              "对象已被其他请求修改，请重新读取",
            );
            current[t] = current[t].filter((x) => x.id !== row.id);
            current[t].push(structuredClone(row));
          }
          for (const row of baseline[t])
            if (!s[t].some((x) => x.id === row.id))
              current[t] = current[t].filter((x) => x.id !== row.id);
        }
      },
      {
        ...details,
        userId: actor.userId,
        role: actor.role,
        credentialId: actor.credentialId,
      },
    );
    this.baselines.set(s, structuredClone(s));
  }
  async run(a: Actor, action: string, b: any, key: string): Promise<any> {
    check(ROLES[action], "ACTION_NOT_FOUND", "该功能不存在", 404);
    check(
      ROLES[action].includes(a.role),
      "FORBIDDEN",
      "该身份不能执行此操作",
      403,
    );
    check(
      typeof key === "string" && key.length >= 8 && key.length <= 200,
      "IDEMPOTENCY_REQUIRED",
      "需要有效的幂等键",
      400,
    );
    return this.exclusive(async () => {
      const s = await this.read(),
        requestId = tokenHash(a.id + ":" + key),
        fingerprint = digest({ action, body: b });
      activeActor(s, a);
      const prior = s.requests.find((r) => r.id === requestId);
      if (prior) {
        check(
          prior.fingerprint === fingerprint,
          "IDEMPOTENCY_CONFLICT",
          "同一幂等键不能用于不同请求",
        );
        if (prior.projectId) access(a, find(s.projects, prior.projectId), true);
        check(
          prior.status === "SUCCEEDED",
          "REQUEST_UNRESOLVED",
          prior.status === "FAILED"
            ? "该请求已失败，请使用新请求重试"
            : "操作结果未确定，请先核对仓库",
        );
        return prior.result;
      }
      let p: Entity | undefined,
        result: any,
        external = false,
        journaled = false;
      const request: Entity = {
        id: requestId,
        action,
        fingerprint,
        actor: a.id,
        userId: a.userId,
        status: "RUNNING",
        createdAt: now(),
      };
      const project = (projectId: string) => {
        const found = find(s.projects, short.parse(projectId));
        access(a, found, true);
        p = found;
        if (action !== "repository.reconcile")
          check(
            found.status === "ACTIVE" &&
              !s.requests.some(
                (r) => r.projectId === p!.id && r.status === "UNKNOWN",
              ),
            "REPOSITORY_UNKNOWN",
            "仓库有未决操作，请先核对仓库",
          );
        return found;
      };
      const owner = () =>
        check(
          p!.members[a.userId] === "owner" && a.role === "human",
          "FORBIDDEN",
          "仅项目负责人可管理成员",
          403,
        );
      const begin = async (recovery: any) => {
        request.projectId = p?.id;
        request.recovery = recovery;
        if (!journaled) {
          s.requests.push(request);
          journaled = true;
        }
        await this.save(s, a, action + ".started", {
          projectId: p?.id,
          requestId,
          archiveName: b.archiveName,
          archiveDigest: request.archiveDigest,
          fileCount: request.fileCount,
        });
        external = true;
      };
      const requirement = (action: string, input: any) => {
        if (action === "requirement.create") {
          const v = requirementSchema.extend({ projectId: short }).parse(input);
          project(v.projectId);
          const row = {
            ...v,
            id: id("req"),
            revision: 1,
            createdAt: now(),
            updatedAt: now(),
          };
          s.requirements.push(row);
          return row;
        }
        const v = requirementSchema
          .extend({ id: short, revision: z.number().int().positive() })
          .parse(input);
        const row = find(s.requirements, v.id);
        project(row.projectId);
        check(
          row.revision === v.revision,
          "REVISION_CONFLICT",
          "需求已被修改，请刷新后重试",
        );
        Object.assign(row, v, { revision: row.revision + 1, updatedAt: now() });
        return row;
      };
      try {
        switch (action) {
          case "skill.create": {
            check(a.admin, "FORBIDDEN", "仅平台管理员可管理技能库", 403);
            const v = skillSchema
              .extend({ archiveName: short, archiveBase64: z.string() })
              .parse(b);
            const slug = v.slug || slugify(v.name, "skill");
            check(
              !s.skills.some((skill) => skill.slug === slug),
              "SLUG_TAKEN",
              "技能标识已存在",
            );
            const archive = await readSkillArchive(v.archiveBase64);
            check(
              !s.skills.some((skill) => skill.name === v.name),
              "SKILL_EXISTS",
              "技能名称已存在",
            );
            result = {
              id: id("skill"),
              name: v.name,
              slug,
              description: v.description,
              files: encodeFiles(archive.files),
              revision: 1,
              createdAt: now(),
              updatedAt: now(),
            };
            s.skills.push(result);
            break;
          }
          case "skill.update": {
            check(a.admin, "FORBIDDEN", "仅平台管理员可管理技能库", 403);
            const v = skillSchema
              .extend({
                id: short,
                revision: z.number().int().positive(),
                archiveName: short.optional(),
                archiveBase64: z.string().optional(),
              })
              .parse(b);
            const row = find(s.skills, v.id);
            check(row.revision === v.revision, "REVISION_CONFLICT", "技能已被修改，请刷新后重试");
            const slug = v.slug || row.slug;
            check(
              !s.skills.some((skill) => skill.id !== row.id && skill.slug === slug),
              "SLUG_TAKEN",
              "技能标识已存在",
            );
            check(
              !s.skills.some((skill) => skill.id !== row.id && skill.name === v.name),
              "SKILL_EXISTS",
              "技能名称已存在",
            );
            Object.assign(row, {
              name: v.name,
              slug,
              description: v.description,
              revision: row.revision + 1,
              updatedAt: now(),
            });
            if (v.archiveBase64) {
              check(v.archiveName, "ARCHIVE_INVALID", "更新技能时需要压缩包名称", 400);
              const archive = await readSkillArchive(v.archiveBase64);
              row.files = encodeFiles(archive.files);
            }
            result = row;
            break;
          }
          case "skill.delete": {
            check(a.admin, "FORBIDDEN", "仅平台管理员可管理技能库", 403);
            const v = z.object({ id: short }).strict().parse(b),
              row = find(s.skills, v.id);
            check(
              !s.templates.some((template) => template.skillIds.includes(row.id)),
              "SKILL_IN_USE",
              "技能已被项目模板使用，请先修改模板",
            );
            s.skills = s.skills.filter((skill) => skill.id !== row.id);
            result = { id: row.id, deleted: true };
            break;
          }
          case "template.create": {
            check(a.admin, "FORBIDDEN", "仅平台管理员可管理项目模板", 403);
            const v = templateSchema.parse(b),
              slug = v.slug || slugify(v.name, "template");
            check(
              !s.templates.some((template) => template.slug === slug),
              "SLUG_TAKEN",
              "模板标识已存在",
            );
            check(
              !s.templates.some((template) => template.name === v.name),
              "TEMPLATE_EXISTS",
              "模板名称已存在",
            );
            for (const skillId of v.skillIds) find(s.skills, skillId);
            result = {
              ...v,
              id: id("template"),
              slug,
              revision: 1,
              createdAt: now(),
              updatedAt: now(),
            };
            s.templates.push(result);
            break;
          }
          case "template.update": {
            check(a.admin, "FORBIDDEN", "仅平台管理员可管理项目模板", 403);
            const v = templateSchema
              .extend({ id: short, revision: z.number().int().positive() })
              .parse(b),
              row = find(s.templates, v.id);
            check(row.revision === v.revision, "REVISION_CONFLICT", "模板已被修改，请刷新后重试");
            const slug = v.slug || row.slug;
            check(
              !s.templates.some((template) => template.id !== row.id && template.slug === slug),
              "SLUG_TAKEN",
              "模板标识已存在",
            );
            check(
              !s.templates.some((template) => template.id !== row.id && template.name === v.name),
              "TEMPLATE_EXISTS",
              "模板名称已存在",
            );
            for (const skillId of v.skillIds) find(s.skills, skillId);
            Object.assign(row, v, { slug, revision: row.revision + 1, updatedAt: now() });
            result = row;
            break;
          }
          case "template.delete": {
            check(a.admin, "FORBIDDEN", "仅平台管理员可管理项目模板", 403);
            const v = z.object({ id: short }).strict().parse(b),
              row = find(s.templates, v.id);
            check(
              !s.projects.some((project) => project.templateId === row.id),
              "TEMPLATE_IN_USE",
              "模板已用于项目，不能删除",
            );
            s.templates = s.templates.filter((template) => template.id !== row.id);
            result = { id: row.id, deleted: true };
            break;
          }
          case "project.create":
          case "project.import": {
            check(
              !a.projectId || a.projectId === "*",
              "FORBIDDEN",
              "项目委托不能创建项目",
              403,
            );
            const v = (
              action === "project.import"
                ? projectSchema.extend({
                    archiveName: short,
                    archiveBase64: z.string(),
                  })
                : projectSchema.extend({ templateId: short.optional() })
            ).parse(b);
            const slug = v.slug || "project-" + randomBytes(5).toString("hex");
            check(
              !s.projects.some((p) => p.slug === slug),
              "SLUG_TAKEN",
              "仓库标识已存在",
            );
            const templateId = (v as any).templateId as string | undefined;
            let files: Snapshot = this.templateFiles(s, templateId);
            if (action === "project.import") {
              const archive = await readArchive(b.archiveBase64);
              files = archive.files;
              Object.assign(request, {
                archiveDigest: archive.archiveDigest,
                fileCount: archive.fileCount,
                archiveName: b.archiveName,
              });
            }
            p = {
              id: id("proj"),
              name: v.name,
              slug,
              members: { [a.userId]: "owner" },
              createdAt: now(),
              status: "INITIALIZING",
              ...(action === "project.create" && templateId
                ? {
                    templateId,
                    skillIds: this.template(s, templateId).skillIds,
                  }
                : {}),
            };
            s.projects.push(p);
            await begin({ operation: "project.create", project: p });
            const repo = await this.git.createProject(p, files);
            p.repoId = repo.id;
            p.status = "ACTIVE";
            result = p;
            break;
          }
          case "project.update": {
            const v = z
              .object({ projectId: short, name: short })
              .strict()
              .parse(b);
            project(v.projectId);
            owner();
            p!.name = v.name;
            result = p;
            break;
          }
          case "project.member": {
            const v = z
              .object({
                projectId: short,
                userId: short,
                role: z.enum(["owner", "member", "observer", "remove"]),
              })
              .strict()
              .parse(b);
            project(v.projectId);
            owner();
            find(s.users, v.userId);
            check(
              v.userId !== a.userId || v.role === "owner",
              "LAST_OWNER",
              "不能撤销自己的负责人身份",
            );
            if (v.role === "remove") delete p!.members[v.userId];
            else p!.members[v.userId] = v.role;
            result = p;
            break;
          }
          case "user.create": {
            check(
              a.admin && this.git instanceof Gitea,
              "FORBIDDEN",
              "仅管理员可创建统一账号",
              403,
            );
            const v = z
              .object({
                username: z.string().regex(/^[a-z][a-z0-9_-]{2,30}$/),
                password: z.string().min(8).max(128),
                email: z.email(),
              })
              .strict()
              .parse(b);
            // 密码不写入请求记录；创建失败由管理员检查统一身份后处理。
            await begin({ operation: "user.create", username: v.username });
            const u = await this.git.api("/admin/users", "POST", {
              ...v,
              must_change_password: true,
              send_notify: false,
            });
            result = {
              id: String(u.id),
              giteaId: String(u.id),
              username: u.login,
              active: true,
              admin: false,
            };
            s.users.push(result);
            break;
          }
          case "user.update": {
            check(
              a.admin && this.git instanceof Gitea,
              "FORBIDDEN",
              "仅管理员可管理统一账号",
              403,
            );
            const v = z
                .object({ userId: short, active: z.boolean() })
                .strict()
                .parse(b),
              u = find(s.users, v.userId);
            check(u.id !== a.userId, "SELF_DISABLE", "不能停用当前管理员");
            await begin({
              operation: "user.update",
              userId: u.id,
              active: v.active,
            });
            await this.git.api(
              "/admin/users/" + encodeURIComponent(u.username),
              "PATCH",
              {
                source_id: 0,
                login_name: u.username,
                prohibit_login: !v.active,
              },
            );
            u.active = v.active;
            for (const c of s.credentials)
              if (c.userId === u.id) c.revoked = true;
            result = u;
            break;
          }
          case "requirement.create":
          case "requirement.update":
            result = requirement(action, b);
            break;
          case "branch.create": {
            const v = z
              .object({
                projectId: short,
                name: refName,
                baseSha: sha,
                requirementId: short.optional(),
              })
              .strict()
              .parse(b);
            project(v.projectId);
            check(
              !["main", "devops/control"].includes(v.name) &&
                !v.name.startsWith("devops/"),
              "BRANCH_RESERVED",
              "该分支名称保留",
            );
            if (v.requirementId)
              check(
                find(s.requirements, v.requirementId).projectId === p!.id,
                "PROJECT_DENIED",
                "需求不属于此项目",
                403,
              );
            check(
              !(await this.git.branches(p!)).some((r) => r.name === v.name),
              "BRANCH_EXISTS",
              "分支已存在",
            );
            check(
              await this.git.ancestor(
                p!,
                v.baseSha,
                await this.git.head(p!, "main"),
              ),
              "BASE_INVALID",
              "基线必须属于 main 历史",
            );
            result = { ...v, id: id("br"), status: "ACTIVE", createdAt: now() };
            await begin({ operation: action, row: result });
            await this.git.createBranch(p!, v.name, v.baseSha);
            s.branches.push(result);
            break;
          }
          case "branch.delete": {
            const v = z.object({ id: short, headSha: sha }).strict().parse(b),
              row = find(s.branches, v.id);
            project(row.projectId);
            check(
              row.status === "ACTIVE" &&
                !["main", "devops/control"].includes(row.name),
              "BRANCH_PROTECTED",
              "该分支不能删除",
            );
            check(
              !s.pulls.some(
                (pr) => pr.branchId === row.id && pr.status === "OPEN",
              ),
              "PR_OPEN",
              "请先合并此分支的 PR",
            );
            check(
              (await this.git.head(p!, row.name)) === v.headSha,
              "HEAD_MOVED",
              "分支提交已变化",
            );
            await begin({ operation: action, row, headSha: v.headSha });
            await this.git.deleteBranch(p!, row.name);
            row.status = "DELETED";
            result = row;
            break;
          }
          case "pr.create": {
            const v = z
              .object({
                projectId: short,
                branchId: short,
                title: short,
                description: text.default(""),
              })
              .strict()
              .parse(b);
            project(v.projectId);
            const branch = find(s.branches, v.branchId);
            check(
              branch.projectId === p!.id && branch.status === "ACTIVE",
              "BRANCH_INVALID",
              "工作分支不可用",
            );
            check(
              !s.pulls.some(
                (pr) => pr.branchId === branch.id && pr.status === "OPEN",
              ),
              "PR_EXISTS",
              "此分支已有待合并 PR",
            );
            const row = {
              ...v,
              id: id("pr"),
              requirementId: branch.requirementId,
              status: "OPEN",
              createdAt: now(),
            };
            await begin({ operation: action, row, branch: branch.name });
            const pr = await this.git.createPr(
              p!,
              branch.name,
              "main",
              v.title,
              v.description,
            );
            result = { ...row, number: pr.number };
            s.pulls.push(result);
            break;
          }
          case "pr.merge": {
            const v = z
                .object({ id: short, headSha: sha, targetSha: sha })
                .strict()
                .parse(b),
              row = find(s.pulls, v.id);
            project(row.projectId);
            const pr = await this.git.pr(p!, row.number);
            check(
              row.status === "OPEN" && pr.state === "open" && !pr.merged,
              "PR_CLOSED",
              "PR 已关闭",
            );
            check(
              pr.head.sha === v.headSha &&
                (await this.git.head(p!, "main")) === v.targetSha,
              "HEAD_MOVED",
              "分支或主线已变化，请重新查看差异",
            );
            check(
              pr.base.ref === "main",
              "PR_TARGET_INVALID",
              "PR 目标必须是 main",
            );
            const conflictReport = await this.git.conflicts(
              p!,
              v.targetSha,
              v.headSha,
            );
            if (conflictReport.hasConflicts)
              throw new Fault(
                "MERGE_CONFLICT",
                "检测到合并冲突。请查看 DevOps Agent 差异报告，由人类选择左右版本后交给 IDE Agent 解决；本次未执行合并。",
                409,
                conflictReport,
              );
            check(
              await this.git.protection(p!, "main"),
              "PROTECTION_MISSING",
              "主线保护配置缺失",
            );
            await begin({
              operation: action,
              row,
              headSha: v.headSha,
              targetSha: v.targetSha,
            });
            const merged = await this.git.merge(p!, pr);
            Object.assign(row, {
              status: "MERGED",
              mergeSha: merged,
              mergedAt: now(),
            });
            result = row;
            break;
          }
          case "pr.conflict.choice": {
            const v = z
                .object({
                  id: short,
                  headSha: sha,
                  targetSha: sha,
                  choices: z
                    .object({
                      path: z.string().trim().min(1).max(1000),
                      choice: z.enum(["left", "right"]),
                    })
                    .array()
                    .min(1)
                    .max(500),
                })
                .strict()
                .parse(b),
              row = find(s.pulls, v.id);
            project(row.projectId);
            const pr = await this.git.pr(p!, row.number);
            check(
              row.status === "OPEN" && pr.state === "open" && !pr.merged,
              "PR_CLOSED",
              "PR 已关闭",
            );
            check(
              pr.head.sha === v.headSha &&
                (await this.git.head(p!, "main")) === v.targetSha,
              "HEAD_MOVED",
              "分支或主线已变化，请重新查看冲突",
            );
            const report = await this.git.conflicts(p!, v.targetSha, v.headSha);
            check(
              report.hasConflicts,
              "CONFLICTS_CLEARED",
              "当前提交已没有冲突，请刷新 PR 页面",
            );
            const unique = new Map(
              v.choices.map((choice) => [choice.path, choice]),
            );
            check(
              unique.size === v.choices.length &&
                unique.size === report.conflicts.length &&
                report.conflicts.every((conflict) => unique.has(conflict.path)),
              "CONFLICT_CHOICES_INCOMPLETE",
              "请为每个冲突文件选择左侧或右侧",
            );
            row.conflictReport = report;
            row.conflictChoices = report.conflicts.map((conflict) =>
              unique.get(conflict.path),
            );
            row.conflictChoiceBy = a.userId;
            row.conflictChoiceAt = now();
            result = {
              id: row.id,
              status: row.status,
              targetSha: v.targetSha,
              headSha: v.headSha,
              choices: row.conflictChoices,
              next: "IDE_AGENT_MUST_RESOLVE_AND_PUSH",
            };
            break;
          }
          case "version.create": {
            const v = z
              .object({
                projectId: short,
                name: refName,
                sha,
                notes: text.default(""),
                requirementIds: z.array(short).max(100).default([]),
              })
              .strict()
              .parse(b);
            project(v.projectId);
            check(
              !(await this.git.tags(p!)).some((t) => t.name === v.name),
              "VERSION_EXISTS",
              "版本标签已存在，不能覆盖",
            );
            check(
              await this.git.ancestor(
                p!,
                v.sha,
                await this.git.head(p!, "main"),
              ),
              "VERSION_SOURCE",
              "版本提交必须在 main 历史中",
            );
            for (const rid of v.requirementIds)
              check(
                find(s.requirements, rid).projectId === p!.id,
                "PROJECT_DENIED",
                "关联需求不属于此项目",
                403,
              );
            result = { ...v, id: id("ver"), createdAt: now() };
            await begin({ operation: action, row: result });
            await this.git.createTag(p!, v.name, v.sha);
            s.versions.push(result);
            break;
          }
          case "credential.create": {
            const v = z
              .object({
                projectId: short,
                name: short,
                role: z.enum(["human", "ide_agent", "devops_agent"]),
                hours: z.number().int().min(1).max(24).default(1),
              })
              .strict()
              .parse(b);
            project(v.projectId);
            const token = randomBytes(32).toString("base64url"),
              credential = {
                ...v,
                id: id("cred"),
                userId: a.userId,
                hash: tokenHash(token),
                expiresAt: new Date(
                  Date.now() + v.hours * 3600000,
                ).toISOString(),
                createdAt: now(),
              };
            s.credentials.push(credential);
            result = { ...credential, hash: undefined, token };
            break;
          }
          case "credential.revoke": {
            const v = z.object({ id: short }).strict().parse(b),
              c = find(s.credentials, v.id);
            project(c.projectId);
            check(
              c.userId === a.userId || p!.members[a.userId] === "owner",
              "FORBIDDEN",
              "只能撤销自己的委托",
              403,
            );
            c.revoked = true;
            result = { id: c.id, revoked: true };
            break;
          }
          case "workspace.sync": {
            const v = z
              .object({
                protocolVersion: z.literal(2),
                projectId: short,
                requestId: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/),
                action: short,
                payload: z.record(z.string(), z.unknown()),
              })
              .strict()
              .parse(b);
            project(v.projectId);
            check(
              ["requirement.create", "requirement.update"].includes(v.action),
              "SYNC_ACTION_DENIED",
              "共享文件只支持需求更新",
              403,
            );
            const previous = s.requests.find(
              (r) =>
                r.projectId === p!.id && r.envelope?.requestId === v.requestId,
            );
            if (previous) {
              check(
                previous.fingerprint === fingerprint,
                "IDEMPOTENCY_CONFLICT",
                "文件请求标识已使用",
              );
              check(
                previous.status === "SUCCEEDED",
                "REQUEST_UNRESOLVED",
                "同步结果未确定，请核对仓库",
              );
              result = previous.result;
              break;
            }
            if (v.action === "requirement.update")
              check(
                find(s.requirements, String(v.payload.id)).projectId === p!.id,
                "PROJECT_DENIED",
                "需求不属于此项目",
                403,
              );
            const row = requirement(
              v.action,
              v.action === "requirement.create"
                ? { ...v.payload, projectId: p!.id }
                : v.payload,
            );
            result = {
              requestId: v.requestId,
              status: "SUCCEEDED",
              requirement: row,
            };
            request.envelope = { requestId: v.requestId };
            // 需求更新在一次数据库提交中成立，控制分支仅保存投影，可通过核对仓库重建。
            break;
          }
          case "repository.reconcile": {
            const v = z.object({ projectId: short }).strict().parse(b);
            project(v.projectId);
            result = await this.reconcile(s, p!);
            break;
          }
        }
        request.projectId = p?.id;
        request.status = "SUCCEEDED";
        request.completedAt = now();
        // 凭证明文只在首次响应中出现，不进入状态快照、幂等结果或审计。
        request.result =
          action === "credential.create"
            ? { ...result, token: undefined }
            : structuredClone(result);
        if (!journaled) s.requests.push(request);
        await this.save(s, a, action + ".completed", {
          projectId: p?.id,
          requestId,
          archiveName: request.archiveName,
          archiveDigest: request.archiveDigest,
          fileCount: request.fileCount,
        });
      } catch (e) {
        if (journaled) {
          request.status = external ? "UNKNOWN" : "FAILED";
          if (p?.status === "INITIALIZING") p.status = "UNKNOWN";
          await this.save(s, a, action + ".unknown", {
            projectId: p?.id,
            requestId,
          });
        }
        throw e;
      }
      if (p && p.status === "ACTIVE" && !action.startsWith("credential.")) {
        try {
          await this.git.archive(
            p,
            Object.fromEntries(
              Object.entries(this.files(s, p)).map(([path, value]) => [
                ".devops/" + path,
                JSON.stringify(value, null, 2),
              ]),
            ),
          );
        } catch {
          await this.store.change(
            a.id,
            "workspace.projection_pending",
            (state) => {
              find(state.projects, p!.id).projectionPending = true;
            },
            { projectId: p.id },
          );
        }
      }
      return result;
    });
  }
  files(s: State, p: Entity) {
    const requirements = s.requirements.filter((r) => r.projectId === p.id),
      files: Record<string, any> = {};
    for (const r of requirements)
      files["inbox/requirements/" + r.id + ".json"] = r;
    for (const r of s.requests.filter(
      (r) => r.projectId === p.id && r.envelope,
    ))
      files["receipts/" + r.envelope.requestId + ".json"] = {
        status: r.status,
        ...r.result,
      };
    files["state.json"] = {
      protocolVersion: 2,
      projectId: p.id,
      requirements,
      branches: s.branches.filter((r) => r.projectId === p.id),
      versions: s.versions.filter((r) => r.projectId === p.id),
    };
    return files;
  }
  async reconcile(s: State, p: Entity) {
    const branches = await this.git.branches(p),
      tags = await this.git.tags(p);
    const pending = s.requests.filter(
      (r) => r.projectId === p.id && r.status === "UNKNOWN",
    );
    for (const r of pending) {
      const rec = r.recovery || {},
        row = rec.row;
      let result: any,
        absent = false;
      if (rec.operation === "branch.create") {
        const ref = branches.find((b) => b.name === row.name);
        check(
          !ref || ref.sha === row.baseSha,
          "RECONCILE_CONFLICT",
          "分支发生额外变化，不能自动确认",
        );
        if (ref) {
          if (!s.branches.some((b) => b.id === row.id)) s.branches.push(row);
          result = row;
        } else absent = true;
      } else if (rec.operation === "branch.delete") {
        if (!branches.some((b) => b.name === row.name)) {
          result = find(s.branches, row.id);
          result.status = "DELETED";
        } else absent = true;
      } else if (rec.operation === "version.create") {
        const tag = tags.find((t) => t.name === row.name);
        check(
          !tag || tag.sha === row.sha,
          "RECONCILE_CONFLICT",
          "标签提交不匹配",
        );
        if (tag) {
          if (!s.versions.some((v) => v.id === row.id)) s.versions.push(row);
          result = row;
        } else absent = true;
      } else if (rec.operation === "pr.merge") {
        const pr = await this.git.pr(p, row.number);
        if (pr.merged) {
          result = find(s.pulls, row.id);
          Object.assign(result, {
            status: "MERGED",
            mergeSha: pr.merge_commit_sha,
            mergedAt: now(),
          });
        } else absent = true;
      } else if (rec.operation === "git.push") {
        const ref = branches.find((b) => b.name === rec.branch);
        check(
          ref && [rec.oldSha, rec.newSha].includes(ref.sha),
          "RECONCILE_CONFLICT",
          "工作分支有额外变化",
        );
        if (ref.sha === rec.newSha) result = { sha: ref.sha };
        else absent = true;
      } else if (rec.operation === "project.create") {
        await this.git.finishProject(p);
        p.status = "ACTIVE";
        result = p;
      } else if (rec.operation === "pr.create" && this.git instanceof Gitea) {
        const matches = (
          await this.git.list(this.git.repo(p) + "/pulls?state=all")
        ).filter((pr) => pr.head.ref === rec.branch && pr.base.ref === "main");
        check(
          matches.length <= 1,
          "RECONCILE_CONFLICT",
          "存在多个 PR，请管理员检查",
        );
        if (matches.length) {
          result = { ...row, number: matches[0].number };
          s.pulls.push(result);
        } else absent = true;
      } else
        throw new Fault(
          "RECONCILE_UNSUPPORTED",
          "此操作需要管理员检查统一身份服务",
        );
      r.status = absent ? "FAILED" : "SUCCEEDED";
      r.result = result;
      r.completedAt = now();
    }
    p.projectionPending = false;
    return { projectId: p.id, reconciled: pending.length, branches, tags };
  }
}
