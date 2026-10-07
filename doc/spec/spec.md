# DevOps：需求与版本管理规格

修订：2026-10-07。以用户最新边界为准，取代此前的 Gate / Runner / 构建 / 发布控制设计。历史方法论保留为参考，不再作为产品执行边界。

## 1. 职责

DevOps 管理项目、需求、Git 分支、PR 合并、版本标签、账号授权和审计。IDE agent 自行完成代码、全部测试的编写与执行及发布；DevOps 不调度、领取、校验或接收这些执行任务和证明。没有审批、会签或测试通过后才可合并的流程。权限校验、Git 冲突检测和审计属于版本管理的正常约束。

Git 的唯一远端入口仍为 DevOps。IDE 使用统一账号委托的短时项目凭证 clone/fetch/push；远端分支创建、删除、PR 合并和版本标签只能通过 DevOps API/UI 完成。受保护 main 和 devops/control 不接受 Git 网关直推；工作分支只接受快进，允许修改代码、测试、文档和 agent.md。禁止提交 .git 与 .devops 通信投影。分支、需求和版本均不依赖任何测试或发布状态。

## 2. 数据与接口

- 技能：平台技能库中的可复用技能包。每个技能必须包含非空 UTF-8 `SKILL.md`，保留包内文本、二进制、隐藏文件和执行位；技能由平台管理员维护，模板只能引用已存在的技能。
- 模板：名称、唯一标识、`agentMd`、技能 ID 清单、修订号和修改时间。模板必须包含非空 `agent.md` 内容和当前项目技能清单。内置默认模板始终可用；管理员可创建、编辑和删除自定义模板，已被项目使用的模板不能删除。
- 项目：名称、唯一仓库标识、成员、创建时间、模板和技能快照。创建仅要求名称，可选择项目模板；仓库标识可自动生成。初始提交来自模板，写入 `agent.md`、`skill/manifest.json` 和每个选中技能的 `skill/<技能标识>/` 目录。只建立 main 和 devops/control，不自动建立 production 分支。
- 需求：标题、正文、类型（feature/defect/change）、优先级（low/normal/high）、状态（OPEN/IN_PROGRESS/DONE/CANCELLED）、修订号和修改时间。状态是记录，IDE agent 与有写权限的人均可更新，无审批。更新必须携带当前 revision，冲突返回 409。
- 分支：名称、关联需求（可选）、创建基线、状态。创建需固定 baseSha；删除需固定 headSha；禁止删除 main/control，有未合并 PR 的分支不可删除。
- PR：源分支、目标 main、关联需求、说明、状态。查看真实差异；合并只检查 headSha/targetSha 是否仍然一致、Git 是否存在冲突和主线保护。main 仅禁止直接推送，不启用“工作分支必须最新”等额外合并门禁。无冲突才执行合并；有冲突时由 DevOps Agent 生成文件、左右提交内容和差异说明，人类逐项选择左侧 main 或右侧工作分支，DevOps 只记录选择，不执行合并，IDE Agent 根据选择解决后重新推送。冲突选择不会改变 PR 状态，也不自动把需求标为完成。
- 版本：不可变的版本标签、精确提交 SHA、变更说明、需求集合。SHA 必须在 main 历史中。创建实际 Git tag；无部署环境、发布状态或健康回执。
- 凭证：1–24 小时有效，human/ide_agent/devops_agent；人类有 owner/member/observer 项目角色。owner 管理成员和所有版本操作；member 管理需求、工作分支、PR 和版本；observer 只读。IDE agent 可按委托做需求、分支、PR、合并及版本管理；DevOps agent 仅维护需求。两者均不能改成员或签发凭证。委托永不高于委托人的当前项目权限。

写入口 `POST /api/actions/:action`，需登录或项目委托、CSRF（会话）、Origin、Idempotency-Key。动作：project.create/import/update/member、skill.create/update/delete、template.create/update/delete、user.create/update、requirement.create/update、branch.create/delete、pr.create/merge/conflict.choice、version.create、credential.create/revoke、workspace.sync。技能和模板管理仅平台管理员可写。旧 gate.*、tests.*、build.*、release.*、production.*、operation.claim 等动作返回 404，不登记任务。

读取：`/api/session`、`/api/workspace`（项目、技能库元数据和模板）、`/api/projects/:id/repository`（实际分支和版本）、`/api/projects/:id/workspace`（文件投影）、`/api/pulls/:id`（实时 PR、差异和冲突左右内容）、`/api/audit`、`/api/ops`。技能包正文只在创建或替换时上传并写入权威状态，工作区列表不返回技能包二进制。只向项目成员暴露相应对象，平台管理员未加入项目也不能读取项目正文。

外部 Git 操作先写入 RUNNING 请求和审计，成功后持久化结果；结果未知时请求标为 UNKNOWN，同键不重复执行。提供 `repository.reconcile` 读取实际分支/PR/tag 并完成对账，禁止盲目重放。初始化中断但首次提交已存在时，对账可补齐控制分支与保护，不重复导入。对账只针对 Git，不涉及 IDE 执行侧。

## 3. 项目导入

导入是一次初始代码快照：接受 ZIP、TAR 及 gzip/bzip2/xz 压缩 TAR，按内容识别，与文件后缀无关。支持文件直接位于包根和单层仓库名目录包装。项目导入检查项目根 `agent.md` 是非空 UTF-8 文本；技能包检查根 `SKILL.md` 是非空 UTF-8 文本。二者均不要求测试框架、目录、配置或脚本，也不执行包内程序。项目导入保留原始 agent.md、二进制文件、可执行位及隐藏项目文件；技能在模板物化时复制到 `skill/<技能标识>/`。忽略 .git、.devops 和 macOS 元数据，不导入历史凭证/运行投影。

上传最多 32 MiB，展开最多 256 MiB、10000 个条目、单文件最多 32 MiB。先校验完整清单，再限量读取；拒绝绝对路径、..、重复路径、大小写冲突、符号/硬链接和特殊设备文件。不执行系统解压覆盖命令。失败不创建空仓库；验证成功后由 DevOps 写入首次提交再启用分支保护。原文件名、压缩包摘要和文件数进入审计，原压缩包及凭证不入数据库。

## 4. 共享工作区

人和两端 agent 共用 Git 文件、根 agent.md 和 .devops 文件夹。DevOps 发布需求只读投影 `inbox/requirements/<id>.json`、state.json 和请求回执；客户端上传 `outbox/<requestId>.json`，严格允许 requirement.create/update，版本操作调用专用 API。同步不分发测试、构建或发布命令。回执写入同仓 devops/control，投影不改变业务提交。凭证来自进程环境，文件不提供身份。只读投影被修改时保留本地内容并提示，不静默覆盖。

## 5. UI

紫色卡片、中文、独立页面。主导航：需求、分支与合并、版本、项目与授权、审计；管理员额外看系统运维、技能库和项目模板。技能库页面支持上传包含 `SKILL.md` 的技能包、编辑说明和替换内容；模板页面支持编辑 `agent.md` 与技能清单。创建项目时选择模板，页面明确模板将生成的文件；导入页继续选择压缩包和确认项目名。所有空状态真实展示，无 Gate、审批、Runner、测试或发布任务表单。

## 6. 身份、存储与部署

保留 Gitea 唯一身份源、用户名密码登录、admin/admin 初始账号和每次登录默认密码提示（本次可忽略）。DevOps、Gitea、MySQL 打包单 Docker，仅 data 和 backup 两个 named volume；数据库/Gitea 不公开端口，固定冷备和同版本新空卷恢复继续保留。平台自身的备份维护不属于用户项目执行侧。

schema 3 保留账号、项目、需求文字、技能库、项目模板和业务 Git 仓库；旧 schema 1 先验 HMAC，完整快照存只读 legacy_archive，再在事务中转换项目/需求/已知分支和 PR，撤销旧机器委托与会话。schema 2 升级时补充空技能库和模板表。旧执行状态不迁入新工作台，既有 Git 历史不删除。升级前先使用旧镜像备份 data。恢复撤销会话与委托，仅对未决 Git 请求标记 UNKNOWN。

## 7. 验收路径

1. 管理员上传技能包并创建项目模板；模板包含 agent.md 和技能清单。
2. 选择模板只填名称建项目，检查初始仓库的 agent.md、skill/manifest.json 与技能目录；导入任意后缀的真实 ZIP，保留包内文件及 agent.md。
3. 写需求，直接创建关联分支，无签发；IDE 委托写需求、推代码和 API/E2E 脚本不受角色文件路径限制。
4. 创建 PR，审真实 diff；无冲突直接合并，不提交测试证明也可合并。有冲突时列出 DevOps Agent 差异，人类选择左右版本但不合并，IDE Agent 解决后重新推送。漂移、越权拒绝。
5. 从 main 创建实际 tag 和需求关联；没有发布任务或状态。
6. 所有旧执行/审批动作被拒绝；共享文件也不能重新激活它们。
7. 本产品自身的 API/E2E/集成测试仍按 agent.md 执行，不属于替用户项目运行测试。
