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
}

export type PatchOp = "update" | "create" | "delete" | "rename" | "binary" | "mode";

export interface PatchFile {
  path: string;
  op: PatchOp;
  hunks: PatchHunk[];
  /** 该段在补丁文本里的起始行号（1-based）：报错时用来指认是第几段出的事。 */
  headerLine: number;
}

/** 补丁本身读不下去。「对不上盘上的内容」不在这一层——那是逐 hunk 归因，见 apply_patch。 */
export class PatchParseError extends Error {
  constructor(message: string, readonly line: number) {
    super(`${message}（补丁第 ${String(line)} 行）`);
    this.name = "PatchParseError";
  }
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
    if (line.startsWith("+")) hunk.lines.push({ mark: "+", text: line.slice(1) });
    else if (line.startsWith("-")) hunk.lines.push({ mark: "-", text: line.slice(1) });
    else if (line.startsWith(" ") || line === "") hunk.lines.push({ mark: " ", text: line.startsWith(" ") ? line.slice(1) : "" });
    else hunk = null;
  }

  for (const f of files) {
    if (f.hunks.length === 0 && f.op === "update") f.op = "mode"; // 只有模式/表头、没有内容 hunk 的段
    for (const h of f.hunks) {
      const rem = remaining(h);
      // 收不满声明的行数 = 补丁被截断。这里必须出声：少收的那几行一旦当成「hunk 到这就完了」，
      // 应用结果是把该删的行留在盘上、且不报错——比报错坏得多。
      if (rem.old !== 0 || rem.new !== 0) {
        throw new PatchParseError(
          `hunk 声明 -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount}，实收旧侧 ${String(h.oldCount - rem.old)} 行／新侧 ${String(h.newCount - rem.new)} 行（补丁不完整）`,
          h.declaredAt,
        );
      }
    }
  }
  return files;
}
