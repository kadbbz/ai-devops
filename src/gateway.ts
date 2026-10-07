import type { FastifyInstance, FastifyRequest } from "fastify";
import { gunzipSync } from "node:zlib";
import { spawn } from "node:child_process";
import {
  activeActor,
  type Actor,
  check,
  find,
  access,
  id,
  now,
} from "./model.js";
import { Gitea, exec } from "./git.js";
import { Control } from "./control.js";

export function parsePush(body: Buffer) {
  let offset = 0;
  const commands = [];
  while (offset + 4 <= body.length) {
    const len = parseInt(body.subarray(offset, offset + 4).toString(), 16);
    check(Number.isInteger(len), "GIT_PROTOCOL", "非法 Git 请求", 400);
    offset += 4;
    if (len === 0) break;
    check(
      len >= 4 && offset + len - 4 <= body.length,
      "GIT_PROTOCOL",
      "Git 请求截断",
      400,
    );
    const line = body.subarray(offset, offset + len - 4).toString();
    offset += len - 4;
    const [command] = line.split("\0");
    const [oldSha, newSha, ref] = command.trim().split(" ");
    check(
      /^[a-f0-9]{40}$/.test(oldSha) && /^[a-f0-9]{40}$/.test(newSha) && ref,
      "GIT_PROTOCOL",
      "非法引用",
      400,
    );
    commands.push({ oldSha, newSha, ref });
  }
  check(
    commands.length === 1,
    "GIT_MULTI_REF",
    "每次仅允许推送一个已有工作分支",
    403,
  );
  return { command: commands[0], pack: body.subarray(offset) };
}
export function registerGateway(
  app: FastifyInstance,
  actor: (req: FastifyRequest) => Promise<Actor>,
  control: Control,
  git: Gitea,
) {
  app.addContentTypeParser(
    [
      "application/x-git-receive-pack-request",
      "application/x-git-upload-pack-request",
    ],
    { parseAs: "buffer", bodyLimit: 64 * 1024 * 1024 },
    (_r, b, done) => done(null, b),
  );
  app.route({
    method: ["GET", "POST"],
    url: "/git/:project/*",
    handler: async (req, reply) => {
      let a: Actor;
      try {
        a = await actor(req);
      } catch (e) {
        reply.header("www-authenticate", 'Basic realm="DevOps Git"');
        throw e;
      }
      const key = (req.params as any).project.replace(/\.git$/, "");
      const s = await control.read();
      const p = s.projects.find((p) => p.id === key || p.slug === key);
      check(p, "NOT_FOUND", "仓库不存在", 404);
      access(a, p);
      const suffix = (req.params as any)["*"];
      check(
        ["info/refs", "git-upload-pack", "git-receive-pack"].includes(suffix),
        "GIT_PATH",
        "不支持的 Git 操作",
        403,
      );
      const service = (req.query as any).service;
      check(
        suffix !== "info/refs" ||
          ["git-upload-pack", "git-receive-pack"].includes(service),
        "GIT_SERVICE",
        "不支持的服务",
        403,
      );
      let body = req.body as Buffer | undefined;
      if (req.headers["content-encoding"] === "gzip" && body)
        body = gunzipSync(body, { maxOutputLength: 64 * 1024 * 1024 });
      const forward = async () => {
        const response = await fetch(
          `${git.base}/${git.owner}/${p.slug}.git/${suffix}${suffix === "info/refs" ? "?service=" + service : ""}`,
          {
            method: req.method,
            headers: {
              Authorization:
                "Basic " +
                Buffer.from(`${git.owner}:${git.token}`).toString("base64"),
              ...(req.headers["content-type"]
                ? { "content-type": String(req.headers["content-type"]) }
                : {}),
              ...(req.headers["git-protocol"]
                ? { "git-protocol": String(req.headers["git-protocol"]) }
                : {}),
            },
            body: req.method === "POST" ? (body as any) : undefined,
            redirect: "error",
            signal: AbortSignal.timeout(60000),
          },
        );
        reply
          .type(
            response.headers.get("content-type") || "application/octet-stream",
          )
          .status(response.status);
        return Buffer.from(await response.arrayBuffer());
      };
      if (suffix !== "git-receive-pack") {
        await control.store.change(a.id, "git.read", () => null, {
          projectId: p.id,
          method: suffix,
        });
        return forward();
      }
      return control.exclusive(async () => {
        const state = await control.read();
        activeActor(state, a);
        const project = find(state.projects, p.id);
        access(a, project, true);
        check(
          ["human", "ide_agent"].includes(a.role),
          "GIT_ROLE",
          "该身份不能推送代码",
          403,
        );
        check(
          project.status === "ACTIVE" &&
            !state.requests.some(
              (r) => r.projectId === project.id && r.status === "UNKNOWN",
            ),
          "REPOSITORY_UNKNOWN",
          "仓库有未决操作，请先核对仓库",
        );
        check(body, "GIT_PROTOCOL", "缺少 Git 数据", 400);
        const { command, pack } = parsePush(body);
        check(
          !/^0+$/.test(command.oldSha) && !/^0+$/.test(command.newSha),
          "GIT_REF_CREATION_DENIED",
          "分支创建与删除必须经过 DevOps 流程",
          403,
        );
        const branch = command.ref.replace(/^refs\/heads\//, "");
        const registered = state.branches.find(
          (b) =>
            b.projectId === project.id &&
            b.name === branch &&
            b.status === "ACTIVE",
        );
        check(
          command.ref === "refs/heads/" + branch &&
            registered &&
            !["main", "devops/control"].includes(branch),
          "GIT_BRANCH_DENIED",
          "只能推送 DevOps 创建的工作分支",
          403,
        );
        check(
          (await git.head(project, branch)) === command.oldSha,
          "HEAD_MOVED",
          "工作分支已变化",
        );
        await git.withRepo(project, async (cwd) => {
          if (pack.length) {
            check(
              pack.subarray(0, 4).toString() === "PACK",
              "GIT_PACK",
              "非法 pack",
              400,
            );
            await new Promise<void>((resolve, reject) => {
              const proc = spawn(
                "git",
                ["index-pack", "--stdin", "--fix-thin"],
                {
                  cwd,
                  env: git.env(),
                  stdio: ["pipe", "ignore", "ignore"],
                  timeout: 30000,
                },
              );
              proc.once("error", reject);
              proc.once("exit", (code) =>
                code === 0 ? resolve() : reject(new Error("Git pack 校验失败")),
              );
              proc.stdin.on("error", reject);
              proc.stdin.end(pack);
            });
          }
          try {
            await exec(
              "git",
              ["merge-base", "--is-ancestor", command.oldSha, command.newSha],
              { cwd, env: git.env(), timeout: 10000 },
            );
          } catch {
            check(false, "GIT_FORCE_PUSH", "禁止强推", 403);
          }
          const files = (
            await exec(
              "git",
              ["diff", "--name-only", "-z", command.oldSha, command.newSha],
              { cwd, env: git.env(), timeout: 10000, maxBuffer: 1024 * 1024 },
            )
          ).stdout
            .split("\0")
            .filter(Boolean);
          check(files.length > 0, "EMPTY_PUSH", "没有文件变化");
          for (const file of files)
            check(
              !file
                .split("/")
                .some((p) => [".git", ".devops"].includes(p.toLowerCase())),
              "GIT_PATH_DENIED",
              "通信目录不能提交到业务分支",
              403,
            );
          const tree = (
            await exec(
              "git",
              ["diff", "--raw", command.oldSha, command.newSha],
              { cwd, env: git.env(), timeout: 10000 },
            )
          ).stdout;
          check(
            !/120000|160000/.test(tree),
            "GIT_SPECIAL_FILE",
            "首期禁止新增符号链接或子模块",
            403,
          );
        });
        const op = {
          id: id("git"),
          projectId: p.id,
          action: "git.push",
          recovery: { operation: "git.push", branch, ...command },
          status: "RUNNING",
          payload: command,
          actor: a.id,
          createdAt: now(),
        };
        state.requests.push(op);
        await control.save(state, a, "git.push.started", {
          projectId: p.id,
          operationId: op.id,
        });
        try {
          const response = await forward();
          const actual = await git.head(project, branch);
          check(
            actual === command.newSha,
            "GIT_RESULT_UNKNOWN",
            "Git 推送结果待对账",
            503,
          );
          op.status = "SUCCEEDED";
          await control.save(state, a, "git.push.completed", {
            projectId: p.id,
            operationId: op.id,
            oldSha: command.oldSha,
            newSha: actual,
          });
          return response;
        } catch (e) {
          op.status = "UNKNOWN";
          await control.save(state, a, "git.push.unknown", {
            projectId: p.id,
            operationId: op.id,
          });
          throw e;
        }
      });
    },
  });
}
