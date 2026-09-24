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

const PLACEHOLDER = /(\$\{[\s\S]*?\}|%[sdijfovc#])/;
const WILDCARD = "@@wildcard@@";

/** vitest 渲染出的标题：`it.each` / `%s` / `${…}` 会被填上实参 ⇒ 静态比必须把占位符换成通配。 */
function titlePatterns(sourceText: string): RegExp[] {
  const lits = [
    ...[...sourceText.matchAll(/\b(?:it|test)(?:\.each|\.skip|\.todo|\.only|\.fails)?\s*\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!),
    ...[...sourceText.matchAll(/\b(?:it|test)(?:\.each|\.skip|\.todo|\.only|\.fails)?\s*\(\s*`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1]!),
  ];
  return lits.map((lit) => {
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

/** 存量：2026-09-25 静态读数登记，**逐条待判定**——本表只负责"别再多一条"和"少一条要出声"，
 *  不声称这 8 条的成因相同。成因要一条条读那个 test 文件才能定（规矩 93：注释里"另一个面也会踩到"是待证断言）。 */
export const KNOWN_DRIFT: Readonly<Record<string, string>> = {
  "auto-verify-default-on": "tests/loop.test.ts 里那句标题不在源码文本中 ⇒ 待判定（expectFail 含『→』，疑似散文式描述而非真标题）",
  "worker-impact-spec-not-appended": "与下一条共用同一串 expectFail，至多一条能对上 ⇒ 待判定（同族：一份文案两处靶）",
  "worker-impact-whitelist-not-appended": "见上一条",
  "evidence-receipt-reports-known-completeness-as-unknown": "标题带 (observationPack=true/false)，已允许 %s/`${}` 通配仍不命中 ⇒ 待判定（疑似标题由 helper 拼接）",
  "renderer-hides-worker-spend": "tests/renderer-child-admission.test.ts 无此串 ⇒ 待判定",
  "panel-dirty-misses-review-and-progress-events": "expectFail 短到像片段（『security_report 实测改投影』）⇒ 待判定",
  "panel-dirty-refreshes-on-inert-events": "同上（『error 实测零影响』）⇒ 待判定",
  "redaction-stops-recursing-into-containers": "tests/stream-redaction.test.ts 无此串 ⇒ 待判定",
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
