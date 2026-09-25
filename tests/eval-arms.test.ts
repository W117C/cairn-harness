/** 语料臂/配对这把尺的判卷面（第 89 页）。
 *  夹具用的是**真臂名**（`loop-eval-v2-base`、`ga-strategy-2026-09-20-rep3`…）——它们是本仓语料目录的实命名，
 *  这样"分组规则对不对"就不是自证，而是对着真形状量。 */
import { describe, expect, it } from "vitest";

import { armOfPath, groupPairs, parseArm, taskKey, type Cell } from "../scripts/lib/eval-arms";

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
