import { emptyState, now, id } from "./model.js";
export const LEGACY_TABLES = [
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
];
/** 旧执行资料由数据库完整归档，仅提取需求与版本管理可用的数据。 */
export function migrateLegacy(old: Record<string, any[]>) {
  const next = emptyState();
  next.users = old.users || [];
  next.projects = (old.projects || []).map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    repoId: p.repoId,
    createdAt: p.createdAt || now(),
    status: p.control === "UNKNOWN" ? "UNKNOWN" : "ACTIVE",
    members: Object.fromEntries(
      Object.entries(p.members || {}).map(([u, r]) => [
        u,
        r === "reviewer" ? "member" : r,
      ]),
    ),
  }));
  for (const i of old.intents || []) {
    next.requirements.push({
      id: i.id,
      projectId: i.projectId,
      title: i.title,
      description: i.description || "",
      kind: i.kind === "defect" ? "defect" : "feature",
      priority: i.risk === "high" ? "high" : "normal",
      status:
        i.stage === "MERGED"
          ? "DONE"
          : i.stage === "DRAFT"
            ? "OPEN"
            : "IN_PROGRESS",
      revision: 1,
      createdAt: i.createdAt || now(),
      updatedAt: now(),
    });
    if (i.branch) {
      const branchId = id("br");
      next.branches.push({
        id: branchId,
        projectId: i.projectId,
        name: i.branch,
        requirementId: i.id,
        baseSha: i.baseSha,
        status: "ACTIVE",
        createdAt: i.createdAt || now(),
      });
      if (i.pr)
        next.pulls.push({
          id: id("pr"),
          projectId: i.projectId,
          branchId,
          number: i.pr.number,
          title: i.title,
          description: "",
          status: i.stage === "MERGED" ? "MERGED" : "OPEN",
          createdAt: i.createdAt || now(),
        });
    }
  }
  return next;
}
