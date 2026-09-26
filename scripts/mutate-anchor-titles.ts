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
import { expectFailMatchesTitles } from "./lib/mutate-gates";

export interface AnchorRow {
  id: string;
  /** 被测面。第 126 页之前不抽这一栏：那张表 963→798 条时没有任何尺看过「被摘的锚点指向谁」。 */
  src: string | null;
  test: string | null;
  expectFail: string | null;
}

export interface TableSource {
  path: string;
  text: string;
}

export type FindingKind =
  | "drift"
  | "stale-waiver"
  | "unverified-face"
  | "unverified-file"
  | "dead-src"
  | "count-under-floor"
  | "stale-zero-anchor-review";

export interface Finding {
  kind: FindingKind;
  id: string;
  detail: string;
  /** 这条 finding 是从哪个取料文件发出来的。以前只有 `detail` 里那句中文带着路径 ⇒
   *  消费方要按文案反解路径，改一句话就把判据拆掉（规则：判据要钉在结构上，不钉在措辞上）。 */
  source: string | null;
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
    const srcLit = /\bsrc:\s*"((?:[^"\\]|\\.)*)"/.exec(chunk);
    const ef = /\bexpectFail:\s*"((?:[^"\\]|\\.)*)"/.exec(chunk);
    out.push({
      id: at[i]![1]!,
      src: srcLit?.[1] === undefined ? null : decode(srcLit[1]),
      test: decode(test?.[1] ?? "") || null,
      expectFail: ef?.[1] === undefined ? null : decode(ef[1]),
    });
  }
  return out;
}

// 用例标题的抽取与命中判据在 `./lib/mutate-gates.ts`（`vitestTitlePatterns` / `expectFailMatchesTitles`）。
// 第 138 页从本文件搬过去的：`mutate-verify --check-needles` 新加的「killer 指针失效」那一维是**同一个判据**，
// 两处各写一份立刻漂宽——新那份按整句逐字比，一次报了 10 条假红（柯里 `it.each`、`$label` 插值、转义引号它都不认）。
// 同一谓词两份副本、宽度不同 ⇒ 最宽那份才是对的（第十三族）；留这份注释是为了下一个人不再抄第三份。

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
 * 存量豁免（只准带理由登记；不再命中即 stale 红）。
 * **当前为空**——第 138 页把最后两条撤了：`user-skill-face-budget-abolished` 与 `prune-attachment-production-entry`
 * 登记时写的是「待 #50 把针脚与 expectFail 改指新写法后撤本条」，那一天正是第 138 页（7 条失效针脚逐条改指并单跑全杀）。
 * 撤名是这条机制唯一的自检：登记时不写"什么时候撤"，存量就变成长期豁免（第 124 页立这条时的原话）。 */
export const KNOWN_DRIFT: Readonly<Record<string, string>> = {};

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
      out.push({ kind: "unverified-face", id: r.id, source: r.test, detail: `test 指向非 vitest 面（${r.test}）⇒ 本闸不判` });
      continue;
    }
    const text = byPath.get(r.test);
    if (text === undefined) {
      out.push({ kind: "unverified-file", id: r.id, source: r.test, detail: `读不到 ${r.test} ⇒ 没尺，不判` });
      continue;
    }
    if (!expectFailMatchesTitles(r.expectFail, text)) {
      drifting.add(r.id);
      if (waivers[r.id] === undefined) {
        out.push({ kind: "drift", id: r.id, source: r.test, detail: `expectFail 在该 test 文件里找不到对应标题（${r.test}）；旧标题「${r.expectFail}」⇒ 同步 expectFail 或改回标题` });
      }
    }
  }
  for (const id of Object.keys(waivers)) {
    if (!drifting.has(id)) out.push({ kind: "stale-waiver", id, source: null, detail: `存量豁免已不再命中：从 KNOWN_DRIFT 删掉它（${waivers[id]}）` });
  }
  return out;
}

/** 锚点表条数下限（**只准调高**，调低必须在提交说明里点名是哪笔摘除、为什么）。
 *
 *  为什么需要它：2026-09-27 实测 `834ba3a`（提交说明写的是 worker 沙箱）把 `scripts/mutate-verify.mjs` 的
 *  工作树版本一起提交 ⇒ 表从 963 掉到 798，**没有任何尺出声**：
 *  `checkAnchorTitles` 判的是"活着的锚点自洽"，整行被删对它透明；`wiring-coverage` 只咬 agent-runner 那一格；
 *  `mutate-verify` 只为"某条没杀"出声，不为"少了几条"出声。⇒ 又一族「两头断」（规则 208 的反向配对）。
 *
 *  这条帽刻意**不按工作树/index 状态取**（同第 123 页那条：帽不能挂在 index 状态上）：
 *  判的是"落库面丢了多少条"，所以由消费方把表文本喂进来，本函数只看行数。 */
export const ANCHOR_COUNT_FLOOR = 798;

/** 「在发货且零变异观察者」的欠条名单：**登记即放行，条目烂掉才红**。
 *  命中条件（=今天为真 ⇒ 不红）：该文件仍在取料面上，且当前锚点数 == 0。
 *  任一条件失效（补回锚点 / 文件本身被删）⇒ `stale-zero-anchor-review` 红，逼人来把这条账销掉——
 *  这正是第 126 页的教训：那 4 个文件掉了 12 条锚点时，没有任何一个地方"记得它们曾经有过"。
 *  名单只保护**已经判定重要**的文件，不是全仓覆盖度度量（边界写在 tests/ 那条用例上）。 */
export const ZERO_ANCHOR_REVIEW: Readonly<Record<string, string>> = {
  "scripts/gate-manifest.ts": "第 126 页：4 条 gate-direct-* 随 834ba3a 消失，而它是 26 道门的唯一事实源；摘掉的四条全是「门禁层自己怎么假绿」",
  "src/main/updater.ts": "第 126 页：6 条 updater-* 锚点消失；文件仍被 ipc-protocol/settings-handlers import，只剩 tests/updater-safety-core.test.ts 一支直接测试",
  "src/agent/security/llm-review.ts": "第 126 页：llm-confidence-fabricated-default 消失（「缺席不得编成 medium」那条），orchestrator 仍在 import；tests/hardening3.test.ts 只 import buildMessages",
  "scripts/replay/ask-density.ts": "第 126 页 C 类：0 生产 import＋0 测试，但它是 replay-readings 登记面＋判断层 §7 复跑块 ⇒ 待裁决「该删没删」，先记欠条而不是顺手清掉",
};

/** 锚点表对「面」的三条判据：行数没跌破帽、`src:` 不许指向不存在的文件、欠条名单不许烂掉。
 *  存在性由调用方注入（同 `checkAnchorTitles` 只吃文本的口径）⇒ 本函数可拿假表逐条判，不触真仓。 */
export function checkAnchorFace(
  rows: readonly AnchorRow[],
  exists: (rel: string) => boolean,
  floor: number = ANCHOR_COUNT_FLOOR,
  review: Readonly<Record<string, string>> = ZERO_ANCHOR_REVIEW,
): Finding[] {
  const out: Finding[] = [];
  if (rows.length < floor) {
    out.push({
      kind: "count-under-floor",
      id: "table",
      source: null,
      detail: `锚点表 ${rows.length} 条 ＜ 下限 ${floor} 条 ⇒ 有人在一次改动里摘掉 ${floor - rows.length} 条观察者。补回来，或显式调低 ANCHOR_COUNT_FLOOR 并在提交说明里点名哪笔摘除、为什么`,
    });
  }
  const perSrc = new Map<string, number>();
  for (const r of rows) {
    if (r.src === null) continue;
    perSrc.set(r.src, (perSrc.get(r.src) ?? 0) + 1);
    if (!exists(r.src)) {
      out.push({ kind: "dead-src", id: r.id, source: r.src, detail: `锚点 ${r.id} 的 src 指向面上不存在的文件（${r.src}）⇒ 这条变异要么在空转，要么跟着一次删除一起烂掉` });
    }
  }
  for (const [src, why] of Object.entries(review)) {
    const shipping = exists(src);
    const count = perSrc.get(src) ?? 0;
    if (shipping && count === 0) continue; // 欠条仍然成立
    out.push({
      kind: "stale-zero-anchor-review",
      id: src,
      source: src,
      detail: `欠条已不再成立（${shipping ? `已补回 ${count} 条锚点` : "文件已不在面上"}）⇒ 从 ZERO_ANCHOR_REVIEW 删掉它并回看第 126 页（${why}）`,
    });
  }
  return out;
}

