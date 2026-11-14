// 壁纸协议常量（2026-11-14 · 设计规格 §3.2）：主进程与渲染层共用一份真值。
//
// 单独一个文件、而不是塞进 `src/main/ipc-protocol.ts`：那份是**类型面**
// （除协议版本常量外全部 type-only，跨层引用不产生运行时依赖），
// 这里要的是两个真值——协议名与媒体地址前缀。
//
// 为什么要有共享常量：渲染层拼 `cairn-wallpaper://media/current?v=N`、
// 主进程注册同名 scheme；两处各写一份字符串，早晚漂（而漂了的表现是
// 「壁纸选了但什么也没变」，极难一眼看出是地址写错）。
export const WALLPAPER_SCHEME = "cairn-wallpaper";

/** 媒体地址前缀。`?v=<revision>` 由渲染层拼在后面（破浏览器缓存）。 */
export const WALLPAPER_MEDIA_URL = `${WALLPAPER_SCHEME}://media/current`;
