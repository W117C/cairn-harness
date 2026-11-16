// 生产 CSP（2026-10-17；2026-11-15 抽出为纯函数）：build-only 注入。dev 不能注入——
// @vitejs/plugin-react 会往 index.html 插内联 preamble，静态 'self' 会把 pnpm dev 一起打死。
//
// 为什么抽成独立模块：CSP 里那几个 scheme 白名单与「自定义协议的 scheme 名」是同一条事实的
// 两半（改一半就静默坏）。以前两边各写各的，判卷只能按源码文本 grep 关键字；现在判卷可以
// 直接 import 这个值，钉住「每个需要放行的指令里都有那个 scheme」。
//
// 2026-11-15 实测的那条：漏掉 `cairn-wallpaper:` 时，壁纸层在真 Electron 里**一张图都加载不出**，
// 控制台只有一行 `violates ... img-src`；补上后同一条探针立刻加载成功（1280×720 → 1440×900 原图）。
// 所以它不是"防御性配置"，而是这条功能能不能出现的开关。
import { WALLPAPER_SCHEME } from "../../../../src/main/wallpaper-protocol";

/** 自定义协议在 CSP 里的写法：`scheme:`（末尾冒号是 scheme 源语法的一部分）。 */
const WALLPAPER_ORIGIN = `${WALLPAPER_SCHEME}:`;

/**
 * 生产 CSP 正文。口径：
 *   · 脚本只跑打包产物（'self'，无 eval）；
 *   · 样式必须放 inline（Radix / xterm 都写行内样式）；
 *   · 图片允许 data:/blob:/https:（消息里的远程图照常显示，不静默改成破图）+ 壁纸协议；
 *   · 媒体（<video> 壁纸）同样要放行壁纸协议——`<img>` 与 `<video>` 各受一条指令管；
 *   · 连接面允许 http(s)/ws(s)（本地预览与 dev HMR）；**不放壁纸协议**：渲染层不从这条协议
 *     fetch（自定义 scheme 未开 corsEnabled，fetch 一律被 CORS 挡），放行等于白开一扇门；
 *   · `frame-src` 只放 **https:**（网站壁纸；2026-11-16 业主批「准放 CSP」）——
 *     不放 data:/blob:/http:，且嵌入页带 `sandbox` 属性隔离；script-src 不动；
 *   · 不放 object/base；form-action 锁死。
 *
 * 为什么不用 `bypassCSP: true` 换省事：那等于让这个协议绕过整份 CSP，越权面比白名单大。
 */
export const CSP_CONTENT = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https: ${WALLPAPER_ORIGIN}`,
  "font-src 'self' data:",
  `media-src 'self' data: blob: ${WALLPAPER_ORIGIN}`,
  "connect-src 'self' http: https: ws: wss:",
  "worker-src 'self' blob:",
  // 2026-11-16（业主批「准放 CSP」）：网站壁纸要能嵌 **https** 页面。
  // 放开面严格限在 `frame-src https:`：不放 data:/blob:/http:，不动 script-src，不动 object/base/form。
  "frame-src https:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** 需要放行壁纸协议的指令（判卷用它逐条点名，不靠"看着像"）。 */
export const WALLPAPER_CSP_DIRECTIVES = ["img-src", "media-src"] as const;