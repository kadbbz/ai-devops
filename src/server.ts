import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { z } from "zod";
import { type Store, MysqlStore } from "./store.js";
import { Gitea, type GitService } from "./git.js";
import { Control } from "./control.js";
import {
  type Actor,
  Fault,
  check,
  id,
  now,
  tokenHash,
  find,
  access,
  SYSTEM_TEMPLATE,
} from "./model.js";
import { registerGateway } from "./gateway.js";

import { nextBackup } from "./backup.js";

interface Options {
  store: Store;
  git: GitService;
  testing?: boolean;
  origin?: string;
  oauth?: { clientId: string; clientSecret: string };
  opsRoot?: string;
  authState?: {
    isDefaultPassword: () => Promise<boolean>;
    markPasswordChanged: () => Promise<void>;
  };
}
export async function createApp(options: Options) {
  const { store, git } = options;
  const control = new Control(store, git);
  const origin = options.origin || "http://localhost:8080";
  const app = Fastify({
    logger: !options.testing,
    bodyLimit: 64 * 1024 * 1024,
    disableRequestLogging: true,
  });
  await app.register(cookie);
  app.addHook("onRequest", async (req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "same-origin");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers.origin)
      check(
        req.headers.origin === origin,
        "ORIGIN_DENIED",
        "请求来源不匹配",
        403,
      );
  });
  const actor = async (req: FastifyRequest): Promise<Actor> => {
    const s = await store.read();
    let bearer = req.headers.authorization?.replace(/^Bearer /, "");
    if (req.headers.authorization?.startsWith("Basic ")) {
      const [, token] = Buffer.from(
        req.headers.authorization.slice(6),
        "base64",
      )
        .toString()
        .split(":");
      bearer = token;
    }
    let userId: string,
      role = "human",
      name = "",
      projectId: string | undefined,
      credentialId: string | undefined,
      actorId: string;
    if (bearer) {
      const cred = s.credentials.find(
        (c) =>
          c.hash === tokenHash(bearer!) && !c.revoked && c.expiresAt > now(),
      );
      check(cred, "UNAUTHENTICATED", "凭证无效或已过期", 401);
      userId = cred.userId;
      role = cred.role;
      name = cred.name;
      projectId = cred.projectId;
      credentialId = cred.id;
      actorId = role === "human" ? userId : cred.id;
    } else {
      const session = s.sessions.find(
        (x) =>
          x.id === tokenHash(req.cookies.devops_session || "") &&
          x.expiresAt > now(),
      );
      check(session, "UNAUTHENTICATED", "请先登录", 401);
      userId = session.userId;
      actorId = userId;
      if (!["GET", "HEAD"].includes(req.method))
        check(
          req.headers["x-csrf-token"] === session.csrf,
          "CSRF_DENIED",
          "请求校验失败，请刷新页面",
          403,
        );
    }
    const user = find(s.users, userId);
    check(user.active, "ACCOUNT_INACTIVE", "账号已停用", 401);
    if (!options.testing) await git.activeUser(user.giteaId, user.username);
    return {
      id: actorId,
      userId,
      role,
      name: name || user.username,
      projectId,
      credentialId,
      admin:
        role === "human" && user.admin && (!projectId || projectId === "*"),
    };
  };
  app.setErrorHandler(async (error: any, req, reply) => {
    const status =
      error instanceof Fault
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : error.statusCode || 500;
    const code =
      error instanceof Fault
        ? error.code
        : error instanceof z.ZodError
          ? "VALIDATION"
          : "INTERNAL_ERROR";
    if (status >= 400 && status < 500) {
      await store
        .change("request", "request.denied", () => null, {
          requestId: req.id,
          route: req.routeOptions.url,
          code,
        })
        .catch(() => {});
    }
    if (status >= 500) req.log.error({ code, name: error.name }, "请求失败");
    reply.status(status).send({
      code,
      message:
        error instanceof Fault
          ? error.message
          : error instanceof z.ZodError
            ? error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("；")
            : "服务暂时不可用",
      ...(error instanceof Fault && error.details !== undefined
        ? { details: error.details }
        : {}),
      requestId: req.id,
    });
  });
  app.get("/api/health", async () => {
    await store.read();
    return { status: "ready", version: "2.0.0" };
  });
  app.get("/api/session", async (req) => {
    const a = await actor(req);
    const s = await store.read();
    const session = s.sessions.find(
      (x) => x.id === tokenHash(req.cookies.devops_session || ""),
    );
    return {
      user: { id: a.userId, name: a.name, admin: a.admin, role: a.role },
      csrf: session?.csrf,
      defaultPasswordWarning: session?.defaultPassword === true,
      actor: {
        id: a.id,
        userId: a.userId,
        role: a.role,
        name: a.name,
        projectId: a.projectId,
      },
    };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    const a = await actor(req);
    await store.change(a.id, "session.logout", (s) => {
      s.sessions = s.sessions.filter(
        (x) => x.id !== tokenHash(req.cookies.devops_session || ""),
      );
    });
    reply.clearCookie("devops_session", { path: "/" });
    return { ok: true };
  });
  app.post("/api/session/default-password-dismiss", async (req) => {
    const a = await actor(req);
    const sessionId = tokenHash(req.cookies.devops_session || "");
    await store.change(a.id, "session.default_password_dismissed", (s) => {
      const session = s.sessions.find((x) => x.id === sessionId);
      check(session, "UNAUTHENTICATED", "请先登录", 401);
      session.defaultPassword = false;
    });
    return { ok: true };
  });
  app.get("/api/auth/login", async (req, reply) => {
    check(
      options.oauth && git instanceof Gitea,
      "IDENTITY_NOT_READY",
      "统一账号尚未就绪",
      503,
    );
    const state = randomBytes(24).toString("base64url"),
      verifier = randomBytes(32).toString("base64url");
    await store.change("anonymous", "oauth.start", (s) => {
      s.sessions = s.sessions.filter((x) => x.expiresAt > now());
      s.sessions.push({
        id: "oauth_" + tokenHash(state),
        verifier,
        expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
      });
    });
    reply.setCookie("oauth_state", state, {
      path: "/api/auth",
      httpOnly: true,
      sameSite: "lax",
      secure: origin.startsWith("https:"),
      maxAge: 600,
    });
    const challenge = Buffer.from(tokenHash(verifier), "hex").toString(
      "base64url",
    );
    reply.redirect(
      "/identity/login/oauth/authorize?" +
        new URLSearchParams({
          client_id: options.oauth.clientId,
          redirect_uri: origin + "/api/auth/callback",
          response_type: "code",
          scope: "read:user",
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
        }),
    );
  });
  app.get("/api/auth/callback", async (req, reply) => {
    check(
      options.oauth && git instanceof Gitea,
      "IDENTITY_NOT_READY",
      "统一账号未就绪",
      503,
    );
    const q = req.query as any;
    check(
      typeof q.state === "string" &&
        q.state === req.cookies.oauth_state &&
        typeof q.code === "string",
      "OAUTH_STATE",
      "身份回调校验失败",
      403,
    );
    const s = await store.read();
    const pending = s.sessions.find(
      (x) => x.id === "oauth_" + tokenHash(q.state) && x.expiresAt > now(),
    );
    check(pending, "OAUTH_EXPIRED", "登录已过期", 401);
    await store.change("anonymous", "oauth.consume", (s) => {
      s.sessions = s.sessions.filter((x) => x.id !== pending.id);
    });
    const response = await fetch(git.base + "/login/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: q.code,
        client_id: options.oauth.clientId,
        client_secret: options.oauth.clientSecret,
        redirect_uri: origin + "/api/auth/callback",
        code_verifier: pending.verifier,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    check(response.ok, "OAUTH_FAILED", "统一身份授权失败", 401);
    const auth = (await response.json()) as any;
    const profile = await fetch(git.base + "/api/v1/user", {
      headers: { Authorization: `token ${auth.access_token}` },
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    check(profile.ok, "OAUTH_PROFILE", "无法读取统一账号", 401);
    const u = (await profile.json()) as any;
    await git.activeUser(String(u.id), String(u.login));
    const defaultPassword =
      String(u.login) === "admin" &&
      (options.authState ? await options.authState.isDefaultPassword() : false);
    const token = randomBytes(32).toString("base64url"),
      csrf = randomBytes(24).toString("base64url");
    await store.change(String(u.id), "session.login", (s) => {
      let user = s.users.find((x) => x.id === String(u.id));
      if (!user) {
        user = {
          id: String(u.id),
          giteaId: String(u.id),
          username: u.login,
          admin: u.is_admin,
          active: true,
        };
        s.users.push(user);
      }
      s.sessions.push({
        id: tokenHash(token),
        userId: user.id,
        csrf,
        defaultPassword,
        expiresAt: new Date(Date.now() + 8 * 3600000).toISOString(),
      });
    });
    reply.clearCookie("oauth_state", { path: "/api/auth" });
    reply.setCookie("devops_session", token, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: origin.startsWith("https:"),
      maxAge: 8 * 3600,
    });
    reply.redirect("/");
  });
  // 仅代理身份页面和静态资源，仓库/管理 API 不存在公开代理路径。
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_r, b, done) => done(null, b),
  );
  app.route({
    method: ["GET", "POST"],
    url: "/identity/*",
    handler: async (req, reply) => {
      check(git instanceof Gitea, "IDENTITY_NOT_READY", "身份服务未就绪", 503);
      const path = req.url.split("?")[0].slice("/identity".length);
      check(
        !/%(?:2e|2f|5c)/i.test(path) &&
          !path.includes("..") &&
          !path.includes("\\"),
        "IDENTITY_PATH_DENIED",
        "非法身份路径",
        403,
      );
      const allowed = [
        "/user/login",
        "/user/logout",
        "/user/settings/change_password",
        "/user/change_password",
        "/user/settings/account",
        "/login/oauth/authorize",
        "/login/oauth/grant",
      ];
      check(
        allowed.includes(path) ||
          (req.method === "GET" && path.startsWith("/assets/")),
        "IDENTITY_PATH_DENIED",
        "此路径不能通过身份入口访问",
        403,
      );
      const passwordChangePaths = new Set([
        "/user/settings/change_password",
        "/user/change_password",
      ]);
      const passwordChange =
        req.method === "POST" && passwordChangePaths.has(path);
      let identitySession: any;
      if (passwordChange) {
        const state = await store.read();
        identitySession = state.sessions.find(
          (x) =>
            x.id === tokenHash(req.cookies.devops_session || "") &&
            x.expiresAt > now(),
        );
        check(identitySession, "UNAUTHENTICATED", "请先登录 DevOps", 401);
        const user = find(state.users, identitySession.userId);
        check(
          user.username === "admin",
          "PASSWORD_CHANGE_DENIED",
          "只有内置管理员可以修改默认密码",
          403,
        );
      }
      const response = await fetch(
        git.base + req.url.slice("/identity".length),
        {
          method: req.method,
          headers: {
            "accept-language": "zh-CN,zh;q=0.9",
            ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
            "content-type": String(
              req.headers["content-type"] ||
                "application/x-www-form-urlencoded",
            ),
          },
          body: req.method === "POST" ? String(req.body) : undefined,
          redirect: "manual",
          signal: AbortSignal.timeout(15000),
        },
      );
      let publicLocation: string | undefined;
      for (const c of response.headers.getSetCookie())
        reply.header("set-cookie", [
          ...((reply.getHeader("set-cookie") as string[]) || []),
          c,
        ]);
      const location = response.headers.get("location");
      if (location) {
        const url = new URL(location, git.base);
        if (url.origin === git.base) {
          publicLocation =
            (url.pathname.startsWith("/identity/")
              ? url.pathname
              : "/identity" + url.pathname) + url.search;
        } else {
          check(
            url.origin === origin,
            "IDENTITY_REDIRECT",
            "拒绝未知身份跳转",
            403,
          );
          publicLocation = url.pathname + url.search;
        }
        reply.header("location", publicLocation);
      }
      if (
        passwordChange &&
        response.status >= 300 &&
        response.status < 400 &&
        publicLocation
      ) {
        const redirectedPath = new URL(publicLocation, origin).pathname;
        const changed =
          redirectedPath !== "/identity/user/settings/change_password" &&
          redirectedPath !== "/identity/user/change_password" &&
          redirectedPath !== "/identity/user/login";
        if (changed) {
          await options.authState?.markPasswordChanged();
          await store.change("identity", "session.password_changed", (s) => {
            const current = s.sessions.find((x) => x.id === identitySession.id);
            if (current) current.defaultPassword = false;
          });
        }
      }
      reply.status(response.status);
      reply.type(response.headers.get("content-type") || "text/html");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (response.headers.get("content-type")?.includes("text/html")) {
        // Gitea 默认 no-referrer 会让同源表单发送 Origin:null；统一同源来源策略。
        const html = bytes
          .toString("utf8")
          .replace(
            '<meta name="referrer" content="no-referrer">',
            '<meta name="referrer" content="same-origin">',
          );
        return html.replace(
          "</head>",
          `<style>body{background:#f6f3fc!important}#navbar,footer,.passkey-login,a[href*="forgot_password"]{display:none!important}.ui.container{max-width:560px!important}.ui.segment{border-radius:14px!important;border-color:#e9e1f7!important}.ui.primary.button,.ui.green.button{background:#7047eb!important}.ui.header{color:#513485!important}main:before{content:"序 · DevOps 统一身份";display:block;text-align:center;padding:48px 0 20px;color:#7047eb;font-size:24px;font-weight:600}</style></head>`,
        );
      }
      return bytes;
    },
  });
  app.get("/api/workspace", async (req) => {
    const a = await actor(req),
      s = await store.read();
    const projects = s.projects.filter(
      (p) =>
        p.members[a.userId] &&
        (!a.projectId || a.projectId === "*" || a.projectId === p.id),
    );
    const ids = new Set(projects.map((p) => p.id));
    const templates = [
      SYSTEM_TEMPLATE,
      ...s.templates.filter((template) => template.id !== SYSTEM_TEMPLATE.id),
    ].map((template) => {
      const { files, ...metadata } = template as any;
      return metadata;
    });
    return {
      projects,
      ...Object.fromEntries(
        ["requirements", "branches", "pulls", "versions"].map((table) => [
          table,
          s[table as "requirements"].filter((r) => ids.has(r.projectId)),
        ]),
      ),
      requests: s.requests
        .filter((r) => ids.has(r.projectId) && r.status === "UNKNOWN")
        .map((r) => ({
          id: r.id,
          projectId: r.projectId,
          action: r.action,
          status: r.status,
          createdAt: r.createdAt,
        })),
      credentials:
        a.role === "human"
          ? s.credentials
              .filter((c) => ids.has(c.projectId) && c.userId === a.userId)
              .map(({ hash, ...c }) => c)
          : [],
      users: a.admin
        ? s.users
        : s.users.filter((u) => projects.some((p) => p.members[u.id])),
      skills: s.skills.map(({ files, ...skill }) => skill),
      templates,
    };
  });
  app.post("/api/actions/:action", async (req) => {
    const a = await actor(req);
    return {
      result: await control.run(
        a,
        (req.params as any).action,
        req.body,
        req.headers["idempotency-key"] as string,
      ),
    };
  });
  app.get("/api/projects/:id/workspace", async (req) => {
    const a = await actor(req),
      s = await store.read(),
      p = find(s.projects, (req.params as any).id);
    access(a, p);
    return { files: control.files(s, p) };
  });
  app.get("/api/projects/:id/repository", async (req) => {
    const a = await actor(req),
      s = await store.read(),
      p = find(s.projects, (req.params as any).id);
    access(a, p);
    const [branches, tags] = await Promise.all([git.branches(p), git.tags(p)]);
    return { branches, tags };
  });
  app.get("/api/pulls/:id", async (req) => {
    const a = await actor(req),
      s = await store.read(),
      row = find(s.pulls, (req.params as any).id),
      p = find(s.projects, row.projectId);
    access(a, p);
    const pr = await git.pr(p, row.number),
      targetSha = await git.head(p, "main"),
      conflicts = await git.conflicts(p, targetSha, pr.head.sha);
    return {
      ...row,
      headSha: pr.head.sha,
      targetSha,
      mergeable: !conflicts.hasConflicts,
      conflictReport: conflicts,
      conflicts: conflicts.conflicts,
      merged: pr.merged,
      diff: await git.diff(p, targetSha, pr.head.sha),
    };
  });
  app.get("/api/audit", async (req) => {
    const a = await actor(req);
    check(a.role === "human", "FORBIDDEN", "仅人类可查询审计", 403);
    const s = await store.read(),
      ids = new Set(
        s.projects.filter((p) => p.members[a.userId]).map((p) => p.id),
      );
    return (await store.audit()).filter(
      (e) => a.admin || ids.has(e.details?.projectId),
    );
  });
  app.get("/api/ops", async (req) => {
    const a = await actor(req);
    check(a.admin, "FORBIDDEN", "仅管理员可查看运维", 403);
    const root = options.opsRoot || "/data/ops";
    try {
      return JSON.parse(await readFile(root + "/status.json", "utf8"));
    } catch {
      return { phase: "UNAVAILABLE", message: "运维状态尚不可用", backups: [] };
    }
  });
  app.post("/api/ops/schedule", async (req) => {
    const a = await actor(req);
    check(a.admin, "FORBIDDEN", "仅管理员可修改备份计划", 403);
    check(options.opsRoot, "OPS_UNAVAILABLE", "运维不可用", 503);
    const input = z
      .object({
        time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
        zone: z.string().min(1).max(100),
      })
      .strict()
      .parse(req.body);
    let nextAt: string;
    try {
      nextAt = nextBackup(new Date(), input.time, input.zone);
    } catch {
      throw new Fault("SCHEDULE_INVALID", "时间或时区无效", 400);
    }
    await store.change(a.id, "backup.schedule.request", () => null, {
      ...input,
      nextAt,
    });
    await writeFile(
      options.opsRoot + "/schedule.request",
      JSON.stringify({ ...input, actor: a.id, at: now() }),
      { mode: 0o600 },
    );
    return { nextAt };
  });
  app.post("/api/ops/backup", async (req) => {
    const a = await actor(req);
    check(a.admin, "FORBIDDEN", "仅管理员可执行备份", 403);
    check(
      options.opsRoot,
      "OPS_UNAVAILABLE",
      "当前运行方式不支持平台备份",
      503,
    );
    const operationId = id("backup");
    await store.change(a.id, "backup.request", () => null, { operationId });
    await writeFile(
      options.opsRoot + "/backup.request",
      JSON.stringify({ id: operationId, actor: a.id, at: now() }),
      { mode: 0o600 },
    );
    return { operationId };
  });
  if (git instanceof Gitea) registerGateway(app, actor, control, git);
  const webRoot = fileURLToPath(new URL("../web/dist/", import.meta.url));
  if (existsSync(webRoot)) {
    await app.register(staticFiles, {
      root: webRoot,
      prefix: "/",
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api") ||
      req.url.startsWith("/git") ||
      req.url.startsWith("/identity")
        ? reply.status(404).send({ code: "NOT_FOUND", message: "路径不存在" })
        : reply.sendFile("index.html"),
    );
  }
  app.addHook("onClose", async () => {
    await store.close();
  });
  return app;
}
export async function start() {
  const config = JSON.parse(
    readFileSync(
      process.env.DEVOPS_CONFIG || "/data/config/devops.json",
      "utf8",
    ),
  );
  const secrets = JSON.parse(
    readFileSync(config.secretsFile || "/data/secrets/devops.json", "utf8"),
  );
  const store = new MysqlStore(secrets.databaseUrl, secrets.auditKey);
  await store.init();
  const git = new Gitea(config.giteaUrl, secrets.giteaToken);
  const app = await createApp({
    store,
    git,
    origin: config.origin,
    oauth: secrets.oauth,
    opsRoot: "/data/ops",
    authState: {
      isDefaultPassword: async () => {
        const current = JSON.parse(
          await readFile(
            config.secretsFile || "/data/secrets/devops.json",
            "utf8",
          ),
        );
        return current.adminPasswordDefault === true;
      },
      markPasswordChanged: async () => {
        const path = config.secretsFile || "/data/secrets/devops.json";
        const current = JSON.parse(await readFile(path, "utf8"));
        if (current.adminPasswordDefault === false) return;
        const next = { ...current, adminPasswordDefault: false };
        await writeFile(path + ".tmp", JSON.stringify(next, null, 2), {
          mode: 0o600,
        });
        await rename(path + ".tmp", path);
      },
    },
  });
  await app.listen({ host: "127.0.0.1", port: config.port || 8081 });
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => app.close().then(() => process.exit(0)));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  start().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
