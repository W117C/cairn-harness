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
  assertWritablePath,
  captureContainedPath,
  openContainedFile,
  resolveInWorkspace,
  resolveWriteTarget,
  ToolError,
  type Tool,
  type ToolResult,
} from "./base.js";
import { collectDiagnostics } from "./lsp.js";
import { snapshotBeforeOverwrite, snapshotNote } from "./snapshot.js";
import { lineDelta } from "./line-delta.js";

/** 0 匹配时的「最像的位置」提示——把「读错误→重读整个文件→再改」的三轮压成一轮。
 *  只定位不替换：静默改到别处比改不动危险得多，所以这条永远只出现在报错文本里。
 *  两级判据，宁缺毋滥（找不到足够像的就什么都不加）：
 *  ① 首行 trim 后逐字相同 ⇒ 典型是缩进抄丢了；② 词级重合度 ≥ 0.5 ⇒ 典型是变量/函数名换了。 */
function nearestHint(content: string, oldString: string, rel: string): string {
  const wantLines = oldString.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (wantLines.length === 0) return "";
  const want = wantLines[0];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === want) {
      return `｜提示：第 ${String(i + 1)} 行去掉缩进后与你的 old_string 首行逐字相同——多半是缩进没照原文抄。`;
    }
  }
  if (lines.length > 20_000) return ""; // 超大文件不做词级扫描（提示不值这点开销）
  const wantTokens = new Set(want.split(/[^\p{L}\p{N}_$]+/u).filter((t) => t !== ""));
  if (wantTokens.size === 0) return "";
  let best = { line: -1, score: 0, text: "" };
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    let hit = 0;
    for (const t of new Set(trimmed.split(/[^\p{L}\p{N}_$]+/u).filter((x) => x !== ""))) {
      if (wantTokens.has(t)) hit++;
    }
    const score = hit / wantTokens.size;
    if (score > best.score) best = { line: i + 1, score, text: trimmed };
  }
  if (best.score < 0.5 || best.line < 0) return "";
  const shown = best.text.length > 120 ? best.text.slice(0, 120) + "…" : best.text;
  return `｜提示：${rel} 第 ${String(best.line)} 行与你的 old_string 最像（相似度 ${Math.round(best.score * 100)}%）：${shown}`;
}

export const edit_file: Tool = {
  name: "edit_file",
  async run(args, ctx): Promise<ToolResult> {
    const rel = typeof args.path === "string" ? args.path : "";
    const oldString = args.old_string;
    const newString = args.new_string;
    if (typeof oldString !== "string" || oldString.length === 0) {
      throw new ToolError("edit_file: old_string 必须是非空字符串");
    }
    if (typeof newString !== "string") {
      throw new ToolError("edit_file: new_string 必须是字符串");
    }
    const replaceAll = args.replace_all === true;
    const abs = resolveInWorkspace(ctx.workspace, rel, "edit_file");
    assertNotAgentArea(rel, "edit_file");
    await assertRealContainment(ctx.workspace, abs, "edit_file");
    await assertNotAgentAreaReal(ctx.workspace, abs, "edit_file"); // C3：软链落点复查
    await assertNotFrozenReal(ctx.workspace, abs, "edit_file"); // L0：软链/大小写落到判卷文件
    await assertNotSensitivePathReal(ctx.workspace, abs, "edit_file"); // 软链落点命中敏感路径
    const targetAbs = await resolveWriteTarget(ctx.workspace, abs, "edit_file");
    let content: string;
    let existingMode: number | undefined;
    let sourceHandle;
    try {
      const opened = await openContainedFile(ctx.workspace, targetAbs, "edit_file");
      sourceHandle = opened.fh;
      existingMode = opened.stat.mode & 0o777;
      const raw = await opened.fh.readFile();
      // 非 UTF-8 / 二进制：按 utf8 解码 + 整文件写回会把非法字节替换成 U+FFFD，
      // 且未命中的行也会一起被改写。与 apply_patch 同口径 fail-visible。
      if (raw.includes(0)) throw new ToolError("edit_file: 疑似二进制文件（含 NUL 字节），拒绝按文本编辑: " + rel);
      content = raw.toString("utf8");
      if (!Buffer.from(content, "utf8").equals(raw)) {
        throw new ToolError("edit_file: 文件不是合法 UTF-8（按 utf8 回写会替换非法字节）；请改用二进制安全的工具: " + rel);
      }
    } catch (err) {
      if (err instanceof ToolError) throw err;
      throw new ToolError("edit_file: 文件不存在或不可读: " + rel);
    } finally {
      await sourceHandle?.close().catch(() => undefined);
    }
    // 唯一匹配纪律：非唯一且未显式 replace_all 一律拒绝并回报匹配数。
    let count = 0;
    let idx = content.indexOf(oldString);
    while (idx !== -1) {
      count++;
      idx = content.indexOf(oldString, idx + 1);
    }
    if (count === 0) {
      throw new ToolError("edit_file: old_string 在文件中 0 处匹配，未做任何修改: " + rel + nearestHint(content, oldString, rel));
    }
    if (count > 1 && !replaceAll) {
      throw new ToolError("edit_file: old_string 匹配 " + count + " 处（要求唯一）。若确要全部替换，加 replace_all: true: " + rel);
    }
    // 替换一律用「字面量」语义：replace_all 走 split/join；单次替换用回调形式。
    // 若直接写 content.replace(old, new)，new_string 里的 $& / $1 / $` / $' 会被当成
    // 替换模式解释（把匹配到的原文插回去），静默写出错误内容——两个分支必须同口径。
    const updated = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, () => newString);
    await mkdir(dirname(targetAbs), { recursive: true });
    const parentAbs = dirname(targetAbs);
    const parentIdentity = await captureContainedPath(ctx.workspace, parentAbs, "edit_file");
    const guard = async (): Promise<void> => {
      await assertContainedPathIdentity(ctx.workspace, parentAbs, "edit_file", parentIdentity);
      await assertWritablePath(ctx.workspace, targetAbs, "edit_file");
    };
    // D7 覆盖前快照：排在「0 处/多处匹配」两道拒绝**之后**——被拒的编辑不该留下快照（那会是脏文件）。
    const snapshotId = ctx.snapshot === false ? null : await snapshotBeforeOverwrite(ctx.workspace, targetAbs, rel, ctx.callId);
    await writeFileAtomic(targetAbs, updated, {
      ...(existingMode !== undefined ? { mode: existingMode } : {}),
      guard,
    });
    const replacements = replaceAll ? count : 1;
    // 行增减是「改动范围最小」的可核对面：处数只说改了几块，不说动了多少行内容。
    const d = lineDelta(content, updated);
    // M2a 诊断回流：成功写盘后等诊断（LSP 未配置 = 空串，输出不变）
    const diag = await collectDiagnostics(ctx.workspace, targetAbs);
    // M7 影响面：替换成功后回注跨文件波及（best-effort，见 appendImpact）。
    const output = await appendImpact(
      ctx,
      rel,
      "已替换 " + rel + "（" + replacements + " 处，+" + String(d.added) + " −" + String(d.removed) + " 行）" +
        (snapshotId !== null ? snapshotNote(snapshotId) : "") + diag,
    );
    return { ok: true, output, change: "modified", ...(snapshotId !== null ? { snapshotId } : {}) };
  },
};
