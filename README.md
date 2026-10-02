# AI DevOps P0

以项目和变更为中心的 TypeScript 工作台。实现基线：[P0 技术规格](doc/DevOps平台P0技术规格.md)。

当前支持真实会话/RBAC、MySQL 事务和任务队列、Git/Gitea 固定提交、Phoenix/TS/JS/CSS/SQL 语义变化、人工 Review/测试报告、test→prod 批准和人工部署核验，以及 JSONL 审计。

- [运行、配置、备份和恢复](doc/P0运行手册.md)
- [实现对齐与测试记录](doc/P0验收记录.md)
- [原始技术规格](doc/DevOps平台P0技术规格.md)

## 启动

从 `docker/.env.example` 复制配置到 `docker/.env`，生成不同的随机密码。Gitea 数据库密码须为至少 16 位字母、数字、下划线或连字符。首次平台管理员为 `admin`，使用 `BOOTSTRAP_PASSWORD` 登录，随后强制改密。

```sh
docker compose --env-file docker/.env -f docker/docker-compose.yml up -d --build
```

默认工作台为 http://localhost:8080，Gitea 为 http://localhost:3000。端口只绑定回环地址。HTTPS 反向代理部署须设置实际 `PUBLIC_ORIGIN` 与 `COOKIE_SECURE=true`。

## 验证

```sh
cd package
npm ci
npm test
npm run test:e2e
```

`test:api` 使用临时测试存储、实际 Git 仓库、实际测试子进程与本地 HTTP 模型契约服务。`test:e2e` 自动启动临时实例，账号只存在于该测试实例。真实 MySQL/Gitea 验证见 `test/compose-smoke.mjs`；该脚本会在本机 Compose 创建验收用户和项目，重启 app/worker，并保存去除凭证的报告。

AI 模型需另行配置；未配置会记录失败，人工流程仍可完成。Phoenix 发布保持 `manual`，不会自动调用未验证的官方发布接口。
