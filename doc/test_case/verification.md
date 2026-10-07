# 需求与版本管理验证记录

验证日期：2026-10-07，Asia/Shanghai。对应 schema 2、应用 2.0.0；以最新 [spec](../spec/spec.md) 为准。旧 Gate/Runner/执行控制不属于当前产品。

## 已完成

| 检查 | 结果与范围 |
| --- | --- |
| TypeScript 与构建 | `npm run typecheck`、宿主构建和最终 Docker 构建通过 |
| API | 20/20；需求直接修改、修订冲突、无审批合并/标签、角色与项目边界、委托撤销、旧执行接口关闭、共享文件、未知 Git 结果对账、安全导入、默认密码、迁移与备份规则 |
| 浏览器 | 3/3；真实 admin/admin 登录与默认密码提示、简化建项目、直接修改需求状态、关联分支、版本、委托、运维/审计、390px 窄屏 |
| 真实集成 | Gitea/MySQL、无关后缀压缩包、二进制和执行位、Git 网关、IDE 修改 agent.md 与 API/E2E 文件、需求 CLI、无需审批或执行证明的 PR 合并、真实标签、凭证撤销及审计 |
| 运维 | 最终镜像全新双卷一次启动、自动首备、手动冷备、新空卷恢复、Git/HMAC/数据库校验、需求/版本/标签保留、恢复演练不开放 Web |
| 视觉与手册 | 已查看桌面、手机、HTML 手册截图；手机页面与手册均无横向溢出 |
| 差异检查 | `git diff --check` 通过；源码无旧 Gate、Runner、执行动作实现；会话、凭证明文和测试产物均位于忽略目录 |

测试先暴露旧接口与模型不匹配，再按 `agent.md` 实现后端；前端完成后按 PRD 编写浏览器脚本。真实测试还复现并修复 Gitea 首次推送后的异步索引时序，以及排队请求使用已撤销委托的问题。

## 当前运行与迁移

- 当前实例：`ai-native-default-verify-devops-1`，<http://localhost:18083>，健康状态正常。旧 18082 与其他 ai-devops 实例未参与升级。
- 运行镜像与最终 `ai-native-devops:local` 相同：`sha256:0e3040d643b77e413ae28c6546df915c7ceab779cc21b73aad6a514af337a152`。
- ARM64，容器 Node 22.20.0 / MySQL 8.4.6 / Gitea 1.24.6，Playwright Chromium。未验证 AMD64 运行。
- 升级前在旧容器创建 v1 冷备 `bk_65ea4894fcf34d80a09b476b9894a33b`；旧源码快照存本地忽略目录 `.data/upgrade/source-before-v2.tar.gz`，可用于重建旧版本镜像。旧备份必须使用匹配的旧镜像恢复。
- 原有 6 个项目、6 条需求文字完成迁移，保留业务 Git 历史；审计包含 `schema.requirements_versions`。旧状态完整归档到 legacy_archive，旧会话与委托清空。验收另行创建项目，最终数量包含这些测试数据。

## 真实路径证据

[integration.json](results/integration.json)，`2026-10-07T02:17:17.112Z`：

1. 导入自定义后缀 ZIP，将原始 agent.md、二进制、隐藏文件、可执行脚本写入真实仓库。
2. IDE 委托创建需求分支，clone 经 DevOps Git 网关；在本地编写并运行样例测试，推送 API/E2E 文件及 agent.md。
3. DevOps Agent 可维护需求但不能推代码；直接创建远端分支、推 main 和推 tag 被拒绝。
4. CLI outbox 更新需求，重复同步幂等；本地回执与同仓 devops/control 归档一致。
5. 不上报测试证明，直接创建 PR、查看真实 diff、合并和创建不可变标签。错误 SHA 拒绝，合并不会自动完成需求。
6. 旧测试/审批/发布接口返回 404，撤销委托立即失效，Gitea 原始写入口不公开。

## 冷备与恢复证据

- [firstboot.json](results/firstboot.json)，`2026-10-07T02:17:34.673Z`：全新 data/backup 自动初始化全部服务、账号、OAuth 与首备，状态 READY。
- [restore.json](results/restore.json)，`2026-10-07T02:17:53.861Z`：冷备 `bk_5dc13a39964a4862bcb2a5dbf25c56fb` 恢复到新空卷。保留 13 个项目、11 条需求、4 个版本；有效委托与会话均为 0。
- 校验 Git fsck、分支与标签清单、数据库和 HMAC 审计链。仅两个 named volume，仅公开 DevOps 端口。
- 隔离恢复演练没有 Web 服务，8081 未监听，维护入口返回 503。首次启动临时卷已清理，恢复演练数据卷保留供复核。

本地测试结果与截图均在忽略目录，新的 checkout 需按 [测试说明](README.md) 重跑。未执行长时间凌晨调度等待或完整容灾故障矩阵；定时计算有 API 测试，真实冷备与新卷恢复已验证。Vite 仍提示主包体积较大，不影响构建通过。IDE 的实际业务发布环境不属于 DevOps 的执行范围。
