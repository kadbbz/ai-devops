import { type State } from "./model.js";
/** 恢复撤销登录和委托，未决 Git 操作只核对实际结果，不自动重放。 */
export function recoverState(s: State, restored = false) {
  if (restored) {
    s.sessions = [];
    for (const c of s.credentials) c.revoked = true;
  }
  for (const r of s.requests) if (r.status === "RUNNING") r.status = "UNKNOWN";
}
