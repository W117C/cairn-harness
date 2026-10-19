// 补丁级输入：一次调用落多处、跨文件，失败逐 hunk 归因。
//
// 存在的理由按基线读数排（`outputs/m2-apply-patch-2026-10-01/readings.md`）：
// ① 本仓真实提交里「一笔改动 = 中位 3–10 处 hunk」，edit_file 的形状是**一处一次调用**（n=60：680 次 vs 60 次）；
// ② 跨文件的改动没有原子性——逐处替换写到第 5 处失败时，前 4 处已经在盘上；
// ③ 源码侧字符省 11–16%（上下文只抄一遍），但这不是主打，主打是①②；
// ④ 行数读数用 hunk 声明的 +/- 计数，与 `git diff --stat` 同口径（现 `lineDelta` 是多重集差，实测 2.7–3.6% 的文件差 1–2 行）。
//
// 写盘纪律全部复用 `base.ts` 的四道闸 + `snapshot.ts` + `lsp.ts` + 影响面回注：本工具不另立第二套。
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, posix } from "node:path";
import {
  appendImpact,
  assertNotAgentArea,
  assertNotAgentAreaReal,
  assertNotFrozenReal,
  assertNotSensitivePathReal,
  assertRealContainment,
  resolveInWorkspace,
  resolveWriteTarget,
  ToolError,
  type Tool,
  type ToolResult,
} from "./base.js";
import { collectDiagnostics } from "./lsp.js";
import { snapshotBeforeOverwrite, snapshotNote } from "./snapshot.js";
import { contentLines } from "./line-delta.js";
import { tmpPathFor } from "../atomic-write.js";
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
    // **纯新增时 oldStart 是"插在旧文件第几行之后"**（git 口径：`@@ -2,0 +3 @@` 的新内容跟在
    // 旧第 2 行后面）。0-based 落点因此是 `oldStart`，不是 `oldStart - 1`——后者会让每一次
    // 中间插入都整体早一行（往文件尾追加时甚至插到末行之前），而回执照报 `ok: true`：
    // 静默改错地方比改不动危险得多。`@@ -0,0`（新建）两式都落到 0，行为不变。
    const at = Math.min(Math.max(h.oldStart, 0), lines.length);
    if (h.oldStart > lines.length) return mismatchError(f, h, seq, at, undefined);
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
  let lastOldNoNewline = false;
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
    lastOldNoNewline = p.hunk.oldNoNewline;
    offsets.push(p.offset);
    for (const l of p.hunk.lines) {
      if (l.mark === "+") add++;
      else if (l.mark === "-") rem++;
    }
  }
  if (failures.length > 0) return failures;
  for (let i = cursor; i < text.lines.length; i++) out.push(text.lines[i]);

  // 结尾换行：只有覆盖到文件末的那一个 hunk 说话才算（`\ No newline` 在中间段是补丁自身的形状，不是文件末的形状）。
  //
  // **不能只看新侧就完事**：补丁完全不带 `\ No newline` 标记是常见形状（手写补丁、别处抄来的），
  // 那时 `newNoNewline` 恒为 false，只看它就会给一个本来没有行尾换行的文件强加 `\n`——
  // git apply 在这一格的真值是保持原样。
  //
  // git 的记法实测（`git diff` 自己产的两种补丁）：
  //   · 结果无换行 ⇒ 标记跟在**新侧**末行之后（`newNoNewline = true`）；
  //   · 结果有换行、而原文件末行没有 ⇒ 标记跟在**旧侧**末行之后（`oldNoNewline = true`）。
  // 所以 `oldNoNewline` **不是**"不参与结果形状"：它恰恰说明新结果**有**行尾换行。
  // 旧实现完全忽略它 ⇒「无换行 → 有换行」的补丁被反向执行成仍然无换行（与 git apply 相反）。
  // 判据是：
  //   ① 新侧标了     ⇒ 无换行（git 常规形状，也是既有测试钉的那两格）
  //   ② 旧侧标了     ⇒ 有换行（原文件无、结果有）
  //   ③ 两侧都没标   ⇒ 原文件怎样就怎样（不替用户决定要不要行尾换行）
  // 例外是**新建文件**（`--- /dev/null`）：没有"原文件"可保持，而 git 对这一族补丁从不放
  // `\ No newline` 标记、产出的却是带行尾换行的文件（POSIX 文本文件也以换行结尾）
  // ⇒ 新建的缺省就是有换行。少了这一支，新建文件会写成无行尾换行。
  const endsWithNewline = f.op === "create" ? !lastNewNoNewline
    : coversEof && lastNewNoNewline ? false
      : coversEof && lastOldNoNewline ? true
        : text.endsWithNewline;
  return { text: { lines: out, endsWithNewline }, offsets, add, rem };
}

interface Prepared {
  file: PatchFile;
  rel: string;
  abs: string;
  result: { text: FileText; offsets: number[]; add: number; rem: number };
  /** 落盘后的文件模式：new mode 优先，否则沿用原文件（新建未指定 = undefined）。 */
  mode?: number;
  /** 覆盖前快照 id（没拍 / 关着快照 = null）。回执用它，所以挂在数据结构上而不是局部变量。
   *  **不用于回滚**：快照是 best-effort 且可被 `ctx.snapshot === false` 关掉，回滚不能依赖它。 */
  snap: string | null;
  /** 原文件内容（新建 = null）。多文件写入中途失败时靠它把已落盘的恢复回去。 */
  original: string | null;
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
    // 同一路径被拆成多段：每段都基于同一份旧内容各自构造结果，逐个 rename 时后者胜、
    // 前一段改动静默消失（git apply 对同形输入直接报 corrupt patch）。
    const seenPaths = new Map<string, number>();
    /** 真实落点去重：`link.txt`（软链→real.txt）与 `real.txt` 两段在词法上不同，
     *  解析后是同一个 inode；逐段 rename 会让前一段静默消失。 */
    const resolvedPaths = new Map<string, string>();
    for (const f of files) {
      if (f.path === "") continue;
      const key = posix.normalize(f.path.split("\\").join("/").replace(/^\.\//, ""));
      const prev = seenPaths.get(key);
      if (prev !== undefined) {
        failures.push(`${f.path}（补丁第 ${String(f.headerLine)} 行）与第 ${String(prev)} 行是同一路径的两段：逐段写会静默丢掉前一段，请合并成一段，或拆成两次 apply_patch`);
      } else {
        seenPaths.set(key, f.headerLine);
      }
    }
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
        await assertNotFrozenReal(ctx.workspace, abs, "apply_patch"); // L0：软链/大小写落到判卷文件
        await assertNotSensitivePathReal(ctx.workspace, abs, "apply_patch");
        // 写穿软链：temp+rename 会替换软链本身（同 write_file 的 path-boundary 回归）。
        abs = await resolveWriteTarget(ctx.workspace, abs, "apply_patch");
        const prior = resolvedPaths.get(abs);
        if (prior !== undefined) {
          failures.push(`${f.path} 与 ${prior} 解析到同一真实文件（软链/大小写别名）：逐段写会静默丢掉前一段`);
          continue;
        }
        resolvedPaths.set(abs, f.path);
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e));
        continue;
      }
      let raw: string | null = null;
      let originalMode: number | undefined;
      try {
        const buf = await readFile(abs);
        // 非 UTF-8 / 二进制：按 utf8 解码会把非法字节变成 U+FFFD，整文件写回时未被 hunk
        // 触碰的行也一起被永久替换。这里 fail-visible 拒绝，不静默改坏文件。
        if (buf.includes(0)) {
          failures.push(`${f.path} 是二进制文件（含 NUL 字节），内容补丁已拒绝`);
          continue;
        }
        const decoded = buf.toString("utf8");
        if (!Buffer.from(decoded, "utf8").equals(buf)) {
          failures.push(`${f.path} 不是合法 UTF-8（按 utf8 改写会把非法字节替换成 U+FFFD）；请改用二进制安全的工具`);
          continue;
        }
        raw = decoded;
        originalMode = (await stat(abs)).mode & 0o777;
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
      const requestedMode = f.newMode !== undefined ? Number.parseInt(f.newMode, 8) : undefined;
      prepared.push({ file: f, rel: f.path, abs, result: built, existed, snap: null, original: raw,
        ...(requestedMode !== undefined ? { mode: requestedMode } : originalMode !== undefined ? { mode: originalMode } : {}) });
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
    //
    // 多文件时**逐文件 writeFile 是不原子的**：第 3 个文件写失败（EACCES / 磁盘满 / 路径被占），
    // 前两个已经改完，而回执抛的是裸 fs 错误——「整笔未写盘」这句承诺在这一格是假的，
    // 且模型看不出哪几个已经落了盘。改成两阶段：
    //   ① 全部内容先写进各自的临时文件（**目标文件一个都没碰**）；
    //   ② 全部临时文件就绪才逐个 rename（同目录内 rename 是原子的，且不看目标文件权限）。
    // ① 里任何一笔失败 ⇒ 一个字节都没动盘，直接报失败（这正是"整笔未写盘"该有的形状）。
    // ② 里 rename 失败（极窄窗口）⇒ 把已 rename 的用临时文件反向恢复，并在回执里点名
    //      哪些回滚了、哪些没有——**不静默**，也不把半成品说成成功。
    const notes: string[] = [];
    let totalAdd = 0;
    let totalRem = 0;
    let snapshotId: string | undefined;
    const staged: { p: Prepared; tmp: string }[] = [];
    try {
      for (const p of prepared) {
        p.snap = ctx.snapshot === false || !p.existed ? null : await snapshotBeforeOverwrite(ctx.workspace, p.abs, p.rel, ctx.callId);
        // 新建文件的父目录可能整条都不存在（write_file 同纪律）：真数据探针在 138/163 笔上撞到的就是这条。
        await mkdir(dirname(p.abs), { recursive: true });
        const tmp = tmpPathFor(p.abs);
        await writeFile(tmp, fromText(p.result.text), "utf8");
        // 临时文件按 0666&umask 创建：不补模式，rename 后原 0755/ACL 会被换成 0644。
        if (p.mode !== undefined) await chmod(tmp, p.mode).catch(() => undefined);
        staged.push({ p, tmp });
        if (p.snap !== null && snapshotId === undefined) snapshotId = p.snap;
      }
      // 全部就绪：逐个 rename。同目录内 rename 原子，失败只剩"目录被撤权"这一种，概率极窄。
      const renamed: string[] = [];
      for (const { p, tmp } of staged) {
        try {
          await rename(tmp, p.abs);
          renamed.push(p.rel);
        } catch (err) {
          // 回滚：已 rename 落盘的用**原内容**写回去（不依赖快照——快照 best-effort 且可关）。
          // 新建的文件原本不存在 ⇒ 删掉它。恢复失败的如实点名，不假装干净。
          const rolled: string[] = [];
          const stuck: string[] = [];
          for (const other of staged) {
            if (other.p.rel === p.rel || !renamed.includes(other.p.rel)) continue;
            try {
              if (other.p.original === null) await unlink(other.p.abs).catch(() => {});
              else await writeFile(other.p.abs, other.p.original, "utf8");
              rolled.push(other.p.rel);
            } catch {
              stuck.push(other.p.rel);
            }
          }
          for (const { tmp: t } of staged) await unlink(t).catch(() => {});
          const why = err instanceof Error ? err.message : String(err);
          // 恢复不了时才该指路，而且**只指确实存在的路**：没有快照（关着或没拍）时说
          // 「用覆盖前快照取回」是空头承诺——模型照做会发现没有那份原件。那种情形只说 git。
          const recovery = snapshotId !== undefined
            ? `请用覆盖前快照取回（${snapshotId}），或走 git`
            : "本轮没有覆盖前快照，请走 git 取回";
          throw new ToolError(
            `apply_patch: 写入 ${p.rel} 失败（${why}）` +
            (stuck.length > 0
              ? `，已回滚 ${String(rolled.length)} 个，但 ${stuck.join("、")} 没能恢复——这几个文件停在改动后的状态，${recovery}`
              : `，已回滚 ${String(rolled.length)} 个，全部文件回到改动前状态，整笔未写盘`),
          );
        }
      }
      for (const { p } of staged) {
        totalAdd += p.result.add;
        totalRem += p.result.rem;
        const offsetNote = p.result.offsets.filter((o) => o !== 0);
        notes.push(
          `  ${p.rel} +${String(p.result.add)} −${String(p.result.rem)}` +
            (offsetNote.length > 0 ? `（${String(offsetNote.length)} 处行号漂移，最大偏差 ${String(Math.max(...offsetNote.map(Math.abs)))} 行）` : "") +
            (p.snap !== null ? snapshotNote(p.snap) : ""),
        );
      }
    } catch (err) {
      // 阶段①（预写临时文件）失败：目标文件一个都没碰，清掉临时文件即可。
      // 阶段② 的失败已经在上面包成 ToolError（带回滚明细），直接透传。
      if (err instanceof ToolError) throw err;
      for (const { tmp } of staged) await unlink(tmp).catch(() => {});
      const why = err instanceof Error ? err.message : String(err);
      throw new ToolError(
        `apply_patch: 预写阶段失败（${why}）——目标文件一个都没有改动，整笔未写盘` +
        (staged.length > 0 ? `（已写好 ${String(staged.length)} 个临时文件，已清理）` : ""),
      );
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
      changedPaths: prepared.map((p) => p.rel),
      ...(snapshotId !== undefined ? { snapshotId } : {}),
    };
  },
};
