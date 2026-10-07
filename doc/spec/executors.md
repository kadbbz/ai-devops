# IDE / Runner 与工作区接口

与 [spec](spec.md) 配套。API 的写入口为 `POST /api/actions/:action`，统一响应 `{result}`；错误包含 `code/message/requestId`。请求发送 `Content-Type: application/json`、`Authorization: Bearer <委托>`、唯一 `Idempotency-Key`。同键同内容幂等；同键不同内容返回 409；UNKNOWN 不得换键盲重试。

## 人类授权与机器签名

在人类工作台「项目与授权」签发一小时委托。`ide_agent` 只能发构建/发布请求；`devops_agent` 维护方案、材料、系统方案并发起验收；`ide_control` 登记构建/风险/生产证明及发布回执；`runner` 领取和完成 API/E2E。机器身份签发时登记 Ed25519 **公钥**，私钥留在执行端。Runner 名称必须与项目 `runnerId` 一致。

`build.register`、`risk.register`、`production.attest`、`tests.complete`、`release.complete`，以及机器通过 `workspace.sync` 上传的文件，需要 `X-Receipt-Signature`。算法 Ed25519，签名原文为以下对象的规范化 UTF-8 JSON；签名编码 Base64：

```ts
{ action: 'tests.complete', body: requestBody, key: idempotencyKey }
```

规范化规则：对象键按字典排序，忽略值为 undefined 的对象键；数组保留顺序；原始值用 JSON.stringify；不附加空格。实现见 `src/model.ts` 的 `canonical`。角色、项目和机器 ID 来自平台凭证，不能由 body 自报。执行端稳定 ID 由项目、角色、名称、公钥共同导出；恢复后重新授权同一公钥可对账旧操作。

## 固定执行契约

| 动作 | 请求关键字段 | 结果 |
| --- | --- | --- |
| `build.request` | `id`（intent/delivery） | 固定 sourceSha、controls、snapshotId 的 QUEUED 操作 |
| `operation.claim` | `id`（operation） | 领取一次；校验来源和签发仍有效，返回租约及固定 payload |
| `build.register` | `id`（intent/delivery）, `build`（含 `operationId`） | 必须对应当前执行器已领取的原 build 操作且输入指纹仍有效；登记构建、依赖/制品/SBOM/来源摘要及 unit/component/security 结果，更新操作状态 |
| `tests.request` | `id` | 创建 API、E2E 两个操作，绑定命令 ID、环境、数据与指纹 |
| `tests.complete` | `id`, `fingerprint`, `outcome`, `command`, `environment`, `toolVersion`, `dataDigest`, `prepared`, `cleaned`, `beforeDigest`, `afterDigest`, `log` | PASSED / FAILED / UNKNOWN；旧输入标 STALE |
| `system.save` | `id`, `system` | 最终提交、制品、配置、环境、应用集合、顺序、迁移、健康与恢复 |
| `release.request` | `id`（delivery） | C 有效才可登记；同环境不得并发发布 |
| `release.complete` | `id`, `fingerprint`, `outcome`, `actualSha`, `artifactDigest`, `environment`, `healthy`, `log` | 实际版本匹配才关闭，否则阻断/对账 |
| `production.attest` | `projectId`, `report` | 签名报告实际 SHA、制品、环境、健康、operationId、log；等待人类确认 |
| `risk.register` | `id`, `evidence` | 绑定当前 sourceSha 的 backupLocation、restoreVerified、invariantsVerified、permissionsVerified、forwardFix、log |

完整字段与枚举以 `src/model.ts`、`src/control.ts` 的 Zod schema 为准。可运行示例见 `doc/test_case/integration.ts`；该脚本是测试执行器，不能作为生产控制器直接使用。平台不会执行 payload 中的 shell；执行端必须把 command ID 映射到自身固定、隔离的工作流。30 分钟租约到期进入 UNKNOWN。503 维护时保留同一请求键和 operation ID 重交。

功能交付实际发布成功后，程序通过真实 Gitea 的 `fast-forward-only` PR 将 `production` 引用投影到已签发且核验的同一 SHA；不产生不同制品或新的部署。不能快进、来源移动或结果未知时停止关闭并要求对账。

## 同仓文件协议

```sh
# 凭证通过安全环境或密钥管理器注入，禁止放入 Git。
DEVOPS_URL=http://localhost:8080 DEVOPS_PROJECT=<项目ID> DEVOPS_TOKEN=<短时凭证> node /path/to/ai-devops/cli/devops.mjs workspace init
node /path/to/ai-devops/cli/devops.mjs workspace sync
```

`init` 校验 origin 指向 DevOps Git 网关，并在本地 Git exclude 排除 `.devops/`。先通过 DevOps 创建/签发任务，再在该任务工作树中执行 init；两个 agent 共享同一工作树。客户端不创建或合并远端分支。

用 `GET /api/session` 读取 `actor.id`，用 `GET /api/projects/:id/workspace` 获取当前投影和 `inputFingerprint`。将 envelope 原子写入 `.devops/outbox/<actorId>/<requestId>.json`，然后 sync：

```json
{
  "protocolVersion": 1,
  "projectId": "prj_...",
  "intentId": "int_...",
  "requestId": "request_00000001",
  "operationId": "request_00000001",
  "actorId": "cred_...",
  "action": "build.request",
  "sourceSha": "固定的40位SHA",
  "inputFingerprint": "sha256:固定的64位摘要",
  "createdAt": "2026-10-06T03:00:00.000Z",
  "payload": { "id": "int_..." }
}
```

没有现存操作时 `operationId` 使用请求 ID；回执必须填原 operation ID，payload.id 为该操作 ID。delivery 使用 `deliveryId` 替代 intentId。机器同步另设 `DEVOPS_SIGNING_KEY` 指向本地 PEM 私钥文件。禁止在文件里签 Gate、合并、改权限或人工恢复。

平台将 outbox/receipt 归档到同仓 `devops/control`，业务源码 SHA 不受回执影响。客户端对 inbox/receipt/state 做本地摘要检查；若被手工修改，先保存改动并删除对应本地投影文件，再重新同步。未知归档结果由人类对账，不能用新请求绕过。

## 可选模型

宿主机管理员在持久化 `/data/config/devops.json` 增加 `model: {baseUrl, name}`，在 `/data/secrets/devops.json` 增加 `aiApiKey`，保留原字段、文件权限和所有者后重启。模型接口兼容 `/chat/completions`，需支持 JSON 输出。模型只有文本能力，输出必须通过点/应用方案 schema；受限上下文不出站。未配置模型时可完整使用人工方案流程，不生成虚假结果。
