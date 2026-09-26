/** 语料臂/配对这把尺的判卷面（第 89 页）。
 *  夹具用的是**真臂名**（`loop-eval-v2-base`、`ga-strategy-2026-09-20-rep3`…）——它们是本仓语料目录的实命名，
 *  这样"分组规则对不对"就不是自证，而是对着真形状量。 */
import { describe, expect, it } from "vitest";

import {
  abRowLine,
  armOfPath,
  groupPairs,
  magnitudeOfAb,
  parseArm,
  repRowLine,
  signTestToken,
  taskKey,
  type AbMagnitude,
  type Cell,
} from "../scripts/lib/eval-arms";

describe("parseArm：真臂名拆得对不对", () => {
  it("`loop-eval-v2-base` ⇒ family=loop-eval-v2 / variant=base / rep=1", () => {
    expect(parseArm("loop-eval-v2-base")).toEqual({ arm: "loop-eval-v2-base", family: "loop-eval-v2", variant: "base", rep: 1 });
  });

  it("`ga-strategy-2026-09-20-rep3` ⇒ family=ga-strategy / variant=null / rep=3（同配置第三次重复，不是 A/B）", () => {
    expect(parseArm("ga-strategy-2026-09-20-rep3")).toEqual({
      arm: "ga-strategy-2026-09-20-rep3", family: "ga-strategy", variant: null, rep: 3,
    });
  });

  it("`loop-eval-2026-09-20-short` ⇒ family=loop-eval（与 loop-eval-v2 **不同族**，不许互相配对）", () => {
    const a = parseArm("loop-eval-2026-09-20-short");
    expect(a.family).toBe("loop-eval");
    expect(a.variant).toBe("short");
    expect(a.family).not.toBe(parseArm("loop-eval-v2-base").family);
  });

  // 反向一侧（漏配优于硬凑）：没登记过的后缀**不该**被认成变体——
  // 若把它当 `base` 的同变体配对，就会拿两个不同实验的差冒充策略效应。
  it("未知后缀 `loop-eval-v2-cascade` 自成一族 ⇒ 与 base 配不上对", () => {
    const c = parseArm("loop-eval-v2-cascade");
    expect(c.variant).toBeNull();
    expect(c.family).toBe("loop-eval-v2-cascade");
  });
});

describe("taskKey / armOfPath", () => {
  it("`I2-rep1-base.events.jsonl` ⇒ I2；`fanout.events.jsonl` ⇒ fanout", () => {
    expect(taskKey("outputs/loop-eval-v2-base/I2-rep1-base.events.jsonl")).toBe("I2");
    expect(taskKey("outputs/ga-strategy-2026-09-20/fanout.events.jsonl")).toBe("fanout");
  });

  it("躺在语料根（`outputs`/`sessions`）下的文件**没有臂** ⇒ 显式标 `(无臂)`，不许拿根名当实验条件", () => {
    expect(armOfPath("outputs/solo.events.jsonl")).toBe("(无臂)");
    expect(armOfPath("/Library/Application Support/m0-agent-loop/sessions/会话 x.jsonl")).toBe("(无臂)");
    expect(armOfPath("/x/loop-eval-v2-short/I1-rep1-short.events.jsonl")).toBe("loop-eval-v2-short");
  });
});

describe("groupPairs：A/B 与重复分开，单臂不成组", () => {
  type NumCell = Cell & { value: number };
  const cell = (arm: string, file: string, v: number): NumCell => ({ arm: parseArm(arm), task: taskKey(file), value: v });
  const rows: NumCell[] = [
    cell("loop-eval-v2-base", "I1-rep1-base.events.jsonl", 1),
    cell("loop-eval-v2-short", "I1-rep1-short.events.jsonl", 0),
    cell("loop-eval-v2-base", "I2-rep1-base.events.jsonl", 1),
    // 只有 base 这一条臂的格子 ⇒ 无从配对
    cell("loop-eval-v2-base", "I3-rep1-base.events.jsonl", 1),
    cell("ga-strategy-2026-09-20", "fanout.events.jsonl", 3),
    cell("ga-strategy-2026-09-20-rep2", "fanout.events.jsonl", 5),
    // 不同 family 的同名任务：不许凑成一对
    cell("loop-eval", "fanout.events.jsonl", 9),
  ];
  const groups = groupPairs(rows);
  const at = (family: string, task: string) => groups.find((g) => g.family === family && g.task === task);

  it("v2 网格里的 I1 配上 base/short ⇒ 真 A/B，并带上两条臂的数", () => {
    const g = at("loop-eval-v2", "I1");
    expect(g?.arms).toBe(2);
    expect(g?.hasAb).toBe(true);
    expect(g?.cells.map((c) => [c.arm.variant, c.value])).toEqual([["base", 1], ["short", 0]]);
  });

  it("只有单臂的格子不成组（I3 只跑了 base ⇒ 读数里不许出现「I3 的 A/B 差」这种句子）", () => {
    expect(at("loop-eval-v2", "I3")).toBeUndefined();
  });

  it("同配置重复 ⇒ 成组但 `hasAb=false`：它是抖动样本，不是策略差", () => {
    const g = at("ga-strategy", "fanout");
    expect(g?.arms).toBe(2);
    expect(g?.hasAb).toBe(false);
  });

  it("跨 family 的同名任务不凑对", () => {
    expect(groups.some((g) => g.task === "fanout" && g.cells.some((c) => c.arm.family === "loop-eval"))).toBe(false);
  });
});

/* ——— 幅度的可引用性（第 91 页：把第 89 页那句口径从散文挪到读数面上）———
 * 这组用例的作用是**钉住最严的那格**：噪声底必须来自同一任务、同一条臂的重复。
 * 宽松版（借全族/全语料的抖动）在这份真语料上会把 4 条 v2 读数全判成可引用，
 * 而那正是第 89 页拒绝引用它们的原因。 */
type TkCell = Cell & { tokens: number };
const tk = (arm: string, file: string, tokens: number): TkCell => ({
  arm: parseArm(arm), task: taskKey(file), tokens,
});
const groupOf = (rows: readonly TkCell[], family: string, task: string) => {
  const g = groupPairs(rows).find((x) => x.family === family && x.task === task);
  if (g === undefined) throw new Error("夹具没配上对：" + family + "/" + task);
  return g;
};
const abOf = (rows: readonly TkCell[], family: string, task: string) => magnitudeOfAb(groupOf(rows, family, task));
/** 一条 A/B 格（每臂各 n 次）压成 magnitude，供符号检验用。 */
const pairOf = (task: string, base: number[], short: number[]): AbMagnitude =>
  abOf(
    [
      ...base.map((t, i) => tk("loop-eval-v2-base" + (i === 0 ? "" : "-rep" + String(i + 1)), `${task}-rep${String(i + 1)}-base.events.jsonl`, t)),
      ...short.map((t, i) => tk("loop-eval-v2-short" + (i === 0 ? "" : "-rep" + String(i + 1)), `${task}-rep${String(i + 1)}-short.events.jsonl`, t)),
    ],
    "loop-eval-v2", task,
  );

describe("magnitudeOfAb：比值可以印，引用资格要另判", () => {

  it("真语料形状：v2 网格每臂只跑一次 ⇒ 比值照算，但判 `unreplicated`（不可引用）", () => {
    const m = abOf(
      [
        tk("loop-eval-v2-base", "I1-rep1-base.events.jsonl", 46504),
        tk("loop-eval-v2-short", "I1-rep1-short.events.jsonl", 28549),
      ],
      "loop-eval-v2", "I1",
    );
    expect(m.verdict).toBe("unreplicated");
    expect(m.minReps).toBe(1);
    // 数字不藏：藏掉会让人自己去 Excel 里除一个更差的数
    expect(m.ratio).toBeCloseTo(1.629, 2);
    // 这里**不再**收 `reason` 的文案：判态已由 `verdict` 枚举钉住，再收一遍同源文案＝第二把尺不独立；
    // 且 `prose-needle-scan` 量到那句文案落在 2 处字面量里 ⇒ 改另一处它照样绿（假验收）。
  });

  // 这条是整组的**反控**：宽松实现（族级借底）在此处会判 citable。
  it("同族的**另一个任务**有两次重复、抖动很大 ⇒ 本格仍不可引用（不许借别格的底）", () => {
    const rows = [
      tk("loop-eval-v2-base", "I1-rep1-base.events.jsonl", 46504),
      tk("loop-eval-v2-short", "I1-rep1-short.events.jsonl", 28549),
      // 同族、同变体、但**不同任务**的重复（抖到 4 倍）
      tk("loop-eval-v2-base", "I2-rep1-base.events.jsonl", 1000),
      tk("loop-eval-v2-base-rep2", "I2-rep2-base.events.jsonl", 4000),
    ];
    const m = abOf(rows, "loop-eval-v2", "I1");
    expect(m.verdict).toBe("unreplicated");
    expect(m.floor).toBeNull();
    // 而那个重复格自己算得出底 ⇒ 说明"I1 借不到"不是"这函数不会算底"，是**不许跨格借**
    const rep = abOf(rows, "loop-eval-v2", "I2");
    expect(rep.variants.find((v) => v.label === "base")?.reps).toBe(2);
    expect(rep.floor).toBeCloseTo(4.0, 5);
    expect(rep.verdict).toBe("not-ab");
  });

  it("每臂各两次重复、幅度 1.30× 而底 2.00× ⇒ `within-noise`（与「重跑一遍」分不开）", () => {
    const m = abOf(
      [
        tk("loop-eval-v2-base", "I3-rep1-base.events.jsonl", 1000),
        tk("loop-eval-v2-base-rep2", "I3-rep2-base.events.jsonl", 2000),
        tk("loop-eval-v2-short", "I3-rep1-short.events.jsonl", 1100),
        tk("loop-eval-v2-short-rep2", "I3-rep2-short.events.jsonl", 1210),
      ],
      "loop-eval-v2", "I3",
    );
    expect(m.minReps).toBe(2);
    expect(m.floor).toBeCloseTo(2.0, 5);
    expect(m.verdict).toBe("within-noise");
    // 判态与底都是数值/枚举，够钉住这条判据；`reason` 的文案这里不收
    // （`prose-needle-scan` 量到「噪声底」落在 3 处字面量里 ⇒ 改另一处照样绿＝假验收）
    // 统计量自己是字段＝有观测者；取「上中位」会读成 2000/1210
    expect(m.variants.map((v) => v.median)).toEqual([1500, 1155]);
  });

  it("每臂各两次重复、幅度 4× 而底 1.33× ⇒ 这格才是 `citable`", () => {
    const m = abOf(
      [
        tk("loop-eval-v2-base", "I4-rep1-base.events.jsonl", 4000),
        tk("loop-eval-v2-base-rep2", "I4-rep2-base.events.jsonl", 4400),
        tk("loop-eval-v2-short", "I4-rep1-short.events.jsonl", 1000),
        tk("loop-eval-v2-short-rep2", "I4-rep2-short.events.jsonl", 1100),
      ],
      "loop-eval-v2", "I4",
    );
    expect(m.floor).toBeCloseTo(1.1, 5);
    expect(m.ratio).toBeCloseTo(4.0, 5);
    expect(m.verdict).toBe("citable");
  });

  it("一臂 token=0 ⇒ `degenerate`，比值 null（不许读成 0× 或 Infinity）", () => {
    const m = abOf(
      [
        tk("loop-eval-v2-base", "I5-rep1-base.events.jsonl", 0),
        tk("loop-eval-v2-short", "I5-rep1-short.events.jsonl", 12000),
      ],
      "loop-eval-v2", "I5",
    );
    expect(m.ratio).toBeNull();
    expect(m.verdict).toBe("degenerate");
  });

  it("噪声底只算**同变体**的重复：把 rep2 挂到另一个变体名下就不成底", () => {
    const m = abOf(
      [
        tk("loop-eval-v2-base", "I6-rep1-base.events.jsonl", 1000),
        tk("loop-eval-v2-long", "I6-rep1-long.events.jsonl", 4000),
        tk("loop-eval-v2-long-rep2", "I6-rep2-long.events.jsonl", 4200),
      ],
      "loop-eval-v2", "I6",
    );
    // base 只有一条 ⇒ minReps=1 ⇒ 无从谈底
    expect(m.variants.map((v) => [v.label, v.reps])).toEqual([["base", 1], ["long", 2]]);
    expect(m.verdict).toBe("unreplicated");
  });

  it("A/B 报告行自带引用资格：格、每臂终态、比值、资格在**同一行**", () => {
    const m = abOf(
      [
        tk("loop-eval-v2-base", "I1-rep1-base.events.jsonl", 46504),
        tk("loop-eval-v2-short", "I1-rep1-short.events.jsonl", 28549),
      ],
      "loop-eval-v2", "I1",
    );
    const line = abRowLine(m, ["base=绿/46504tk", "short=绿/28549tk"]);
    expect(line).toContain("loop-eval-v2/I1");
    expect(line).toContain("base=绿/46504tk");
    expect(line).toContain("1.63×");
    expect(line).toContain("幅度不可引用（unreplicated）");
    // 顺序也要钉：把判词放到数字之前，读的人就先抄了数
    expect(line.indexOf("1.63×")).toBeLessThan(line.indexOf("不可引用"));
  });

  it("重复行自己报噪声底（真语料那三次的形状）：它是抖动样本，不是策略差", () => {
    const m = magnitudeOfAb(groupOf(
      [
        tk("ga-strategy-2026-09-20", "fanout.events.jsonl", 179985),
        tk("ga-strategy-2026-09-20-rep2", "fanout.events.jsonl", 80617),
        tk("ga-strategy-2026-09-20-rep3", "fanout.events.jsonl", 53908),
      ],
      "ga-strategy", "fanout",
    ));
    const line = repRowLine(m, ["rep1=绿/179985tk", "rep2=绿/80617tk", "rep3=绿/53908tk"]);
    expect(m.floor).toBeCloseTo(3.3387, 3); // 第 89 页那个 3.34× 的原始形状
    expect(line).toContain("噪声底=3.34×");
    expect(line).toContain("不是策略差");
  });

  it("一次重复缺报 token ⇒ 底报「样本不足」，也不许把缺报当「跑过且免费」", () => {
    // 真形状：ga-strategy 的 rep2 那条 run 没上报 usage（第 88 页见过 0 model 归因的同类缺口）
    const m = magnitudeOfAb(groupOf(
      [
        tk("ga-strategy-2026-09-20", "solo.events.jsonl", 5787),
        tk("ga-strategy-2026-09-20-rep2", "solo.events.jsonl", 0),
      ],
      "ga-strategy", "solo",
    ));
    expect(m.floor).toBeNull();
    expect(m.variants.find((v) => v.label === "(无后缀)")?.reps).toBe(2);
    expect(m.variants.find((v) => v.label === "(无后缀)")?.measured).toBe(1);
    expect(repRowLine(m, ["rep1=绿/5787tk", "rep2=绿/0tk"])).toContain("样本不足");
  });

  it("A/B 每臂各两次、其中一次缺报 ⇒ 仍判 `unreplicated`（缺报那次不顶重复的名额）", () => {
    const m = abOf(
      [
        tk("loop-eval-v2-base", "I7-rep1-base.events.jsonl", 100),
        tk("loop-eval-v2-base-rep2", "I7-rep2-base.events.jsonl", 0),
        tk("loop-eval-v2-short", "I7-rep1-short.events.jsonl", 50),
        tk("loop-eval-v2-short-rep2", "I7-rep2-short.events.jsonl", 60),
      ],
      "loop-eval-v2", "I7",
    );
    expect(m.minReps).toBe(2);
    expect(m.minMeasured).toBe(1);
    expect(m.verdict).toBe("unreplicated");
    // base 的中位只在有上报的那次上取：把缺报当 0 会读出 (0+100)/2=50 ⇒ 幅度白涨一倍
    expect(m.variants.find((v) => v.label === "base")?.median).toBe(100);
  });
});

describe("signTestToken：符号与幅度分开判", () => {
  it("5/5 同向 ⇒ 符号可报，并带上它自己的分母", () => {
    const s = signTestToken([
      pairOf("I1", [46504], [28549]),
      pairOf("I2", [14385], [11799]),
      pairOf("I3", [45681], [23159]),
      pairOf("I4", [23849], [9860]),
      pairOf("J2", [68535], [24067]),
    ]);
    expect(s.pairs).toBe(5);
    expect(s.ties).toBe(0);
    expect(s.skipped).toBe(0);
    expect(s.tokenDirection).toEqual({ sign: "a-above-b", agree: 5, against: 0 });
  });

  it("掺一条反向 ⇒ `against` 非 0（「一致」这个说法当场不成立）", () => {
    const s = signTestToken([pairOf("T1", [100], [50]), pairOf("T2", [60], [90])]);
    expect(s.tokenDirection?.against).toBe(1);
    expect(s.tokenDirection?.agree).toBe(1);
  });

  it("同值格算 `ties` 不算 `skipped`：它是「没差异」的证据，不是证据缺席", () => {
    const s = signTestToken([pairOf("T1", [100], [100]), pairOf("T2", [100], [50])]);
    expect(s.ties).toBe(1);
    expect(s.skipped).toBe(0);
    expect(s.pairs).toBe(1);
  });

  it("一臂 token 全缺报 ⇒ 计进 `skipped`，不许悄悄缩分母（也不许白送一个方向）", () => {
    const s = signTestToken([pairOf("T1", [100], [50]), pairOf("T2", [0], [50])]);
    expect(s.pairs).toBe(1);
    expect(s.skipped).toBe(1);
  });

  it("零格可比 ⇒ tokenDirection 为 null（不是 0/0 读成 100%）", () => {
    const s = signTestToken([pairOf("T1", [0], [0])]);
    expect(s.pairs).toBe(0);
    expect(s.tokenDirection).toBeNull();
  });

  it("重复够与不够，符号陈述的强度不同：两次重复翻向时 `against` 必须非 0", () => {
    // base 两次 [100,300] ⇒ 中位 200；short 两次 [150,150] ⇒ 150 ⇒ base 更贵
    const s = signTestToken([pairOf("T1", [100, 300], [150, 150])]);
    expect(s.tokenDirection).toEqual({ sign: "a-above-b", agree: 1, against: 0 });
  });
});
