# 验证需求与版本管理

依据 `agent.md`：先编写后端 API 测试并执行 RED，再实现并验证；前端实现后依据 PRD 编写浏览器脚本；更新 HTML 手册。测试针对本产品自身，DevOps 不负责运行用户项目测试。

- `npm run typecheck`：后端与前端 TypeScript。
- `npm run test:api`：无审批合并与版本、需求修订、项目权限、委托撤销、旧接口关闭、文件协议、未知 Git 结果对账、安全压缩包导入、默认密码、备份规则和迁移；冲突时验证左右差异报告、选择记录和不调用 Git merge。
- `npm run test:e2e`：真实统一登录、名称建项目、需求直接改状态、关联分支、版本标签、委托、运维与窄屏。
- `npm run test:integration`：真实 Gitea/MySQL、任意后缀压缩包、二进制和可执行位、Git HTTP clone/push、IDE 修改测试与 agent.md、拒绝绕过分支/主线/tag、无审批直接合并、不可变标签、CLI 同步和审计。
- `npm run test:ops`：全新双卷一次启动、自动首备、手动冷备、全新空卷恢复、撤销会话和委托、需求/版本保留、隔离演练不启动 Web。

```sh
DEVOPS_PORT=18083 PUBLIC_ORIGIN=http://localhost:18083 docker compose -p ai-native-default-verify up -d --build --wait
DEVOPS_TEST_URL=http://localhost:18083 npm run test:e2e
DEVOPS_TEST_URL=http://localhost:18083 npm run test:integration
DEVOPS_TEST_CONTAINER=ai-native-default-verify-devops-1 npm run test:ops
```

浏览器测试保存忽略目录 `.data/test/session.json`，集成测试复用同一登录。恢复测试从目标容器解析 backup 卷名，建立独立空 data 卷，不接触其他部署。结果存 `doc/test_case/results`，最终摘要见 `verification.md`。
