// 基准装配面（`scripts/lib/eval-assembly.ts`）的判卷。两块：
//  ⑴ 纯函数本身：表态表怎么投影、少装的那一列怎么数、没表态会不会被抓。
//  ⑵ **表与参数不许分叉**：`loop-eval` 递给 `runLoop` 的键必须由这张表投影出来。
//
// 立项动因（2026-10-02 现读）：`scripts/loop-eval.ts` 头上写着「装配 = 生产同款」，
// 而它递给 `runLoop` 的参数里一枚产品缺省开的开关都没有。后果不是"少一个功能"，是**读数说谎**：
// 盘上 49 趟真模型跑批（bench-reps3 / eval-long30 / eval-baseline-1）里 `autoVerifyBeat` 全是 false，
// 于是这一列被读成「模型从不自己验证」，而真实原因是「跑器没把能力 5 的收束闸装上」。
// 本文件钉的不是"表写得全不全"，是**表说装了 ⇒ 参数里真装着**这一层接线。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/main/settings";
import {
  BENCH_KNOBS,
  assemblyOverrides,
  assemblyRows,
  missingKnobs,
  renderAssemblyFace,
  runLoopKnobsFromAssembly,
  undeclaredKnobs,
  type AssemblyRow,
} from "../scripts/lib/eval-assembly";

const REPO = fileURLToPath(new URL("..", import.meta.url));

/** 产品缺省态那副装配（不带旗标）——本文件里"缺省"一律指这一副。 */
const PLAIN = assemblyRows(DEFAULT_SETTINGS);
/** 带 `--auto-verify` 那副。 */
const FLAGGED = assemblyRows(DEFAULT_SETTINGS, undefined, assemblyOverrides(true));

const faceOf = (rows: readonly AssemblyRow[], key: string): string | undefined =>
  rows.find((r) => r.key === key)?.face;

describe("装配表：产品缺省开的键必须逐枚表态", () => {
  /* 分母自证排在前面：`undeclaredKnobs(PLAIN)` 为空这件事，在「一行都没有」时同样成立。
   * 没有这一格，谁把 `assemblyRows` 的筛选写死成空数组，整张表就静默变成恒真。 */
  it("真缺省确实投影出行：少一行就是缺省翻了而这里没人管", () => {
    expect(PLAIN.length).toBeGreaterThanOrEqual(4);
    expect(PLAIN.map((r) => r.key)).toEqual([
      "autoMemory", "autoVerify", "impactAnalysis", "promptCache", "subagentTools",
    ]);
  });

  // 主尺：每一枚都得有表态（今天五枚全在 BENCH_KNOBS 里）。
  it("每一枚缺省开的键都有表态，没有一枚靠沉默过关", () => {
    expect(undeclaredKnobs(PLAIN)).toEqual([]);
  });

  /* 反向哨兵：翻一枚缺省而没写表 ⇒ 那一枚必须是 undeclared，且原因串指回该改的地方。
   * 只留主尺那条正向断言的话，「键名漂了」「表被清空」这两种坏形状都是绿的。 */
  it("缺省新开一枚键而表里查无 ⇒ 判成 undeclared 并指回登记处", () => {
    const rows = assemblyRows({ brandNewKnob: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.face).toBe("undeclared");
    expect(undeclaredKnobs(rows).map((r) => r.key)).toEqual(["brandNewKnob"]);
    expect(rows[0]!.why).toContain("装配表里查不到");
  });

  /* 这张表只管「缺省为真」的东西：缺省关的键基准不装是正常的（装了我反而要问为什么）。
   * 少了这一格，`v === true` 被写成 `v !== undefined` 也会照样出一张"看起来对"的表。 */
  it("缺省关的键不进这张表", () => {
    expect(assemblyRows({ autoVerifyRepair: false, telemetry: false })).toEqual([]);
    expect(assemblyRows({ autoVerifyRepair: false, autoVerify: true }).map((r) => r.key)).toEqual(["autoVerify"]);
    expect(assemblyRows({})).toEqual([]);
  });

  it("表里每枚 off-here 都写了为什么，且不许躺着产品已不开的键", () => {
    const missing = missingKnobs(PLAIN);
    expect(missing.length).toBeGreaterThan(0);
    for (const r of missing) expect(r.why.length).toBeGreaterThanOrEqual(20);
    for (const key of Object.keys(BENCH_KNOBS)) expect(BENCH_KNOBS[key]!.why.trim().length).toBeGreaterThan(0);
    /* 反向哨兵：产品把某枚缺省翻回 false，表里那一行就没人消费了——留着不删就是假存量
     * （本仓对登记表一律要求 stale 也要红，否则登记表自己烂掉而读数照印）。
     * 键集直接复用上面那张投影出来的行，不在这里再筛一遍 DEFAULT_SETTINGS。 */
    const onKeys = new Set(PLAIN.map((r) => r.key));
    expect(Object.keys(BENCH_KNOBS).filter((k) => !onKeys.has(k))).toEqual([]);
  });
});

describe("表 → 递进 runLoop 的参数：不许各算一次", () => {
  /* 「A＝B」必配「A≠旧值」：两态**各**钉一条，且它们对同一个输入给不同输出。
   * 只钉带旗标那一副的话，把投影写成恒 `{ autoVerify: true }` 也是绿的——
   * 那正是"表当注释、参数自己再算一遍"的分叉形状。 */
  it("缺省那副：表说没装 ⇒ runLoop 收不到 autoVerify（今日行为逐字不动）", () => {
    expect(faceOf(PLAIN, "autoVerify")).toBe("off-here");
    expect(runLoopKnobsFromAssembly(PLAIN)).toEqual({});
  });

  it("带 --auto-verify 那副：表改口成 same ⇒ 递出去的参数里真装着 autoVerify", () => {
    expect(faceOf(FLAGGED, "autoVerify")).toBe("same");
    expect(runLoopKnobsFromAssembly(FLAGGED)).toEqual({ autoVerify: true });
  });

  it("旗标只改一枚的表态，其余四枚不许跟着翻", () => {
    for (const key of ["autoMemory", "impactAnalysis", "promptCache", "subagentTools"]) {
      expect(faceOf(FLAGGED, key)).toBe(faceOf(PLAIN, key));
    }
  });

  /* 反方向那一格：产品缺省**关**的键被旗标装上时，也必须进表，记成 `on-here`。
   * 只数 off-here 的表会对这个方向沉默——而「对照臂被读成产品缺省态」是同一枚硬币的反面。 */
  it("缺省关而这一趟装了 ⇒ 进表记 on-here（两枚旗标都在时才成立）", () => {
    const both = assemblyRows(DEFAULT_SETTINGS, undefined, assemblyOverrides(true, true));
    expect(faceOf(both, "autoVerifyRepair")).toBe("on-here");
    expect(renderAssemblyFace(both)).toContain("autoVerifyRepair:on-here");
    // 只带返修、不带闸 ⇒ 它没有对象，不进表（配对规则只在 assemblyOverrides 判一次）
    expect(assemblyOverrides(false, true)).toEqual({});
    expect(faceOf(assemblyRows(DEFAULT_SETTINGS, undefined, assemblyOverrides(false, true)), "autoVerifyRepair")).toBeUndefined();
  });

  /* 投影也吃这条配对：表自相矛盾（说有返修、没有闸）时宁可不装（fail-closed），
   * 而不是把一个永远不会被 loop 读到的键递出去——那正是「算出来不接」的形状。 */
  it("投影不给没闸的返修：只有闸也装着时才递 autoVerifyRepair", () => {
    const contradictory: AssemblyRow[] = [{ key: "autoVerifyRepair", face: "on-here", why: "表自己矛盾" }];
    expect(runLoopKnobsFromAssembly(contradictory)).toEqual({});
    const paired: AssemblyRow[] = [
      { key: "autoVerify", face: "same", why: "" },
      { key: "autoVerifyRepair", face: "on-here", why: "" },
    ];
    expect(runLoopKnobsFromAssembly(paired)).toEqual({ autoVerify: true, autoVerifyRepair: true });
  });

  it("两枚旗标都带 ⇒ 投影出的参数两枚都装着（对照臂的真实形状）", () => {
    const both = assemblyRows(DEFAULT_SETTINGS, undefined, assemblyOverrides(true, true));
    expect(runLoopKnobsFromAssembly(both)).toEqual({ autoVerify: true, autoVerifyRepair: true });
    // 只带闸那一副必须**没有**返修：否则"缺省那副"与"对照臂"在读数上分不开
    expect(runLoopKnobsFromAssembly(FLAGGED)).toEqual({ autoVerify: true });
  });

  /* 少装的那一列是**数出来的**：这格的存在理由就是「基准比产品少装了 N 枚」要能印出来。
   * 4 → 3 这一格差值同时钉住「表里的缺省态」和「改口只影响一枚」——
   * 把 `BENCH_KNOBS.autoVerify.face` 从 off-here 抄成 same，这里立刻红。 */
  it("少装计数：缺省四枚、带旗标三枚，且差的就是 autoVerify 那一枚", () => {
    expect(missingKnobs(PLAIN).map((r) => r.key)).toEqual([
      "autoMemory", "autoVerify", "impactAnalysis", "promptCache",
    ]);
    expect(missingKnobs(FLAGGED).map((r) => r.key)).toEqual([
      "autoMemory", "impactAnalysis", "promptCache",
    ]);
  });
});

describe("装配面的读数形状", () => {
  it("渲染串逐枚带 key:face，顺序稳定（同一副装配两次要一模一样）", () => {
    const once = renderAssemblyFace(PLAIN);
    expect(once.split(" ")).toHaveLength(PLAIN.length);
    expect(once).toContain("autoVerify:off-here");
    expect(once).toContain("subagentTools:same");
    expect(renderAssemblyFace(assemblyRows(DEFAULT_SETTINGS))).toBe(once);
    expect(renderAssemblyFace(FLAGGED)).not.toBe(once);
  });

  it("空表渲染成空串，不是一枚分隔符", () => {
    expect(renderAssemblyFace([])).toBe("");
  });
});

describe("loop-eval 的装配接线", () => {
  const evalSrc = readFileSync(join(REPO, "scripts/loop-eval.ts"), "utf8");

  /* 钉整条调用连入参，不钉函数名：只写 `assemblyRows` 的话，
   * 「算了但没把 overrides 递进去」这一变异会存活——那恰好是本案的原始形状。 */
  it("缺省表与旗标改口是同一条调用算出来的", () => {
    expect(evalSrc).toContain("assemblyRows(DEFAULT_SETTINGS, undefined, assemblyOverrides(AUTO_VERIFY, AUTO_VERIFY_REPAIR))");
  });

  it("递给 runLoop 的是投影结果，不是第二个 if", () => {
    const call = evalSrc.indexOf("await runLoop({");
    expect(call).toBeGreaterThan(-1);
    expect(evalSrc.slice(call, call + 200)).toContain("...BENCH_RUNLOOP_KNOBS");
    // 跑器里不许再手写一枚 `autoVerify: true`：那等于表与参数各算一次，表退化成注释。
    expect(evalSrc.includes("autoVerify: true")).toBe(false);
  });

  /* 拒绝出数必须排在**花钱之前**：装配面不完整还照跑，跑出来的分母就是假的。
   * 拿「任务=…」那行批量表头当花费起点——它是第一趟 run 之前最后一行读数。 */
  it("未表态 ⇒ 在第一趟跑批之前退，且退出码是 1", () => {
    const guard = evalSrc.indexOf("ASSEMBLY_UNDECLARED.length > 0");
    const header = evalSrc.indexOf("[loop-eval] 任务=");
    expect(guard).toBeGreaterThan(-1);
    expect(header).toBeGreaterThan(guard);
    expect(evalSrc.slice(guard, guard + 400)).toContain("process.exit(1)");
  });

  it("零花费那条路（--feasibility）也印装配面，且印在退出之前", () => {
    const print = evalSrc.indexOf(`"[feasibility] 装配面`);
    expect(print).toBeGreaterThan(-1);
    expect(print).toBeLessThan(evalSrc.indexOf("process.exit(0)", print));
  });

  /* 读数行上也要有装配面：日志那一行不在 readings.json 里。
   * 事后拿读数做 A/B 的人（`scripts/eval/report.ts` 那一路）只看得见 JSON，
   * 「这 49 趟是没装收束闸跑出来的」这件事必须写在每一格上，而不是写在控制台。 */
  it("读数每一格自带装配面：JSON 里不许只剩 autoVerifyBeat 一个孤零零的 false", () => {
    expect(evalSrc).toContain("assembly: ASSEMBLY_FACE");
    expect(evalSrc).toContain("assembly: string;");
  });

  /* 闸补的拍数：口径在 `lib/eval-validity` 的 `autoVerifyBeats`，跑器只许吃它算出来的那个值。
   * 三条各钉一位，是因为这三种坏形状互不相同：不调 lib（第二份生产者）、布尔与计数分家、
   * 以及旧写法被悄悄请回来。 */
  it("闸拍口径只在 lib 里算一次：跑器必须调 autoVerifyBeats(verifies)", () => {
    expect(evalSrc).toContain("const harnessBeats = autoVerifyBeats(verifies);");
  });

  it("Reading 两格都从同一个值来：布尔位与计数不许各读各的", () => {
    expect(evalSrc).toContain("autoVerifyBeat: harnessBeats > 0, autoVerifyBeats: harnessBeats,");
  });

  it("旧的那份 some(auto) 判定不许回来：同一谓词两份副本迟早宽度不同", () => {
    expect(evalSrc).not.toContain("verifies.some(");
  });

  it("读数行上印单趟闸拍：闸补了几拍不许只在 JSON 里", () => {
    expect(evalSrc).toContain("闸拍=${String(r.autoVerifyBeats)}");
  });

  it("批次行上印 ≥2 拍那一格：返修链路走没走通要当场看得见", () => {
    expect(evalSrc).toContain("≥2 拍的趟次");
  });

  it("返修旗标走同一条投影，配对规则不在跑器里判第二次", () => {
    // 跑器只出声（warn），不许自己再拼一枚 `autoVerifyRepair: true` 塞进调用
    expect(evalSrc.includes("autoVerifyRepair: true")).toBe(false);
    expect(evalSrc).toContain("--auto-verify-repair 被忽略");
  });
});
