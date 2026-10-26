import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { writeFileAtomic } from "../atomic-write.js";
import {
  appendImpact,
  assertContainedPathIdentity,
  assertNotAgentArea,
  assertNotAgentAreaReal,
  assertNotFrozenReal,
  assertNotSensitivePathReal,
  assertRealContainment,
  captureContainedPath,
  openContainedFile,
  resolveInWorkspace,
  resolveWriteTarget,
  type Tool,
  type ToolResult,
} from "./base.js";
import { snapshotBeforeOverwrite, snapshotNote } from "./snapshot.js";
import { collectDiagnostics } from "./lsp.js";
import { contentLines, isNearCopyRewrite, lineDelta } from "./line-delta.js";

/** 按扩展名给产物分类（用户面据此选入口：图片直接看、HTML/SVG 可预览、其余当源码）。
 *  判据只用后缀名，与 `render_image.isRenderable` / `read_image` 同一条纪律——不看内容。 */
export function artifactKindOf(rel: string): "image" | "html" | "svg" | "text" {
  const dot = rel.lastIndexOf(".");
  const ext = dot > 0 ? rel.slice(dot).toLowerCase() : "";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".svg") return "svg";
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif" || ext === ".webp") return "image";
  return "text";
}

/** 一次成功写盘的产物引用（写工具共用这一个构造口，不在三处各拼一份）。 */
export function artifactFor(rel: string): { kind: "image" | "html" | "svg" | "text"; path: string } {
  return { kind: artifactKindOf(rel), path: rel };
}

// 与 read 对称的 50KB 上限：超出直接拒绝写入——截断写入会静默损坏数据，拒绝才是正确语义。
const WRITE_LIMIT_BYTES = 50 * 1024;
/** 旧内容只为统计行增减；被覆盖的既有文件超过这个尺寸就跳过统计（不值一次大文件读）。 */
const DELTA_READ_LIMIT_BYTES = 256 * 1024;

export const write_file: Tool = {
  name: "write_file",
  async run(args, ctx): Promise<ToolResult> {
    const rel = typeof args.path === "string" ? args.path : "";
    const content = args.content;
    if (typeof content !== "string") {
      throw new Error("write_file: content 参数必须是字符串");
    }
    const abs = resolveInWorkspace(ctx.workspace, rel, "write_file");
    assertNotAgentArea(rel, "write_file");
    await assertRealContainment(ctx.workspace, abs, "write_file");
    await assertNotAgentAreaReal(ctx.workspace, abs, "write_file"); // C3：软链落点复查
    await assertNotFrozenReal(ctx.workspace, abs, "write_file"); // L0：软链/大小写落到判卷文件
    await assertNotSensitivePathReal(ctx.workspace, abs, "write_file"); // 软链落点命中敏感路径
    const targetAbs = await resolveWriteTarget(ctx.workspace, abs, "write_file");
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > WRITE_LIMIT_BYTES) {
      throw new Error(`write_file: 内容 ${bytes} 字节，超过 50KB 上限，已拒绝写入: ${rel}`);
    }
    // 覆盖前先拿旧内容：只为算行增减（写盘本身不依赖它）。
    // "" = 拿不到旧内容 ⇒ 按新建口径报；null = 旧文件大到不值得读 ⇒ 退回旧口径只报字节数，
    // 不拿「不知道」当「新建」。读失败的非 ENOENT 分支不单独处理：那种路径紧随的 writeFile
    // 同样会失败，永远走不到这里——为它写一条测不到的分支就是本仓忌的防御性死码。
    let oldText: string | null = null;
    let existed: boolean | null = null;
    let existingMode: number | undefined;
    let deltaHandle;
    try {
      const opened = await openContainedFile(ctx.workspace, targetAbs, "write_file");
      const { fh, stat: st } = opened;
      deltaHandle = fh;
      if (!st.isFile()) throw Object.assign(new Error("write_file: target is not a regular file"), { code: "EINVAL" });
      existed = true;
      existingMode = st.mode & 0o777;
      oldText = st.size <= DELTA_READ_LIMIT_BYTES ? await fh.readFile("utf8") : null;
    } catch (error) {
      // ENOENT 是可证明的新建；其它 stat 失败只能标 unknown，不能把“看不见”说成“新建”。
      existed = (error as NodeJS.ErrnoException).code === "ENOENT" ? false : null;
      oldText = existed === false ? "" : null;
    } finally {
      await deltaHandle?.close().catch(() => undefined);
    }
    await mkdir(dirname(targetAbs), { recursive: true });
    const parentAbs = dirname(targetAbs);
    const parentIdentity = await captureContainedPath(ctx.workspace, parentAbs, "write_file");
    const guard = () => assertContainedPathIdentity(ctx.workspace, parentAbs, "write_file", parentIdentity);
    // D7：覆盖已有文件前先把原件抄进 .agent/snapshots/（新建文件不占快照；失败不改写盘结果）。
    const snapshotId = ctx.snapshot === false ? null : await snapshotBeforeOverwrite(ctx.workspace, targetAbs, rel, ctx.callId);
    // 原子写：先写临时文件再 rename。直接 writeFile 是 O_TRUNC 后写，ENOSPC/EFBIG 或被硬杀
    // 会留下空文件/半截文件（原内容已截掉）；这里保留原模式（0755 不会被换成 0644）。
    await writeFileAtomic(targetAbs, content, {
      ...(existingMode !== undefined ? { mode: existingMode } : {}),
      guard,
    });
    let summary = `已写入 ${rel}（${bytes} 字节）`;
    if (oldText !== null) {
      const d = lineDelta(oldText, content);
      const oldCount = contentLines(oldText).length;
      summary = oldCount === 0
        ? `已写入 ${rel}（${bytes} 字节，新建 +${d.added} 行）`
        : `已写入 ${rel}（${bytes} 字节，+${d.added} −${d.removed} 行）` +
          (isNearCopyRewrite(oldCount, d.added + d.removed)
            ? `｜提示：这是对已有 ${oldCount} 行文件的整份重写，实际只动 ${d.added + d.removed} 行——同类改动用 edit_file 更省 output，也不会漏抄未改的行。`
            : "");
    }
    if (snapshotId !== null) summary += snapshotNote(snapshotId);
    // M2a 诊断回流：成功写盘后等诊断（LSP 未配置 = 空串，输出不变）
    const diag = await collectDiagnostics(ctx.workspace, targetAbs);
    // M7 影响面：写盘成功后回注跨文件波及（best-effort，见 appendImpact）。
    const output = await appendImpact(ctx, rel, summary + diag);
    return {
      ok: true,
      output,
      // 产物引用：**落盘的那一份**才是权威版本。前端据此给「打开预览/下载/看源码」入口，
      // 用户看到的与盘上逐字节一致——而不是模型在最终回复里重新抄一遍的那份
      // （实测：两次输出的腿部动画数据不同，聊天里看到的与文件里跑的不是同一个动画）。
      artifact: artifactFor(rel),
      ...(existed === true ? { change: "modified" as const } : existed === false ? { change: "created" as const } : {}),
      ...(snapshotId !== null ? { snapshotId } : {}),
    };
  },
};
