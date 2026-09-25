/** 锚点 `expectFail` 的标题对账判据（纯函数，供 tests/ 消费；不在这里出声）。
 *
 * 为什么要它：`scripts/mutate-verify.mjs` 的 runner 会把变异后的 vitest 输出与 `expectFail` 逐字比
 * （其 8400 行：「测试红了但没红在期望用例上——可能误伤无关用例」）。
 * 于是**改了 `it()` 标题而没同步 expectFail** 的表现不是"失去守护"，而是**一条好锚点被报成未杀**——
 * 代价要跑完整张表（2026-09-24 实测 963 条 / 36.9 分钟）才看得见，而看见的人还得靠人眼归类。
 * 本判据把这件事挪到秒级：漂移一条即点名。
 *
 * 名单（`KNOWN_DRIFT`）的规矩照 `docs-check` 的 `LEGACY_WAIVERS`：存量逐条带理由，
 * 名单外新增即红；**登记了却不再命中的条目也算红（stale-waiver）**——豁免不许静默烂在这儿。 */

export interface AnchorRow {
  id: string;
  test: string | null;
  expectFail: string | null;
}

export interface TableSource {
  path: string;
  text: string;
}

export type FindingKind = "drift" | "stale-waiver" | "unverified-face" | "unverified-file";

export interface Finding {
  kind: FindingKind;
  id: string;
  detail: string;
}

/** 表里那条字符串字面量是 JS 转义态（`\"`、`\\`），运行时比的是解出来的真字符。
 *  第一版直接拿原文去比 ⇒ 131 条误报，其中绝大多数只是标题里有引号。 */
function decode(lit: string): string | null {
  try { return JSON.parse('"' + lit + '"') as string; } catch { return null; }
}

/** 按每个 `id:` 出现的下标切片。
 *  刻意不用"按 `{` 行切块"：`\s*$` 在没有 `m` 标志时会连换行一起吃，整张表并成一块，
 *  于是读出「锚点总数 1」这种**结构恒真**的读数（本仓 117/118 那一族）。 */
export function parseAnchors(tableText: string): AnchorRow[] {
  const out: AnchorRow[] = [];
  const at = [...tableText.matchAll(/\bid:\s*"((?:[^"\\]|\\.)*)"/g)];
  for (let i = 0; i < at.length; i += 1) {
    const start = at[i]!.index!;
    const end = i + 1 < at.length ? at[i + 1]!.index! : tableText.length;
    const chunk = tableText.slice(start, end);
    const test = /\btest:\s*"((?:[^"\\]|\\.)*)"/.exec(chunk);
    const ef = /\bexpectFail:\s*"((?:[^"\\]|\\.)*)"/.exec(chunk);
    out.push({
      id: at[i]![1]!,
      test: decode(test?.[1] ?? "") || null,
      expectFail: ef?.[1] === undefined ? null : decode(ef[1]),
    });
  }
  return out;
}

const PLACEHOLDER = /(\$\{[\s\S]*?\}|\$[A-Za-z_]\w*|%[sdijfovc#])/;
const WILDCARD = "@@wildcard@@";

/** 抽源码里的用例标题。四支缺一不可：
 *  直接 `it("…")` / 模板字面量 / **柯里 `it.each([...])("…")`** / 后两者的模板形式。
 *  柯里那一支是第一版漏掉的：真表里 4 条被误判成漂移，全是 `it.each` 的标题（标题在第二个括号里）。 */
function extractTitles(sourceText: string): string[] {
  const MOD = String.raw`(?:\.each|\.skip|\.todo|\.only|\.fails|\.concurrent|\.sequential)?`;
  const SQ = String.raw`"((?:[^"\\]|\\.)*)"`;
  const BQ = "`((?:[^`\\\\]|\\\\.)*)`";
  const EACH_TAIL = String.raw`\((?:[^()]|\([^()]*\))*\)\s*\(\s*`;
  const pats = [
    new RegExp(String.raw`\b(?:it|test)` + MOD + String.raw`\s*\(\s*` + SQ, "g"),
    new RegExp(String.raw`\b(?:it|test)\.each\s*` + EACH_TAIL + SQ, "g"),
    new RegExp(String.raw`\b(?:it|test)` + MOD + String.raw`\s*\(\s*` + BQ, "g"),
    new RegExp(String.raw`\b(?:it|test)\.each\s*` + EACH_TAIL + BQ, "g"),
  ];
  const out: string[] = [];
  for (const re of pats) for (const m of sourceText.matchAll(re)) out.push(m[1]!);
  return out;
}

function titlePatterns(sourceText: string): RegExp[] {
  return extractTitles(sourceText).map((lit) => {
    const un = lit.replace(/\\(.)/g, "$1");
    // 顺序要紧：先按占位符切开、只转义字面段、再把通配拼回去。
    // 若先整体转义，`${…}` 会变成 `\$\{…\}`，之后就再也认不出它是占位符（第一版栽在这）。
    const body = un
      .split(PLACEHOLDER)
      .map((piece) => (PLACEHOLDER.test(piece) ? WILDCARD : piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .join("");
    return new RegExp("^[\\s\\S]*" + body.split(WILDCARD).join("[\\s\\S]*?") + "[\\s\\S]*$");
  });
}

/** 命中判据（两条任一即算在场，与 runner 的 `输出含这段` 语义同宽）：
 *  ① 解出来的 expectFail 逐字出现在该 test 文件源码里；② 它整串匹配某条（含占位符的）标题。 */
function titlePresent(expectFail: string, sourceText: string): boolean {
  if (sourceText.includes(expectFail)) return true;
  return titlePatterns(sourceText).some((re) => re.test(expectFail));
}

/** 存量名单：**当前为空**——这一栏本来记过 8 条"待判定"的漂移（`auto-verify-default-on`、
 *  `worker-impact-spec-not-appended`、`renderer-hides-worker-spend`、`panel-dirty-*`、`redaction-stops-recursing-into-containers` 等）。
 *  它们**全部是本闸自己的误判**，不是标题漂移：真标题写成柯里的 `it.each([...])("…%s…")` / `("…$label…")`，
 *  第一版抽取只认 `it("…")`，标题落在第二个括号里就抽不到 ⇒ 一律判成"找不到对应标题"。
 *  补上"柯里"与 `$插值` 两支后，**当前工作树那张 804 条的表**漂移归零。
 *  另两面分开记（本闸读的是工作树，不是 HEAD）：
 *    · HEAD（detached `6a06249`，963 条）仍报 **2 条真漂移**：`renderer-hides-worker-spend`、
 *      `panel-dirty-misses-review-and-progress-events` —— 同属渲染层/面板族，正随 core-only 那笔在飞删除一起消失，
 *      在那棵树里改无处可改（对方副本已删），所以**不修只记**；若桌面层方向回退，这两条要重判。
 *  留这段话是给下一个人：**先问抽取面缺不缺形状，再考虑登记成存量**。 */
/**
 * 存量豁免（只准带理由登记；#50 落笔后这条必须撤，届时 stale 机制会自己点名）。
 * `user-skill-face-budget-abolished`：第 64 页 #47 把三处「全文见」副本收成一支 `skillRecallSuffix`
 * 并按落位分两案 ⇒ 那条用例的标题换成"取回那句按落位给，没登记工作区就不递地址"。
 * 锚点行本身在 `scripts/mutate-verify.mjs`（别人的在飞文件），针脚与 expectFail 由 #50 一起改指。
 */
export const KNOWN_DRIFT: Readonly<Record<string, string>> = {
  "user-skill-face-budget-abolished": "第 64 页 #47 改了那句尾注的措辞与用例标题；待 #50 把针脚与 expectFail 改指新写法后撤本条",
};

export function checkAnchorTitles(
  rows: readonly AnchorRow[],
  sources: readonly TableSource[],
  waivers: Readonly<Record<string, string>> = KNOWN_DRIFT,
): Finding[] {
  const byPath = new Map<string, string>();
  for (const s of sources) byPath.set(s.path, s.text);

  const out: Finding[] = [];
  const drifting = new Set<string>();
  for (const r of rows) {
    if (r.test === null) continue; // 没有 test 字段的锚点由 mutate-verify 自己管，不在这儿造第二把尺
    if (r.expectFail === null) continue;
    if (!r.test.endsWith(".test.ts")) {
      out.push({ kind: "unverified-face", id: r.id, detail: `test 指向非 vitest 面（${r.test}）⇒ 本闸不判` });
      continue;
    }
    const text = byPath.get(r.test);
    if (text === undefined) {
      out.push({ kind: "unverified-file", id: r.id, detail: `读不到 ${r.test} ⇒ 没尺，不判` });
      continue;
    }
    if (!titlePresent(r.expectFail, text)) {
      drifting.add(r.id);
      if (waivers[r.id] === undefined) {
        out.push({ kind: "drift", id: r.id, detail: `expectFail 在该 test 文件里找不到对应标题（${r.test}）；旧标题「${r.expectFail}」⇒ 同步 expectFail 或改回标题` });
      }
    }
  }
  for (const id of Object.keys(waivers)) {
    if (!drifting.has(id)) out.push({ kind: "stale-waiver", id, detail: `存量豁免已不再命中：从 KNOWN_DRIFT 删掉它（${waivers[id]}）` });
  }
  return out;
}
