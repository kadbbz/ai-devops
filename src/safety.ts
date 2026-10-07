import { createPublicKey, verify } from "node:crypto";
import { canonical, check, invalidate, now, type State } from "./model.js";

/** 回执使用执行端 Ed25519 私钥签名；平台仅保管公钥。 */
export function verifyReceipt(
  publicKey: string,
  signature: string,
  input: unknown,
) {
  let valid = false;
  try {
    const key = createPublicKey(publicKey);
    valid =
      key.asymmetricKeyType === "ed25519" &&
      verify(
        null,
        Buffer.from(canonical(input)),
        key,
        Buffer.from(signature, "base64"),
      );
  } catch {}
  check(valid, "RECEIPT_SIGNATURE", "执行回执签名无效", 403);
}
/** 重启不重放外部副作用；恢复额外吊销从归档带回的所有登录与委托。 */
export function recoverState(s: State, restored = false) {
  if (restored) {
    s.sessions = [];
    for (const c of s.credentials) c.revoked = true;
    for (const p of s.projects)
      if (p.production) p.production.confirmed = false;
  }
  for (const o of s.operations)
    if (o.status === "RUNNING" || (restored && o.status === "QUEUED")) {
      o.status = "UNKNOWN";
      o.reason = restored
        ? "备份恢复后必须核验外部实际结果"
        : "服务重启，执行结果待对账";
    }
  for (const x of [...s.intents, ...s.deliveries]) {
    if (x.stage === "CLOSED") continue;
    const unknown = s.operations.some(
      (o) => o.subjectId === x.id && o.status === "UNKNOWN",
    );
    if (restored || unknown) {
      invalidate(s, x, restored);
      x.control = unknown ? "UNKNOWN" : "HUMAN_RECOVERY";
      x.reason = restored ? "恢复后重新核验来源和授权" : "外部执行结果未知";
    }
  }
  for (const r of s.requests) if (r.status === "RUNNING") r.status = "UNKNOWN";
}
export function expireLeases(s: State) {
  for (const o of s.operations)
    if (o.status === "RUNNING" && o.leaseUntil && o.leaseUntil < now()) {
      o.status = "UNKNOWN";
      o.reason = "执行租约到期，请原执行者对账";
      const sub = [...s.intents, ...s.deliveries].find(
        (x) => x.id === o.subjectId,
      );
      if (sub) {
        sub.control = "UNKNOWN";
        sub.reason = o.reason;
      }
    }
}
