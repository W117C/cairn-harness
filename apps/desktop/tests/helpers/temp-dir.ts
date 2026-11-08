import { rmSync } from "node:fs";

/** 清理临时目录：**尽力而为，不抛**（第 948 页）。
 *
 *  为什么不能裸 `rmSync`：带隔离 HOME 的登录 shell（`$SHELL -l`）在退出前还会往那里写
 *  `.zcompdump` / `.zsh_history` / 缓存目录。清理与写入撞上就是 `ENOTEMPTY`——
 *  一条判据本来是绿的，却因为「清理没清干净」变红（2026-11-01 桌面套件首跑实测，
 *  `terminal-login-shell.test.ts` 就是这样红的；单跑绿、重跑绿 ⇒ 典型的清理竞态）。
 *
 *  做法：带重试地删；真删不掉也咽下——留下的是系统临时目录（`/var/folders/…` 或 `/tmp`），
 *  操作系统迟早会收，比把一条绿判据误判成红要好。
 */
export function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  } catch {
    /* 尽力而为：见上。 */
  }
}
