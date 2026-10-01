// 补丁级输入：一次调用落多处、跨文件，失败逐 hunk 归因。
//
// 存在的理由按基线读数排（`outputs/m2-apply-patch-2026-10-01/readings.md`）：
// ① 本仓真实提交里「一笔改动 = 中位 3–10 处 hunk」，edit_file 的形状是**一处一次调用**（n=60：680 次 vs 60 次）；
// ② 跨文件的改动没有原子性——逐处替换写到第 5 处失败时，前 4 处已经在盘上；
// ③ 源码侧字符省 11–16%（上下文只抄一遍），但这不是主打，主打是①②；
// ④ 行数读数用 hunk 声明的 +/- 计数，与 `git diff --stat` 同口径（现 `lineDelta` 是多重集差，实测 2.7–3.6% 的文件差 1–2 行）。
//
// 写盘纪律全部复用 `base.ts` 的四道闸 + `snapshot.ts` + `lsp.ts` + 影响面回注：本工具不另立第二套。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  appendImpact,
  assertNotAgentArea,
  assertNotAgentAreaReal,
  assertRealContainment,
  resolveInWorkspace,
  ToolError,
  type Tool,
  type ToolResult,
} from "./base.js";
import { collectDiagnostics } from "./lsp.js";
import { snapshotBeforeOverwrite, snapshotNote } from "./snapshot.js";
import { contentLines } from "./line-delta.js";
import { parsePatch, PatchParseError, type PatchFile, type PatchHunk } from "./patch-parse.js";

/** 补丁正文上限：比 write_file 的单文件 50KB 宽（补丁天然跨文件），但必须有界——
 *  没有上限的入参会让一次调用把上下文面撑爆，且报错文本也跟着无界。
 *  导出给验收探针：超限是**设计边界**（与删除/改名/二进制同类），探针要按同一事实源分类，
 *  抄第二份魔数就又是两处会漂的真相。 */
export const PATCH_LIMIT_BYTES = 256 * 1024;
/** 行号漂移时的搜索半径：git apply 的 fuzz 也是有限窗口，全文无约束搜索会把「改错地方」变成概率事件。 */
const SEARCH_WINDOW = 400;
/** 逐文件清单的打印上限（报错与回执都要有界，超了只点名前若干处并如实报余数）。 */
const LIST_CAP = 20;
/** 单条归因里期望/实际文本的截断长度（沿用 edit_file 的「失败路径也不能把上下文撑爆」口径）。 */
const SNIPPET_CAP = 120;

const clip = (s: string): string => (s.length > SNIPPET_CAP ? s.slice(0, SNIPPET_CAP) + "…" : s);

/** 一份文件内容拆成「行 + 结尾有没有换行」。`contentLines` 已经把尾部空元素去掉了，
 *  但「结尾有换行」这件事只有这里能恢复出来，`\ No newline at end of file` 必须靠它判。 */
interface FileText {
  lines: string[];
  endsWithNewline: boolean;
}
const toText = (raw: string): FileText => ({
  lines: contentLines(raw),
  endsWithNewline: raw !== "" && raw.endsWith("\n"),
});
const fromText = (t: FileText): string => (t.lines.length === 0 ? "" : t.lines.join("\n") + (t.endsWithNewline ? "\n" : ""));

const beforeOf = (h: PatchHunk): string[] => h.lines.filter((l) => l.mark !== "+").map((l) => l.text);
const afterOf = (h: PatchHunk): string[] => h.lines.filter((l) => l.mark !== "-").map((l) => l.text);

interface Placement {
  hunk: PatchHunk;
  /** 旧文件里这一段的起始下标（0-based）。 */
  at: number;
  /** 与补丁声明行的偏差（0 = 行号准）：非 0 要报出来，模型得知道补丁是从哪个版本抄的。 */
  offset: number;
}

/** 一个 hunk 的失败归因：位置 + 期望首行 + 该处实际首行。光说「对不上」等于让模型重读整个文件。 */
function mismatchError(f: PatchFile, h: PatchHunk, seq: number, at: number, actual: string | undefined): string {
  const expect = beforeOf(h)[0] ?? afterOf(h)[0] ?? "";
  const where = actual === undefined ? "文件到这里已经结束了" : `实际是 ${JSON.stringify(clip(actual))}`;
  return (
    `${f.path} 第 ${String(seq)} 个 hunk（补丁第 ${String(h.declaredAt)} 行，声明旧侧第 ${String(h.oldStart)} 行起）上下文对不上：` +
    `期望 ${JSON.stringify(clip(expect))}，${where}`
  );
}

/** 在窗口内找这一段的落点：先试声明行号，再按上下文中轴向外扩。要求**逐字**相同（不做空白模糊匹配，
 *  静默改到别处比改不动危险得多——与 edit_file 的「只定位不替换」同一条纪律）。 */
function locate(f: PatchFile, h: PatchHunk, seq: number, lines: string[]): Placement | string {
  const before = beforeOf(h);
  const declared = h.oldStart - 1;
  const matches = (at: number): boolean => {
    if (at < 0 || at + before.length > lines.length) return false;
    for (let i = 0; i < before.length; i++) if (lines[at + i] !== before[i]) return false;
    return true;
  };
  if (before.length === 0) {
    // 纯新增 hunk（`-0,0` 或前后都无上下文时）：只能按声明行号插，越界就报。
    const at = Math.min(Math.max(declared, 0), lines.length);
    if (declared > lines.length) return mismatchError(f, h, seq, at, undefined);
    return { hunk: h, at, offset: 0 };
  }
  if (matches(declared)) return { hunk: h, at: declared, offset: 0 };
  const lo = Math.max(0, declared - SEARCH_WINDOW);
  const hi = Math.min(lines.length - before.length, declared + SEARCH_WINDOW);
  let found = -1;
  let ambiguous = 0;
  for (let i = lo; i <= hi; i++) {
    if (!matches(i)) continue;
    if (found === -1) found = i;
    ambiguous++;
  }
  if (found === -1) {
    const actual = lines[declared] === undefined ? undefined : lines[declared];
    return mismatchError(f, h, seq, declared, actual);
  }
  // 多处一样：不猜。上下文本就不足以唯一定位，猜中是运气，猜错是静默改错地方。
  if (ambiguous > 1) {
    return (
      `${f.path} 第 ${String(seq)} 个 hunk（补丁第 ${String(h.declaredAt)} 行）在声明行号 ±${String(SEARCH_WINDOW)} 行内匹配到 ${String(ambiguous)} 处，` +
      `无法唯一定位：请多带几行上下文，或改用 edit_file 显式指定`
    );
  }
  return { hunk: h, at: found, offset: found - declared };
}

/** 校验 + 生成新内容（不写盘）。返回 string[] 失败清单，空数组 = 可以写。 */
function buildFile(f: PatchFile, raw: string): { text: FileText; offsets: number[]; add: number; rem: number } | string[] {
  const text = toText(raw);
  const failures: string[] = [];
  const placements: Placement[] = [];
  for (let i = 0; i < f.hunks.length; i++) {
    const r = locate(f, f.hunks[i], i + 1, text.lines);
    if (typeof r === "string") failures.push(r);
    else placements.push(r);
  }
  if (failures.length > 0) return failures;

  const out: string[] = [];
  let cursor = 0;
  let coversEof = false;
  let lastNewNoNewline = false;
  let add = 0;
  let rem = 0;
  const offsets: number[] = [];
  for (const p of placements) {
    if (p.at < cursor) {
      failures.push(`${f.path} 第 hunk（补丁第 ${String(p.hunk.declaredAt)} 行）与上一处重叠（声明旧侧第 ${String(p.hunk.oldStart)} 行落在已用区间内）`);
      continue;
    }
    for (let i = cursor; i < p.at; i++) out.push(text.lines[i]);
    out.push(...afterOf(p.hunk));
    cursor = p.at + beforeOf(p.hunk).length;
    coversEof = cursor >= text.lines.length;
    lastNewNoNewline = p.hunk.newNoNewline;
    offsets.push(p.offset);
    for (const l of p.hunk.lines) {
      if (l.mark === "+") add++;
      else if (l.mark === "-") rem++;
    }
  }
  if (failures.length > 0) return failures;
  for (let i = cursor; i < text.lines.length; i++) out.push(text.lines[i]);

  // 结尾换行：只有覆盖到文件末的那一个 hunk 说话才算（`\ No newline` 在中间段是补丁自身的形状，不是文件末的形状）。
  const endsWithNewline = coversEof ? !lastNewNoNewline : text.endsWithNewline;
  return { text: { lines: out, endsWithNewline }, offsets, add, rem };
}

interface Prepared {
  file: PatchFile;
  rel: string;
  abs: string;
  result: { text: FileText; offsets: number[]; add: number; rem: number };
  existed: boolean;
}

export const apply_patch: Tool = {
  name: "apply_patch",
  async run(args, ctx): Promise<ToolResult> {
    const patch = args.patch;
    if (typeof patch !== "string") throw new ToolError("apply_patch: patch 必须是字符串（统一 diff 全文）");
    if (patch.trim() === "") throw new ToolError("apply_patch: 补丁为空，没有任何内容改动");
    const bytes = Buffer.byteLength(patch, "utf8");
    if (bytes > PATCH_LIMIT_BYTES) {
      throw new ToolError(`apply_patch: 补丁 ${String(bytes)} 字节，超过 ${String(PATCH_LIMIT_BYTES / 1024)}KB 上限，已拒绝（请拆成多笔或整文件 write_file）`);
    }

    let files: PatchFile[];
    try {
      files = parsePatch(patch);
    } catch (e) {
      if (e instanceof PatchParseError) throw new ToolError(`apply_patch: ${e.message}`);
      throw e;
    }
    if (files.length === 0) throw new ToolError("apply_patch: 补丁里找不到任何 `diff --git` 段，没有任何内容改动");

    // —— 第一趟：所有段先过闸与可应用性，任何一处不过就整笔不写盘。
    const failures: string[] = [];
    const prepared: Prepared[] = [];
    const skipped: string[] = [];
    for (const f of files) {
      if (f.op === "binary") {
        failures.push(`${f.path}（补丁第 ${String(f.headerLine)} 行）是二进制文件，统一 diff 里没有可应用的内容，已拒绝`);
        continue;
      }
      if (f.op === "delete") {
        failures.push(`${f.path}（补丁第 ${String(f.headerLine)} 行）要求删除文件，本工具只应用内容改动：删除请显式逐笔做`);
        continue;
      }
      if (f.op === "rename") {
        failures.push(`${f.path}（补丁第 ${String(f.headerLine)} 行）要求改名/移动，本工具只应用内容改动：移动请显式逐笔做`);
        continue;
      }
      if (f.op === "mode" || f.hunks.length === 0) {
        skipped.push(`${f.path}（仅模式变更，无内容改动）`);
        continue;
      }
      if (f.path === "") {
        failures.push(`补丁第 ${String(f.headerLine)} 行的段没有可识别的目标路径`);
        continue;
      }
      let abs: string;
      try {
        abs = resolveInWorkspace(ctx.workspace, f.path, "apply_patch");
        assertNotAgentArea(f.path, "apply_patch");
        await assertRealContainment(ctx.workspace, abs, "apply_patch");
        await assertNotAgentAreaReal(ctx.workspace, abs, "apply_patch"); // C3：软链落点复查
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e));
        continue;
      }
      let raw: string | null = null;
      try {
        raw = await readFile(abs, "utf8");
      } catch {
        raw = null;
      }
      const existed = raw !== null;
      if (f.op === "update" && raw === null) {
        failures.push(`${f.path} 不存在或不可读，但补丁把它当已有文件改（新建的补丁该带「--- /dev/null」）`);
        continue;
      }
      if (f.op === "create" && existed) {
        failures.push(`${f.path} 已经存在，但补丁把它当新建（「--- /dev/null」）：要改已有内容请重新生成补丁`);
        continue;
      }
      const built = buildFile(f, raw === null ? "" : raw);
      if (Array.isArray(built)) {
        failures.push(...built);
        continue;
      }
      prepared.push({ file: f, rel: f.path, abs, result: built, existed });
    }

    if (failures.length > 0) {
      const head = failures.slice(0, LIST_CAP);
      const rest = failures.length - head.length;
      throw new ToolError(
        `apply_patch: ${String(failures.length)} 处不可应用，整笔未写盘（${String(files.length)} 段中 ${String(prepared.length)} 段本可落地）：\n` +
          head.map((s) => "  · " + s).join("\n") +
          (rest > 0 ? `\n  · …另有 ${String(rest)} 处未列` : ""),
      );
    }
    if (prepared.length === 0) {
      throw new ToolError(`apply_patch: 补丁里没有可应用的内容改动（${skipped.length > 0 ? skipped.join("；") : "全是空段"}）`);
    }

    // —— 第二趟：校验全过了才动盘。快照排在「不可应用」那道拒绝之后（与 edit_file 的 D7 同纪律）。
    const notes: string[] = [];
    let totalAdd = 0;
    let totalRem = 0;
    let snapshotId: string | undefined;
    for (const p of prepared) {
      const s = ctx.snapshot === false || !p.existed ? null : await snapshotBeforeOverwrite(ctx.workspace, p.abs, p.rel, ctx.callId);
      // 新建文件的父目录可能整条都不存在（write_file 同纪律）：真数据探针在 138/163 笔上撞到的就是这条。
      await mkdir(dirname(p.abs), { recursive: true });
      await writeFile(p.abs, fromText(p.result.text), "utf8");
      totalAdd += p.result.add;
      totalRem += p.result.rem;
      const offsetNote = p.result.offsets.filter((o) => o !== 0);
      notes.push(
        `  ${p.rel} +${String(p.result.add)} −${String(p.result.rem)}` +
          (offsetNote.length > 0 ? `（${String(offsetNote.length)} 处行号漂移，最大偏差 ${String(Math.max(...offsetNote.map(Math.abs)))} 行）` : "") +
          (s !== null ? snapshotNote(s) : ""),
      );
      if (s !== null && snapshotId === undefined) snapshotId = s;
    }

    const summary =
      `已应用补丁（${String(prepared.length)} 文件 / ${String(prepared.reduce((n, p) => n + p.file.hunks.length, 0))} hunk，` +
      `+${String(totalAdd)} −${String(totalRem)} 行）\n` +
      notes.slice(0, LIST_CAP).join("\n") +
      (notes.length > LIST_CAP ? `\n  …另有 ${String(notes.length - LIST_CAP)} 个文件未列` : "") +
      (skipped.length > 0 ? `\n  跳过：${skipped.slice(0, LIST_CAP).join("；")}` : "");

    // 写后诊断与影响面：与 edit_file/write_file 同一套（每个落盘文件各问一次）。
    let output = summary;
    for (const p of prepared) {
      const diag = await collectDiagnostics(ctx.workspace, p.abs);
      if (diag !== "") output = await appendImpact(ctx, p.rel, output + diag);
    }
    return {
      ok: true,
      output,
      change: prepared.every((p) => !p.existed) ? "created" : "modified",
      ...(snapshotId !== undefined ? { snapshotId } : {}),
    };
  },
};
