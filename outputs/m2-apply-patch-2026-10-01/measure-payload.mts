// M2 基线（同分母 A/B）：同一次改动，用「统一 diff 一次调用」表达 vs 用「edit_file 逐处替换」表达，
// 各自要模型吐出多少字符、要发多少次工具调用。
//
// 分母固定为同一批 hunk（同一份 git diff 拆给两边），所以两侧没有各自的样本选择偏差。
//
// 两侧的字符模型（都是「模型必须逐字打出来的正文」，不含 JSON 外壳；写进 readings 时如实标注）：
//   patch 侧：每个 hunk = 上下文行 + 删除行 + 新增行（上下文只出现一遍）+ 每行 1 字符前缀 + @@ 头
//             每个文件 + 头四行（diff --git / index / --- / +++）
//   edit  侧：每处一次调用 = old_string（上下文 + 被删行）+ new_string（上下文 + 新增行）
//             ⇒ 上下文在这里出现两遍，外加每次调用的固定开销与 path
// edit 侧这个模型是「把整个 hunk 照抄成 old/new」的形状。真实的模型可能只打最小唯一定位串
// （会更短），也可能因为那一行不唯一而被迫多抄上下文（会更长）——两个方向都存在，
// 所以字符读数只当量级看；**调用次数是不依赖这些假设的硬读数**。
//
// 为什么没有「省了几轮返工 / 成功率」：本仓没有可用的真会话 edit 失败语料（.agent/sessions 为空），
// 那两件事现在量不了，就不写。
import { execFileSync } from "node:child_process";

const N = Number(process.argv[2] ?? 60);
const CALL_OVERHEAD = 24; // 一次 edit_file 调用里 path 参数 + 两段 JSON 字符串边界的下界估计

function git(args: string[], quiet = false): string {
  // 退出码非 0 直接抛：所有读数都建立在「git 确实把 diff 吐给我了」之上。
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: quiet ? ["ignore", "pipe", "ignore"] : undefined,
  });
}

interface Hunk {
  add: number;
  rem: number;
  ctx: number;
  addChars: number;
  remChars: number;
  ctxChars: number;
}
interface FileDiff {
  path: string;
  hunks: Hunk[];
  binary: boolean;
}

/** 最小解析器：只为计数服务（生产解析器另有判卷，不共用这份，免得探针和被测物同源）。 */
function parseDiff(text: string): FileDiff[] {
  const out: FileDiff[] = [];
  let cur: FileDiff | null = null;
  let hunk: Hunk | null = null;
  const close = (): void => {
    if (hunk && cur) cur.hunks.push(hunk);
    hunk = null;
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      close();
      cur = { path: "?", hunks: [], binary: false };
      out.push(cur);
      continue;
    }
    // 路径取 +++ 那一行：它在改名/含空格时比 `diff --git a / b` 稳定。
    if (line.startsWith("+++ ") && cur !== null && !line.startsWith("+++ /dev/null")) {
      cur.path = unquote(line.slice(4).replace(/^b\//, ""));
      continue;
    }
    if (cur === null) continue;
    if (line.startsWith("GIT binary patch")) cur.binary = true;
    const bm = /^Binary files a\/(.*) and b\/.* differ$/.exec(line);
    if (bm) {
      cur.binary = true;
      cur.path = unquote(bm[1]); // 二进制段没有 +++ 行，路径只在这句里
      continue;
    }
    if (line.startsWith("@@")) {
      close();
      hunk = { add: 0, rem: 0, ctx: 0, addChars: 0, remChars: 0, ctxChars: 0 };
      continue;
    }
    if (hunk === null) continue;
    const body = line.slice(1);
    if (line.startsWith("+")) {
      hunk.add++;
      hunk.addChars += body.length;
    } else if (line.startsWith("-")) {
      hunk.rem++;
      hunk.remChars += body.length;
    } else if (line.startsWith(" ") || line.startsWith("\\")) {
      hunk.ctx++;
      hunk.ctxChars += body.length;
    }
  }
  close();
  return out;
}

/** git 在路径含特殊字符时加引号并按 C 转义（core.quotePath）；剥不掉就原样留着。 */
function unquote(p: string): string {
  return p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p;
}

const patchCharsOf = (f: FileDiff): number =>
  f.hunks.reduce((n, h) => n + h.addChars + h.remChars + h.ctxChars + h.add + h.rem + h.ctx + 14, 0) +
  (f.hunks.length > 0 ? 36 + 3 * f.path.length : 0);

const editCharsOf = (f: FileDiff): number =>
  f.hunks.reduce((n, h) => n + h.addChars + h.remChars + 2 * h.ctxChars + 2 * h.ctx + CALL_OVERHEAD + f.path.length, 0);

const isCode = (p: string): boolean => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(p);

// —— 哨兵：已知不可能为 0 的输入，证明解析器不是扫空气（分母静默 0 命中比不建尺更坏）。
// 第一版只数了 hunk 数，路径整块坏掉（全是 "?"）却没被抓到 ⇒ 现在逐字段钉。
const SENTINEL = [
  "diff --git a/x.ts b/x.ts",
  "--- a/x.ts",
  "+++ b/x.ts",
  "@@ -1,3 +1,3 @@",
  " line one",
  "-line two",
  "+line TWO",
  " line three",
  "@@ -10,2 +10,3 @@",
  " a",
  " b",
  "+c",
  "diff --git a/y.png b/y.png",
  "Binary files a/y.png and b/y.png differ",
].join("\n");
const sentinel = parseDiff(SENTINEL);
const bad =
  sentinel.length !== 2 ||
  sentinel[0].path !== "x.ts" ||
  sentinel[0].hunks.length !== 2 ||
  sentinel[0].hunks[0].add !== 1 ||
  sentinel[0].hunks[0].rem !== 1 ||
  sentinel[0].hunks[0].ctx !== 2 ||
  sentinel[0].hunks[1].add !== 1 ||
  sentinel[0].hunks[1].rem !== 0 ||
  sentinel[1].binary !== true ||
  sentinel[1].path !== "y.png" ||
  patchCharsOf(sentinel[0]) === 0 ||
  editCharsOf(sentinel[0]) === 0;
if (bad) {
  console.error(`哨兵失效：手写样例解析成 ${JSON.stringify(sentinel)} ⇒ 探针在扫空气，读数作废`);
  process.exit(1);
}
console.log(`哨兵 OK｜2 文件（含 binary 1）｜路径/逐 hunk +/-/上下文 计数与两侧字符模型全对`);

const shas = git(["log", "--no-merges", "--pretty=%H", "-n", String(N)]).trim().split("\n").filter((s) => s !== "");
console.log(`取料：非 merge 提交 ${shas.length} 笔（HEAD 往回）`);

interface Row {
  hunks: number;
  hunksCode: number;
  patch: number;
  edit: number;
  patchCode: number;
  editCode: number;
  callsCode: number;
}
const rows: Row[] = [];
for (const sha of shas) {
  let text = "";
  try {
    text = git(["diff", "--unified=3", "--no-color", `${sha}^`, sha]);
  } catch {
    continue; // 根提交无父
  }
  const files = parseDiff(text).filter((f) => !f.binary);
  const code = files.filter((f) => isCode(f.path));
  const r: Row = {
    hunks: files.reduce((n, f) => n + f.hunks.length, 0),
    hunksCode: code.reduce((n, f) => n + f.hunks.length, 0),
    patch: files.reduce((n, f) => n + patchCharsOf(f), 0),
    edit: files.reduce((n, f) => n + editCharsOf(f), 0),
    patchCode: code.reduce((n, f) => n + patchCharsOf(f), 0),
    editCode: code.reduce((n, f) => n + editCharsOf(f), 0),
    callsCode: code.reduce((n, f) => n + f.hunks.length, 0),
  };
  rows.push(r);
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)];
};

console.log("—— 表达代价 A/B（同一批 hunk；全量语料）——");
console.log(`统一 diff：${sum(rows.map((r) => r.patch))} 字符 / ${rows.length} 次调用（一笔一次）`);
console.log(`edit_file：${sum(rows.map((r) => r.edit))} 字符 / ${sum(rows.map((r) => r.hunks))} 次调用（一处一次）`);
console.log(`逐笔 edit/patch 字符比：中位 ${median(rows.map((r) => r.edit / Math.max(r.patch, 1))).toFixed(2)}×`);
console.log(`每笔调用数：patch 恒 1｜edit 中位 ${median(rows.map((r) => r.hunks))}｜最大 ${Math.max(...rows.map((r) => r.hunks))}`);

console.log("—— 只看源码文件（.ts/.tsx/.js/…，剔掉本仓提交里占大头的 .md 台账）——");
const codeRows = rows.filter((r) => r.hunksCode > 0);
console.log(`有源码改动的提交 ${codeRows.length} / ${rows.length}`);
console.log(`统一 diff：${sum(codeRows.map((r) => r.patchCode))} 字符 / ${codeRows.length} 次调用`);
console.log(`edit_file：${sum(codeRows.map((r) => r.editCode))} 字符 / ${sum(codeRows.map((r) => r.callsCode))} 次调用`);
console.log(`每源码 hunk 归一：patch ${(sum(codeRows.map((r) => r.patchCode)) / Math.max(sum(codeRows.map((r) => r.callsCode)), 1)).toFixed(0)} 字符 vs edit ${(sum(codeRows.map((r) => r.editCode)) / Math.max(sum(codeRows.map((r) => r.callsCode)), 1)).toFixed(0)} 字符`);
console.log(`逐笔（仅源码）edit/patch 字符比：中位 ${median(codeRows.map((r) => r.editCode / Math.max(r.patchCode, 1))).toFixed(2)}×｜每笔 edit 调用数中位 ${median(codeRows.map((r) => r.callsCode))}`);

// —— 行数口径分歧：现 lineDelta（多重集差）vs git 的 hunk 计数。M2 验收要求 apply_patch 的行数读数与 git 一致。
function safeShow(ref: string, path: string): string | null {
  try {
    return git(["show", `${ref}:${path}`], true);
  } catch {
    return null;
  }
}
function contentLines(t: string): string[] {
  if (t === "") return [];
  const arr = t.split("\n");
  if (arr[arr.length - 1] === "") arr.pop();
  return arr;
}
function multisetDelta(oldText: string, newText: string): { added: number; removed: number } {
  const counts = new Map<string, number>();
  for (const l of contentLines(oldText)) counts.set(l, (counts.get(l) ?? 0) + 1);
  let added = 0;
  for (const l of contentLines(newText)) {
    const c = counts.get(l) ?? 0;
    if (c > 0) counts.set(l, c - 1);
    else added++;
  }
  let removed = 0;
  for (const c of counts.values()) removed += c;
  return { added, removed };
}

let compared = 0;
let skipped = 0;
let noPath = 0; // 路径解析不出的文件数：非 0 则本段作废
const mismatchRows: string[] = [];
const shas2 = git(["log", "--no-merges", "--pretty=%H", "-n", String(N)]).trim().split("\n").filter((s) => s !== "");
for (const sha of shas2) {
  let full = "";
  try {
    full = git(["diff", "--unified=3", "--no-color", `${sha}^`, sha]);
  } catch {
    continue;
  }
  for (const f of parseDiff(full).filter((x) => !x.binary)) {
    if (f.path === "?") {
      noPath++;
      continue;
    }
    const before = safeShow(`${sha}^`, f.path);
    const after = safeShow(sha, f.path);
    if (before === null || after === null) {
      skipped++; // 新建/删除/改名：拿不到两侧全文，不在本分歧统计的分母里
      continue;
    }
    compared++;
    const add = f.hunks.reduce((n, h) => n + h.add, 0);
    const rem = f.hunks.reduce((n, h) => n + h.rem, 0);
    const d = multisetDelta(before, after);
    if (d.added !== add || d.removed !== rem) {
      mismatchRows.push(`${sha.slice(0, 7)} ${f.path}｜git +${add} −${rem} vs 多重集 +${d.added} −${d.removed}`);
    }
  }
}
console.log("—— 行数口径分歧（现 lineDelta＝多重集差 vs git hunk 计数）——");
console.log(`路径解析失败 ${noPath}（非 0 则本段作废）｜可比文件 ${compared}（跳过新建/删除/改名 ${skipped}）｜分歧 ${mismatchRows.length} 处（${((mismatchRows.length / Math.max(compared, 1)) * 100).toFixed(1)}%）`);
for (const r of mismatchRows.slice(0, 20)) console.log(`  ${r}`);
if (mismatchRows.length > 20) console.log(`  …另有 ${mismatchRows.length - 20} 处未列（计数以上一行为准）`);
