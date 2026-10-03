/** 「谁在读这段文本」＝接线判卷的**读取面**（第 328 页，任务 #37）。
 *
 *  立尺的实测（2026-10-03，第 327 页补）：把 `heldOutFailReasons(` 与 `verifyRecovered` 那两支从
 *  `scripts/loop-eval.ts` 搬进 `scripts/lib/eval-expects.ts` 之后，typecheck 0 条、我动过的两个判卷全绿、
 *  六台造红各红不同条、`--check-needles` 阻断 0——而 `head-cert` 印 `Tests 2 failed | 4023 passed (4025)`。
 *  两条红都在 `tests/eval-heldout.test.ts`：它们**把 `scripts/loop-eval.ts` 的源文本当判据读**（所谓接线判卷），
 *  文本一搬家，`indexOf(...)` 拿到 -1、切片成空串 ⇒ 判据静默失效。
 *  ⇒ 针脚体检那张表只知道自己那些锚点的针脚，**不知道还有谁在读同一份文本**；这一格当时靠全量判卷才看见（贵，且在交笔之后）。
 *  本尺把它变成秒级读数：给定改动面，直接印出「该跑的判卷清单」。
 *
 *  形状表是被现读打回过一次的（第 328 页第 3 项）：第一版只认「字面量路径」那三种写法，
 *  在 HEAD 上量到 `读取调用 403 处／认得出 54／要人复认 349` ⇒ 87% 喊"看不懂"的尺等于没有尺。
 *  现读的分桶（`outputs/text-readers-2026-10-03/shapes.log`）说清了两件事：绝大多数调用读的是**运行期路径**
 *  （临时目录、夹具副本：`join(dir, …)`、`abs`、`logOf()`），它们本来就指不到仓内某个文件；
 *  而「指不到」与「看不懂形状」是两格，必须分开印——把它们并成一档，这张表就永远是红的，
 *  而永远红的尺和没有尺是同一件事（规则 261：读不到与没有不许同形）。
 *
 *  四态（互斥，相加＝读取调用总数）：
 *   - `literal`  ：第一参数是字面量路径（或字面量分段／`new URL("../x", import.meta.url)`）⇒ 归一到仓内 rel，进清单；
 *   - `dynamic`  ：形状认得出（变量／函数调用／模板串／数组），但路径要到运行期才知道 ⇒ 这一格对"谁读仓内源码"无话可说；
 *   - `unknown`  ：连第一个参数都切不出来（括号配平被引号／正则字面量打断）⇒ **要人复认**，帽只准调低；
 *   - 另：`literal` 但目标在盘上不存在 ⇒ 单列（多半是判卷里的合成字符串，不是真读取者）。
 *
 *  口径选择（写下来免得被读成已做）：**宁可多列，不可漏列**。判卷文件里的「假源码字符串」也会命中字面量形状，
 *  于是某份判卷可能并没读那份文件却被列进清单——这是安全方向的误差（清单的用途是"顺手把这些判卷也跑了"，
 *  多跑只花时间）；反过来漏一条就是第 327 页那次事故。所以不做去噪，只做分档。
 *
 *  本文件只有判据与措辞，不碰盘、不起进程；取料（读 tests/ 下的文本、跑 git 拿改动面）由调用方做。 */

/** 四态里的形状名。`dynamic` 的三个子形状一并印出来，方便看新写法长在哪一类上。 */
export type ReaderShape = "literal-string" | "literal-join" | "url-relative" | "dynamic-identifier"
  | "dynamic-call" | "dynamic-template" | "dynamic-array" | "unknown";

/** 仓内可能被人当文本读的面。清单只问这些前缀之下的目标（读 `node_modules` 不算接线判卷）。 */
const SOURCE_FACES = ["src/", "scripts/", "tests/", "fixtures/", "docs/", "apps/"];

export interface ReaderHit {
  judge: string;
  /** 读取调用所在行（1 起）——给人现场复认用，不参与判定。 */
  line: number;
  shape: ReaderShape;
  /** 四态归类。 */
  kind: "literal" | "dynamic" | "unknown";
  /** 归一到仓内 rel；`dynamic`／`unknown` 与指不到仓内文件的那几格为 null。 */
  target: string | null;
  /** 字面量目标在盘上不存在（多半是合成字符串）——分列印，不并进"没有读取者"。 */
  targetMissing: boolean;
}

export interface ReaderScan {
  judge: string;
  readCalls: number;
  hits: ReaderHit[];
  literal: number;
  dynamic: number;
  unknown: number;
}

const READ_CALL_NAMES = ["readFileSync", "readFile", "readTextFileSync"];

/** 在**代码上下文**里找读取调用的位置（返回每个调用左括号后第一个字符的下标）。
 *
 *  为什么不能直接对全文跑正则（第 328 页第 3 项的现读抓出来的）：
 *  判卷文件里躺着大量**合成源码字符串**（夹具正文），里面有 `readFile(p: string)`、`readFileSync("x")` 这种写法；
 *  按全文正则量，六处里四处是这种假调用 ⇒ 分母被灌水、清单会把没读文件的判卷列成"在读"。
 *  所以这一步必须区分「代码」与「字符串/注释里的文本」：
 *   - 双引号／单引号：整段跳过；
 *   - 模板串：整段跳过，但 `${…}` 里是代码 ⇒ 进去继续找（那正是动态路径读写的常见写法）；
 *   - `//` 行注释与 `/* … *\/` 块注释：跳过；
 *   - 换行不算特殊字符（多行调用照样能找到）。 */
export function findReadCallSites(text: string): number[] {
  const out: number[] = [];
  type St = { kind: "code" } | { kind: "str"; quote: string } | { kind: "tmpl" } | { kind: "tmpl-expr"; depth: number };
  const stack: St[] = [{ kind: "code" }];
  const isIdent = (c: string): boolean => /[\w$]/u.test(c);
  let i = 0;
  while (i < text.length) {
    const top = stack[stack.length - 1]!;
    const c = text[i]!;
    if (top.kind === "str") {
      if (c === "\\") { i += 2; continue; }
      if (c === top.quote) stack.pop();
      i += 1;
      continue;
    }
    if (top.kind === "tmpl") {
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { stack.pop(); i += 1; continue; }
      if (c === "$" && text[i + 1] === "{") { stack.push({ kind: "tmpl-expr", depth: 0 }); i += 2; continue; }
      i += 1;
      continue;
    }
    // 代码态（含模板串插值）
    if (c === "/" && text[i + 1] === "/") { const nl = text.indexOf("\n", i); i = nl < 0 ? text.length : nl + 1; continue; }
    if (c === "/" && text[i + 1] === "*") { const end = text.indexOf("*/", i + 2); i = end < 0 ? text.length : end + 2; continue; }
    if (c === "\"" || c === "'") { stack.push({ kind: "str", quote: c }); i += 1; continue; }
    if (c === "`") { stack.push({ kind: "tmpl" }); i += 1; continue; }
    if (top.kind === "tmpl-expr") {
      if (c === "{") { top.depth += 1; i += 1; continue; }
      if (c === "}") { if (top.depth === 0) stack.pop(); else top.depth -= 1; i += 1; continue; }
    }
    // 名字前面是标识符字符就不是这个名字（`xreadFile(`）；带点号前缀算（`fs.readFileSync(`）。
    let matched: string | null = null;
    for (const name of READ_CALL_NAMES) {
      if (!text.startsWith(name, i)) continue;
      if (i > 0 && isIdent(text[i - 1]!)) continue;
      let j = i + name.length;
      while (j < text.length && (text[j] === " " || text[j] === "\t" || text[j] === "\n" || text[j] === "\r")) j += 1;
      if (text[j] !== "(") continue;
      matched = name;
      out.push(j + 1);
      i = j + 1; // 从参数开头继续走：嵌套调用（`readFileSync(readFile…)`）也要被数到
      break;
    }
    if (matched === null) i += 1;
  }
  return out;
}

/** 把 `../` 按判卷文件自己的目录展开，再归一化；逃出纳名目录返回 null。 */
export function normalizeRel(raw: string): string | null {
  const clean = raw.replaceAll("\\", "/");
  if (clean === "" || clean.includes("$")) return null;
  const parts = clean.split("/").filter((p) => p !== "" && p !== ".");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") { if (out.length === 0) return null; out.pop(); continue; }
    out.push(p);
  }
  return out.length > 0 ? out.join("/") : null;
}

/** `../scripts/x.ts` 是相对**判卷自己**的目录：judge＝`tests/a/b.ts` ⇒ 基准目录 `tests/a`。 */
function relFromJudge(judge: string, raw: string): string | null {
  const dir = judge.includes("/") ? judge.slice(0, judge.lastIndexOf("/")) : "";
  return normalizeRel(dir === "" ? raw : `${dir}/${raw}`);
}

/** 从 `(` 之后切出**第一个参数表达式**：按括号／方括号／花括号配平，跳过引号内文本。
 *  切不出来（走到窗口尽头仍没收敛）＝`unknown`，这一格要人复认。 */
function firstArg(win: string, lookAhead: number): { raw: string; ok: boolean } {
  let depth = 0, i = 0;
  let quote: string | null = null;
  const limit = Math.min(win.length, lookAhead);
  while (i < limit) {
    const ch = win[i]!;
    if (quote !== null) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === quote) quote = null;
      else if (ch === "\n") return { raw: win.slice(0, i), ok: false }; // 跨行的裸引号串：不当参数切
      i += 1;
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") { quote = ch; i += 1; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth += 1; i += 1; continue; }
    if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0 && (ch === ")" )) return { raw: win.slice(0, i), ok: true };
      depth -= 1; i += 1; continue;
    }
    if (ch === "," && depth === 0) return { raw: win.slice(0, i), ok: true };
    i += 1;
  }
  return { raw: win.slice(0, limit), ok: false };
}

/** 从一段代码文本里按顺序取出所有引号（含反引号）内的字面量。 */
function stringLiterals(raw: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (ch === "\"" || ch === "'" || ch === "`") {
      const end = raw.indexOf(ch, i + 1);
      if (end < 0) break;
      out.push(raw.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    i += 1;
  }
  return out;
}

/** 一个参数表达式落在哪一格：字面量能定路径？还是形状认得出但运行期才知道？还是切不出来？ */
function classifyArg(argRaw: string, ok: boolean, judge: string): { shape: ReaderShape; kind: ReaderHit["kind"]; rel: string | null } {
  const trimmed = argRaw.trim();
  if (!ok || trimmed === "") return { shape: "unknown", kind: "unknown", rel: null };
  // new URL("../x", import.meta.url)／fileURLToPath(new URL(...))：第一个参数是指向仓内的相对串
  const url = /^\s*(?:fileURLToPath\(\s*)?new\s+URL\(\s*(["'`])([^"'`]*)\1/u.exec(trimmed);
  if (url !== null) {
    const rel = relFromJudge(judge, url[2]!);
    return rel === null
      ? { shape: "dynamic-call", kind: "dynamic", rel: null }
      : { shape: "url-relative", kind: "literal", rel };
  }
  // join(REPO|ROOT, "a", "b")：全字面量分段 ⇒ 仓内 rel
  const absJoin = /^\s*join\(\s*(?:REPO|ROOT|root|MAIN_ROOT)\s*((?:\s*,\s*[^,()]+)*)\)/u.exec(trimmed);
  if (absJoin !== null) {
    const segs = stringLiterals(absJoin[1] ?? "");
    if (segs.length > 0 && segs.every((s) => !s.includes("$"))) {
      return { shape: "literal-join", kind: "literal", rel: normalizeRel(segs.join("/")) };
    }
    return { shape: "dynamic-call", kind: "dynamic", rel: null };
  }
  // 裸字面量：readFileSync("fixtures/x.json", "utf8")。**只认引号**——反引号是模板串，
  // 让它走下面那一档，否则 `${DIR}/x.ts` 会被读成"字面量但定不出路径"，动态形状这一格就永远没人观测到。
  const bare = /^(["'])([^"']*)\1$/u.exec(trimmed);
  if (bare !== null) return { shape: "literal-string", kind: "literal", rel: normalizeRel(bare[2]!) };
  // join(变量, …)／变量／函数调用／模板串／数组：形状认得出，路径要跑起来才知道
  if (trimmed.startsWith("[") || trimmed.startsWith("...")) return { shape: "dynamic-array", kind: "dynamic", rel: null };
  if (trimmed.includes("${") || trimmed.startsWith("`")) return { shape: "dynamic-template", kind: "dynamic", rel: null };
  if (/^\s*join\(/u.test(trimmed) || /[a-zA-Z_$][\w$]*\s*\(/u.test(trimmed)) return { shape: "dynamic-call", kind: "dynamic", rel: null };
  // 其余首字符是标识符／下标的（`abs`、`entry!.script`、`r.path`）：形状认得出，路径要到运行期才知道。
  // 这一档**不许**并进 `unknown`——并进去就等于把"我看懂了但这是动态的"谎报成"我看不懂"。
  if (/^[a-zA-Z_$(]/u.test(trimmed)) return { shape: "dynamic-identifier", kind: "dynamic", rel: null };
  return { shape: "unknown", kind: "unknown", rel: null };
}

/** 只有仓内源码面才算「接线判卷在读的东西」；其余（相对路径拼出来的临时盘、node_modules…）不算命中。 */
function isSourceFace(rel: string | null): rel is string {
  return rel !== null && SOURCE_FACES.some((f) => rel.startsWith(f));
}

/** 扫一份判卷：把每个读取调用归进四态之一。`exists` 由调用方注入（纯函数不碰盘）。 */
export function scanJudgeForReaders(
  judge: string, text: string, exists: (rel: string) => boolean, lookAhead: number = 200,
): ReaderScan {
  const lines = text.split("\n");
  const starts: number[] = [];
  let acc = 0;
  for (const l of lines) { starts.push(acc); acc += l.length + 1; }
  const lineAt = (idx: number): number => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid]! <= idx) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };

  const hits: ReaderHit[] = [];
  let literal = 0, dynamic = 0, unknown = 0;
  for (const at of findReadCallSites(text)) {
    const win = text.slice(at, at + lookAhead);
    const { raw, ok } = firstArg(win, lookAhead);
    const c = classifyArg(raw, ok, judge);
    if (c.kind === "literal") literal += 1;
    else if (c.kind === "dynamic") dynamic += 1;
    else unknown += 1;
    const rel = isSourceFace(c.rel) ? c.rel : null;
    hits.push({
      judge, line: lineAt(at), shape: c.shape, kind: c.kind,
      target: rel, targetMissing: rel !== null && !exists(rel),
    });
  }
  return { judge, readCalls: hits.length, hits, literal, dynamic, unknown };
}

/** 反查：这些被改动的文件，各有哪些判卷把它们当文本读。 */
export function readersOf(changed: readonly string[], scans: readonly ReaderScan[]): Map<string, ReaderHit[]> {
  const out = new Map<string, ReaderHit[]>();
  for (const c of changed) out.set(c, []);
  for (const s of scans) {
    for (const h of s.hits) {
      if (h.target === null || h.targetMissing) continue; // 指不到盘上文件的字面量不算读取者
      if (h.target === s.judge) continue;                  // 判卷读自己不参与这一格
      const list = out.get(h.target);
      if (list) list.push(h);
    }
  }
  return out;
}

/** 一行汇总，四态分开印（哪一态并进另一态，这把尺就会在某个方向上静默）。 */
export function readerSummary(scans: readonly ReaderScan[]): string {
  const calls = scans.reduce((a, s) => a + s.readCalls, 0);
  const literal = scans.reduce((a, s) => a + s.literal, 0);
  const dynamic = scans.reduce((a, s) => a + s.dynamic, 0);
  const unknown = scans.reduce((a, s) => a + s.unknown, 0);
  return `读取调用 ${String(calls)} 处 ⇒ 字面量 ${String(literal)}／运行期路径 ${String(dynamic)}`
    + `／**形状不认识 ${String(unknown)}**（三态相加＝${String(literal + dynamic + unknown)}，不等就是量法坏了）`;
}
