// 统一 diff → 「逐文件、逐 hunk 的改盘计划」。纯函数层：零 IO、零副作用，
// 因此语义突变（同一输入不同计划）能在离线判卷里逐条钉住，不必起真工作区。
//
// 只吃 `git diff` 那一族形状（`diff --git` / `--- a/` / `+++ b/` / `@@ -l,s +l,s @@` / 前缀 +/-/空格），
// 不吃 `*** Update File:` 那族：前者能从真实工具输出里原样复制（`git diff`、`git apply --check` 的原料），
// 后者要模型先做一次格式转换，转换本身又是一个静默出错面。

/** 一行补丁内容：mark 是前导标记（' ' 上下文 / '-' 删除 / '+' 新增），text 是去掉标记后的正文。 */
export interface PatchLine {
  mark: " " | "-" | "+";
  text: string;
}

export interface PatchHunk {
  /** `@@ -l,s`：这一侧在**旧文件**里的起始行号（1-based）。 */
  oldStart: number;
  oldCount: number;
  /** `@@ +l,s`：这一侧在**新文件**里的起始行号（1-based）。 */
  newStart: number;
  newCount: number;
  lines: PatchLine[];
  /** 旧/新侧最后一行后面跟了 `\ No newline at end of file` ⇒ 该侧结果文件不以换行结尾。 */
  oldNoNewline: boolean;
  newNoNewline: boolean;
  /** `@@` 行在补丁里的行号（1-based）：截断报错要指认是哪一声明的。 */
  declaredAt: number;
  /** 本 hunk 正文在补丁里**实收的最后一行**（1-based，含 `\ No newline` 那一行）；一行都没收到 ⇒ 缺省。
   *  截断归因靠它说清「抄到第几行停的、停的那行后面还剩下什么」，纯用于回执，不参与解析。 */
  bodyEndLine?: number;
}

export type PatchOp = "update" | "create" | "delete" | "rename" | "binary" | "mode";

export interface PatchFile {
  path: string;
  op: PatchOp;
  hunks: PatchHunk[];
  /** 该段在补丁文本里的起始行号（1-based）：报错时用来指认是第几段出的事。 */
  headerLine: number;
}

/** 补丁本身读不下去。「对不上盘上的内容」不在这一层——那是逐 hunk 归因，见 apply_patch。
 *  `truncation` 只在「hunk 收不满声明行数」那一类出现（带它就把可自纠的读数一并追加在回执里）；
 *  其余形状没有它，回执与从前逐字相同。 */
export class PatchParseError extends Error {
  constructor(message: string, readonly line: number, readonly truncation?: PatchTruncation) {
    super(
      truncation === undefined
        ? `${message}（补丁第 ${String(line)} 行）`
        : `${message}（补丁第 ${String(line)} 行）\n${formatTruncationGuidance(truncation)}`,
    );
    this.name = "PatchParseError";
  }
}

/** —— 截断归因（纯函数层：不碰盘、不起进程，取料由 `parsePatch` 的主循环做）——
 *  回执从前只报「声明几行／实收几行」，模型收到后常见的下一步是把整条补丁逐字重发一遍
 *  （本仓留档轨迹 `outputs/tool-choice-receipt-2026-10-04` 里连着 4 次、一次也没落盘）。
 *  这一层补的是**定位与下一步**：出事的是哪一段第几个 hunk、两侧各差几行、正文抄到补丁第几行停、
 *  停手处紧跟的是什么，以及最要紧的一句归因（回执里那句逐字是「这一步还没跟盘上的内容对照」）——
 *  不改判定、不改 `ok`、不改退出路径。 */

/** 正文之后紧跟的那一行的形状（决定「缺的行在哪儿」这一句怎么说）。 */
export type TruncationAfter = "patch-end" | "header" | "hunk" | "unparsed";

export interface PatchTruncation {
  /** 出事的段：路径（空路径如实留空）、段号/总段数。 */
  path: string;
  fileSeq: number;
  fileCount: number;
  /** 该段内的 hunk 序号/总数。 */
  hunkSeq: number;
  hunksInFile: number;
  declaredAt: number;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  receivedOld: number;
  receivedNew: number;
  /** 声明 − 实收：>0 = 少抄了行，<0 = 多算了行（把下一段/表头算进来了），0 = 这一侧收满。 */
  deltaOld: number;
  deltaNew: number;
  /** 本 hunk 实收正文的最后一行（1-based）；一行都没收到 ⇒ `@@` 行本身。 */
  bodyEndLine: number;
  /** 实收正文的最后若干行（带前导标记，逐条截断）：让模型看见补丁被切在哪。 */
  tail: string[];
  after: TruncationAfter;
  /** 停手处紧跟那一行的行号（1-based）；`after === "patch-end"` 时为 0。 */
  afterLine: number;
  /** 紧跟那一行的内容（截断后）；`after === "patch-end"` 时为空串。 */
  afterText: string;
  /** 整笔补丁的行数（与 `patch-end` 合起来说「你只发了 X 行」）。 */
  patchLines: number;
}

/** 停手处后面那一行的形状：只用于把回执说清楚，**不参与解析**（解析那侧的表头判定在主循环里，
 *  两处分开是有意的——改文案不该动解析）。 */
const SHAPE_PREFIXES: { prefix: string; kind: TruncationAfter }[] = [
  { prefix: "diff --git ", kind: "header" },
  { prefix: "index ", kind: "header" },
  { prefix: "old mode ", kind: "header" },
  { prefix: "new mode ", kind: "header" },
  { prefix: "new file mode ", kind: "header" },
  { prefix: "deleted file mode ", kind: "header" },
  { prefix: "similarity index", kind: "header" },
  { prefix: "rename from ", kind: "header" },
  { prefix: "rename to ", kind: "header" },
  { prefix: "copy from", kind: "header" },
  { prefix: "copy to", kind: "header" },
  { prefix: "Binary files", kind: "header" },
  { prefix: "GIT binary patch", kind: "header" },
  { prefix: "--- ", kind: "header" },
  { prefix: "+++ ", kind: "header" },
];

/** 回执里引用补丁正文的截断长度：报错文本自己也得有界（与 apply_patch 的 SNIPPET_CAP 同纪律，
 *  但那是「文件内容」的窗口、这里是「补丁正文」的窗口，两张表各管各的）。 */
const TAIL_SNIPPET_CAP = 100;
const TAIL_KEEP_LINES = 2;

const clipLine = (s: string): string => (s.length > TAIL_SNIPPET_CAP ? s.slice(0, TAIL_SNIPPET_CAP) + "…" : s);

/** 已收进行文的旧/新侧行数与声明行的差（`at` 由调用方给：段号/段内 hunk 号）。 */
export function patchTruncation(
  lines: string[],
  file: PatchFile,
  hunk: PatchHunk,
  at: { fileSeq: number; fileCount: number; hunkSeq: number },
): PatchTruncation {
  const rem = remaining(hunk);
  const receivedOld = hunk.oldCount - rem.old;
  const receivedNew = hunk.newCount - rem.new;
  const endIdx = hunk.bodyEndLine === undefined ? hunk.declaredAt : hunk.bodyEndLine;
  const nextIdx = endIdx; // 1-based 末行 ⇒ 0-based 的「紧跟下一行」恰是同一个数
  const after = nextIdx >= lines.length
    ? { after: "patch-end" as TruncationAfter, afterLine: 0, afterText: "" }
    : {
        after: HUNK_RE.test(lines[nextIdx])
          ? ("hunk" as TruncationAfter)
          : (SHAPE_PREFIXES.find((s) => lines[nextIdx].startsWith(s.prefix))?.kind ?? ("unparsed" as TruncationAfter)),
        afterLine: nextIdx + 1,
        afterText: clipLine(lines[nextIdx]),
      };
  const tail: string[] = [];
  for (const l of hunk.lines.slice(-TAIL_KEEP_LINES)) tail.push(clipLine(l.mark + l.text));
  return {
    path: file.path,
    fileSeq: at.fileSeq,
    fileCount: at.fileCount,
    hunkSeq: at.hunkSeq,
    hunksInFile: file.hunks.length,
    declaredAt: hunk.declaredAt,
    oldStart: hunk.oldStart,
    oldCount: hunk.oldCount,
    newStart: hunk.newStart,
    newCount: hunk.newCount,
    receivedOld,
    receivedNew,
    deltaOld: hunk.oldCount - receivedOld,
    deltaNew: hunk.newCount - receivedNew,
    bodyEndLine: endIdx,
    tail,
    after: after.after,
    afterLine: after.afterLine,
    afterText: after.afterText,
    patchLines: lines.length,
  };
}

/** 把结构化读数渲染成回执（纯函数）。既有那句「hunk 声明 …（补丁不完整）（补丁第 N 行）」在前、逐字不动，
 *  这里只在其后追加——按文案匹配的老账（`outputs/failure-face-2026-10-04/readings.txt` 那行簇文本）不受影响。 */
export function formatTruncationGuidance(t: PatchTruncation): string {
  const side = (name: string, declared: number, received: number): string => {
    const d = declared - received;
    const how = d === 0 ? "收满" : d > 0 ? `少抄 ${String(d)} 行` : `多算 ${String(-d)} 行`;
    return `${name}声明 ${String(declared)} 行／实收 ${String(received)} 行（${how}）`;
  };
  const where = (t.path === "" ? "（该段没有可识别路径）" : t.path) + ` 第 ${String(t.hunkSeq)}/${String(t.hunksInFile)} 个 hunk`;
  const ends =
    t.tail.length === 0
      ? `本段正文一行都没收到（@@ 之后第 ${String(t.declaredAt + 1)} 行起就不是这一段的内容）`
      : `正文止于补丁第 ${String(t.bodyEndLine)} 行，末 ${String(t.tail.length)} 行：${t.tail.map((s) => JSON.stringify(s)).join(" ⏎ ")}`;
  const after =
    t.after === "patch-end"
      ? `补丁到第 ${String(t.patchLines)} 行就发完了 ⇒ 是这一段**尾部被截**，不是内容对不上`
      : t.after === "header"
        ? `其后第 ${String(t.afterLine)} 行已是下一段的表头（${JSON.stringify(t.afterText)}）⇒ 缺的行在本段末尾，下一段没受影响`
        : t.after === "hunk"
          ? `其后第 ${String(t.afterLine)} 行已是下一个 @@（${JSON.stringify(t.afterText)}）⇒ 缺的行在本段末尾`
          : `其后第 ${String(t.afterLine)} 行没被算进本段正文（${JSON.stringify(t.afterText)}）⇒ 多半是这一行丢了前导标记：上下文行前一个空格、新增行前 +、删除行前 -`;
  const over = t.deltaOld < 0 || t.deltaNew < 0;
  const fix = over
    ? "下一步：实收比声明多 ⇒ 核对 @@ 的四个数字与正文边界后**重发这一段**（少写声明数字会让多出来的行被当成下一段的内容）。"
    : "下一步：只补这一段缺的那几行、其余原样，**别整笔重发**；缺的行必须补回来，不能把 @@ 的声明数字改小——少抄的删除行会原样留在盘上。抄不准就 read_file 重读这一段，或改走 edit_file 逐处替换。";
  const rest =
    t.fileCount > t.fileSeq ? `\n· 本笔共 ${String(t.fileCount)} 段，其后 ${String(t.fileCount - t.fileSeq)} 段本轮还没查到（修好这段可能再撞上同形状读数）。` : "";
  return [
    `· 截断定位（这一步还没跟盘上的内容对照，改行号不会有用）`,
    `· 出事的是 ${where}：@@ 在补丁第 ${String(t.declaredAt)} 行；${side("旧侧", t.oldCount, t.receivedOld)}；${side("新侧", t.newCount, t.receivedNew)}`,
    `· ${ends}；${after}`,
    `· ${fix}${rest}`,
  ].join("\n");
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** `--- a/<path>` / `+++ b/<path>` 去掉前缀；`/dev/null` 返回 null（由 op 判定）。 */
function pathOf(prefix: "a/" | "b/", raw: string): string | null {
  if (raw === "/dev/null") return null;
  const p = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  return p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p;
}

/** 一个 hunk 还差几行：旧侧 = 上下文 + 删除，新侧 = 上下文 + 新增。收满就停手，
 *  多收会把 hunk 之后的下一段表头当成上下文吃进去（本仓教训：分母静默多一格比少一格更难发现）。 */
function remaining(h: PatchHunk): { old: number; new: number } {
  let ctx = 0;
  let del = 0;
  let add = 0;
  for (const l of h.lines) {
    if (l.mark === " ") ctx++;
    else if (l.mark === "-") del++;
    else add++;
  }
  return { old: h.oldCount - ctx - del, new: h.newCount - ctx - add };
}

export function parsePatch(text: string): PatchFile[] {
  const raw = text.split("\n");
  // 补丁以换行结尾时 split 会多出一个尾空元素：它不是上下文行（见上条注释）。
  if (raw.length > 0 && raw[raw.length - 1] === "") raw.pop();

  const files: PatchFile[] = [];
  let cur: PatchFile | null = null;
  let hunk: PatchHunk | null = null;

  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];

    if (line.startsWith("diff --git ")) {
      hunk = null;
      // 直接赋值而不是走闭包：闭包里的 `cur = …` 让 TS 把后面的 `cur` 收窄成 never，
      // 而「编译器看不懂我的控制流」这种写法本身就该避。
      const next: PatchFile = { path: "", op: "update", hunks: [], headerLine: i + 1 };
      files.push(next);
      cur = next;
      continue;
    }
    if (line.startsWith("index ") || line.startsWith("old mode ") || line.startsWith("new mode ") ||
        line.startsWith("similarity index") || line.startsWith("copy from") || line.startsWith("copy to") ||
        line.startsWith("--- ") || line.startsWith("+++ ")) {
      // 段内表头：hunk 到此为止（后面的表头不属于上一个 hunk 的上下文）。
      hunk = null;
      if (cur === null) {
        if (line.startsWith("--- ") || line.startsWith("+++ ")) {
          throw new PatchParseError("出现文件头行但不在某个 `diff --git` 段内", i + 1);
        }
        continue;
      }
      if (line.startsWith("--- ")) {
        const p = pathOf("a/", line.slice(4));
        if (p === null) cur.op = "create"; // `--- /dev/null` = 新建
        else if (cur.path === "") cur.path = p;
      }
      if (line.startsWith("+++ ")) {
        const p = pathOf("b/", line.slice(4));
        if (p === null) cur.op = "delete"; // `+++ /dev/null` = 删除
        else cur.path = p;
      }
      continue;
    }

    const hm = HUNK_RE.exec(line);
    if (hm !== null) {
      if (cur === null) throw new PatchParseError("出现 @@ 行但不在某个 `diff --git` 段内", i + 1);
      hunk = {
        oldStart: Number(hm[1]),
        oldCount: hm[2] === undefined ? 1 : Number(hm[2]),
        newStart: Number(hm[3]),
        newCount: hm[4] === undefined ? 1 : Number(hm[4]),
        lines: [],
        oldNoNewline: false,
        newNoNewline: false,
        declaredAt: i + 1,
      };
      cur.hunks.push(hunk);
      continue;
    }

    if (line.startsWith("Binary files")) {
      if (cur !== null) {
        cur.op = "binary";
        const m = /^Binary files a\/(.*) and b\/.* differ$/.exec(line);
        if (m !== null) cur.path = pathOf("a/", m[1]) ?? cur.path;
      }
      hunk = null;
      continue;
    }
    if (line.startsWith("GIT binary patch")) {
      if (cur !== null) cur.op = "binary";
      hunk = null;
      continue;
    }
    if (line.startsWith("rename from ") || line.startsWith("rename to ")) {
      if (cur !== null) {
        cur.op = "rename";
        const m = /^rename to (.*)$/.exec(line);
        if (m !== null) cur.path = pathOf("b/", m[1]) ?? cur.path;
      }
      continue;
    }

    if (hunk === null) continue; // 段内杂行（空行、`Mode`、注释）一律不吃
    const last = hunk.lines[hunk.lines.length - 1];
    if (line.startsWith("\\")) {
      // `\ No newline at end of file`：归属紧跟其前的那一行所在的一侧。
      hunk.bodyEndLine = i + 1;
      if (last !== undefined) {
        if (last.mark === "-") hunk.oldNoNewline = true;
        else if (last.mark === "+") hunk.newNoNewline = true;
        else {
          hunk.oldNoNewline = true;
          hunk.newNoNewline = true;
        }
      }
      continue;
    }
    const rem = remaining(hunk);
    if (rem.old <= 0 && rem.new <= 0) {
      hunk = null; // 收满了，多余的行不再算上下文
      continue;
    }
    // 记下正文收到的最后一行：只给截断回执定位用，收满/收尾的判定一律照旧走 remaining()。
    if (line.startsWith("+")) { hunk.lines.push({ mark: "+", text: line.slice(1) }); hunk.bodyEndLine = i + 1; }
    else if (line.startsWith("-")) { hunk.lines.push({ mark: "-", text: line.slice(1) }); hunk.bodyEndLine = i + 1; }
    else if (line.startsWith(" ") || line === "") { hunk.lines.push({ mark: " ", text: line.startsWith(" ") ? line.slice(1) : "" }); hunk.bodyEndLine = i + 1; }
    else hunk = null;
  }

  for (let fi = 0; fi < files.length; fi++) {
    const f = files[fi]!;
    if (f.hunks.length === 0 && f.op === "update") f.op = "mode"; // 只有模式/表头、没有内容 hunk 的段
    for (let hi = 0; hi < f.hunks.length; hi++) {
      const h = f.hunks[hi]!;
      const rem = remaining(h);
      // 收不满声明的行数 = 补丁被截断。这里必须出声：少收的那几行一旦当成「hunk 到这就完了」，
      // 应用结果是把该删的行留在盘上、且不报错——比报错坏得多。
      if (rem.old !== 0 || rem.new !== 0) {
        throw new PatchParseError(
          `hunk 声明 -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount}，实收旧侧 ${String(h.oldCount - rem.old)} 行／新侧 ${String(h.newCount - rem.new)} 行（补丁不完整）`,
          h.declaredAt,
          patchTruncation(raw, f, h, { fileSeq: fi + 1, fileCount: files.length, hunkSeq: hi + 1 }),
        );
      }
    }
  }
  return files;
}
