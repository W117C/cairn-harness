/**
 * 无进展检测门（stagnation / no-progress）。
 *
 * 判的是**误报**，不只是"能不能抓到"：外部两家 shipped 检测器（OpenHands StuckDetector、
 * Gemini CLI loopDetectionService）都公布了阈值、**没有一家公布 precision**，而真实投诉两头都有
 * ——一次重 grep 被判成环并 exit 1，一段每轮微变的 word-salad 反而没被判住。
 * ⇒ 本门的结构是「一份带标签的语料 + 判据双向卡」：该报的必须报且指名，不该报的一条都不许报。
 * 语料里 4 条是**真实录制**（loop-eval 跑出来的事件流），3 条是造出来的对照——造的那几条存在的理由
 * 正是真实语料没有覆盖到的形状（"两次红之间改了东西"与"红在另一个文件上"都是**前进**而不是停滞）。
 *
 * 分工：action-shaped 判定住在 `stuck.ts`（既有，不抄第二份）；outcome-shaped 住在
 * `src/agent/no-progress.ts`。本门只判"这套判据有没有分辨力"，不重复实现。
 *
 * 用法：`pnpm no-progress-check`｜反向对照 `pnpm no-progress-check -- --self-test`
 */
import { createHash } from "node:crypto";
import { readdirSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { replay } from "../src/events";
import {
  detectVerifyStagnation,
  judgeNoProgressEvents,
  noProgressLadder,
  type NoProgressCase,
  type NoProgressVerdict,
  type VerifyBeat,
} from "../src/agent/no-progress";

const FIXTURE_DIR = "fixtures/no-progress";

/** 带标签语料。标签是判卷标准的一部分——改标签等于改判据，走 `scripts/frozen-sha256.json`。 */
export const NO_PROGRESS_CASES: readonly NoProgressCase[] = [
  {
    file: "real-red-verify-stagnation.events.jsonl",
    expect: "fire",
    rule: "verify_stagnation",
    note: "真实录制：verify 1/3 与 2/3 红在同一个 `pnpm run test` 上，中间只有 run_shell 没有写入。两次输出长度 1,370 与 150（第二次只剩结论行）逐字不同 ⇒ 既有那套「截前 200 字符逐字比」的 action-shaped 规则看不见它",
  },
  { file: "real-green-read-edit-verify.events.jsonl", expect: "silent", note: "真实录制（成功）：读 → 改 → 一次绿 verify" },
  { file: "real-green-long-explore.events.jsonl", expect: "silent", note: "真实录制（成功）：多轮探索后才绿" },
  { file: "real-green-short-run.events.jsonl", expect: "silent", note: "真实录制（成功，10 次调用）：合法的重复读——任何「见重复就掐」的策略都会误伤它" },
  {
    file: "synth-stagnation-suppressed-by-write.events.jsonl",
    expect: "silent",
    note: "对照：两次红结论相同，但中间有一次成功的 edit_file ⇒ 那是换路子在试，归既有 verify 上限管，不是停滞",
  },
  {
    file: "synth-progress-not-stagnation.events.jsonl",
    expect: "silent",
    note: "对照（**归一化的头号风险**）：两次红的报错文字逐字相同，但红在 `a.test.ts` 与 `b.test.ts` 上 ⇒ 那是修好了一个又撞上下一个。把路径也抹平的归一化会在这里把前进读成停滞",
  },
  {
    file: "synth-alternating-thrash.events.jsonl",
    expect: "fire",
    rule: "alternating_thrash",
    note: "对照：同一对编辑往返 3 个来回且观察回到原值 ⇒ 往返抖动（既有实现里根本没有这一族，外部只有 OpenHands 的 alternating ≥6 cycles）",
  },
];

export interface NpVerdict { ok: boolean; detail: string }
export interface CaseReading {
  file: string;
  fired: boolean;
  rules: string[];
  evidence: string;
  /** 期望某条规则时它必须在实际命中的规则里（否则就是"被别的规则碰巧报了"）。 */
  expectedRulePresent: boolean;
}

async function readCorpus(): Promise<Map<string, CaseReading>> {
  const out = new Map<string, CaseReading>();
  for (const one of NO_PROGRESS_CASES) {
    const events = (await replay(join(FIXTURE_DIR, one.file))) as unknown as Record<string, unknown>[];
    if (events.length === 0) throw new Error(one.file + " 读不到事件（语料坏了）");
    const v = judgeNoProgressEvents(events);
    out.set(one.file, {
      file: one.file,
      fired: v.action !== "silent",
      rules: v.rules,
      evidence: v.evidence,
      expectedRulePresent: one.rule === undefined || v.rules.includes(one.rule),
    });
  }
  return out;
}

const fireCases = () => NO_PROGRESS_CASES.filter((c) => c.expect === "fire");
const silentCases = () => NO_PROGRESS_CASES.filter((c) => c.expect === "silent");

/** 判据一：该报的都报了、且报对了规则、且指得出名。 */
export function positivesFire(rows: readonly CaseReading[]): NpVerdict {
  const missing = rows.filter((r) => !r.fired).map((r) => r.file);
  const wrongRule = rows.filter((r) => r.fired && !r.expectedRulePresent).map((r) => r.file);
  const nameless = rows.filter((r) => r.fired && r.evidence.trim().length === 0).map((r) => r.file);
  return {
    ok: missing.length === 0 && wrongRule.length === 0 && nameless.length === 0,
    detail: `fire 样本 ${String(rows.length)} 条：没报 ${String(missing.length)}${missing.length ? "[" + missing.join(",") + "]" : ""}、` +
      `规则名不对 ${String(wrongRule.length)}${wrongRule.length ? "[" + wrongRule.join(",") + "]" : ""}、` +
      `报了没指名 ${String(nameless.length)}${nameless.length ? "[" + nameless.join(",") + "]" : ""}`,
  };
}

/** 判据二：不该报的一条都不报——这就是外部没人公布的那个 precision 数。 */
export function negativesStaySilent(rows: readonly CaseReading[]): NpVerdict & { fpRate: number } {
  const hit = rows.filter((r) => r.fired);
  const fpRate = rows.length === 0 ? 1 : hit.length / rows.length;
  return {
    ok: rows.length >= 3 && hit.length === 0,
    fpRate,
    detail: `silent 样本 ${String(rows.length)} 条：误报 ${String(hit.length)} 条 ⇒ 语料上的经验误报率 ` +
      (rows.length === 0 ? "n/a" : Math.round(fpRate * 100) + "%") +
      (hit.length ? "[" + hit.map((r) => r.file + "→" + r.rules.join("+")).join("，") + "]" : "") +
      (rows.length < 3 ? "（负样本少于 3 条 ⇒ 这条判据没有分辨力，门自身红）" : ""),
  };
}

const beat = (i: number, signature: string, wrote: boolean): VerifyBeat => ({
  index: i, attempt: i + 1, maxAttempts: 3, ok: false, signature, named: [signature], wroteSinceLast: wrote,
});

/** 判据三：归一化必须"抓住该抓的、放过该放的"——两头各一只反例。
 *  判的是**读数**（不是直接调检测器）：这样 `--self-test` 能把一只故意做错的读数喂进来，
 *  证明这只判据真会红。判据吃不到输入 ⇒ 它的反向对照只能是句空话。 */
export interface NormalizationReadings {
  /** 同一结论、中间没写 ⇒ 该报。 */
  sameFaultNoWrite: boolean;
  /** 同一结论、中间有写 ⇒ 该不报（抑制）。 */
  suppressedByWrite: boolean;
  /** 换了文件的同款报错 ⇒ 该不报（那是前进）。 */
  nextFileSameText: boolean;
}

export function normalizationDiscriminates(r: NormalizationReadings): NpVerdict {
  const problems: string[] = [];
  if (!r.sameFaultNoWrite) problems.push("同结论无写却没报（检测器漏了本职）");
  if (r.suppressedByWrite) problems.push("同结论有写还报（抑制失效 ⇒ 把「换路子再试」读成停滞）");
  if (r.nextFileSameText) problems.push("换了文件的同款报错还报（归一化抹太狠 ⇒ 把「修好一个撞上下一个」读成停滞）");
  return {
    ok: problems.length === 0,
    detail: `同结论无写⇒报=${String(r.sameFaultNoWrite)}、同结论有写⇒不报=${String(!r.suppressedByWrite)}、` +
      `换文件同款报错⇒不报=${String(!r.nextFileSameText)}` + (problems.length ? " ❌ " + problems.join("；") : ""),
  };
}

/** 判据四：阶梯分级按测量给，不许凭直觉升级。同样吃读数。 */
export interface LadderRanks {
  both: string;
  onlyStuck: string;
  onlyThrash: string;
  nothing: string;
}

export function ladderRanksFollowMeasurement(got: LadderRanks): NpVerdict {
  const want: LadderRanks = { both: "escalate", onlyStuck: "directive", onlyThrash: "note", nothing: "silent" };
  const bad = (Object.keys(want) as (keyof LadderRanks)[]).filter((k) => got[k] !== want[k]);
  return {
    ok: bad.length === 0,
    detail: `停滞+抖动=${String(got.both)}、只有 action-shaped=${String(got.onlyStuck)}、` +
      `只有往返（真实语料上零触发，未证明无害）=${String(got.onlyThrash)}、全静=${String(got.nothing)}` +
      (bad.length ? " ❌ 越级/降级：" + bad.map((k) => k + "≠" + want[k]).join("，") : ""),
  };
}

/** 现算读数：门跑这个，`--self-test` 跑上面两只判据的反例。 */
export function readNormalizationSignals(): NormalizationReadings {
  return {
    sameFaultNoWrite: detectVerifyStagnation([beat(0, "pnpm test#[ERR_X] refusing", false), beat(1, "pnpm test#[ERR_X] refusing", false)]).stagnant,
    suppressedByWrite: detectVerifyStagnation([beat(0, "pnpm test#[ERR_X] refusing", false), beat(1, "pnpm test#[ERR_X] refusing", true)]).stagnant,
    nextFileSameText: detectVerifyStagnation([beat(0, "pnpm test#FAIL tests/a.test.ts", false), beat(1, "pnpm test#FAIL tests/b.test.ts", false)]).stagnant,
  };
}

export function readLadderSignals(): LadderRanks {
  const stagnation = detectVerifyStagnation([beat(0, "s", false), beat(1, "s", false)]);
  const thrash = { thrashing: true as const, cycles: 3, evidence: "t" };
  const none = { thrashing: false as const };
  return {
    both: noProgressLadder({ stuck: { stuck: false }, stagnation, thrash }).action,
    onlyStuck: noProgressLadder({ stuck: { stuck: true, rule: "same_action_obs_x4", repeats: 4, sameObservation: true }, stagnation: { stagnant: false }, thrash: none }).action,
    onlyThrash: noProgressLadder({ stuck: { stuck: false }, stagnation: { stagnant: false }, thrash }).action,
    nothing: noProgressLadder({ stuck: { stuck: false }, stagnation: { stagnant: false }, thrash: none }).action,
  };
}

/** 冻结面对账（纯函数、可注入 ⇒ `--self-test` 能喂一只假表进去证明它会红）。 */
export function corpusFreezeIntact(frozen: Readonly<Record<string, string>>, rels: readonly string[], actuals: Readonly<Record<string, string>> = {}): NpVerdict {
  const drift = rels.filter((rel) => frozen[rel] === undefined || (actuals[rel] !== undefined && frozen[rel] !== actuals[rel]));
  return {
    ok: drift.length === 0,
    detail: `冻结表核对 ${String(rels.length)} 份：不在表上或哈希对不上 ${String(drift.length)}${drift.length ? " [" + drift.map((d) => d.split("/").pop()).join(",") + "]" : ""}`,
  };
}

export interface NpRules { id: string; why: string; run: () => Promise<NpVerdict> | NpVerdict }

export const NO_PROGRESS_RULES: readonly NpRules[] = [
  {
    id: "NP1-该报的都报了且指得出名",
    why: "检测器不报警等于没有；报了却说不清卡在哪一件，模型无从换路（本仓点名的「出声但没内容」形状）",
    run: async () => {
      const corpus = await readCorpus();
      return positivesFire(fireCases().map((c) => corpus.get(c.file)!));
    },
  },
  {
    id: "NP2-合法长跑一条都不报",
    why: "误伤有实测代价（外部：撤掉 loop-breaker 换来 ±1.4–7.8% 成功率；一次重 grep 被判环直接 exit 1）。" +
      "所以这条判据落在**真实录制的成功跑**上，不落在那种「看着合理」的合成样本上",
    run: async () => {
      const corpus = await readCorpus();
      return negativesStaySilent(silentCases().map((c) => corpus.get(c.file)!));
    },
  },
  {
    id: "NP3-归一化两头都有反例",
    why: "归一化是这条判据唯一的软肋：抹太狠把「修好一个撞上下一个」读成停滞（误报），抹太松则抓不住本仓那条真实红（1,370 与 150 字符的两次同一失败）。⇒ 两个方向各钉一只",
    run: () => normalizationDiscriminates(readNormalizationSignals()),
  },
  {
    id: "NP4-阶梯分级按测量给",
    why: "R1 在真实语料上零误报 ⇒ 允许 escalate；R3 在真实语料上零触发（既没证明有用也没证明无害）⇒ 只到 note。写成断言，免得哪天有人顺手把没测过的规则提到「可以掐」",
    run: () => ladderRanksFollowMeasurement(readLadderSignals()),
  },
  {
    id: "NP5-语料 sha256 与冻结表逐字一致",
    why: "带标签语料就是判卷标准：翻一个 label 或改一份事件文件，NP1/NP2 立刻能从「永远红」被改成「永远绿」。" +
      "本仓对 gym 靶面用的是同一只手（`gym-check` A3），但那只手只走 fixtures/gym ⇒ 这里自己钉一份",
    run: async () => {
      const frozen = JSON.parse(await readFile(join("scripts", "frozen-sha256.json"), "utf8")) as Record<string, string>;
      const actuals: Record<string, string> = {};
      for (const one of NO_PROGRESS_CASES) {
        const rel = join(FIXTURE_DIR, one.file);
        actuals[rel] = createHash("sha256").update(await readFile(rel)).digest("hex");
      }
      const v = corpusFreezeIntact(frozen, Object.keys(actuals), actuals);
      return {
        ok: v.ok && NO_PROGRESS_CASES.length >= 5,
        detail: `语料 ${String(NO_PROGRESS_CASES.length)} 份｜${v.detail}` +
          (NO_PROGRESS_CASES.length < 5 ? "（样本缩到 5 条以下 ⇒ 冻结面自己就在塌，判红）" : ""),
      };
    },
  },
];

/** 反向对照：每只判据喂一件故意做错的工件，要求它判假。造不出红的规则等于摆设。 */
export function runNpSelfTest(): { caught: string[]; missed: string[] } {
  const caught: string[] = [];
  const missed: string[] = [];
  const row = (over: Partial<CaseReading>): CaseReading => ({
    file: "x", fired: true, rules: ["verify_stagnation"], evidence: "同一条验证结论连红 2 次", expectedRulePresent: true, ...over,
  });
  const probes: { id: string; predicateSaysRed: () => boolean }[] = [
    { id: "NP1-该报的都报了且指得出名", predicateSaysRed: () => !positivesFire([row({ fired: false, evidence: "" })]).ok },
    { id: "NP1 报了但没指名", predicateSaysRed: () => !positivesFire([row({ evidence: "   " })]).ok },
    { id: "NP1 碰巧被别的规则报了", predicateSaysRed: () => !positivesFire([row({ rules: ["alternating_thrash"], expectedRulePresent: false })]).ok },
    { id: "NP2-合法长跑一条都不报", predicateSaysRed: () => !negativesStaySilent([row({ file: "a", fired: false }), row({ file: "b", fired: true, rules: ["alternating_thrash"] }), row({ file: "c", fired: false })]).ok },
    { id: "NP2 负样本太少也算红", predicateSaysRed: () => !negativesStaySilent([row({ file: "a", fired: false })]).ok },
    // 三只反例各对应一种归一化错法：漏本职 / 抑制失效 / 抹太狠把前进读成停滞
    { id: "NP3 同结论无写却不报（漏本职）", predicateSaysRed: () => !normalizationDiscriminates({ sameFaultNoWrite: false, suppressedByWrite: false, nextFileSameText: false }).ok },
    { id: "NP3 抑制失效", predicateSaysRed: () => !normalizationDiscriminates({ sameFaultNoWrite: true, suppressedByWrite: true, nextFileSameText: false }).ok },
    { id: "NP3 归一化抹太狠", predicateSaysRed: () => !normalizationDiscriminates({ sameFaultNoWrite: true, suppressedByWrite: false, nextFileSameText: true }).ok },
    { id: "NP4 未证明无害的规则被提级", predicateSaysRed: () => !ladderRanksFollowMeasurement({ both: "escalate", onlyStuck: "directive", onlyThrash: "escalate", nothing: "silent" }).ok },
    { id: "NP4 该 escalate 的被降成 note", predicateSaysRed: () => !ladderRanksFollowMeasurement({ both: "note", onlyStuck: "directive", onlyThrash: "note", nothing: "silent" }).ok },
    {
      // NP5 的判据就是"漂移表非空即红 + 语料规模不许缩到 5 以下"，两只都喂反例
      id: "NP5 冻结表与语料不一致（含规模塌陷）",
      predicateSaysRed: () => !(NO_PROGRESS_CASES.length >= 5) || !corpusFreezeIntact({ "fixtures/no-progress/synth-alternating-thrash.events.jsonl": "deadbeef" }, NO_PROGRESS_CASES.map((c) => join(FIXTURE_DIR, c.file))).ok,
    },
  ];
  for (const p of probes) {
    let red = false;
    try {
      red = p.predicateSaysRed();
    } catch {
      red = false;
    }
    (red ? caught : missed).push(p.id);
  }
  return { caught, missed };
}

async function main(): Promise<void> {
  if (process.argv.slice(2).includes("--self-test")) {
    const r = runNpSelfTest();
    console.log(`[no-progress-check] --self-test：造得红 ${String(r.caught.length)}/${String(r.caught.length + r.missed.length)}`);
    for (const id of r.caught) console.log(`  ✅ 造得红 ${id}`);
    for (const id of r.missed) console.log(`  ❌ 造不红 ${id} —— 这条判据是摆设`);
    process.exit(r.missed.length === 0 ? 0 : 1);
  }
  const disk = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".events.jsonl"));
  const listed = new Set(NO_PROGRESS_CASES.map((c) => c.file));
  const orphans = disk.filter((f) => !listed.has(f));
  const missing = [...listed].filter((f) => !disk.includes(f));
  let failed = orphans.length + missing.length === 0 ? 0 : 1;
  console.log(`  ${orphans.length === 0 && missing.length === 0 ? "✅" : "❌"} NP0-语料表与目录一致 — 目录 ${String(disk.length)} 份 / 表内 ${String(listed.size)} 条` +
    (orphans.length ? "｜目录里没登记的：" + orphans.join(",") : "") + (missing.length ? "｜表内缺文件：" + missing.join(",") : ""));
  for (const rule of NO_PROGRESS_RULES) {
    let v: NpVerdict;
    try {
      v = await rule.run();
    } catch (err) {
      v = { ok: false, detail: "抛异常：" + (err instanceof Error ? err.message : String(err)) };
    }
    if (!v.ok) failed++;
    console.log(`  ${v.ok ? "✅" : "❌"} ${rule.id} — ${v.detail}`);
    if (!v.ok) console.log(`     为什么要有这条：${rule.why}`);
  }
  const total = NO_PROGRESS_RULES.length + 1;
  console.log(failed === 0 ? `[no-progress-check] ${String(total)}/${String(total)} 通过` : `[no-progress-check] ❌ ${String(failed)} 条不过`);
  process.exit(failed === 0 ? 0 : 1);
}

// 入口判定：单测 import 本模块不得把门跑起来（照 scripts/prefix-churn-check.ts 的写法）。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  void main();
}
