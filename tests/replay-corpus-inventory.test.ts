// 复跑面判卷 · `scripts/replay/corpus-inventory.ts`
//
// 这张表最后一行「失败后仍调同一工具 / 其中参数一字不变」是**要不要给主循环加换路压力**的决策依据
// （记忆 [[dsh-loop-repeat-blindspot]]：`detectStuck` 只服务 worker 看门）。既然是决策依据，
// 它就不能有"静默偏小"的形状——本次抓到两处，都在偏小的方向上：
//  ⑴ 只看**紧邻**的下一个 `tool_call`：中间隔了任何一次别的调用，重复就逃过统计；
//  ⑵ 参数用 `JSON.stringify(原始对象)` 比：同一调用换个键序就被读成"改过参数了"，于是「一字不变」偏低。
// 两条都会把人推向"没有卡死证据 ⇒ 不用动"的错误结论，而这类结论错了不会报错，只会安静地不下判断。
import { describe, expect, it } from "vitest";
import { canonicalArgs, repeatOfFailed, tallyInventory, type InventoryEvent } from "../scripts/replay/corpus-inventory";

const call = (id: string, name: string, args: Record<string, unknown> = {}): InventoryEvent =>
  ({ type: "tool_call", id, name, args });
const result = (callId: string, ok: boolean): InventoryEvent => ({ type: "tool_result", callId, ok });

const r = (rows: readonly InventoryEvent[]) => tallyInventory(rows, "x.jsonl");

describe("tallyInventory：重复统计不许静默偏小", () => {
  it("失败后**紧邻**的同参数调用 ⇒ 记一次原样重试", () => {
    const t = r([call("a", "run_shell", { command: "pnpm test" }), result("a", false), call("b", "run_shell", { command: "pnpm test" })]);
    expect(t.failedCalls).toBe(1);
    expect(t.retrySameName).toBe(1);
    expect(t.retryIdenticalArgs).toBe(1);
  });

  it("中间隔了一次别的调用 ⇒ 仍算原样重试（旧写法只看紧邻，这里会读成 0）", () => {
    const t = r([
      call("a", "run_shell", { command: "pnpm test" }), result("a", false),
      call("r", "read_file", { path: "a.ts" }), result("r", true),
      call("b", "run_shell", { command: "pnpm test" }), result("b", false),
    ]);
    expect(t.retrySameName).toBe(1);
    expect(t.retryIdenticalArgs).toBe(1);
  });

  it("参数键序不同、内容相同 ⇒ 仍算「一字不变」（旧写法用原始 JSON.stringify，这里会读成 0）", () => {
    const t = r([
      call("a", "edit_file", { path: "x.ts", content: "y" }), result("a", false),
      call("b", "edit_file", { content: "y", path: "x.ts" }),
    ]);
    expect(t.retrySameName).toBe(1);
    expect(t.retryIdenticalArgs).toBe(1);
  });

  it("反向一侧：换了参数就不算原样重试（把这条写坏会让「卡死」虚高）", () => {
    const t = r([call("a", "run_shell", { command: "pnpm test" }), result("a", false), call("b", "run_shell", { command: "pnpm test --reporter=dot" })]);
    expect(t.retrySameName).toBe(1);
    expect(t.retryIdenticalArgs).toBe(0);
  });

  it("最深一段连续同参数失败的 run 深度单独报（决策线的另一半）", () => {
    const t = r([
      call("a", "run_shell", { command: "make" }), result("a", false),
      call("b", "run_shell", { command: "make" }), result("b", false),
      call("c", "run_shell", { command: "make" }), result("c", false),
    ]);
    expect(t.maxSameFailedRun).toBe(3);
    expect(t.retryIdenticalArgs).toBe(2);
  });

  it("join 键断链必须抛，而不是把「失败」读成 0（09-21 实踩过的形状）", () => {
    expect(() => r([{ type: "tool_result", ok: false } as unknown as InventoryEvent])).toThrow(/callId/);
    expect(() => r([{ type: "tool_call", name: "run_shell" } as unknown as InventoryEvent])).toThrow(/id/);
  });

  it("无配对的 tool_call 单独计数（进程切在调用中途 = 合法成因，但要看得见）", () => {
    const t = r([call("a", "run_shell", { command: "ls" })]);
    expect(t.noResult).toBe(1);
    expect(t.failedCalls).toBe(0);
  });
});

describe("决策线与规范化", () => {
  it("零原样重试 ⇒ 不给主 loop 加压（今天的真语料形状）", () => {
    const t = { maxSameFailedRun: 2, retryIdenticalArgs: 0, failedCalls: 15, retrySameName: 7 };
    const v = repeatOfFailed(t);
    expect(v.shouldAct).toBe(false);
    // 旧针脚「参数一字不变=0」的标签在生产侧有两条出口（决策句 ＋ 读数脚本自己的 console 行）⇒ 换收
    // 只有这一支会说的话（另一支是「有卡死证据」）＋那条阈值理由；数本身改成派生断言。
    expect(v.why).toContain("无卡死证据");
    expect(v.why).toContain("「参数一字不变」>0");
    expect(v.why).toContain("=" + String(t.retryIdenticalArgs) + " 最深连败");
  });

  it("run ≥ 3 且存在原样重试 ⇒ 该动，理由带那两个数", () => {
    const v = repeatOfFailed({ maxSameFailedRun: 3, retryIdenticalArgs: 4, failedCalls: 20, retrySameName: 10 });
    expect(v.shouldAct).toBe(true);
    expect(v.why).toContain("3");
    expect(v.why).toContain("4");
  });

  // 决策线有两半，各自要有分歧格：上一格只钉了「run 到了」，把阈值从 3 放宽到 2 它照样绿。
  it("只有原样重试、run 未到 3 ⇒ 仍不动（阈值这一半的分歧格）", () => {
    const v = repeatOfFailed({ maxSameFailedRun: 2, retryIdenticalArgs: 5, failedCalls: 20, retrySameName: 10 });
    expect(v.shouldAct).toBe(false);
    expect(v.why).toContain("最深连败 run=2");
  });

  it("canonicalArgs：键序无关、嵌套与数组内递归都规范化；循环引用不抛", () => {
    expect(canonicalArgs({ b: 1, a: { d: [2, 1], c: "s" } })).toBe(canonicalArgs({ a: { c: "s", d: [2, 1] }, b: 1 }));
    expect(canonicalArgs(undefined)).toBe("null");
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic["self"] = cyclic;
    expect(() => canonicalArgs(cyclic)).not.toThrow();
  });
});
