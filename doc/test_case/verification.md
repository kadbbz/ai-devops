# 首版实现验证记录

验证日期：2026-10-06，Asia/Shanghai。结果对应本次工作区中的实现；没有创建提交或发布镜像。目标规格的全部验收尚未完成，范围以 [实现与验收范围](../spec/implementation.md) 为准。

## 环境与版本

- 隔离实例：`ai-native-default-verify-devops-1`，`http://localhost:18083`；旧 `ai-devops-*` 部署未参与测试。
- Docker Engine 29.5.3，ARM64；宿主 Node 24.14.0。未验证 AMD64 镜像运行。
- 最终镜像 `ai-native-devops:local`，已核对运行容器使用同一镜像；镜像摘要随每次构建变化，不作为功能验收依据。
- 容器 Node 22.20.0、MySQL 8.4.6、Gitea 1.24.6、s6-overlay 3.2.0.2。Node/MySQL/Gitea 基础镜像固定 digest；s6 下载固定版本，尚未额外校验下载文件摘要。
- 前端 React 19.1.1、Ant Design 5.27.4；浏览器测试 Playwright 1.58.2 / Chromium。

## 已执行的验证

| 检查 | 结果与证据范围 |
| --- | --- |
| `npm run typecheck` | 通过，后端和前端 TypeScript 检查 |
| 镜像构建 | 通过，容器健康；内置真实 MySQL / Gitea / DevOps |
| `npm run test:api` | 20/20 通过；认证、默认密码提示/忽略、CSRF、角色边界、A/B/C、批准失效、签名、恢复状态、跨项目拒绝、并发会话保存、备份与 Git 协议规则。使用测试数据库/Gitea 适配器，不能代替真实集成 |
| `npm run test:e2e` | 3/3 通过；`admin/admin` 登录、默认密码提示、本次忽略、项目/Intent/A、B 证据缺口阻断、审计/运维、390px 窄屏 |
| `npm run test:integration` | 通过；真实 MySQL/Gitea、Git 网关、分支权限、同仓文件归档、真实 PR/合并、最终 SHA 重验、签名回执与关闭。外部执行端为测试模拟器，详见下文 |
| `npm run test:ops` | 通过；最终镜像全新空卷首启/首备、手动冷备、新空卷恢复、Git/MySQL 完整性、撤销旧凭证、隔离恢复不启动业务 API |
| `npm audit --omit=dev` | 0 个已报告漏洞；这不是容器 OS/Gitea 镜像漏洞扫描结论 |
| 人工视觉检查 | 桌面、390px 手机和 HTML manual 截图已检查；紫色卡片、独立页面，无横向溢出。未执行完整无障碍审计 |
| `git diff --check` | 通过；临时凭证、会话、测试结果已由 `.gitignore` 排除 |

执行顺序及重跑命令见 [测试说明](README.md)。未把设计文档中的路径模拟记为测试通过。

## 真实 Git 与共享工作区路径

记录时间 `2026-10-06T03:34:31.136Z`，结果文件 [integration.json](results/integration.json)。该文件位于本地忽略目录，新的 checkout 需重跑才能生成。

1. 同一人类身份创建项目和 Intent，提交方案，由人类签 Gate A；DevOps 创建工作分支与快照。
2. 从 DevOps 网关 clone；在允许范围推送代码。直接创建远程分支、推送 main、改写锁定的 `agent.md` 均被拒绝。
3. CLI 初始化 `.devops` 排除规则，上传 outbox；重复请求保持幂等。同仓 `devops/control` 中的归档回执与下载回执一致，业务源码 SHA 不被通信文件改变。
4. `build.request` 创建固定操作，执行器领取后回传 Ed25519 签名构建证明；API/E2E 回执绑定原操作和输入指纹。缺少证据不能通过 B。
5. B 创建真实 Gitea PR，人类在 DevOps 合并。重新 fetch 并 checkout 最终组合 SHA，重新执行测试及登记证据，准备系统方案后签 C。
6. 测试中的外部发布执行器写入隔离版本文件，再登记精确 SHA/制品/环境/健康回执；平台核对后关闭交付。还验证了授权撤销、身份代理白名单和审计链。

验收用用户项目最终 SHA：`cbe2aa869846f1fe20c1402237a4255e7820f516`。这是测试仓库的组合提交，**不是本平台源码提交号**。

执行器/Runner 的签名、操作领取和回执验证是真实执行的接口检查；其中构建、制品及生产发布由受控测试程序模拟，未部署任何用户生产服务。真实 IDE 控制面、制品库、隔离 Runner 和生产环境仍需按 [执行器接口](../spec/executors.md) 接入。

## 单容器、冷备与恢复

最新运维复跑于北京时间 11:41 完成：

- [firstboot.json](results/firstboot.json)：`2026-10-06T03:41:24.935Z`。最终镜像在两个全新空 named volume 上自动生成账号、数据库、OAuth 配置和首备，状态 `READY`，默认备份计划 `Asia/Shanghai 03:00`。
- [restore.json](results/restore.json)：`2026-10-06T03:41:50.104Z`。手动冷备 ID `bk_8db2d3e6f2b24ff09dc225c4504707fa`，归档 SHA-256 `2a0c3d2893c1c0c37e9f09ecddd9f4f3e5a45e199ec5c3e2c82c3a3abba97e59`。
- Docker inspect 确认仅 `/data`、`/backup` 两个挂载，运行实例仅发布 `8080/tcp`；没有 MySQL/Gitea 对外端口或额外匿名数据卷。
- 使用同版本镜像将归档恢复到新空卷；归档摘要、安全路径、MySQL 数据和 HMAC 审计链、Git `fsck` / refs 校验通过。
- 恢复后保留 7 个项目、6 个 Intent 和 2 个已关闭交付；旧会话 0、有效委托 0、已确认生产基线 0。外部状态需要重新对账，历史关闭记录未被改写。
- 恢复演练实际检查：进程管理状态没有 Web 服务，连接 `127.0.0.1:8081` 被拒绝，维护入口访问 `/api/session` 返回 503。并非把测试报告中的布尔常量当作停用证明。演练容器未映射宿主端口，代码在演练模式下不启动调度器。
- 首启临时卷已清理；恢复演练容器已移除，恢复数据卷保留以供人工复核。主验收容器保持健康运行。

## 未完成项

尚不能宣称完整 spec 或生产交付验收通过：跨版本升级/迁移、恢复报告导回主实例、生产热修复同步、高风险双人会签、多 PR 漂移和全部 UNKNOWN/满盘/中断/停机补跑路径仍需实现或扩大真实验证。每日调度规则已有测试，未等待真实时钟至凌晨做长时间运行验证。

规范化数据库外键、独立 Git blob/修订索引、大日志存储、IDE 自动工作树/持续同步和真实生产执行端接入也未完成。更多实现边界见 [实现范围](../spec/implementation.md)。

截图位于本地忽略目录：[桌面](results/desktop.png)、[手机](results/mobile.png)、[使用手册](results/manual.png)。可阅读的操作说明见 [HTML manual](../manual/index.html)。
