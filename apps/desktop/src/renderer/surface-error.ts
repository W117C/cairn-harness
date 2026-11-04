// 错误条的结构化载荷（2026-11-02 真机订正）。
//
// 为什么不用一串字符串：**原因、依据、下一步是三件不同的事**。
// 拍平成一行（用「——」串起来）之后，读的人分不清哪句是结论、哪句是证据、哪句是自己该做的事——
// 真机截图里那行「预览失败（spec）：这个文件夹里有网页，但没有入口页 index.html——根目录的网页：
// pelican-bicycle.html——把主页改名成 index.html（或新增一个）再导入一次……」就是这么来的：
// 三句拍在一起，最该被看见的「下一步」排在最后，前面还夹着一句内部代号。
//
// 本仓已有一份同口径的结构（导入诊断卡：为什么 / 下一步）——错误条只是没跟上，不是缺能力。
export interface SurfaceError {
  /** 标题：这件事怎么了 + 坏在哪一步（例：预览失败 · 识别项目）。 */
  title: string;
  /** 原因：一句话说清为什么没成。 */
  body?: string;
  /** 依据：凭什么这么判（逐条）。 */
  reasons?: readonly string[];
  /** 下一步：用户现在能做的事。 */
  next?: string;
}

/** 判断一个错误载荷是不是结构化的（渲染层据此选两套排版）。 */
export function isSurfaceError(value: unknown): value is SurfaceError {
  return typeof value === "object" && value !== null && typeof (value as { title?: unknown }).title === "string";
}
