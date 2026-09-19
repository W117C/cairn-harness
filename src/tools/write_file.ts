import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { appendImpact, assertNotAgentArea, assertNotAgentAreaReal, assertRealContainment, resolveInWorkspace, type Tool, type ToolResult } from "./base.js";
import { collectDiagnostics } from "./lsp.js";
import { contentLines, isNearCopyRewrite, lineDelta } from "./line-delta.js";

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
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > WRITE_LIMIT_BYTES) {
      throw new Error(`write_file: 内容 ${bytes} 字节，超过 50KB 上限，已拒绝写入: ${rel}`);
    }
    // 覆盖前先拿旧内容：只为算行增减（写盘本身不依赖它）。
    // "" = 拿不到旧内容 ⇒ 按新建口径报；null = 旧文件大到不值得读 ⇒ 退回旧口径只报字节数，
    // 不拿「不知道」当「新建」。读失败的非 ENOENT 分支不单独处理：那种路径紧随的 writeFile
    // 同样会失败，永远走不到这里——为它写一条测不到的分支就是本仓忌的防御性死码。
    let oldText: string | null = null;
    try {
      const st = await stat(abs);
      oldText = st.size <= DELTA_READ_LIMIT_BYTES ? await readFile(abs, "utf8") : null;
    } catch {
      oldText = "";
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
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
    // M2a 诊断回流：成功写盘后等诊断（LSP 未配置 = 空串，输出不变）
    const diag = await collectDiagnostics(ctx.workspace, abs);
    // M7 影响面：写盘成功后回注跨文件波及（best-effort，见 appendImpact）。
    const output = await appendImpact(ctx, rel, summary + diag);
    return { ok: true, output };
  },
};
