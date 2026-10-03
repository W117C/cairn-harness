// 判卷分母口径的判卷（2026-10-02）。
//
// 缘起是一次**真实误报**：按计划书原命令跑 12 条 × 3 rep（36 趟），32 趟死在
// OpenRouter 免费档日配额（`X-RateLimit-Remaining: 0`，`requests=0/tok=0`），
// 而汇总照样印 **`合计 2/36 达标`** ⇒ 那个 `2/36` 报的是**限流器**，不是 agent。
//
// 这条判卷钉两向，**第二向比第一向要紧**：
//   ① 环境打断（未起步 / provider 报错）⇒ 判**无效**、不进分母；
//   ② **模型自己干坏事**（改了判卷面、verify 没过）⇒ 照旧**算数**、必须计入分母。
//      ②若被误伤，这个修正就变成了"把红跑藏起来"——那正是本仓最忌的形状。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { autoVerifyBeats, costSplit, moneyText, PRICE_UNKNOWN, priceFace, runValidity, tally, verifyRecovery, VERIFY_RECOVERY_WHY, WHY_INTERRUPTED_PREFIX, WHY_NOT_STARTED } from "../scripts/lib/eval-validity";
import type { VerifyBeatFace, VerifyRecovery } from "../scripts/lib/eval-validity";

const row = (requests: number, ok: boolean, fails: string[] = []) =>
  ({ r: { requests }, g: { ok, fails } });

describe("判卷分母：环境打断不算数，模型失败照旧算数", () => {
  it("① 未起步（0 请求）⇒ 无效，且说明里点明是 provider 侧", () => {
    const v = runValidity({ requests: 0 }, ["verify 未通过/未跑", "runLoop 抛错:GLM 请求失败 HTTP 429: Rate limit exceeded"]);
    expect(v.valid).toBe(false);
    // 引用常量而不是抄原话：抄了会让同一段措辞出现在两处（顶包候选 +1，水位"只准下调"）
    expect(v.valid === false && v.why).toBe(WHY_NOT_STARTED);
  });

  it("① 起步后被 429 打断 ⇒ 无效（不然「跑不成」会被记成「模型没做到」）", () => {
    const v = runValidity({ requests: 7 }, ['runLoop 抛错:GLM 请求失败 HTTP 429: {"error":{"message":"Rate limit exceeded"}}']);
    expect(v.valid).toBe(false);
    expect(v.valid === false && v.why.startsWith(WHY_INTERRUPTED_PREFIX)).toBe(true);
  });

  it("★② 模型行为失败（改了判卷面 / verify 没过）⇒ **算数**，不许被这条修正藏起来", () => {
    expect(runValidity({ requests: 20 }, ["改了判卷面"]).valid).toBe(true);
    expect(runValidity({ requests: 20 }, ["verify 未通过/未跑"]).valid).toBe(true);
    // runLoop 抛错但**不是** provider 侧（模型自己造出的坏输出）⇒ 也要算数
    expect(runValidity({ requests: 9 }, ["runLoop 抛错:模型返回了无法解析的 tool_call"]).valid).toBe(true);
  });

  it("汇总：无效不进分母；全无效 ⇒ 拒绝出数（不许印 0/0）", () => {
    const mixed = tally([row(0, false, ["runLoop 抛错:HTTP 429"]), row(5, true), row(6, false, ["改了判卷面"])]);
    expect(mixed).toMatchObject({ pass: 1, total: 2, invalid: 1, refuse: false });
    const allBad = tally([row(0, false, ["runLoop 抛错:HTTP 429"]), row(0, false, ["runLoop 抛错:fetch failed"])]);
    expect(allBad.refuse).toBe(true);
    // 全部无效时 pass/total 都是 0——调用方据 refuse 拒绝出数，不许把它印成 "0/0"
    expect(allBad).toMatchObject({ pass: 0, total: 0, invalid: 2 });
  });

  it("那次实测的分布：32 趟 0 请求 + 4 趟起步 ⇒ 分母只能是 4，不是 36", () => {
    const rows = [
      ...Array.from({ length: 32 }, () => row(0, false, ["runLoop 抛错:GLM 请求失败 HTTP 429: Rate limit exceeded"])),
      row(7, true), row(8, false, ["verify 未通过/未跑"]), row(9, true), row(6, false, ["verify 未通过/未跑"]),
    ];
    const t = tally(rows);
    expect(t.total).toBe(4);
    expect(t.invalid).toBe(32);
    expect(t.pass).toBe(2);
    expect(t.refuse).toBe(false);
  });

  it("钱也要与分母同面：没算数的趟次花的钱单列，不进「每达标任务」的分子", () => {
    const crow = (requests: number, cny: number, ok: boolean, fails: string[] = []) =>
      ({ r: { requests, cny }, g: { ok, fails } });
    // 复刻 2026-10-02 那次 36 趟的形状（简化到四趟）：2 趟未起步（¥0）、
    // 1 趟起步后被 429 打断（独自花掉 ¥0.0789）、1 趟真跑且达标（¥0.1）。
    const rows = [
      crow(0, 0, false, ["runLoop 抛错:GLM 请求失败 HTTP 429"]),
      crow(0, 0, false, ["runLoop 抛错:GLM 请求失败 HTTP 429"]),
      crow(14, 0.0789, false, ["runLoop 抛错:GLM 请求失败 HTTP 429: Rate limit exceeded"]),
      crow(7, 0.1, true),
    ];
    const m = costSplit(rows);
    expect(m.paidAll).toBeCloseTo(0.1789, 8);
    expect(m.wastedRuns).toBe(3);
    expect(m.wastedSpend).toBeCloseTo(0.0789, 8); // 未起步那两趟没花钱 ⇒ 只有中途被打断的这趟是"白花"
    expect(m.validSpend).toBeCloseTo(0.1, 8);
    // 这一格就是被修的东西：旧写法拿全量 ¥ 除以达标数 ⇒ 0.1789，比真值 0.1 **高 79%**
    expect(m.validSpend).toBeLessThan(m.paidAll);
    // 反向证人：一趟都没被剔时 wasted 必须恰为 0，且模型自己干坏事的趟次（改了判卷面）**照旧算数**
    const c = costSplit([crow(7, 0.1, true), crow(8, 0.2, false, ["改了判卷面"])]);
    expect([c.wastedSpend, c.wastedRuns]).toEqual([0, 0]);
    expect(c.validSpend).toBeCloseTo(c.paidAll, 8);
  });

  // ↓↓ 接线那半边。纯函数有了判据不等于消费者在用它——本仓这条同族已经第 12 次：
  //    把 `costSplit` 写得再对，只要汇总行仍除以全量，读数就是错的，而全表不会红。
  //    断言只钉**标识符**（不抄生产文案）：改回旧写法即红，重新措辞不伤。
  const evalSrc = () => readFileSync(fileURLToPath(new URL("../scripts/loop-eval.ts", import.meta.url)), "utf8");

  it("★接线① 汇总那行的分子取的是被留下那些趟的钱，旧的全量写法不许回来", () => {
    const src = evalSrc();
    expect(src).toContain("money.validSpend / t0.pass");
    expect(src).not.toContain("cny / t0.pass");
  });

  it("★接线② 被剔掉那些趟花的钱要单独印出来（是真钱，修正不等于把它藏起来）", () => {
    expect(evalSrc()).toContain("money.wastedSpend.toFixed(");
  });

  // ↓↓ 钱的**出处**。缺省价 0.8/2.8 是某个中转端点对它自己那一档的目录价，
  //    而实测那 36 趟拨的是 OpenRouter 免费档 ⇒ 「实付≈¥0.2774」是拿别人的价给自己定价。
  //    所以这里钉的不是数字，是「有没有资格报数」：价目没绑定所拨档位 ⇒ 钱这一格必须空着出声。
  it("价目只认操作者给全的那两个：缺一边＝不可知，而不是拿缺省凑", () => {
    const both = priceFace("0.5", "1.5");
    expect(both.known).toBe(true);
    if (both.known) expect([both.inPerM, both.outPerM]).toEqual([0.5, 1.5]);
    // 两个都不给 ⇒ 不可知，而且**点名缺哪一个**（只报"不可知"不报缺谁，操作者没法修）
    const none = priceFace(undefined, undefined);
    expect(none.known).toBe(false);
    if (!none.known) {
      expect(none.why).toContain("EVAL_PRICE_IN");
      expect(none.why).toContain("EVAL_PRICE_OUT");
    }
    // 半把尺：只给 in ⇒ 仍然不可知，且 why 只点 out（不许把给过的那边也说成缺）
    const half = priceFace("0.5", undefined);
    expect(half.known).toBe(false);
    if (!half.known) {
      expect(half.why).toContain("EVAL_PRICE_OUT");
      expect(half.why).not.toContain("EVAL_PRICE_IN");
    }
  });

  it("坏价目也判不可知：非数、负数、空串（0 是合法价——免费档就该报得出 ¥0）", () => {
    expect(priceFace("abc", "1").known).toBe(false);
    expect(priceFace("-1", "1").known).toBe(false);
    expect(priceFace("1", "-0.2").known).toBe(false);
    expect(priceFace("", "1").known).toBe(false);
    // 0/0 是**真数**：免费档跑出来的钱就是 0，不许被当成"没给"而误判成不可知
    const zero = priceFace("0", "0");
    expect(zero.known).toBe(true);
    if (zero.known) expect([zero.inPerM, zero.outPerM]).toEqual([0, 0]);
  });

  it("★不可知的钱印成「价不可知」那一档，不许印成 ¥0.0000（0 是最容易被读成「没花钱」的形状）", () => {
    expect(moneyText(0.1234)).toBe("¥0.1234");
    expect(moneyText(0)).toBe("¥0.0000");   // 真的 0 照实印
    expect(moneyText(Number.NaN)).toBe(PRICE_UNKNOWN);
    expect(moneyText(Number.POSITIVE_INFINITY)).toBe(PRICE_UNKNOWN);
  });

  it("★接线③ 跑器真的用 priceFace，旧的缺省价写法不许回来", () => {
    const src = evalSrc();
    expect(src).toContain("priceFace(process.env.EVAL_PRICE_IN, process.env.EVAL_PRICE_OUT)");
    expect(src).toContain("cny: cnyOf(tokensIn, tokensOut),");
    // 反向：那两位缺省价一旦被删掉的路径走回来（env 缺席就吃常数），这一条要红
    expect(src).not.toContain('EVAL_PRICE_IN ?? "0.8"');
    expect(src).toContain("实付=\${PRICE_UNKNOWN}");
  });
});

/* 能力 5 的返修那一拍：从前只有一个布尔位（`some(auto===true)`），1 拍与 2 拍长得一模一样，
 * 于是「红了一拍 ⇒ 模型真改过盘 ⇒ 再验一次」这条链路在读数里没有出口。
 * 这里钉的是计数本身：只数生产者写下的 `auto:true`（`src/agent/loop.ts` 的 verifyBeat 是唯一落点）。 */
describe("闸补拍的计数（autoVerifyBeats）", () => {
  it("空表读成 0：这一格要进直方图，缺值会被读成「没有这一列」", () => {
    expect(autoVerifyBeats([])).toBe(0);
  });

  it("只数带 auto:true 的那几拍（缺席与 false 都是模型自调，不算闸的账）", () => {
    expect(autoVerifyBeats([{ auto: undefined }, { auto: false }, { auto: true }, { auto: true }])).toBe(2);
    // 两态必须给不同的数：1 拍与 2 拍压成同一个值就是这格存在的理由
    expect(autoVerifyBeats([{ auto: true }])).toBe(1);
  });

  it("脏值不算一拍：生产者只会写 true，truthy 判定会把 1／「true」收进分子", () => {
    const dirty = [{ auto: 1 as unknown as boolean }, { auto: "true" as unknown as boolean }, { auto: null as unknown as boolean }];
    expect(autoVerifyBeats(dirty)).toBe(0);
  });
});

/* ── 第 325 页 · 返修那一格：红过之后那枚绿**算谁的账**（能力 5 的分子）───────
 * 只看「最后一拍绿了」不够：收束闸会在模型收队前自己补一拍（`src/agent/loop.ts` 的 `verifyBeat`），
 * 那一拍既可能是模型真改过盘之后的返修，也可能只是闸在替它收尾——旧的布尔位里两种读数长成一个样。
 * 每个态一条用例：合在一条里，下面那几根锚点会全红在同一条上＝其中几根没有分辨力（第 324 页实测）。 */
describe("返修那一格（verifyRecovery）：六态分开印，闸补的绿不记给模型", () => {
  const beat = (ok: boolean, by: VerifyBeatFace["by"]): VerifyBeatFace => ({ ok, by });

  it("没跑过 verify ⇒ noVerify：这是「没有尺」，不许被读成「没有返修」", () => {
    expect(verifyRecovery([])).toBe("noVerify");
  });

  it("从头绿到底 ⇒ greenFirst：一次就过的趟次对这一格没有话可说", () => {
    expect(verifyRecovery([beat(true, "model"), beat(true, "model")])).toBe("greenFirst");
  });

  it("只数**第一枚红之后**的绿：红之前那枚绿不能顶账", () => {
    // 旧口径（只看最后一拍）会把这条读成"绿了"⇒ 白记一次成功返修
    expect(verifyRecovery([beat(true, "model"), beat(false, "model")])).toBe("notRecovered");
  });

  it("红过、之后只有更多红（含闸补的那枚红拍）⇒ notRecovered，不许读成 harnessOnly", () => {
    expect(verifyRecovery([beat(false, "model"), beat(false, "harness"), beat(false, "unknown")])).toBe("notRecovered");
  });

  it("★红过、绿了，但那几枚绿全是闸补的 ⇒ harnessOnly：账记 harness，不记模型", () => {
    const r = verifyRecovery([beat(false, "model"), beat(true, "harness")]);
    expect(r).toBe("harnessOnly");
    // 「A＝B」必配「A≠旧值」：这一态与真返修必须是两个值，否则整格退化成一个布尔
    expect(r).not.toBe("modelRecovery");
  });

  it("★红过、之后有一枚模型自己发的绿 ⇒ modelRecovery（这一格要的分子）", () => {
    expect(verifyRecovery([beat(false, "model"), beat(true, "harness"), beat(true, "model")])).toBe("modelRecovery");
  });

  it("归属读不出的一拍在场时不许猜 ⇒ attributionUnknown（宁可说不出，也不替模型认账）", () => {
    expect(verifyRecovery([beat(false, "model"), beat(true, "unknown")])).toBe("attributionUnknown");
    expect(verifyRecovery([beat(false, "model"), beat(true, "harness"), beat(true, "unknown")])).toBe("attributionUnknown");
  });

  it("六态两两不同（哪一态与别的同值，那一格就只是装饰）", () => {
    const cases: [VerifyRecovery, VerifyBeatFace[]][] = [
      ["noVerify", []],
      ["greenFirst", [beat(true, "model")]],
      ["notRecovered", [beat(false, "model")]],
      ["harnessOnly", [beat(false, "model"), beat(true, "harness")]],
      ["modelRecovery", [beat(false, "model"), beat(true, "model")]],
      ["attributionUnknown", [beat(false, "model"), beat(true, "unknown")]],
    ];
    const got = cases.map(([, b]) => verifyRecovery(b));
    expect(new Set(got).size, got.join(",")).toBe(6);
    cases.forEach(([want, b], i) => expect(verifyRecovery(b)).toBe(want));
  });

  it("每一态的措辞互不相同且都不空（读数行与失败原因共用这一份，抄成同一句就等于没分态）", () => {
    const whys = Object.values(VERIFY_RECOVERY_WHY);
    expect(whys.length).toBe(6);
    expect(new Set(whys).size, "两态共用一句 ⇒ 打印出来的字不再指向具体那一格").toBe(6);
    for (const w of whys) expect(w.trim().length).toBeGreaterThan(3);
  });

  // ↓↓ 消费者那半边（纯函数有判据不等于跑器在用它——本仓这条同族已第 13 次）。只钉标识符，不抄文案。
  const runnerSrc = () => readFileSync(fileURLToPath(new URL("../scripts/loop-eval.ts", import.meta.url)), "utf8");
  // 第 327 页把判据本体从跑器搬进 `lib/eval-expects`（跑器顶层会跑起来，判卷 import 不进去）。
  // 针脚跟着搬家：正向钉新位置那一行，反向把旧位置钉死——搬走的支不许在跑器里再留一份副本。
  const branchSrc = () => readFileSync(fileURLToPath(new URL("../scripts/lib/eval-expects.ts", import.meta.url)), "utf8");

  it("★接线① 那一支吃的是这一格，不是「最后一拍绿没绿」（旧口径不许藏在同一支里当第二把尺）", () => {
    expect(branchSrc()).toContain('verifyRecovered: (r) => (r.verifyRecovery !== "modelRecovery"');
    expect(runnerSrc()).not.toContain('e === "verifyRecovered" && r.verifyRecovery');
    expect(runnerSrc()).not.toContain('e === "verifyRecovered" && r.verifyOkLast');
  });

  it("★接线② 那一格要进读数行、也要进汇总行（只算不印＝没出口）", () => {
    const src = runnerSrc();
    expect(src).toContain("RECOVERY_TOKEN[r.verifyRecovery]");
    expect(src).toContain('const n = (s: VerifyRecovery) => states.filter((x) => x === s).length;');
    expect(src).toContain('n("modelRecovery")');
  });

  it("★接线③ 归属判定吃的是生产端导出的那枚哨兵，且谓词只有 `verifyBeatFace` 一份", () => {
    const src = runnerSrc();
    expect(src).toContain("verifyBeatFace(v, verifyCallIds, HARNESS_VERIFY_CALL_ID)");
    // 抄第二份字面量＝两份副本各漂各的（`cancel-name-constant-drifts` 同族）：这里宁可它读不到
    expect(src).not.toContain('"harness-auto-verify"');
    // 同一支谓词不许在跑器里再写一遍（第十三族：N 份副本宽度不同，最宽那份才是对的）
    expect(src).not.toContain("v.auto === true || v.callId ===");
    expect(readFileSync(fileURLToPath(new URL("../src/agent/loop.ts", import.meta.url)), "utf8"))
      .toContain("const beat = await verifyBeat(HARNESS_VERIFY_CALL_ID, true);");
  });
});
