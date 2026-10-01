import { put } from "./store.js";

export function saveUser(id, name) {
  return put("users", String(id), { name })
}
