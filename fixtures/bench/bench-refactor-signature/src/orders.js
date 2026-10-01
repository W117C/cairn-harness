import { put } from "./store.js";

export function saveOrder(id, total) {
  return put("orders", String(id), { total })
}
