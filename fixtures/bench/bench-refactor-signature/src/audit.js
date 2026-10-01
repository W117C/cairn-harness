import { put } from "./store.js";

export function audit(action) {
  return put("audit", String(Date.now()), { action })
}
