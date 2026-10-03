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

/** 仓内可能被人当文本读的面。清单只问这些前缀之下的目标（读 `node_modules` 不算接线判卷）。
 *  出口给判卷用：语料助手登记表里写的每一面都必须在这张表里（抄第二份清单＝各写各的）。 */
export const SOURCE_FACES = ["src/", "scripts/", "tests/", "fixtures/", "docs/", "apps/"];

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

/** 在**代码上下文**里找某个名字的调用位置（返回每个调用左括号后第一个字符的下标）。
 *
 *  为什么不能直接对全文跑正则（第 328 页第 3 项的现读抓出来的）：
 *  判卷文件里躺着大量**合成源码字符串**（夹具正文），里面有 `readFile(p: string)`、`readFileSync("x")` 这种写法；
 *  按全文正则量，六处里四处是这种假调用 ⇒ 分母被灌水、清单会把没读文件的判卷列成"在读"。
 *  所以这一步必须区分「代码」与「字符串/注释里的文本」：
 *   - 双引号／单引号：整段跳过；
 *   - 模板串：整段跳过，但 `${…}` 里是代码 ⇒ 进去继续找（那正是动态路径读写的常见写法）；
 *   - `//` 行注释与块注释：跳过；
 *   - 换行不算特殊字符（多行调用照样能找到）。 */
export function findCallSites(text: string, names: readonly string[]): number[] {
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
    for (const name of names) {
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

/** 读取调用的入口名单。只认这一族 ⇒ 数到调用而下面四条形状都不中，就是 `unknown`。 */
const READ_CALL_NAMES = ["readFileSync", "readFile", "readTextFileSync"];
export function findReadCallSites(text: string): number[] {
  return findCallSites(text, READ_CALL_NAMES);
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

/** `../` 打头的那个 rel 是相对**判卷自己**的目录，不是仓根：judge＝`tests/a/b.ts` ⇒ 基准目录 `tests/a`。 */
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
  // join(REPO|ROOT, "a", "b")／join(__dirname, "..", "a")：全字面量分段 ⇒ 仓内 rel
  const absJoin = /^\s*join\(\s*(REPO|ROOT|root|MAIN_ROOT|repoRoot|__dirname|__filename)\s*((?:\s*,\s*[^,()]+)*)\)/u.exec(trimmed);
  if (absJoin !== null) {
    const segs = stringLiterals(absJoin[2] ?? "");
    if (segs.length > 0 && segs.every((s) => !s.includes("$"))) {
      const rawRel = segs.join("/");
      // `__dirname` 的基准是**判卷自己所在目录**：`join(__dirname, "..", "scripts", "gates.ts")`＝仓内那份文件。
      // 少兜这一层就会把真读取者读成「运行期路径」⇒ 第一栏点不出它的名字（`tests/gate-failure-log.test.ts:101` 现读命中）。
      const rel = (absJoin[1] === "__dirname" || absJoin[1] === "__filename")
        ? relFromJudge(judge, rawRel) : normalizeRel(rawRel);
      return { shape: "literal-join", kind: "literal", rel };
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

/* ── 第二出口：语料级读取者（第 329 页，任务 #38）───────────────────────────────────────
 * 立这一格的读数来自第 328 页补：上面那一栏只会点名「字面量里写着某个文件」的判卷，
 * 而 `tests/dead-script-refs.test.ts` 走的是 `collectScriptRefs(root)`——它遍历 `src/`＋`scripts/` 全量，
 * 被读的目标要运行期才知道。于是那一族判卷在「该跑哪些判卷」的清单里是**整类缺失**：
 * 本笔只改了两处散文，认证判卷当场报 1 红（而且并发判卷两端独占 ⇒ 不是负载），清单一个名字都没给。
 * ⇒ 「少了一条」与「少了一类」是两种错；只有后者需要这个第二出口。
 *
 * 三态（相加＝这一份判卷里数到的"列目录／列跟踪面"调用总数）：
 *  - `corpus`  ：列的是仓内某个源面（见 `SOURCE_FACES`），或调了已登记的语料助手，或用 git 列跟踪面 ⇒ 改了任何源面文件都该跑它；
 *  - `local`   ：列的是运行期才有的目录（临时盘、夹具副本）⇒ 对这一格无话可说；
 *  - `unknown` ：第一个参数切不出来 ⇒ **要人复认**（帽只准调低；新写法不许并进 `local`，那是把"我不认识"谎报成"没关系"）。
 *    助手在遍历但这一次调用定不出面 ⇒ **不计**（既不算 corpus 也不算 unknown）：窗口式助手识别会误报同名假助手，
 *    一律出声会让这张表被 `runCli`／`stripComments` 那一类刷红而再没人看（第 329 页现读第一版的读数）。 */

const LIST_CALL_NAMES = ["readdirSync", "readdir"];
const PROCESS_CALL_NAMES = ["execFileSync", "spawnSync", "execSync"];
/** 进程调用里出现这些 git 子命令 ⇒ 它列的是**跟踪面**（等价于遍历源面）。 */
const GIT_LIST_TOKENS = ["ls-files", "ls-tree"];

/** 已登记的语料助手：实现自己在遍历源面，调用方看不见遍历动作。
 *  `faces` 只能写 `SOURCE_FACES` 里已有的面（判卷逐条核这一点）——登记一个助手要同笔补一条只有它能看见的合成输入。 */
export const CORPUS_HELPERS: ReadonlyArray<{ name: string; faces: readonly string[] }> = [
  { name: "collectScriptRefs", faces: ["src/", "scripts/"] },
];

export interface CorpusScan {
  judge: string;
  listCalls: number;
  corpus: number;
  local: number;
  unknown: number;
  /** 命中的面（去重、排序）。`corpus` 却说不出面 ⇒ 这条读数不许存在。 */
  faces: string[];
  shapes: string[];
}

/** 一串路径分段拼起来是不是某个源面下的路径。是就返回那一面（含尾斜杠）。 */
function faceOfSegments(segs: readonly string[]): string | null {
  if (segs.length === 0) return null;
  const rel = normalizeRel(segs.join("/"));
  if (rel === null) return null;
  return SOURCE_FACES.find((f) => rel === f.replace(/\/$/u, "") || rel.startsWith(f)) ?? null;
}

/** 「`git ls-files`／`ls-tree`」这一类面覆盖**任何**被跟踪文件，没有前缀可配 ⇒ 用这个标记存在。 */
export const TRACKED_FACE = "git:";

/** 一个登记的面罩不罩得住这个改动文件。 */
function faceCovers(face: string, file: string): boolean {
  return face.startsWith(TRACKED_FACE) || file.startsWith(face);
}

/** 判卷自己的模块级常量初始化式（`const REPLAY_DIR = join(__dirname, "..", "scripts", "replay")`）。
 *  为什么必须有这张表（第 329 页现读抓出来的）：`tests/env-cue-single-source.test.ts` 与
 *  `tests/replay-readings-registry.test.ts` 都是 `readdirSync(REPLAY_DIR)`——遍历的确实是仓内 `scripts/`，
 *  但字面量躺在**另一行**的常量定义里。只按参数行找字面量就会把这两份判成「临时盘」，
 *  于是第二出口仍然整类漏，而这一格正是 #38 开出来的理由。 */
function constInitializers(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/gmu)) {
    if (!out.has(m[1]!)) out.set(m[1]!, m[2]!);
  }
  return out;
}

/** 取**不算定义处**的调用位置（`function walkSources(` 自身不是一次调用）。 */
function callSitesNotDefs(text: string, names: readonly string[]): number[] {
  if (names.length === 0) return [];
  return findCallSites(text, names).filter((at) => {
    const before = text.slice(0, at - 1).trimEnd();
    return !/\bfunction\s+[A-Za-z_$][\w$]*$/u.test(before);
  });
}

/** 同文件里**自己写的遍历助手**：函数体里有列目录动作，遍历哪个面由调用处的实参决定。
 *  现读见证：`tests/goal-price.test.ts:16` 与 `tests/plan-required.test.ts:30` 的
 *  `function walkSources(dir) { … readdirSync(dir) … }` ＋ 调用处 `walkSources(join(__dirname, "..", "src"))`。
 *  名字**不写成登记表**（登记会烂、也不会被新写法提醒），面也**不写死**（写死就没人核）。 */
function localWalkerNames(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/gmu)) {
    const at = (m.index ?? 0) + m[0].length;
    if (findCallSites(text.slice(at, at + 1200), LIST_CALL_NAMES).length > 0) out.push(m[1]!);
  }
  return out;
}

export function scanJudgeForCorpusReaders(judge: string, text: string, lookAhead: number = 220): CorpusScan {
  const faces = new Set<string>();
  const shapes = new Set<string>();
  const consts = constInitializers(text);
  let listCalls = 0, corpus = 0, local = 0, unknown = 0;
  const tally = (verdict: "corpus" | "local" | "unknown", shape: string, hit: readonly string[]): void => {
    listCalls += 1;
    shapes.add(verdict === "unknown" ? "unknown:" + shape : shape);
    if (verdict === "corpus") { corpus += 1; for (const f of hit) faces.add(f); return; }
    if (verdict === "local") { local += 1; return; }
    unknown += 1;
  };
  /** 一个参数表达式指向哪个源面（解不出＝null）。三条出路按「先宽松后严格」排，都是为了宁可多列不可漏列：
   *  ① 字面量分段本身就是面（`resolve(root, "src")` 这一类，根是变量也算）；
   *  ② 交给第一栏那支 `classifyArg` 定 rel（`join(__dirname, "..", "src")`、`new URL("../x", import.meta.url)`）；
   *  ③ 参数是裸标识符 ⇒ 展开同文件的常量定义**一次**（不迭代，防成环）。 */
  const faceOfExpr = (expr: string, depth: number = 0): string | null => {
    const byLiterals = faceOfSegments(stringLiterals(expr));
    if (byLiterals !== null) return byLiterals;
    const rel = classifyArg(expr, true, judge).rel;
    if (rel !== null) return faceOfSegments([rel]);
    if (depth > 0) return null;
    // 整条正则已锚定 ⇒ `bare[0]` 就是那个标识符。**这里曾经写的是 `bare[1]`**：这条正则没有捕获组，
    // 于是 `bare[1]` 恒为 undefined、两次常量展开静默失效，而 TS 不会报（`RegExpExecArray` 按下标取就是 string）。
    // 现读抓到它的方式是「把最小输入喂进尺子，读数说 local」——不是靠读代码（读代码时它看着完全正确）。
    const bare = /^[A-Za-z_$][\w$]*$/u.exec(expr.trim());
    const init = bare === null ? undefined : consts.get(bare[0]);
    return init === undefined ? null : faceOfExpr(init, 1);
  };

  for (const at of findCallSites(text, LIST_CALL_NAMES)) {
    const { raw, ok } = firstArg(text.slice(at, at + lookAhead), lookAhead);
    if (!ok || raw.trim() === "") { tally("unknown", "readdir", []); continue; }
    const face = faceOfExpr(raw);
    if (face !== null) { tally("corpus", "readdir-face", [face]); continue; }
    const bare = /^[A-Za-z_$][\w$]*$/u.exec(raw.trim());
    if (bare !== null && consts.has(bare[0])) { tally("local", "readdir-const", []); continue; }
    // 参数里没有字面量分段 ⇒ 要么是运行期变量（临时盘／夹具副本），要么是我看不懂的新写法
    if (/^[a-zA-Z_$(]/u.test(raw.trim())) { tally("local", "readdir-dynamic", []); continue; }
    tally("unknown", "readdir", []);
  }
  for (const w of localWalkerNames(text)) {
    for (const at of callSitesNotDefs(text, [w])) {
      const { raw, ok } = firstArg(text.slice(at, at + lookAhead), lookAhead);
      if (!ok) continue;
      const face = faceOfExpr(raw);
      // 只在**实参点得出面**时记账。定不出面的调用不计数：那一次遍历的目标是运行期才知道的（多半是临时盘），
      // 把它算进「要人复认」会让这张表被 `stripComments`／`runCli` 一类同名假助手刷红（现读第一版就是这么炸的：
      // 窗口式助手识别误报 10 处假 walker）。漏的那一格与 `dynamic` 同一口径，写在页上。
      if (face !== null) tally("corpus", "walker:" + w, [face]);
    }
  }
  for (const helper of CORPUS_HELPERS) {
    for (const at of callSitesNotDefs(text, [helper.name])) {
      tally("corpus", "helper:" + helper.name, helper.faces);
    }
  }
  for (const at of callSitesNotDefs(text, PROCESS_CALL_NAMES)) {
    const win = text.slice(at, at + lookAhead);
    const tok = GIT_LIST_TOKENS.find((t) => win.includes(`"${t}"`) || win.includes(`'${t}'`) || win.includes("`" + t + "`"));
    if (tok !== undefined) tally("corpus", "git-" + tok, [TRACKED_FACE + tok]);
  }
  return {
    judge, listCalls, corpus, local, unknown,
    faces: [...faces].sort(), shapes: [...shapes].sort(),
  };
}

/** 反查第二出口：这些改动文件**各有哪些语料级判卷每次都要跑**。
 *  只按登记的面配（`corpus` 那一档必须点得出面，否则这条读数不许存在）——按「有 corpus 就算」会把
 *  只列 `fixtures/` 的那份也列进「改了 src 要跑什么」，那是把清单变成噪音，而噪音清单没人看。 */
export function corpusJudgesFor(changed: readonly string[], scans: readonly CorpusScan[]): { judge: string; faces: string[] }[] {
  const hits = new Map<string, Set<string>>();
  for (const s of scans) {
    if (s.corpus === 0) continue;
    for (const face of s.faces) {
      for (const f of changed) {
        if (!faceCovers(face, f)) continue;
        const set = hits.get(s.judge) ?? new Set<string>();
        set.add(face);
        hits.set(s.judge, set);
      }
    }
  }
  return [...hits.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([j, set]) => ({ judge: j, faces: [...set].sort() }));
}

/** 第二出口的读数：一栏一句，**不许**与 `readerSummary` 并成一行（并成就分不清是哪一类漏了）。 */
export function corpusSummary(scans: readonly CorpusScan[]): string {
  const calls = scans.reduce((a, s) => a + s.listCalls, 0);
  const corpus = scans.reduce((a, s) => a + s.corpus, 0);
  const local = scans.reduce((a, s) => a + s.local, 0);
  const unknown = scans.reduce((a, s) => a + s.unknown, 0);
  const judges = scans.filter((s) => s.corpus > 0).map((s) => s.judge);
  return `列目录／列跟踪面 ${String(calls)} 处 ⇒ 语料级 ${String(corpus)}／临时盘与副本 ${String(local)}`
    + `／**要人复认 ${String(unknown)}**（三态相加＝${String(corpus + local + unknown)}）｜语料级判卷 ${String(judges.length)} 份`
    + `⇒ 改动面碰到源面就要跑：${judges.length === 0 ? "（一份都没有——这本身就是缺口）" : judges.join("、")}`;
}
