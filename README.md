# 序 · AI 原生 DevOps

基于新版 [spec](doc/spec/spec.md) 的 TypeScript / React / Ant Design 实现。Gitea 是统一账号和仓库服务；DevOps 是唯一 Git 入口。一个 Docker 容器包含 DevOps、Gitea、MySQL 和固定运维程序，只挂载 `data`、`backup` 两个 named volume。

## 启动

```sh
docker compose up -d --build
```

等容器健康后访问 <http://localhost:8080>。首次启动自动创建数据库、统一管理员、OAuth 和首份冷备。使用内置账号 `admin/admin` 登录；继续使用默认密码时，登录后每次都会提示修改密码，也可以选择“本次忽略”。平台仅支持用户名密码登录，不支持 Passkey/WebAuthn。首次启动需要数十秒，首次镜像构建需要下载依赖。

自定义地址在**第一次启动前**设置，例如：

```sh
DEVOPS_PORT=18082 PUBLIC_ORIGIN=http://localhost:18082 docker compose up -d --build
```

已有 data 卷保存的地址不会被环境默认值覆盖。对外使用 HTTPS 反向代理，并在首次启动设置对应 `PUBLIC_ORIGIN`。不要开放 Gitea 或 MySQL 端口。

## 操作入口

- [HTML 使用手册](doc/manual/index.html)：账号、需求、分支、版本、共享工作区和备份恢复。
- [产品路径](doc/prd/prd.md)、[实现与验收范围](doc/spec/implementation.md)。后者区分已验证能力和未完成的规格项。
- [Agent 接入约定](doc/spec/executors.md)：需求文件同步、IDE 委托和版本管理 API。
- [测试说明](doc/test_case/README.md)。

```sh
npm ci
npm run typecheck
npm run test:api
```

完整验收使用独立容器，避免触碰旧部署：

```sh
DEVOPS_PORT=18083 PUBLIC_ORIGIN=http://localhost:18083 docker compose -p ai-native-default-verify up -d --build --wait
DEVOPS_TEST_URL=http://localhost:18083 DEVOPS_TEST_CONTAINER=ai-native-default-verify-devops-1 npm test
```

`npm test` 执行构建、API、浏览器、真实 Git/MySQL/Gitea 集成及冷备恢复。依赖 Playwright Chromium（`npx playwright install chromium`）。测试在隔离项目中创建数据；恢复演练不开放端口，保留新恢复卷供复核。测试账号信息只存于忽略目录 `.data/test`，不得提交。

前端开发：`npm run dev:web`。后端生产配置来自 `/data/config/devops.json` 和 `/data/secrets/devops.json`；不提供生产内存存储或免认证演示模式。

DevOps 仅关注需求与版本管理。IDE Agent 自行编写和执行全部测试，并负责开发和发布；无需向 DevOps 请求执行任务或上报证明。需求状态可直接更新，PR 合并只校验权限、提交变化和 Git 冲突。版本是 Git 标签，不表示部署。

创建项目只需名称；仓库标识可选。导入支持任意文件后缀的 ZIP、TAR（包括 gzip/bzip2/xz 压缩），仅要求项目根目录有非空 UTF-8 `agent.md`；源码、二进制及执行位进入首次提交。

## 从 v1 升级

先在旧容器执行 `docker exec <容器名> devopsctl backup`，确认系统运维产生已完成恢复点，再重新构建并启动相同 Compose 项目。schema 2 会校验旧状态与审计链，完整归档旧状态，提取项目、需求、分支和 PR；旧会话与凭证撤销，请重新登录并委托。旧 Git 历史保持。旧备份须使用旧版本镜像恢复，不能混用。
