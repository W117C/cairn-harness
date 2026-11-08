// Composer 的纯展示手柄（2026-11-05 从 Composer.tsx 抽出：该文件已贴 1200 行帽，
// 再往里加一行就过界；这些函数不依赖组件状态，抽出来不改变任何行为）。
// 测试仍从 Composer 导入同名符号——Composer 原样 re-export，判卷口径不动。
import { formatBytes } from "../derived/format-bytes";
import { STR } from "../strings";

/** 拖放路径（蓝本 §3.1）：走 preload 的 webUtils 桥（pathForFile）；桥缺席（旧 preload）返回
 *  null——不造假路径（宁可不加引用，也不添一条主进程必拒的伪路径）。 */
export function filePathOf(file: File): string | null {
  const api = window.agent as unknown as { pathForFile?: (f: File) => string };
  try {
    const p = api.pathForFile?.(file);
    return p !== undefined && p !== "" ? p : null;
  } catch {
    return null;
  }
}

/** 加入队列钮的显隐判据（纯函数，判卷锚）：运行中且**有话说**才出现——
 *  空输入下只留打断钮，不摆一枚禁用的灰钟（v7.1 业主裁；旧形态是常驻 + disabled）。 */
export function showQueueButton(running: boolean, canSend: boolean): boolean {
  return running && canSend;
}

/** 附件 chip 图标分类（纯函数，判卷锚）：图片族按扩展名认，其余文件兜底（目录由 kind 决定）。 */
export function fileIconKind(name: string): "image" | "file" {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  return ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "svg", "avif"].includes(ext) ? "image" : "file";
}

/** 附件小字大小（拿不到不显；B/KB/MB 人话刻度——纯函数）。实现见 `derived/format-bytes.ts`
 *  （第 924 页：与日志窗同一把尺；此前这里对 512 字节只写裸数 "512"）。 */
export function formatSize(n: number): string {
  return formatBytes(n) ?? STR.composer.dash;
}

export const baseNameOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1);
