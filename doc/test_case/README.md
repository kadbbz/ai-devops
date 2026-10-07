# 测试与执行顺序

遵循根目录 agent.md：先写后端 API 用例再实现；前端实现后，依据 `doc/prd/prd.md` 写 Playwright；最后更新 HTML manual。测试适配器仅供 `NODE_ENV=test`，生产使用真实 MySQL/Gitea，没有免认证或模拟通过后门。

```sh
npm ci
npx playwright install chromium
DEVOPS_PORT=18082 PUBLIC_ORIGIN=http://localhost:18082 docker compose -p ai-native-verify up -d --build --wait
npm test
```

默认测试容器 `ai-native-verify-devops-1`，公开端口18082；环境变量 `DEVOPS_TEST_CONTAINER`/`DEVOPS_TEST_URL` 可更换测试入口，运维脚本的 backup volume 也需对应修改。不要对用户现有生产容器运行测试。旧 ai-devops-* 容器不参与测试。

- `npm run test:api`：Fastify.inject API 与领域/备份/Git 协议门禁。MySQL/Gitea 适配器使用明确的测试替身，不把它们当真实集成证据。
- `npm run test:e2e`：使用 `admin/admin` 统一登录、默认密码提示与本次忽略、创建项目/Intent、A、B 缺口阻断、审计/运维与390px窄屏。
- `npm run test:integration`：真实 MySQL/Gitea；Ed25519 委托；受保护仓库；Git gateway 合法推送与非法创建分支/主线/协议修改阻断；共享文件同步；真实 PR/merge；最终提交重新执行近端测试；发布回执契约。外部 Runner/生产发布是隔离测试执行器，不能代表用户真实生产部署。
- `npm run test:ops`：最终镜像全新空卷首次启动/首备；手动冷备；检查恰好两个 named volume 与唯一公开端口；新空卷恢复、Git fsck/refs、MySQL/HMAC 审计、旧会话/委托撤销、生产基线暂停。演练不启动 Web 或调度。临时首启卷清理；恢复卷保留供人工复核。

脚本保存结果至忽略目录 `doc/test_case/results/`。Playwright 会话存在 `.data/test/`，均不得提交。测试使用隔离实例的 `admin/admin`；若删除测试卷重建，需要移走该实例对应的 `.data/test/session.json` 后重跑。

`verification.md` 是可提交的执行摘要。升级、满盘/断电、所有热修复/未知路径等未覆盖项见 `doc/spec/implementation.md`；尚未测试不能标为通过。
