# IDE / DevOps Agent 接入

平台仅处理需求和版本。IDE Agent 自行编写、执行全部测试，完成开发与发布。人类在“项目与授权”创建 human / ide_agent / devops_agent 委托，有效期 1–24 小时，凭证保存在 IDE 环境或凭证管理器，不入 Git。DevOps Agent 仅维护需求；IDE Agent 可按委托做需求和版本操作。无需机器回执公钥。

项目模板和技能库由平台管理员维护。技能包上传时必须包含 `SKILL.md`；模板必须包含 `agent.md` 内容和技能 ID 清单。创建项目选择模板后，DevOps 将选中技能复制到初始仓库的 `skill/<技能标识>/`，并写入 `skill/manifest.json`。IDE Agent 后续通过 Git 读取这些文件，不需要额外技能服务。

Git origin 为 `http(s)://<devops>/git/<仓库标识>.git`，Basic Auth 用户名为统一账号，密码为 token。只向已存在工作分支快进推送；不直接 push 创建/删除远端分支、推主线、改标签或合并。

写入口 `POST /api/actions/:action`，请求头 `Authorization: Bearer <token>`、`Content-Type: application/json`、`Idempotency-Key: <唯一请求键>`。同键同内容返回原结果；不同内容拒绝，UNKNOWN 先对账。凭证明文只在首次响应显示，幂等重试不会再次返回。

| 动作 | 请求正文 |
| --- | --- |
| requirement.create | projectId, title, description?, kind?, priority?, status? |
| requirement.update | id, revision, title, description?, kind?, priority?, status? |
| branch.create | projectId, name, baseSha, requirementId? |
| branch.delete | id, headSha |
| pr.create | projectId, branchId, title, description? |
| pr.merge | id, headSha, targetSha；仅无冲突时合并 |
| pr.conflict.choice | id, headSha, targetSha, choices: [{path, choice: "left"|"right"}]；只记录人类选择，不合并 |
| version.create | projectId, name, sha, notes?, requirementIds? |
| repository.reconcile | projectId |

完整 SHA 为 40 位十六进制。基线和版本提交须属于 main 历史。创建分支与合并不依赖需求状态或测试证明。需求修订冲突和 Git 漂移返回 409。合并冲突返回 `MERGE_CONFLICT`，响应 `details.conflicts` 包含文件、摘要、左侧 main 内容、右侧工作分支内容和冲突类型；此时不会调用 Git merge。人类可以逐项提交左右选择，响应会标记下一步为 `IDE_AGENT_MUST_RESOLVE_AND_PUSH`。IDE Agent 解决并推送后，使用新的 SHA 重新查看 PR。

读取 `/api/workspace` 获取可见对象；`/api/projects/:id/repository` 获取实际分支和标签；`/api/pulls/:id` 获取真实差异和合并使用的 headSha/targetSha。状态枚举 OPEN / IN_PROGRESS / DONE / CANCELLED；类型 feature / defect / change；优先级 low / normal / high。

```sh
export DEVOPS_URL=http://localhost:18083
export DEVOPS_PROJECT=<项目ID>
export DEVOPS_TOKEN=<短时凭证>
node /path/to/ai-devops/cli/devops.mjs workspace init
node /path/to/ai-devops/cli/devops.mjs workspace sync
```

双方通过根 `agent.md` 约定分工，CLI 使用 `.devops/outbox/<requestId>.json` 请求变更：

```json
{
  "protocolVersion": 2,
  "projectId": "项目ID",
  "requestId": "唯一请求标识-至少8位",
  "action": "requirement.update",
  "payload": {
    "id": "需求ID", "revision": 1,
    "title": "支持客户导入", "description": "预期结果",
    "kind": "feature", "priority": "normal", "status": "DONE"
  }
}
```

文件通道只允许 requirement.create/update。inbox/requirements 是只读需求投影；state.json 列出需求、分支和版本；receipts 返回请求结果。CLI 从 DevOps 读取同一份权威投影，程序同时归档到同仓 devops/control。同步不启动项目命令，不接受文件声明身份。只读投影被修改时拒绝覆盖，先保留个人修改再删除相应投影重试。旧 v1 outbox 不兼容，升级后按上面格式重建。
