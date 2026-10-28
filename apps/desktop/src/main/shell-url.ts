// 应用壳 URL 判定（纯函数，判卷可直接钉）：只有 dist/index.html 或 dev server 同源页面
// 可以带着全量 preload 在应用窗口里加载。外链走 shell.openExternal。
import { resolve } from "node:path";

export interface ShellUrlOptions {
  /** VITE_DEV_SERVER_URL（生产为空串）。 */
  devServerUrl?: string;
  /** 桌面包根（dist/ 的父目录）：dev = apps/desktop；打包 = <app>/Contents/Resources/app/apps/desktop。 */
  appPath: string;
}

/** 从主进程入口目录（<desktop>/src/main）推桌面包根。
 *  不能用 app.getAppPath()：runtime package 的 main 在 apps/desktop/src/main/entry.cjs，
 *  打包后它返回 Resources/app，而 loadFile 的壳在 Resources/app/apps/desktop/dist —— 差一层，
 *  IPC 来源校验会把壳页面整体判成不可信。 */
export function shellAppPath(mainDir: string): string {
  return resolve(mainDir, "..", "..");
}

export function isAppShellUrl(raw: string, opts: ShellUrlOptions): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol === "file:") {
      // 路径必须**恰好**是应用自己的 dist/index.html：只判后缀会放行
      // file:///tmp/x/dist/index.html（外部文件带着全量 preload 进应用窗口）。
      const p = resolve(decodeURIComponent(u.pathname));
      return p === resolve(opts.appPath, "dist", "index.html");
    }
    const dev = opts.devServerUrl ?? "";
    if (dev === "") return false;
    // 比较 origin，不比较字符串前缀：`http://localhost:5173@evil.com/` 的 hostname 是 evil.com，
    // 但旧写法 `raw.startsWith(dev)` 会放行它。
    return u.origin === new URL(dev).origin;
  } catch { return false; }
}
