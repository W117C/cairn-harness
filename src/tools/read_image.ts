import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { assertRealContainment, resolveInWorkspace, type Tool, type ToolResult } from "./base.js";

/** 识图工具：把工作区内的一张图片读成 data URL，作为多模态内容块进上下文。
 *
 *  为什么要有它（2026-10-15 读数）：桌面端一场真实会话里，用户发了一张自己产物的截图让 agent 评价，
 *  而 agent **没有任何办法看见它**——`read_file` 按二进制拒读（NUL/不可打印占比），
 *  附件系统只传路径不传内容。于是它只能说「我看不了图，请你用文字描述」，
 *  而它要评价的正是那份自己刚写完的 HTML。缺的是**回路**，不是能力声明。
 *
 *  三道闸，缺一不可：
 *  ① 只收 workspace 内的图片（resolveInWorkspace + assertRealContainment，与 read_file 同口径）；
 *  ② 字节帽（`MAX_IMAGE_BYTES`）——图片直接进请求体，超帽的图要么先缩，要么换别的路；
 *  ③ 只认图片 magic number——拿这个工具读任意二进制是错的，文件名后缀由攻击者说了算。
 */

/** 单图字节帽。5MB 约等于 2048×2048 的 PNG；再大的图先让用户缩，而不是把请求体撑爆。 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** 认得的图片类型（magic number → MIME）。**不认后缀名**：`.png` 后缀下可以是任意字节，
 *  而把任意字节当 image/png 送进请求体，上游只会回一句难以归因的 400。 */
const MAGIC: readonly { mime: string; test: (b: Buffer) => boolean }[] = [
  { mime: "image/png", test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: "image/jpeg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/gif", test: (b) => b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  // 判到第 12 字节 ⇒ 长度判据是 >= 12（写成 > 12 会把正好 12 字节的合法 WebP 误判成非图片）。
  { mime: "image/webp", test: (b) => b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" },
];

/** 按 magic number 判图片类型（纯函数，判卷直接钉——后缀名不参与判定）。 */
export function sniffImageMime(buf: Buffer): string | null {
  for (const m of MAGIC) if (m.test(buf)) return m.mime;
  return null;
}

export const READ_IMAGE_DESCRIPTION =
  "读取工作区内的一张图片并放入上下文（识图）。" +
  "何时用：用户发了截图/设计稿/报错界面图片，或需要核对刚生成的可视化产物；" +
  "何时不用：要读源码、配置、日志等文本内容用 read_file；不要用它试探任意二进制文件。" +
  "约束：只接受工作区内路径；单图 ≤ " + String(Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)) + "MB；" +
  "图片按 data URL 整体进上下文，一次别读太多张。";

export const read_image: Tool = {
  name: "read_image",
  async run(args, ctx): Promise<ToolResult> {
    const rel = args.path;
    if (typeof rel !== "string" || rel.trim() === "") {
      throw new Error("read_image: path 参数必须是非空字符串");
    }
    const abs = resolveInWorkspace(ctx.workspace, rel.trim(), "read_image");
    // 软链穿透：与 read_file/grep/glob 同一道闸（词法 resolve 挡不住「界内软链指向界外」）。
    await assertRealContainment(ctx.workspace, abs, "read_image");
    let st;
    try {
      st = await stat(abs);
    } catch {
      throw new Error("read_image: 文件不存在或不可读: " + rel);
    }
    if (!st.isFile()) throw new Error("read_image: 不是文件: " + rel);
    if (st.size > MAX_IMAGE_BYTES) {
      throw new Error(
        "read_image: 图片超过 " + String(Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)) + "MB 帽（实际 " +
          String(Math.ceil(st.size / 1024 / 1024)) + "MB）——先缩到帽内再读，或分块描述你要看的部分",
      );
    }
    if (st.size === 0) throw new Error("read_image: 空文件不是图片: " + rel);
    const buf = await readFile(abs);
    const mime = sniffImageMime(buf);
    if (mime === null) {
      throw new Error(
        "read_image: 不是可识别的图片（PNG/JPEG/GIF/WebP）: " + rel +
          "——后缀名不作为判据；要读文本内容请用 read_file",
      );
    }
    const dataUrl = "data:" + mime + ";base64," + buf.toString("base64");
    return {
      ok: true,
      // output 是给人/日志看的摘要；真正进上下文的是下面这个结构化块。
      output: "[image] " + basename(rel) + "（" + mime + "，" + String(st.size) + " 字节）已作为图片内容块附上",
      images: [{ type: "image", dataUrl }],
    };
  },
};
