// 模型菜单不许自己弹开（2026-10-19 独立评审追出的真缺陷）。
//
// 缺陷形状：ModelPicker 按 `key={draftKey}` 在切会话时重挂（Composer.tsx 的注释说明这是为了
// 不让"模型搜索框还开着"悬在新会话上），但重挂把「上一次见过的 seq」这个 ref 复位了；
// Composer 那边的 pickerOpenSeq 不会重挂、还留着上一次 ⌘⇧I 的值 ⇒ 重挂后的 picker 看到
// "seq(3) > 基线(0)" ⇒ **切会话时菜单自己弹开**，悬在新会话的输入框上抢焦点——
// 正是那个 key 原本要防的症状。
//
// 判据落在**纯函数**上（nextOpenSeqState）：本仓无 jsdom，交互逻辑走「纯函数 + 接线见证」两面。
// 纯函数能真跑 ⇒ 这一条不是恒真的源码断言。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nextOpenSeqState } from "../src/renderer/components/ModelPicker";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("模型菜单的信号开合（nextOpenSeqState）", () => {
  it("★重挂后的首帧：只对齐基线，**不开**（旧实现基线是 0 ⇒ 切会话时菜单自己弹开）", () => {
    // 场景：A 会话按过 ⌘⇧I（seq=3），菜单已关；切到 B ⇒ ModelPicker 重挂，首帧拿到 seq=3。
    const step = nextOpenSeqState(null, 3);
    expect(step.open, "重挂不是「seq 前进」，切会话时菜单不许自己弹开").toBe(false);
    expect(step.baseline).toBe(3);
  });

  it("seq 真的前进 ⇒ 开一次", () => {
    const step = nextOpenSeqState(3, 4);
    expect(step.open).toBe(true);
    expect(step.baseline).toBe(4);
  });

  it("seq 没动 ⇒ 不开（不重复开）", () => {
    const step = nextOpenSeqState(3, 3);
    expect(step.open).toBe(false);
    expect(step.baseline).toBe(3);
  });

  it("seq 回退 ⇒ 不开、基线不倒退（避免下一次前进被算成连跳两格而开两次）", () => {
    const step = nextOpenSeqState(5, 2);
    expect(step.open).toBe(false);
    expect(step.baseline).toBe(5);
    // 基线没退 ⇒ 下一次前进（5→6）只开一次
    expect(nextOpenSeqState(step.baseline, 6).open).toBe(true);
  });

  it("没有 openSeq（不响应信号）⇒ 什么都不发生", () => {
    expect(nextOpenSeqState(null, undefined)).toEqual({ open: false, baseline: null });
    expect(nextOpenSeqState(3, undefined)).toEqual({ open: false, baseline: 3 });
  });

  it("反向对照：seq 前进确实会开（判据不是恒假）", () => {
    expect(nextOpenSeqState(0, 1).open).toBe(true);
  });
});

describe("接线：ModelPicker 走这一个判据", () => {
  const picker = read("../src/renderer/components/ModelPicker.tsx");

  it("effect 调 nextOpenSeqState，基线用 null 起（不是 0）", () => {
    expect(picker).toContain("const lastOpenSeq = useRef<number | null>(null);");
    expect(picker).toContain("const step = nextOpenSeqState(lastOpenSeq.current, props.openSeq);");
    expect(picker).toContain("lastOpenSeq.current = step.baseline;");
    // 反面对照：旧的"基线是 0"那种形状不许回来（重挂就回到 0 ⇒ 自己弹开）
    expect(picker).not.toContain("const lastOpenSeq = useRef(0);");
  });

  it("disabled（门槛/排队）时不开（硬锁语义不变）", () => {
    expect(picker).toContain("if (step.open && props.disabled !== true) setOpen(true);");
  });
});
