import { loadUser } from "./loader.js";

// 待办：这里应当做记忆化（同一个 id 只真取一次）
export async function getUser(id) {
  return loadUser(id)
}

export function resetCache() {
  // 待办：清掉缓存，让下一次 getUser 会重新取
}
