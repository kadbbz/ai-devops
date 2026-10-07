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

- [HTML 使用手册](doc/manual/index.html)：账号、目标、三道 Gate、共享工作区、备份恢复。
- [产品路径](doc/prd/prd.md)、[实现与验收范围](doc/spec/implementation.md)。后者区分已验证能力和未完成的规格项。
- [执行端接口约定](doc/spec/executors.md)：IDE 控制面与 Runner 的签名回执。
- [测试说明](doc/test_case/README.md)。

```sh
npm ci
npm run typecheck
npm run test:api
```

完整验收使用独立容器，避免触碰旧部署：

```sh
DEVOPS_PORT=18082 PUBLIC_ORIGIN=http://localhost:18082 docker compose -p ai-native-verify up -d --build --wait
npm test
```

`npm test` 执行构建、API、浏览器、真实 Git/MySQL/Gitea 集成及冷备恢复。依赖 Playwright Chromium（`npx playwright install chromium`）。测试在隔离项目中创建数据；恢复演练不开放端口，保留新恢复卷供复核。测试账号信息只存于忽略目录 `.data/test`，不得提交。

前端开发：`npm run dev:web`。后端生产配置来自 `/data/config/devops.json` 和 `/data/secrets/devops.json`；不提供生产内存存储或免认证演示模式。

平台不会编译、测试或部署用户项目。项目的真实 IDE 控制面、隔离 Runner、制品库和生产环境需要按接口约定接入；未收到真实证据时 B/C 不会放行。
