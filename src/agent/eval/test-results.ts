/** 逐测试名的结果解析（能力 5「Agent 能证明代码真的能跑」＋能力 10「用 SWE-bench 衡量」缺的那一格）。
 *
 *  动因（2026-10-08 现读）：`task-set.ts` 的 SWE-bench 构造路径把 FAIL_TO_PASS 与 PASS_TO_PASS
 *  **拼成一条** `python -m pytest` 命令，只靠退出码 0 判。基准要的却是两件事——
 *  「该转绿的一条不许少」＋「该保住的一条不许坏」——而这两件事在只有退出码的面上**读不出来**：
 *  退出码 1 既可能是「没修好」也可能是「修坏了别的」，出路完全不同却同形。
 *  逐名的料其实早就在场：`scripts/lib/head-cert-deps.ts` 的 `suiteRows` 已在读同一份 vitest JSON，
 *  只是把每条用例的 `status` 丢了。这一支补的就是那个**读者**，不是第二份取料器。
 *
 *  契约里三条设计决定（写清楚理由，别当成「自然形状」）：
 *   ⑴ **零 IO**：只吃字符串，不 open、不 spawn、不读盘。取料由调用方负责——与同目录 `task-set.ts`
 *      的 `EnvProbe` 同一个分法（数据层纯、编排层脏），这样它才能在判卷里被逐分支喂死。
 *   ⑵ **格式自动认，认不出就 `unknown`**：让调用方声明格式，等于允许它把「环境噪声／半截输出」
 *      喂进某个解析器、读出一个看起来很确定的绿。`unknown` 是这一支唯一诚实的第三种出口。
 *   ⑶ `complete` 判的是**派生完整性**（计划线对逐名数／顶层计数对逐名计数／结尾汇总行在不在／
 *      有没有省略标记），**不是「读到几条」**。本仓的成文纪律是防空跑要判派生完整而非数量下界：
 *      读到 0 条可以是 false，读到 3000 条同样可以是 false。
 *   ⑷ 名字匹配**只认逐字**（见 `keysOf`）：SWE-bench 的 id 是 `tests/test_foo.py::Class::test_bar`，
 *      vitest／TAP 的 name 是标题串——两者本来就不该对上。对不上就点名进 `unmatched` 并落第三态，
 *      靠「去掉前缀再看看像不像」去蒙，就是把没测到读成测到了。
 */

export type ResultsFormat = "vitest-json" | "node-test-tap" | "node-test-spec" | "pytest" | "unknown";
/**
 * `node --test` 的**另一种**原生 reporter（spec）。与 TAP 是同一个跑器的两种输出面：
 * node 按 stdout 是不是 TTY 选 reporter——管道 ⇒ `tap`，TTY ⇒ `spec`。
 * 2026-10-12 CI 自评抓到：GitHub Actions 给每个 step 分一个 PTY ⇒ CI 上永远是 spec，
 * 本地（跑器把输出接进管道）永远是 TAP。只有 TAP 那一支的解析器因此在 CI 上整份读成
 * `unknown`（「没有尺」），而退出码那一格照旧能判 ⇒ 逐名这半把尺子在 CI 上静默失效。
 * 实测复现：`script -q /dev/null node --test tests/*.test.js` ⇒ `✔ 名字`／`✖ 名字`／`ℹ tests N`。
 *
 * 形状：`✔ 名字 (1.23ms)`／`✖ 名字 (1.23ms)`，结尾 `ℹ tests 3`／`ℹ pass 3`／`ℹ fail 0`。
 * 名字后面的括号里是耗时；`ℹ` 行是汇总。嵌套用缩进表达，与 TAP 一样只数顶格。
 */
export type ResultsFormatSpec = "node-test-spec";
export type TestOutcome = "passed" | "failed" | "skipped" | "todo" | "unknown";

export interface ParsedTest {
  /** 这一条用例的名字（vitest 用 fullName、TAP 用结果行标题、pytest 用 nodeid），逐字不加工。 */
  name: string;
  /** 出处文件（读得到才给；TAP 只有失败块带 location，vitest/pytest 每条都带）。 */
  file?: string;
  outcome: TestOutcome;
}

export interface TestCounts {
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
}

export interface ParsedResults {
  format: ResultsFormat;
  tests: ParsedTest[];
  counts: TestCounts;
  /** 派生完整性（见文件头⑴⑶）。false＝这一格的逐名面**不可信**，不等于「全绿」也不等于「全红」。 */
  complete: boolean;
  /** 不完整／存疑的成因，逐条点名（没有成因的 false 与没有 false 的成因都是装饰）。 */
  reasons: string[];
}

/** 逐名规格：SWE-bench 那两列。数据层（`task-set.ts` 的 `TaskSpec.judge`）与这里的裁决器共用同一形状。 */
export interface NamedSets {
  readonly failToPass: readonly string[];
  readonly passToPass: readonly string[];
}

export type NamedSetState = "pass" | "fail" | "unreadable";

export interface NamedSetVerdict {
  /** `pass` 要求「两列每个 id 都逐字对上、读到的全是绿、且逐名面派生完整」；
   *  `fail` 只由**逐名读到的具体红**给出（那是结论性的，哪怕别处读不全）；其余一律 `unreadable`。 */
  state: NamedSetState;
  /** FAIL_TO_PASS 里逐字对上、但读到的不是绿（failed／skipped／todo／不认识的状态都算没绿）。 */
  notGreen: string[];
  /** PASS_TO_PASS 里逐字对上、但读到的不再是绿。 */
  broken: string[];
  /** 两列里在任何逐名结果中都找不到对应名字的 id —— 点名，绝不算成绿。 */
  unmatched: string[];
  reasons: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const nonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

const emptyCounts = (): TestCounts => ({ passed: 0, failed: 0, skipped: 0, todo: 0 });

function countOf(tests: readonly ParsedTest[]): TestCounts {
  const c = emptyCounts();
  for (const t of tests) {
    if (t.outcome === "passed") c.passed += 1;
    else if (t.outcome === "failed") c.failed += 1;
    else if (t.outcome === "skipped") c.skipped += 1;
    else if (t.outcome === "todo") c.todo += 1;
  }
  return c;
}

/** 报错里用的片段：折掉换行、掐到 60 字（整段原文进 reasons 会把读数刷成屏）。 */
function snippet(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length <= 60 ? flat : flat.slice(0, 60) + "…";
}

function unknownResults(reasons: string[]): ParsedResults {
  return { format: "unknown", tests: [], counts: emptyCounts(), complete: false, reasons };
}

/** 绝对路径 → 仓内相对路径（与 `suiteRows` 同一条兜法：配不上前缀就退到 `/tests/` 取尾）。
 *  为什么在本模块再写一遍：`suiteRows` 在 `scripts/` 里，而 `src/` 不许反向依赖评测脚本层
 *  （`scripts/desktop-boundary-check.ts` 那条单向边）。它是路径归一，不是取料。 */
function relFile(name: string): string {
  let rel = name.replace(/^\/+/u, "");
  if (!rel.startsWith("tests/") && rel.includes("/tests/")) rel = rel.slice(rel.lastIndexOf("/tests/") + 1);
  return rel;
}

/* ── vitest 的 JSON 报告（`--reporter=json`）────────────────────────────────────────────── */

const VITEST_STATUS: Record<string, TestOutcome> = {
  passed: "passed",
  failed: "failed",
  skipped: "skipped",
  pending: "skipped", // vitest 把 skip／仅排队都写成 pending：它们都不是绿
  todo: "todo",
};

/** 用例名：`fullName` 优先，缺了才由 `ancestorTitles` ＋ `title` 拼（与 `suiteRows` 同一口径，
 *  这样两位读者对同一份原文给出的名字集合必须一模一样——判卷里就钉这一条）。 */
function vitestAssertionName(a: Record<string, unknown>): string | null {
  if (nonEmptyString(a.fullName)) return a.fullName.trim();
  const ancestors = Array.isArray(a.ancestorTitles) ? a.ancestorTitles.filter((x) => nonEmptyString(x)) : [];
  const title = nonEmptyString(a.title) ? [a.title as string] : [];
  const joined = [...ancestors, ...title].map((x) => String(x).trim()).filter((x) => x !== "").join(" ");
  return joined === "" ? null : joined;
}

function parseVitestJson(text: string): ParsedResults | null {
  if (!text.trimStart().startsWith("{")) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    // 以 `{` 开头却解析不开：这是「写了一半的 JSON」，比认不出更具体，要说出来。
    return unknownResults([`像 JSON 报告却解析不开（多半是输出被截断／没写完）：${snippet(String((e as Error).message))}`]);
  }
  if (!isRecord(obj) || !Array.isArray(obj.testResults)) {
    return unknownResults(["JSON 顶层没有 testResults 数组 ⇒ 认不出这是哪份报告，不猜"]);
  }

  const tests: ParsedTest[] = [];
  const reasons: string[] = [];
  let fileLevelFailures = 0;

  obj.testResults.forEach((entry, i) => {
    const at = `testResults[${String(i + 1)}]`;
    if (!isRecord(entry)) {
      reasons.push(`${at} 不是对象 ⇒ 它里面的用例一条都读不到`);
      return;
    }
    const file = nonEmptyString(entry.name) ? relFile(entry.name) : undefined;
    const label = file ?? at;
    const list = entry.assertionResults;
    if (!Array.isArray(list)) {
      // 整个 suite 崩了／收不到用例时，vitest 只给文件级 status：那一格的红在逐名面上**没有行**。
      // 不记这一笔的话，「一份全是文件级红的报告」会被读成「逐名没有红」＝最贵的那种假绿。
      if (entry.status === "failed") {
        fileLevelFailures += 1;
        reasons.push(`${label} 文件级 failed 却没有 assertionResults ⇒ 这个文件的失败没有逐名行，逐名面接不住`);
      }
      return;
    }
    list.forEach((raw, j) => {
      if (!isRecord(raw)) {
        reasons.push(`${label} 的第 ${String(j + 1)} 条用例不是对象 ⇒ 丢掉，不算进任何一列`);
        return;
      }
      const name = vitestAssertionName(raw);
      if (name === null) {
        reasons.push(`${label} 的第 ${String(j + 1)} 条用例既没有 fullName 也没有 title ⇒ 名字对不上任何 id`);
        return;
      }
      const status = typeof raw.status === "string" ? raw.status : "";
      const outcome: TestOutcome = VITEST_STATUS[status] ?? "unknown";
      if (outcome === "unknown") reasons.push(`用例「${name}」的状态「${status || "(缺失)"}」不认识 ⇒ 它既没算进绿也没算进红`);
      tests.push({ name, ...(file !== undefined ? { file } : {}), outcome });
    });
  });

  const counts = countOf(tests);
  const numTotal = obj.numTotalTests;
  const numFailed = obj.numFailedTests;
  const numPassed = obj.numPassedTests;
  if (typeof numTotal === "number" && numTotal !== tests.length) {
    reasons.push(`顶层 numTotalTests=${String(numTotal)}，逐名只读到 ${String(tests.length)} 条 ⇒ 差的 ${String(Math.abs(numTotal - tests.length))} 条没有任何逐名行`);
  }
  if (typeof numFailed === "number" && numFailed !== counts.failed) {
    reasons.push(`顶层 numFailedTests=${String(numFailed)}，逐名读到 ${String(counts.failed)} 条红 ⇒ 两半对不上`);
  }
  if (typeof numPassed === "number" && numPassed !== counts.passed) {
    reasons.push(`顶层 numPassedTests=${String(numPassed)}，逐名读到 ${String(counts.passed)} 条绿 ⇒ 两半对不上`);
  }
  if (obj.success === true && counts.failed > 0) reasons.push("报告说 success=true，逐名却读到了红 ⇒ 顶层计数不可信");
  if (obj.success === false && counts.failed === 0 && fileLevelFailures === 0) {
    reasons.push("报告说 success=false，逐名却一条红也没读到 ⇒ 红在别处（文件级／退出码），逐名面没接住");
  }
  const complete = reasons.length === 0;
  return { format: "vitest-json", tests, counts, complete, reasons };
}

/* ── node --test 的 TAP（逐名在结果行里）────────────────────────────────────────────────── */

const TAP_HEADER = /^TAP version \d+/u;
/** 结果行：`ok 3 - 名字`／`not ok 3 - 名字`。**解析与判卷共用这一枚**（判卷不许再抄一份取料）。
 *  只有**顶格**的那些进逐名面（缩进的是嵌套 subtest，收了会双计）。
 *  ⚠️ 别把这条读成「顶格的才是 node 结尾计数数的那些」——**不成立**（2026-10-19 实测）：
 *  `node --test --test-reporter tap` 的 `# tests N` 把 subtest 一起数进去
 *  （2 个父 + 2 个子 ⇒ `# tests 4`）。所以带 subtest 的 TAP 在结尾计数对账那一格
 *  必然对不上，`complete` 会是 false——方向是 fail-safe（不会假绿），但成因要说清楚，
 *  否则读的人会去查"少了哪几条结果行"，而真相是"subtest 被有意排除、计数却含它们"。
 *  **连字符与描述都是可选的**（TAP 文法：`ok <number> [<description>]`）——2026-10-19 修：
 *  原先硬要 `" - "`，于是 `ok 1 甲`／`ok 1` 这两种**合法** TAP 一整行都匹配不上，
 *  在 `if (m === null …) continue` 那里被静默跳过，逐名面直接空掉（下面那句
 *  「第 N 行结果没有名字」因此对它们永不可达）。改成 `(?: - )?` 之后，没描述的
 *  由 `rest` 为空串接手，走那条**会出声**的分支——宁可报「没有名字」，别静默丢。
 *  ⚠️ 别为了兼容把 ` - ` 换成 `-`：那会把 `ok 1 -a-b` 这类名字切错位置。 */
export const TAP_RESULT_LINE = /^(?<indent> *)(?<verdict>not ok|ok) (?<num>\d+)(?: - )?(?<rest>.*)$/u;
const TAP_PLAN = /^1\.\.(\d+)/u;
const TAP_TRAILER = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)/u;
/** 指令（`# SKIP`／`# TODO`）：node 把它接在名字后面。已知局限——标题里自己带 ` # SKIP` 会被切成两段，
 *  本仓没有这种标题；要放宽也得先有见证，别预先造一条更松的匹配。
 *  **大小写不敏感**（TAP 规定指令大小写无关）：2026-10-19 修。原先只认大写，而下一行的
 *  `directive?.[1]?.toUpperCase()` 因此是**死代码**（正则永远产不出小写），小写
 *  `# skip` / `# todo` 整条不匹配 ⇒ 指令文本粘在名字上、用例按 ok/not ok 归桶：
 *  实测 `ok 1 - 甲 # skip 还没装依赖` 读出 `name:"甲 # skip 还没装依赖", outcome:"passed"`
 *  ，且 `complete: true`——**被跳过的用例计成绿**。见证：node 24 实测输出是大写，
 *  但 TAP 语法本身允许小写，别的生产者会这么写（见 tests/eval-test-results.test.ts 的
 *  小写用例）。大小写放开的**代价**是名字里出现 ` # skip` 的概率上升，与本条原有的
 *  已知局限同向，不引入新的一类错。 */
const TAP_DIRECTIVE = /\s#\s(SKIP|TODO)\b/iu;
/** 失败块里的 `location: '<路径>:<行>:<列>'`——路径在引号**内**，别把收尾引号写在冒号前面。
 *  node 只在失败（或有诊断）的那些块里打它，绿块没有 ⇒ `file` 因此是「读得到才给」。 */
const TAP_LOCATION = /^\s+location:\s*'(.+?):\d+:\d+'/u;
/** 本仓有界输出留下的省略标记（跑器把中段掐了只留两头）。被省略的那段里可能有红。 */
const OUTPUT_ELISION = /\[\s*有界性：中段省略/u;

/** spec 结果行：`✔ 名字 (1.23ms)`／`✖ 名字 (1.23ms)`。顶格才算（嵌套 subtest 缩进）。 */
const SPEC_RESULT_LINE = /^(?<verdict>[✔✖]) (?<name>.+?)(?: \([0-9.]+ms\))?$/u;
/** spec 的汇总行：`ℹ tests 3`／`ℹ pass 3`／`ℹ fail 0`。 */
const SPEC_TRAILER = /^ℹ (?<key>tests|pass|fail|cancelled|skipped|todo|suites) (?<n>\d+)$/u;

function looksLikeSpec(lines: readonly string[]): boolean {
  const results = lines.filter((l) => !l.startsWith(" ") && SPEC_RESULT_LINE.test(l));
  if (results.length === 0) return false;
  // 同时要有一行 `ℹ` 汇总：单看 `✔ 某某` 太像给人看的一行字（同 looksLikeTap 那条纪律）。
  return lines.some((l) => SPEC_TRAILER.test(l));
}

function parseNodeTestSpec(text: string, lines: readonly string[]): ParsedResults {
  const tests: ParsedTest[] = [];
  const reasons: string[] = [];
  const trailer = new Map<string, number>();
  let summaryStarted = false;
  for (const line of lines) {
    const t = SPEC_TRAILER.exec(line);
    if (t !== null) {
      trailer.set(t.groups!.key!, Number(t.groups!.n));
      summaryStarted = true;
      continue;
    }
    // Node's spec reporter repeats failed tests beneath `✖ failing tests:` after its ℹ summary.
    // Those diagnostic lines are not another result list and must not be counted twice.
    if (summaryStarted) continue;
    const m = SPEC_RESULT_LINE.exec(line);
    if (m === null || line.startsWith(" ")) continue;
    const name = m.groups!.name!.trim();
    if (name === "") { reasons.push("spec 结果行没有名字 ⇒ 它匹配不上任何 id"); continue; }
    tests.push({ name, outcome: m.groups!.verdict === "✔" ? "passed" : "failed" });
  }
  const counts = countOf(tests);
  for (const [key, bucket] of [["tests", "tests"], ["pass", "passed"], ["fail", "failed"], ["skipped", "skipped"], ["todo", "todo"]] as const) {
    const declared = trailer.get(key);
    if (declared === undefined) continue;
    const got = bucket === "tests" ? tests.length : counts[bucket];
    if (declared !== got) reasons.push(`结尾报 ${key} ${String(declared)}、逐名读到 ${String(got)} 条 ⇒ 对不上`);
  }
  if (tests.length === 0) reasons.push("一条逐名都没读到 ⇒ 这一格没有料");
  return { format: "node-test-spec", tests, counts, complete: reasons.length === 0, reasons };
}

function looksLikeTap(lines: readonly string[]): boolean {
  if (lines.some((l) => TAP_HEADER.test(l))) return true;
  // 没有头也认得出来（跑器有时只把那段结果贴进日志）：但要**同时**有结果行与 TAP 的另一种标记，
  // 免得把一句人话里的 "ok 1 - x" 当成一份报告。认成 TAP 之后，缺头本身会进 reasons（判不完整）。
  const results = lines.filter((l) => !l.startsWith(" ") && TAP_RESULT_LINE.test(l));
  if (results.length === 0) return false;
  return lines.some((l) => TAP_PLAN.test(l)) || lines.some((l) => /^# Subtest: /u.test(l));
}

function parseNodeTestTap(text: string, lines: readonly string[]): ParsedResults {
  const tests: ParsedTest[] = [];
  const reasons: string[] = [];
  let planCount: number | null = null;
  const trailer = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const p = TAP_PLAN.exec(line);
    if (p !== null) { planCount = Number(p[1]); continue; }
    const t = TAP_TRAILER.exec(line);
    if (t !== null) { trailer.set(t[1]!, Number(t[2]!)); continue; }
    if (/^Bail out!/u.test(line)) { reasons.push(`出现 Bail out!（${snippet(line.slice(10))}）⇒ 后面的用例根本没跑`); continue; }

    const m = TAP_RESULT_LINE.exec(line);
    if (m === null || line.startsWith(" ")) continue; // 缩进的那些属嵌套 subtest，不计（见上）
    const groups = m.groups as { verdict: string; num: string; rest: string };
    const rest = groups.rest ?? "";
    const directive = TAP_DIRECTIVE.exec(rest);
    const dKind = directive?.[1]?.toUpperCase();
    const name = (directive === null ? rest : rest.slice(0, directive.index)).trim();
    if (name === "") { reasons.push(`第 ${groups.num} 行结果没有名字 ⇒ 它匹配不上任何 id`); continue; }

    // 失败块自带的 YAML `location:` 是本仓语料里唯一能对上文件的那一枚（绿块没有）。
    let file: string | undefined;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!;
      if (!next.startsWith(" ")) break;
      const loc = TAP_LOCATION.exec(next);
      if (loc !== null) { file = relFile(loc[1]!); break; }
    }

    let outcome: TestOutcome;
    if (dKind === "SKIP") outcome = "skipped";
    else if (dKind === "TODO") outcome = "todo";
    else outcome = groups.verdict === "ok" ? "passed" : "failed";
    tests.push({ name, ...(file !== undefined ? { file } : {}), outcome });
  }

  const counts = countOf(tests);
  if (!TAP_HEADER.test(lines.find((l) => l.includes("TAP version")) ?? "")) {
    reasons.push("没有 `TAP version` 头 ⇒ 认它是 TAP 只靠结果行形状，读到的东西不保证是全份");
  }
  if (planCount === null) reasons.push("没有 1..N 计划线 ⇒ 无法核对逐名是否齐全（读到几条就是几条，可能就是半份）");
  else if (planCount !== tests.length) {
    // 措辞不许说「没有结果行」：那些行可能**在场**，只是没匹配上（`ok 1 甲` 这种无连字符
    // 形状在 2026-10-19 之前正是如此——整行都在，却被读成 0 条）。判据要指认"数不上"，
    // 而不是替一个没验证过的成因定罪（第 186 页同一次课：判据的措辞会教人去错的方向查）。
    reasons.push(`计划 ${String(planCount)} 条、逐名只读到 ${String(tests.length)} 条 ⇒ 差的 ${String(Math.abs(planCount - tests.length))} 条没进逐名面（行没匹配上，或整行缺失）`);
  }
  const trailerPairs: readonly [string, keyof TestCounts | "tests" | "cancelled"][] = [
    ["tests", "tests"], ["pass", "passed"], ["fail", "failed"], ["skipped", "skipped"], ["todo", "todo"], ["cancelled", "cancelled"],
  ];
  for (const [key, bucket] of trailerPairs) {
    const declared = trailer.get(key);
    if (declared === undefined) continue;
    const got = bucket === "tests" ? tests.length : bucket === "cancelled" ? 0 : counts[bucket as keyof TestCounts];
    if (bucket === "cancelled") {
      if (declared > 0) reasons.push(`结尾报 cancelled=${String(declared)} ⇒ 那些用例既不是绿也不是红，逐名面上没有它们的行`);
      continue;
    }
    if (declared !== got) {
      // 多出来的那侧往往是**嵌套 subtest**：node 的结尾计数含它们，而逐名面按设计只收顶格
      // （收了会双计）。措辞要把这个成因说出来——只说"不符"会把读的人送去查少了哪条结果行，
      // 而真相是两边口径不同（2026-10-19：这条成因此前在注释里就是错的，见 TAP_RESULT_LINE）。
      const more = declared > got;
      reasons.push(
        `结尾计数 # ${key} ${String(declared)} 与逐名读到的 ${String(got)} 不符`
        + (more ? "（多出来的多半是嵌套 subtest：计数含它们、逐名面只收顶格，收齐了会双计）" : "（少的那侧可能被省略标记掐掉，或行没匹配上）"),
      );
    }
  }
  if (OUTPUT_ELISION.test(text)) reasons.push("输出里有省略标记（[有界性：中段省略 N 字]）⇒ 被掐掉的那段里可能有红，这一格的逐名面不完整");
  return { format: "node-test-tap", tests, counts, complete: reasons.length === 0, reasons };
}

/* ── pytest（SWE-bench 的判卷就是它：`python -m pytest -rA <ids>`）────────────────────────── */

/** 逐名行的**状态位**取「一个大写开头的词」而不是「已知六个词」：拿已知词表去当门，
 *  不认识的词就整行不匹配 ⇒ 那条结果从面上消失，只剩「读到的条数少了」这一句间接话术。
 *  状态不认识是要**点名**的（见 `record`），不是要装作没看见——这是本模块的第三态口径。 */
const PYTEST_STATUS_TOKEN = "[A-Z][A-Za-z_]*";
/** 逐名行的两种形状：verbose 的 `nodeid PASSED [ 33%]`，和 `-rA` 短汇总的 `FAILED nodeid - 原因`
 *  （跳过那条写成 `SKIPPED [1] nodeid: 原因`，所以状态词后面允许一段 `[..]`）。 */
const PYTEST_VERBOSE = new RegExp(
  "^(?<nodeid>\\S+::\\S+) (?<status>" + PYTEST_STATUS_TOKEN + ")(?:\\s+\\[\\s*\\d+%\\])?\\s*$",
  "u",
);
const PYTEST_SUMMARY = new RegExp(
  // 短汇总的 skipped 形如 `SKIPPED [1] tests/x.py::t: reason`（nodeid 后是单个冒号），
  // 旧正则只认 ` - reason` / 行尾 ⇒ 该行解析不到，逐名计数与结尾汇总对不上，整份判卷变 unreadable。
  "^(?<status>" + PYTEST_STATUS_TOKEN + ")(?:\\s+\\[[^\\]]*\\])? (?<nodeid>\\S+?)(?::\\s.*|\\s+- .*)?$",
  "u",
);
const PYTEST_SESSION = /^=+ test session starts =+$/u;
const PYTEST_SUMMARY_HEAD = /^=+ short test summary info =+$/u;
const PYTEST_TRAILER = /^=+ (?<body>[^=]*?) in [0-9.]+(?:s|mins) =+$/u;
const PYTEST_COLLECTED = /^collected (\d+)(?: items?)?(?: \/ \d+ error[s]?)?$/u;
const PYTEST_STATUS_OUTCOME: Record<string, TestOutcome> = {
  PASSED: "passed", XPASS: "passed", FAILED: "failed", ERROR: "failed", SKIPPED: "skipped", XFAIL: "skipped",
};
/** 结尾汇总行里每一枚词归属的桶（`1 failed` 与 `1 error` 都进 failed，`1 xfailed` 进 skipped……）。 */
const PYTEST_TRAILER_WORDS: readonly [string, keyof TestCounts][] = [
  ["failed", "failed"], ["error", "failed"], ["errors", "failed"],
  ["passed", "passed"], ["xpassed", "passed"],
  ["skipped", "skipped"], ["xfailed", "skipped"],
];

function looksLikePytest(lines: readonly string[]): boolean {
  return lines.some((l) =>
    PYTEST_SESSION.test(l) || PYTEST_SUMMARY_HEAD.test(l) || PYTEST_COLLECTED.test(l) ||
    PYTEST_VERBOSE.test(l) || PYTEST_SUMMARY.test(l));
}

function parsePytest(text: string, lines: readonly string[]): ParsedResults {
  const reasons: string[] = [];
  /** nodeid → 这条的最终读数（同一 nodeid 在 verbose 与短汇总里各出现一次，必须并成一条）。 */
  const seen = new Map<string, ParsedTest>();
  /** 结尾那行的桶（failed／passed／skipped 三桶够用了；warning／duration 不参与裁决）。 */
  let trailer: Record<string, number> | null = null;
  let trailerBody = "";
  let collected: number | null = null;

  const record = (nodeid: string, statusWord: string): void => {
    const outcome = PYTEST_STATUS_OUTCOME[statusWord] ?? "unknown";
    if (outcome === "unknown") {
      // 认不出状态词也要把这条**留在逐名面里**（挂 unknown 桶），只出声不落账是不够的：
      // 不落账的话它接着会被上面那句「一条逐名也没读到」再报一次——同一行两个相反的 diagnosis，
      // 而 collected 与逐名计数的对账也跟着失真（我们确实读到了这一行，只是没法归类）。
      reasons.push(`状态词「${statusWord}」不认识（行：${snippet(nodeid)}）⇒ 它没算进任何一列`);
      if (!seen.has(nodeid)) seen.set(nodeid, { name: nodeid, file: nodeid.includes("::") ? nodeid.split("::")[0] : nodeid, outcome: "unknown" });
      return;
    }
    const file = nodeid.includes("::") ? nodeid.split("::")[0] : nodeid;
    const prev = seen.get(nodeid);
    if (prev === undefined) { seen.set(nodeid, { name: nodeid, file, outcome }); return; }
    const rank: Record<TestOutcome, number> = { unknown: 4, failed: 3, skipped: 2, todo: 2, passed: 1 };
    if (rank[prev.outcome] !== rank[outcome]) {
      reasons.push(`同一 nodeid「${nodeid}」出现两种状态（${prev.outcome} 与 ${outcome}）⇒ 取更坏的那条，并记为派生不完整`);
      if (rank[outcome] > rank[prev.outcome]) prev.outcome = outcome;
    }
  };

  for (const line of lines) {
    const v = PYTEST_VERBOSE.exec(line);
    if (v !== null) { record(v[1]!, (v.groups as { status: string }).status); continue; }
    const s = PYTEST_SUMMARY.exec(line);
    if (s !== null) {
      const nodeid = s[2]!;
      record(nodeid, (s.groups as { status: string }).status);
      if (!nodeid.includes("::")) {
        // 收集期就炸（`ERROR tests/test_foo.py - ImportError`）：那一格的红落在文件级，
        // 这个文件里的用例**一条逐名行都没有** ⇒ 逐名面必须说它接不住，而不是「没读到红」。
        reasons.push(`「${nodeid}」没有 :: 段 ⇒ 这是文件级／收集期的事，它里面的用例不会有逐名行`);
      }
      continue;
    }
    const c = PYTEST_COLLECTED.exec(line);
    if (c !== null) { collected = Number(c[1]); continue; }
    const t = PYTEST_TRAILER.exec(line);
    if (t !== null) {
      trailerBody = t.groups?.body ?? "";
      trailer = {};
      for (const m of trailerBody.matchAll(/(\d+) (failed|passed|error|errors|skipped|xfailed|xpassed)/gu)) {
        trailer[m[2]!] = (trailer[m[2]!] ?? 0) + Number(m[1]);
      }
    }
  }

  const tests = [...seen.values()];
  const counts = countOf(tests);
  if (tests.length === 0) {
    reasons.push("一条逐名也没读到（只有进度点／收集失败／输出被截断）⇒ 这一格没有尺，读不出比判绿诚实");
  }
  if (trailer === null) reasons.push("没有结尾那行汇总（N failed, M passed in Xs）⇒ 无法确认逐名是否齐全，进程可能崩在半路");
  else {
    if (/\bno tests ran\b/u.test(trailerBody)) reasons.push("结尾说 no tests ran ⇒ 一条都没跑，逐名面是空的不是绿的");
    for (const bucket of ["passed", "failed", "skipped"] as const) {
      const declared = Object.entries(trailer)
        .filter(([word]) => (PYTEST_TRAILER_WORDS.find(([w]) => w === word)?.[1] ?? "passed") === bucket)
        .reduce((sum, [, n]) => sum + n, 0);
      const mentioned = Object.keys(trailer).some((word) => (PYTEST_TRAILER_WORDS.find(([w]) => w === word)?.[1] ?? "passed") === bucket);
      if (mentioned && declared !== counts[bucket]) {
        reasons.push(`结尾汇总的 ${bucket} 合计 ${String(declared)} 与逐名读到的 ${String(counts[bucket])} 不符`);
      }
    }
  }
  if (collected !== null && collected > tests.length) {
    reasons.push(`收集期说 collected ${String(collected)} 条、逐名只读到 ${String(tests.length)} 条 ⇒ 差的 ${String(collected - tests.length)} 条没有名字行`);
  }
  return { format: "pytest", tests, counts, complete: reasons.length === 0, reasons };
}

/** 自动认格式并逐名解析。调用方只负责把原文喂进来（不 open、不 spawn）。 */
export function parseTestResults(raw: string): ParsedResults {
  // 先剥 ANSI 再解析（2026-10-12 CI 自评抓到）：CI 里 `GITHUB_ACTIONS=true` 让 vitest 强制开彩色，
  // `pnpm run test` 的每一行都带 `ESC[…m` ⇒ `looksLikeTap` 认不出 `TAP version 13` 头、
  // 也认不出 `ok 1 - 名字` 结果行 ⇒ 整份逐名面退成 `unknown`（"没有尺"，不是"零条失败"）。
  // 本地不红只因为 TERM=dumb 且非 CI，那**不是判据该依赖的东西**：这一支吃的是测试输出，
  // 与终端有没有颜色无关。同族先例：`scripts/lib/mutate-gates.ts` 的 `failingTestText` 与
  // `selectedTestCount` 早就剥过一次（同一个 CI 抓到）。
  const text = (typeof raw === "string" ? raw : "").replace(ANSI_SEQUENCE, "");
  if (text.trim() === "") return unknownResults(["输入是空的 ⇒ 没有任何逐名可读（这是「没有尺」，不是「零条失败」）"]);
  const vitest = parseVitestJson(text);
  if (vitest !== null) return vitest;
  const lines = text.split("\n");
  if (looksLikeSpec(lines)) return parseNodeTestSpec(text, lines);
  if (looksLikeTap(lines)) return parseNodeTestTap(text, lines);
  if (looksLikePytest(lines)) return parsePytest(text, lines);
  return unknownResults([`认不出格式：既不是 vitest 的 JSON 报告，也没有 node --test 的 spec/TAP 结果行，也没有 pytest 的逐名行（开头：${snippet(text)}）`]);
}

/** ANSI SGR 颜色序列（`ESC [ … m`）。跑器输出在 CI 里被强制着色，见 `parseTestResults` 头上那段。 */
const ANSI_SEQUENCE = /\u001b\[[0-9;]*m/gu;

/* ── SWE-bench 那一格的裁决 ────────────────────────────────────────────────────────────── */

/** 一条逐名结果能对外报出的名字（**只认逐字**，见文件头⑷）。
 *  vitest／TAP 的 name 是标题串，pytest 的 name 已是 nodeid；带文件的组合形态只给「名字里没有 ::」的那些，
 *  否则会拼出 `tests/a.py::tests/a.py::test_b` 这种不存在的 id。 */
function keysOf(t: ParsedTest): string[] {
  const norm = (s: string): string => s.trim().replace(/\s+/gu, " ");
  const out = [norm(t.name)];
  if (t.file !== undefined && !t.name.includes("::")) out.push(norm(`${t.file}::${t.name}`));
  return out.filter((x) => x !== "");
}

/** 逐名规格成立的最小条件。数据层（`task-set.ts` 的 judge 解析）与裁决器**共用这一支**，
 *  免得「解析期放行、裁决期拒判」各写一套——那是本仓反复点名的抄第二份。 */
export function namedSetProblems(spec: NamedSets | null | undefined): string[] {
  if (typeof spec !== "object" || spec === null) return ["没给逐名规格 ⇒ 这一格没有可判的清单"];
  const out: string[] = [];
  const f2p = spec.failToPass;
  const p2p = spec.passToPass;
  const clean = (list: readonly string[], label: string): string[] => {
    if (!Array.isArray(list)) { out.push(`${label} 不是数组`); return []; }
    const kept: string[] = [];
    const seen = new Set<string>();
    list.forEach((x, i) => {
      if (!nonEmptyString(x)) { out.push(`${label} 第 ${String(i + 1)} 条是空的或非字符串 ⇒ 它永远匹配不上任何用例`); return; }
      const id = x.trim();
      if (seen.has(id)) out.push(`${label} 里「${id}」重复 ⇒ 同一 id 数两次，分母骗人`);
      seen.add(id);
      kept.push(id);
    });
    return kept;
  };
  const f = clean(f2p, "failToPass");
  const p = clean(p2p, "passToPass");
  if (f.length === 0) out.push("failToPass 为空 ⇒ 没有「该转绿的」清单，这一格退化成只查「好的不许坏」");
  const both = new Set(f);
  const overlap = p.filter((x) => both.has(x));
  if (overlap.length > 0) out.push(`同一个 id 既在 failToPass 又在 passToPass（${overlap.join("、")}）⇒ 自相矛盾的判卷`);
  return out;
}

/** 两列逐名裁决：哪些该转绿的没绿、哪些该保住的坏了、哪些名字根本对不上（第三态）。 */
export function judgeNamedSets(parsed: ParsedResults, spec: NamedSets): NamedSetVerdict {
  const reasons: string[] = [];
  const problems = namedSetProblems(spec);
  const allIds = [...new Set([...(Array.isArray(spec?.failToPass) ? spec.failToPass : []),
    ...(Array.isArray(spec?.passToPass) ? spec.passToPass : [])].map((x) => (typeof x === "string" ? x.trim() : x)))];
  if (problems.length > 0) {
    return { state: "unreadable", notGreen: [], broken: [], unmatched: allIds, reasons: [...problems, "逐名规格不成立 ⇒ 这一格不许出 pass／fail 读数"] };
  }
  if (parsed.format === "unknown") {
    return {
      state: "unreadable", notGreen: [], broken: [], unmatched: allIds,
      reasons: [...parsed.reasons, `格式认不出（${parsed.format}）⇒ 一条逐名也接不住，这些 id 全部算没读到：${allIds.join("、")}`],
    };
  }

  const index = new Map<string, ParsedTest[]>();
  for (const t of parsed.tests) {
    for (const k of keysOf(t)) {
      const bucket = index.get(k);
      if (bucket === undefined) index.set(k, [t]);
      else if (!bucket.includes(t)) bucket.push(t);
    }
  }

  const notGreen: string[] = [];
  const broken: string[] = [];
  const unmatched: string[] = [];
  const look = (id: string): TestOutcome | null => {
    const hits = index.get(id.trim().replace(/\s+/gu, " "));
    if (hits === undefined || hits.length === 0) return null;
    const rank: Record<TestOutcome, number> = { passed: 1, todo: 2, skipped: 2, failed: 3, unknown: 4 };
    let worst: TestOutcome = "passed";
    for (const h of hits) if (rank[h.outcome] > rank[worst]) worst = h.outcome;
    return worst;
  };

  for (const id of spec.failToPass) {
    const got = look(id);
    if (got === null) { unmatched.push(id.trim()); continue; }
    if (got !== "passed") { notGreen.push(id.trim()); reasons.push(`FAIL_TO_PASS「${id.trim()}」逐名读到的是 ${got} ⇒ 该转绿的没绿`); }
  }
  for (const id of spec.passToPass) {
    const got = look(id);
    if (got === null) { unmatched.push(id.trim()); continue; }
    if (got !== "passed") { broken.push(id.trim()); reasons.push(`PASS_TO_PASS「${id.trim()}」逐名读到的是 ${got} ⇒ 该保住的坏了`); }
  }

  let state: NamedSetState;
  if (notGreen.length > 0 || broken.length > 0) state = "fail"; // 读到的红是结论性的，即使别处读不全
  else if (unmatched.length > 0) {
    state = "unreadable";
    reasons.push(`这些 id 在任何逐名结果里都对不上号（${unmatched.join("、")}）⇒ 不许算成绿；名字口径不同就得上报器做映射，不是在这儿蒙`);
  } else if (!parsed.complete) {
    state = "unreadable";
    reasons.push("读到的都对上了，但逐名面派生不完整 ⇒ 只能报没读全，不能报过");
  } else state = "pass";

  return { state, notGreen, broken, unmatched, reasons: [...parsed.reasons, ...reasons] };
}
