# AI 辅助 DevOps 平台 P0 技术规格

版本：v0.1  
状态：P0 实现基线，供技术拆分、接口评审和原型实现使用  
适用团队：2–3 人项目团队，企业定制化软件交付  
日期：2026-10-02（Asia/Shanghai）

本文把[AI 辅助 DevOps 平台设计方案](./AI辅助DevOps平台设计方案.md)收敛为一个可以实现、部署和验收的 P0 规格。研究依据仍以[研究依据与引用台账](./研究依据与引用台账.md)中的 `[P26]`、`[U1]` 和示例工程证据为准；这里新增的容器、技术栈、角色模型、数据模型和接口均为本项目设计决策，不归因于 Gartner。

## 1. P0 目标与边界

### 1.1 目标

P0 交付一个以项目为边界、以变更为工作单元的可追溯工作台，完成下面一条闭环：

```text
创建项目 → 组装项目模板 → AI 澄清需求 → AI 形成设计和影响分析
→ 外部 AI 开发平台开发 → Git PR → AI Review / 测试影响分析
→ 人工审查与合并 → 生成候选版本 → test / prod 人工发布
→ 版本核验、审计查询和反馈
```

AI agent 出现在每个环节，但 P0 的执行边界是“AI 生成建议和结构化材料，人确认高影响动作”。平台不把自然语言回复当成完成证据。

### 1.2 P0 必须支持

| 类别 | P0 范围 |
| --- | --- |
| 项目 | 项目、应用、客户/业务域、仓库、主分支、环境、成员和项目模板实例 |
| 变更 | 需求、缺陷、改进；用户故事、验收标准、NFR、设计版本、阻塞和时间线 |
| 外部开发 | 生成版本化上下文包；关联 Git 分支、提交、PR；不内置 IDE |
| AI | 需求澄清、设计/影响分析、开发交接、代码 Review、测试生成与影响分析、发布影响分析、配置模板和运行手册、发布后监视摘要/RCA 建议 |
| 代码与资源 | 自动匹配 Phoenix DSL、JavaScript/TypeScript、CSS、SQL；展示语义差异和原始 diff |
| 发布 | 一个候选制品，多环境部署记录；P0 支持 test、prod；人工执行或适配器执行均须回传证据 |
| 权限 | RBAC；平台管理员、平台审计员、平台安全管理员；项目负责人、项目成员、项目干系人（只读） |
| 审计 | JSON Lines 审计日志写入 named volume 中的日志文件；按时间、人员、项目、动作、结果和关联 ID 查询 |
| 部署 | Docker Compose 单机部署；平台应用、MySQL、Git 服务分别为容器；文件持久化使用 named volume |

### 1.3 明确不做

- 内置 IDE、代码编辑器或代码托管协议实现；源码管理使用 Git 服务容器。
- 自研基础模型、模型训练、通用 agent 市场和可视化 agent 编排器。
- 自动合并、自动生产发布、自动应用漏洞修复、自动事件响应。
- 多租户 SaaS、复杂组织/工时/绩效、完整测试管理系统、CMDB、Kubernetes 管理平台。
- P0 之外的应用形态专用自动化。管理、分析、现场、供应链和客户服务形态先以 NFR 清单和模板字段表达。

## 2. 产品与 UX 规格

### 2.1 信息架构

采用“全局工作区 + 项目工作区”两级结构。Ant Design 的 Layout、Menu、Tabs、Table、Drawer、Timeline、Tag、Alert 和 Result 为基础组件，避免为 P0 自建组件库。

```text
全局
├── 项目
├── 我的待办
├── 全局审计（平台审计员 / 授权管理员）
└── 平台设置（平台管理员 / 平台安全管理员）

项目
├── 概览
├── 变更
│   ├── 看板 / 列表
│   └── 变更详情
├── 代码与 Review
├── 测试与证据
├── 发布与环境
├── AI 运行
├── 项目审计
└── 项目设置
    ├── 基础信息与模板
    ├── 成员与项目角色
    ├── 仓库与适配器
    └── AI 策略与环境
```

### 2.2 现代化 UX 方向

UX 面向每天重复操作的 2–3 人团队，优先可扫描、可回溯和低误操作，而不是大面积装饰。

- **壳层**：左侧项目导航固定宽度 224px；顶部显示项目、环境和当前用户；右侧为可收起的 AI agent 面板；正文使用 12 列栅格。
- **首屏**：项目概览只放“需要我决定的事项、正在进行的变更、环境版本、证据缺口”四组信息；每个状态可跳到原始记录。
- **变更详情**：顶部为状态和下一步，中部使用 `目标与验收 / 设计与影响 / 开发与 PR / 测试与审查 / 发布` 五个 Tab，底部保留不可编辑的事件时间线。
- **AI 面板**：显示 agent 名称、输入版本、输出摘要、依据、风险、待确认项和可执行动作；动作按钮区分“应用到草稿”“生成新版本”“仅查看”。
- **变化可视化**：默认显示语义变化图，原始 diff 折叠；使用颜色和图例区分新增、删除、修改、未知依赖，不能只显示一面巨大的代码 diff。
- **误操作控制**：生产发布、角色变更、敏感数据出站、模板覆盖和删除均使用二次确认；确认框必须显示对象、版本、环境、执行人和恢复方式。
- **新团队引导**：创建项目时使用向导、默认值和示例；现有团队接入时使用扫描、diff 和“新增/合并/跳过”；熟练团队可用快捷创建，但不能跳过安全与生产确认。
- **状态表达**：区分“AI 建议”“人工确认”“执行中”“已核验”“失败”“证据缺失”，禁止用绿色总进度替代关键失败信息。
- **视觉基线**：浅色中性背景、白色内容面、低圆角（4–8px）、高对比状态色；主色采用墨绿/蓝绿色，风险使用橙色，失败使用红色，信息使用蓝灰色。支持窄屏，表格在 1200px 以下切换为可横向滚动的密度模式。

### 2.3 P0 页面验收

| 页面 | 必须能完成的操作 | 关键反馈 |
| --- | --- | --- |
| 项目列表 | 创建项目、选择模板、查看待办 | 模板版本、负责人、环境状态、未处理风险 |
| 项目概览 | 进入变更、发布和证据缺口 | 每张卡片有对象 ID 和来源链接 |
| 变更详情 | 编辑需求、确认设计、生成上下文、查看 AI 结果 | 版本差异、确认人、过期证据提示 |
| 变化可视化 | 按技术栈查看资源/逻辑/接口/数据/配置变化 | 语义节点、关系、风险和未知依赖 |
| Review | 触发 AI Review、查看 findings、人工处置 | 文件/资源定位、证据、严重级别、处理状态 |
| 测试与证据 | 生成用例、启动登记的测试、上传人工报告 | 通过/失败/未执行/人工提供明确分开 |
| 发布与环境 | 生成候选、预检、人工发布、回传核验 | 制品摘要、环境版本、批准是否失效 |
| 审计查询 | 按条件检索和导出授权范围的日志 | 查询条件、结果页、文件来源、关联操作 |
| 角色管理 | 分配平台角色和项目角色 | 授权范围、操作者、前后差异、审计 ID |

## 3. 角色、RBAC 与三员管理

### 3.1 角色范围

平台角色是全局角色；项目角色只在绑定的项目内生效。权限采用“默认拒绝、显式授权、最小权限”；平台角色不能自动获得项目业务读权限，除非该角色的权限矩阵明确列出或另有合规授权。

| 角色 | 范围 | 核心职责 | 明确禁止 |
| --- | --- | --- | --- |
| 平台管理员 `platform_admin` | 全局 | 用户生命周期、平台连接、创建项目、指定项目负责人、平台运行配置 | 修改/删除审计日志；绕过安全策略直接批准生产动作 |
| 平台审计员 `platform_auditor` | 全局只读 | 查询和导出平台/项目审计日志、查看证据和审批链 | 改数据、执行 AI agent、发布、分配角色 |
| 平台安全管理员 `platform_security_admin` | 全局安全域 | AI 出站策略、敏感信息规则、凭证引用策略、风险策略、强制审查规则 | 分配平台角色；修改审计日志；代替项目负责人批准业务发布 |
| 项目负责人 `project_owner` | 绑定项目 | 维护项目、指定成员/干系人、确认需求/设计、批准合并和生产发布 | 指定项目负责人；分配平台角色；修改审计日志 |
| 项目成员 `project_member` | 绑定项目 | 创建和处理变更、外部开发、提 PR、触发测试、提交发布建议 | 管理项目负责人；修改项目安全基线；独自批准自己的生产发布 |
| 项目干系人 `project_stakeholder` | 绑定项目，只读 | 查看项目、变更、证据、发布和时间线 | 写入、确认、执行、导出超出授权范围的日志 |

“三员”指平台管理员、平台审计员、平台安全管理员的职责分离。三员不是三个新增岗位，2–3 人团队可以由不同成员兼任，但系统仍保留互斥的操作边界和完整审计。

### 3.2 角色分配规则

1. 平台管理员创建项目，并且只能由平台管理员指定项目负责人。
2. 项目负责人只能在自己的项目内指定或撤销项目成员、项目干系人。
3. 项目负责人不能把自己或他人提升为平台角色，也不能转移项目负责人权限。
4. 项目负责人变更由平台管理员执行；变更前后人员和原因写入审计日志。
5. 平台审计员和平台安全管理员由平台管理员授予；平台管理员不得删除审计日志或关闭审计记录。
6. 最后一名项目负责人不能被撤销，除非平台管理员在同一事务中指定新的负责人。
7. 同一用户可同时拥有一个平台角色和多个项目角色，授权计算以资源范围为准；拒绝规则优先于普通允许规则。

### 3.3 P0 权限矩阵

符号：`管理` 可新增/修改/删除；`执行` 可触发受控动作；`确认` 可形成正式批准；`读` 可查看；`—` 无权。

| 资源/动作 | 平台管理员 | 审计员 | 安全管理员 | 项目负责人 | 项目成员 | 干系人 |
| --- | --- | --- | --- | --- | --- | --- |
| 用户与平台角色 | 管理 | 读 | 读 | — | — | — |
| 项目创建 | 管理 | 读 | 读 | — | — | — |
| 项目负责人指定 | 管理 | 读 | 读 | — | — | — |
| 项目配置/模板实例 | 管理 | 读 | 读安全字段 | 管理 | 读 | 读 |
| 项目成员/干系人 | 管理 | 读 | — | 管理 | 读 | 读 |
| 需求、设计、验收 | 读/管理 | 读 | 读风险 | 确认/管理 | 管理 | 读 |
| 分支、PR、Review | 读 | 读 | 读风险 | 确认 | 执行/管理 | 读 |
| 测试任务与证据 | 读 | 读 | 读安全结果 | 确认 | 执行/管理 | 读 |
| test 发布 | 读/执行 | 读 | 预检/否决安全风险 | 确认/执行 | 执行建议 | 读 |
| prod 发布 | 读 | 读 | 安全预检/否决 | 确认 | 执行建议 | 读 |
| AI agent 运行 | 运维读 | 读 | 策略管理 | 项目内执行 | 项目内执行 | — |
| 审计日志 | 读 | 读/导出 | 读安全域 | 项目范围读 | 项目范围读 | 项目范围读 |

平台管理员对项目数据的“读”用于平台运维和故障处理，所有访问仍记录审计；平台安全管理员看到脱敏后的安全元数据，默认不能查看业务源代码和模型提示词正文。

## 4. AI agent 全流程规格

### 4.1 Agent 目录

P0 采用固定 agent 目录和统一运行协议，不做用户可编排的多 agent 工作流。每个 agent 是一个受策略约束的任务类型。

| agent | 触发点 | 输入 | 输出 | P0 执行动作 |
| --- | --- | --- | --- | --- |
| `intake-agent` 需求澄清 | 创建/编辑变更 | 简述、项目上下文、模板规则 | 用户故事、范围、AC、风险、问题清单 | 写入草稿；不自动确认 |
| `design-impact-agent` 设计与影响 | 需求进入就绪前、PR 更新 | 已确认需求、基线提交、技术栈索引 | 设计草稿、受影响资源、依赖、未知项、NFR 提示 | 写入设计版本；不改代码 |
| `context-agent` 开发交接 | 设计确认后 | 需求/设计/AC/NFR/项目文件 | 外部开发上下文包、任务提示、禁止范围 | 生成文件包并记录摘要 |
| `review-agent` AI Review | PR 或提交更新 | base/head、语义 diff、规则、AC、安全策略 | findings、风险、证据引用、建议 | 只读仓库；不自动合并 |
| `test-agent` 测试 | 需求确认、代码更新 | AC、语义 diff、现有测试、技术栈 | 测试用例草稿、影响分析、缺口 | 生成草稿；执行需人工触发 |
| `release-agent` 发布准备 | 候选制品生成 | 提交、PR、测试证据、环境、配置 | 变更影响、配置模板、运行手册、恢复步骤 | 生成计划；生产需人工确认 |
| `monitor-agent` 发布后监视 | 发布完成/失败、健康检查或事件回传 | 版本、事件、日志摘要、测试结果、运行手册 | 健康摘要、根因假设、风险和下一项变更建议 | 写入建议；不自动处置事件 |

### 4.2 运行协议

每次运行都生成 `agent_run` 和 `agent_output`，包含：

- `project_id`、`change_id`、`agent_type`、`input_fingerprint`、`source_revision`、`stack_profile`；
- 模型提供方和模型名、提示词版本、工具白名单、开始/结束时间、token/费用（若提供）；
- 输出结构、置信度、依据引用、风险级别、待确认项、错误和重试次数；
- 运行状态：`queued`、`running`、`succeeded`、`failed`、`cancelled`、`expired`。

模型输出必须是 JSON Schema 校验后的结构；自由文本仅作为说明字段。仓库文本、PR 评论、日志和知识片段均视为不可信输入，不能修改工具白名单、角色权限、目标环境或系统提示。

### 4.3 Agent 权限边界

- agent 默认无生产凭证、无任意网络访问、无任意 shell；工具调用只能命中平台登记的适配器动作。
- 允许的 P0 工具：读取指定提交/PR、解析资源、生成 diff、读取登记测试、写入草稿、生成文件、启动受限测试、读取发布状态。
- 禁止的 P0 工具：删除仓库或文件、修改角色、读取密钥正文、直接执行生产命令、自动合并、自动发布。
- 生成的配置模板不得包含密钥值，只能包含环境变量名、凭证引用和校验规则。
- 模型不可用时，需求编辑、人工测试、证据上传、审计查询和人工发布流程继续可用。

## 5. 技术栈与系统架构

### 5.1 技术选型

| 层 | P0 选型 | 约束 |
| --- | --- | --- |
| 前端 | React 19 + Vite + TypeScript + Ant Design 5 + React Router | 统一使用 Query/Form/Table/Drawer；状态不散落在组件内部 |
| 全栈运行时 | Node.js 22 LTS + TypeScript 5.x | 前后端共享类型和 Zod schema；ESM；严格模式 |
| HTTP API | Fastify + `@fastify/cookie` + `@fastify/multipart` | OpenAPI 由路由 schema 生成；统一错误码 |
| 数据访问 | Drizzle ORM + `mysql2` | SQL 和迁移文件可审阅；表名/字段使用英文小写 snake_case |
| 认证 | HttpOnly session cookie + Argon2id 密码哈希 | P0 支持本地账号；OIDC/SSO 留 P1 |
| AI | `AiProviderAdapter`，兼容 OpenAI Responses/Chat 风格 HTTP API | 模型服务在平台外；不在 P0 自建模型容器 |
| Git | Git 协议 + Gitea 服务容器 | 平台通过 Git CLI 和 Gitea API 读取仓库/PR；不实现 Git server |
| 任务 | MySQL `agent_runs` 队列 + worker 租约/心跳 | 不引入 Redis；同一应用镜像用不同 command 运行 |
| 审计 | Pino JSON + 审计 JSONL 文件 | 审计日志不以 MySQL 为唯一存储；文件可查询、可轮转 |
| 构建/部署 | Docker Compose | 单机 P0；容器镜像、配置、卷和健康检查可复现 |

### 5.2 容器拓扑

```mermaid
flowchart LR
  U[浏览器] --> APP[devops-app\nReact 静态文件 + Fastify API]
  APP --> DB[(mysql\nplatform + gitea schema)]
  APP --> GIT[gitea\nGit 服务容器]
  APP --> FILES[(platform_files\nnamed volume)]
  APP --> AUDIT[(audit_logs\nnamed volume)]
  WORKER[devops-worker\n同一镜像 / agent worker] --> DB
  WORKER --> GIT
  WORKER --> FILES
  WORKER --> AUDIT
  GIT --> GITDATA[(git_data\nnamed volume)]
  DB --> MYSQLDATA[(mysql_data\nnamed volume)]
```

P0 运行在一台 Docker 主机上。`devops-app` 负责浏览器请求和任务入队，`devops-worker` 负责 agent、Git 分析、测试适配和发布记录；两个容器使用相同镜像、不同启动命令。没有任务队列时 worker 轮询 MySQL，使用数据库租约避免重复执行。

### 5.3 Compose 基线

下面是实现时必须满足的拓扑约束，版本号和镜像 digest 在实现前锁定，不把示例标签视为最终供应链凭证。

```yaml
services:
  devops-app:
    build: ./apps/server
    command: node dist/server.js
    depends_on:
      mysql: { condition: service_healthy }
      git-service: { condition: service_healthy }
    environment:
      DATABASE_URL: mysql://devops:${MYSQL_PASSWORD}@mysql:3306/devops_platform
      GIT_BASE_URL: http://git-service:3000
      FILE_ROOT: /var/lib/devops/files
      AUDIT_ROOT: /var/log/devops/audit
    volumes:
      - platform_files:/var/lib/devops/files
      - audit_logs:/var/log/devops/audit
    ports: ["${DEVOPS_PORT:-8080}:8080"]

  devops-worker:
    image: ${DEVOPS_IMAGE:-devops-platform:local}
    command: node dist/worker.js
    depends_on:
      mysql: { condition: service_healthy }
      git-service: { condition: service_healthy }
    environment:
      DATABASE_URL: mysql://devops:${MYSQL_PASSWORD}@mysql:3306/devops_platform
      GIT_BASE_URL: http://git-service:3000
      FILE_ROOT: /var/lib/devops/files
      AUDIT_ROOT: /var/log/devops/audit
    volumes:
      - platform_files:/var/lib/devops/files
      - workspace_data:/var/lib/devops/workspaces
      - audit_logs:/var/log/devops/audit

  mysql:
    image: mysql:8.4
    command: ["--character-set-server=utf8mb4", "--collation-server=utf8mb4_0900_ai_ci"]
    environment:
      MYSQL_DATABASE: devops_platform
      MYSQL_USER: devops
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
    volumes: [mysql_data:/var/lib/mysql]
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]

  git-service:
    image: gitea/gitea:<pinned-version>
    depends_on:
      mysql: { condition: service_healthy }
    environment:
      GITEA__database__DB_TYPE: mysql
      GITEA__database__HOST: mysql:3306
      GITEA__database__NAME: gitea
      GITEA__database__USER: devops
      GITEA__database__PASSWD: ${MYSQL_PASSWORD}
    volumes: [git_data:/data]
    ports: ["${GIT_PORT:-3000}:3000", "${GIT_SSH_PORT:-2222}:22"]

volumes:
  mysql_data:
  git_data:
  platform_files:
  workspace_data:
  audit_logs:
```

实现约束：

1. `mysql` 和 `git-service` 必须是独立容器；Gitea 可以复用同一 MySQL 容器中的独立 `gitea` database，不与平台表混用。实现时用初始化 SQL 创建该 database 并授予 Gitea 专用连接权限。
2. 项目文件、上下文包、测试报告、制品元数据附件写入 `platform_files`；临时 clone 写入 `workspace_data`，任务结束按策略清理。
3. 审计文件写入 `audit_logs`，应用和 worker 使用进程独立文件，避免多进程竞争同一文件；查询时合并排序。
4. named volume 不等于备份。P0 提供 MySQL dump、Git 数据目录、平台文件和审计日志的备份/恢复运行手册。
5. Docker secret 或宿主环境变量只注入凭证；MySQL、Git 和模型密码不进入镜像、项目文件、AI 上下文或普通日志。

Gitea 复用平台 MySQL 容器时，初始化目录至少包含以下一次性 SQL；生产环境应把密码通过 Docker secret 或等效机制注入，不把明文提交到仓库：

```sql
CREATE DATABASE IF NOT EXISTS gitea CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON gitea.* TO 'devops'@'%';
FLUSH PRIVILEGES;
```

## 6. 数据模型

### 6.1 关系数据

所有表均包含 `id`、`created_at`、`updated_at`；删除优先使用状态字段或软删除。以下是 P0 的最小表集，字段可在实现阶段补充审计所需的索引。

| 表 | 关键字段 | 用途 |
| --- | --- | --- |
| `users` | `username`, `display_name`, `password_hash`, `status` | 平台用户 |
| `roles` | `code`, `scope`, `read_only` | 平台/项目角色定义 |
| `user_platform_roles` | `user_id`, `role_id` | 全局角色绑定 |
| `projects` | `name`, `code`, `owner_user_id`, `status`, `template_instance_id` | 项目和负责人 |
| `project_role_bindings` | `project_id`, `user_id`, `role_id`, `assigned_by` | 项目角色绑定；唯一约束为项目+用户+角色 |
| `templates` | `code`, `version`, `status`, `manifest_json` | 不可变模板版本 |
| `template_instances` | `project_id`, `template_id`, `variables_json`, `file_manifest_json`, `conflict_summary` | 项目模板实例快照 |
| `repositories` | `project_id`, `provider`, `base_url`, `repo_key`, `default_branch`, `credential_ref` | Git 关联；不存令牌正文 |
| `stack_profiles` | `repository_id`, `profile_code`, `confidence`, `detected_files_json`, `override_by` | 技术栈识别结果 |
| `changes` | `project_id`, `key`, `title`, `type`, `status`, `owner_user_id`, `priority`, `blocked_reason` | 变更主记录 |
| `change_versions` | `change_id`, `version_no`, `content_json`, `confirmed_by`, `confirmed_at` | 需求/设计/验收版本 |
| `change_links` | `change_id`, `link_type`, `external_key`, `metadata_json` | PR、提交、测试、制品关联 |
| `agent_runs` | `project_id`, `change_id`, `agent_type`, `status`, `input_fingerprint`, `lease_until` | agent 任务队列和运行状态 |
| `agent_outputs` | `agent_run_id`, `schema_version`, `output_json`, `evidence_json`, `risk_level` | AI 结构化结果 |
| `semantic_diffs` | `change_id`, `base_revision`, `head_revision`, `stack_profile`, `graph_json`, `raw_diff_ref` | 变化可视化索引 |
| `reviews` | `change_id`, `revision`, `status`, `reviewer_user_id` | 人工 Review 状态 |
| `review_findings` | `review_id`, `severity`, `path`, `resource_key`, `message`, `evidence_json`, `state` | AI/人工发现项 |
| `test_definitions` | `project_id`, `name`, `kind`, `command_ref`, `environment_ref` | 登记的测试入口 |
| `test_runs` | `change_id`, `revision`, `status`, `result_json`, `report_ref`, `source` | 测试证据 |
| `environments` | `project_id`, `code`, `kind`, `target_ref`, `current_revision`, `current_artifact_ref` | test/prod 环境 |
| `releases` | `project_id`, `version`, `source_revision`, `artifact_ref`, `config_ref`, `status` | 候选版本 |
| `deployments` | `release_id`, `environment_id`, `approval_fingerprint`, `executor`, `status`, `verified_revision` | 环境部署记录 |
| `file_objects` | `project_id`, `storage_key`, `sha256`, `content_type`, `size_bytes`, `retention_until` | named volume 文件索引 |

平台审计日志不写入以上业务表。业务表只保存 `audit_event_id` 或 `operation_id` 关联，具体审计内容写入文件。

### 6.2 变更状态

P0 固定五个主状态：`inbox`（收件箱）、`ready`（就绪）、`in_progress`（开发中）、`awaiting_acceptance`（待验收）、`completed`（已完成）。任意未完成状态可有 `blocked=true` 和原因。发布状态独立于变更状态，避免“已合并”等于“已上线”。

### 6.3 版本与证据失效

以下任一变化会使相关批准和测试证据标记为 `stale`，不能静默沿用：base/head 提交变化、验收标准版本变化、目标环境配置版本变化、候选制品摘要变化、生产环境变化、Review 未解决项变化。

## 7. Git、技术栈识别与变化可视化

### 7.1 Git 服务边界

P0 使用独立 Git 服务容器承载仓库和 PR。平台不复制 Git 的提交事实，只保存仓库标识、提交 SHA、分支、PR 编号、状态快照和外部 URL。平台所有变更都关联 `base_revision` 和 `head_revision`，需要时重新从 Git 读取。

Git 操作白名单：读取仓库、读取提交、读取 PR、创建分支、创建 PR 草稿（由用户确认发送）、上传状态检查。平台不替用户修改受保护分支，不代替 Git 的合并策略。

### 7.2 自动技术栈匹配

仓库首次导入和每次基线变化后执行检测。检测结果包含 `profile_code`、置信度、证据文件、版本和人工覆盖记录；人工覆盖优先但仍保留自动结果。

| profile | 识别信号 | 解析器/规则 | 语义节点 |
| --- | --- | --- | --- |
| `phoenix_dsl` | `app.pxproj`、`documents/**/*.json`、Phoenix metadata | JSON/metadata 解析；按资源类型识别 page、logic、permission、external_api、type、global | 页面、服务端逻辑、权限、接口、类型、全局变量 |
| `typescript` | `tsconfig.json`、`.ts`、`.tsx` | TypeScript Compiler API；读取导入、导出、函数、类、类型和测试引用 | 模块、函数、类型、路由、测试 |
| `javascript` | `package.json`、`.js`、`.jsx` | TypeScript Compiler API 的 JS 模式；结合 package scripts | 模块、函数、组件、路由、测试 |
| `css` | `.css`、`.scss`、`.less` | PostCSS + 对应语法解析 | 选择器、规则、变量、媒体查询、组件范围 |
| `sql` | `.sql`、迁移目录、SQL script | `node-sql-parser` MySQL 方言；无法解析时降级文本 diff 并标记未知 | 表、列、索引、约束、视图、迁移动作 |

同一仓库可以得到多个 profile。P0 选择主 profile 和辅助 profile，Review、测试影响和发布影响分析合并结果；解析失败不阻塞查看原始 diff，但必须显示“语义分析不完整”。

### 7.3 变化可视化数据

`semantic_diffs.graph_json` 使用稳定结构：

```json
{
  "baseRevision": "...",
  "headRevision": "...",
  "profiles": ["phoenix_dsl", "typescript"],
  "nodes": [{
    "id": "logic:ask",
    "kind": "logic",
    "label": "ask",
    "change": "modified",
    "path": "documents/logic/.../ask.json",
    "confidence": 0.96,
    "riskTags": ["llm-call", "permission"]
  }],
  "edges": [{"from": "logic:ask", "to": "external_api:llm", "kind": "calls", "change": "unchanged"}],
  "unknowns": [{"path": "documents/logic/.../ask.metadata.json", "reason": "dynamic reference"}]
}
```

前端默认以三层阅读顺序展示：

1. **摘要**：新增/删除/修改节点数、受影响技术栈、风险标签和解析覆盖率。
2. **关系图**：按页面、逻辑、接口、数据、配置分组；节点点击打开原始资源和版本差异。
3. **证据**：文件路径/资源 ID、提交、Review finding、测试用例和 AI 依据。

颜色只表示变化类型，不用颜色单独表示权限结论：新增为蓝绿、删除为红、修改为橙、未知为灰紫；所有颜色同时有文字标签和图例。

### 7.4 AI Review 结果

每个 finding 必须包含：`severity`（critical/high/medium/low/info）、`category`、`path` 或 `resource_key`、行号或资源节点、问题描述、证据、影响、建议、置信度、状态（open/accepted/fixed/false_positive）。

Review agent 只提交建议，不自动改代码。人工处理后才允许进入“已审查”；`critical/high` 未处置时阻止变更进入待验收，除非项目负责人显式记录例外原因。

## 8. 审计日志与查询

### 8.1 文件格式和落盘

审计日志使用 UTF-8 JSON Lines，一行一个不可变事件，写入 `/var/log/devops/audit/`，通过 named volume `audit_logs` 持久化。文件命名：`audit-YYYY-MM-DD-<process-id>.jsonl`。应用和 worker 分文件写入；查询服务读取目录下全部文件并按 `occurred_at + event_id` 排序。

事件最小结构：

```json
{
  "eventId": "ae_01J...",
  "occurredAt": "2026-10-02T09:00:00.000Z",
  "actor": {"type": "user", "id": "u_123", "role": "project_owner"},
  "action": "release.approve",
  "resource": {"type": "deployment", "id": "dep_123", "projectId": "prj_123"},
  "result": "succeeded",
  "correlationId": "op_123",
  "inputFingerprint": "sha256:...",
  "metadata": {"environment": "prod", "revision": "..."},
  "prevHash": "sha256:...",
  "eventHash": "sha256:..."
}
```

日志中禁止写入密码、令牌、Cookie、完整模型提示词、业务文件原文和生产数据。AI 输出只记摘要、版本、引用和指纹；需要查看正文时按原权限访问 `platform_files`。

### 8.2 事件范围

至少记录登录/登出、失败登录、用户和角色变更、项目创建、项目负责人变更、模板应用、仓库绑定、AI 运行、AI 出站拦截、Review 处置、测试启动/回传、发布预检/批准/执行/回滚、审计查询和导出、权限拒绝、系统配置变化。

### 8.3 查询接口

审计查询从文件读取，不修改日志。P0 支持：时间范围、actor、role、project_id、action、result、resource_type、correlation_id、event_id、关键字；返回分页结果、文件名和校验状态。平台审计员可以全局查询和导出，项目角色只能查询自身项目且不能导出平台级日志。

文件轮转按日执行，默认保留 30 天；发布/合并证据默认保留 90 天。轮转和删除本身也写审计；正式企业部署前由平台安全管理员配置保留期限和外部归档方式。P0 的哈希链用于发现文件被改写，不声称替代合规 WORM 存储。

## 9. API 与内部契约

### 9.1 HTTP API 分组

所有写接口需要 session、CSRF 校验（或同源安全策略）和权限检查；返回 `request_id`，错误结构统一为 `code`、`message`、`details`。

```text
POST   /api/projects
GET    /api/projects
GET    /api/projects/:projectId
POST   /api/projects/:projectId/template-preview
POST   /api/projects/:projectId/template-apply
GET    /api/projects/:projectId/roles
PUT    /api/projects/:projectId/roles/:bindingId

POST   /api/projects/:projectId/changes
GET    /api/projects/:projectId/changes
GET    /api/changes/:changeId
PUT    /api/changes/:changeId/requirements
POST   /api/changes/:changeId/confirm-design
POST   /api/changes/:changeId/context-package
POST   /api/changes/:changeId/ai-runs

GET    /api/changes/:changeId/semantic-diff
POST   /api/changes/:changeId/reviews
PATCH  /api/reviews/:reviewId/findings/:findingId
POST   /api/changes/:changeId/test-runs
POST   /api/changes/:changeId/evidence

POST   /api/projects/:projectId/releases
POST   /api/releases/:releaseId/preflight
POST   /api/releases/:releaseId/approve
POST   /api/releases/:releaseId/deployments
POST   /api/deployments/:deploymentId/verify
POST   /api/deployments/:deploymentId/rollback-plan

GET    /api/audit/events
GET    /api/audit/events/:eventId
GET    /api/audit/export
```

### 9.2 适配器契约

适配器实现统一接口，但 P0 只实现 Git/Gitea、文件、AI provider 和人工发布记录四类能力；Phoenix 发布适配器在完成官方契约验证后实现，未验证时状态为 `manual`。

```ts
interface RepositoryAdapter {
  getRevision(input: RevisionInput): Promise<RevisionSnapshot>;
  getPullRequest(input: PullRequestInput): Promise<PullRequestSnapshot>;
  compare(input: CompareInput): Promise<RawDiff>;
}

interface StackAnalyzer {
  detect(input: RepositorySnapshot): Promise<StackProfile[]>;
  analyze(input: CompareInput): Promise<SemanticDiffGraph>;
}

interface AiProviderAdapter {
  run(input: AgentRunInput): Promise<AgentRunOutput>;
}

interface ReleaseAdapter {
  preflight(input: ReleaseInput): Promise<PreflightResult>;
  deploy(input: ReleaseInput): Promise<DeploymentResult>;
  verify(input: VerifyInput): Promise<VerificationResult>;
}
```

每个适配器返回 `mode: automatic | manual | unsupported`、外部操作 ID、输入/输出指纹和能力说明。`manual` 不是失败；平台必须明确提示人工步骤并等待证据。

## 10. 安全、可靠性与数据保护

- 会话 cookie 使用 `HttpOnly`、`Secure`（HTTPS 部署时）和 `SameSite=Lax`；密码使用 Argon2id；初始平台管理员只允许通过一次性 bootstrap 变量创建并强制改密。
- 平台管理员、安全管理员和审计员的角色授予需要二次确认；安全策略变化、生产审批和审计导出必须留日志。
- AI 出站策略按项目配置：允许的 provider、允许的文件类型、敏感字段扫描、最大上下文大小、费用预算和失败策略。阻断事件展示被拦截原因。
- worker 的 Git clone、解析和测试运行在 workspace volume 中；shell 命令只能从项目登记的测试定义中选择，参数结构化传递，禁止把模型文本拼接成 shell。
- 任务使用 MySQL 租约 `lease_until`、心跳和幂等键；重启后可恢复，超时任务变为 `expired` 并允许人工重试。部署同一环境使用数据库锁，避免并发发布。
- 数据库迁移在启动前执行版本检查；生产环境不自动执行破坏性迁移。文件对象以 SHA-256 校验，上传、替换和清理均有审计。
- 备份包含 MySQL、Git 数据、`platform_files` 和 `audit_logs`；每个 P0 版本至少完成一次恢复演练，记录 RPO/RTO 事实，不预设行业指标。

## 11. P0 验收标准

### 11.1 端到端闭环

1. 平台管理员使用 Phoenix 资源型模板创建项目，指定项目负责人；项目负责人再指定成员和只读干系人。
2. 项目成员从一句话创建变更，`intake-agent` 生成用户故事、AC、风险和问题清单；负责人确认后生成版本化开发上下文。
3. 项目成员关联 Git 分支和 PR；PR 更新后自动生成语义 diff、Review findings、测试草稿和影响分析。
4. 人工处置 Review findings，执行登记测试或上传人工证据；测试失败时状态阻塞，不能用 AI 摘要冒充通过。
5. 生成候选版本，`release-agent` 生成变更影响、配置模板、运行手册和恢复步骤；负责人批准 test，再批准 prod。
6. 部署记录核对源提交、制品摘要、配置版本和环境；回传验证后形成完成记录。
7. 任一关键操作都能从 UI 时间线跳到审计事件、AI 运行、提交、测试和发布证据。

### 11.2 权限与三员

- 项目成员不能修改平台角色、指定项目负责人或查看其他项目私有数据。
- 项目干系人只能读，任何写入请求均返回 `403` 并写审计。
- 平台审计员能按条件查询全局日志但不能修改业务数据或执行发布。
- 平台安全管理员能阻断高风险 AI 出站和生产动作，但不能修改审计文件或代替项目负责人形成业务批准。
- 平台管理员指定负责人后，项目负责人可以指定成员/干系人；这两个流程的操作者和前后差异均可查询。

### 11.3 栈适配与变化图

- 使用包含 `app.pxproj`、Phoenix `documents`、TS/JS、CSS 和 SQL 的样例仓库完成自动识别；结果列出证据文件和置信度。
- 至少验证 Phoenix `ask` 逻辑的节点/依赖变化、TypeScript 函数/导入变化、CSS 选择器变化、SQL 表/列/索引变化。
- 解析失败时仍可查看原始 diff，并明确显示语义分析覆盖率和未知依赖。

### 11.4 审计与部署

- 应用和 worker 将审计事件写入 named volume 中的 JSONL 文件；重启后文件仍可查询。
- 查询支持至少八类条件并返回文件来源、校验状态和分页结果。
- MySQL、Git 服务、平台文件和审计日志分别使用 named volume；删除容器不会删除数据卷。
- `docker compose up` 后健康检查通过；应用、worker、MySQL、Git 服务相互可达；worker 任务可以在重启后恢复。

## 12. 实施顺序

以 2–3 人团队为约束，把 P0 拆成四个可独立评审的切片：

| 切片 | 内容 | 退出条件 |
| --- | --- | --- |
| A 基础与权限 | React/AntD 壳层、Fastify、MySQL migration、登录、六角色、项目和模板实例、Docker Compose | 三员和项目角色测试通过；审计事件可查询 |
| B 变更与 AI | 变更、版本、五状态、agent_runs、intake/design/context/review/test/release agent、AI provider adapter | 一项变更能生成上下文和结构化 AI 输出；模型不可用时可人工继续 |
| C Git 与语义变化 | Gitea 容器、Git 关联、stack detection、五类解析器、语义 diff、Review findings | Phoenix/TS/JS/CSS/SQL 样例能展示变化和未知项 |
| D 发布与恢复 | test/prod 环境、候选版本、预检、人工发布、配置/运行手册、审计导出、备份恢复 | 完成一次 test → prod 模拟闭环和一次数据/文件恢复演练 |

实现顺序不要求先把所有 agent 做成独立服务。P0 使用一个 TypeScript worker 和固定 agent handlers；当运行量、权限隔离或故障域明确后再拆分。

## 13. 与既有方案的关系

- 本规格落实既有方案的项目工作台、外部开发、AI 生命周期、项目模板、Phoenix 适配、变更可视化和人工放行边界。
- `[U1]` 中列出的计划、开发、测试、发布、配置、监视器能力在 P0 都有 agent 入口；自动漏洞修复、自动事件响应等仍只保留为建议或 P1。
- 示例工程 `ikkyu-phx` 的 Phoenix DSL 解析是首个适配器样本；其页面尚未重建、数据库主要是流程引擎表等事实不被 P0 规格改写。
- 本文件不声称 Phoenix 官方发布接口、Gitea 具体版本或任何模型服务已经在真实环境验证；实现阶段必须把能力验证结果补入适配器记录和引用台账。
