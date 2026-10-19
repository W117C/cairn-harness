/** 交付断言（能力 12）的单元面：幽灵交付 + 空转，两格。
 *
 *  立这一格的动机写在 `src/agent/delivery-guard.ts` 头上：三趟真实模型跑（deepseek-chat，
 *  2026-10-17）趟趟都出了问题，而**没有一格判据看见**——前两趟承诺造 pelican.html 却从未
 *  调 write_file，第三趟 196 个 delta 后直接结束、零工具零收尾。
 *  这里钉的是两件事：**该报的报了**（假绿从事件流里跑不掉），以及**不该报的没报**
 *  （只读问答本来就零工具，把它判成空转，就是把提示词纪律变成噪音）。
 */
import { it, expect, describe } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DELIVERY_GUARD_CALL_ID,
  deliveredPaths,
  eventsForCurrentRun,
  findEmptyRun,
  findPhantomDelivery,
  promisedCreates,
} from "../src/agent/delivery-guard";
import { run_shell } from "../src/tools/run_shell";
import type { AgentEvent } from "../src/events";

/** 造一组已结算的方案事件；null 表示仍在等审批。 */
function plan(files: unknown, approved: boolean | null = true): AgentEvent[] {
  const callId = "c-plan";
  return [
    {
      type: "plan_proposed",
      callId,
      plan: { goal: "g", files },
    } as unknown as AgentEvent,
    ...(approved === null ? [] : [{ type: "plan_approved", callId, approved } as AgentEvent]),
  ];
}

/** 造一条 tool_result。 */
function result(callId: string, ok: boolean, extra: Record<string, unknown> = {}): AgentEvent {
  return { type: "tool_result", callId, ok, output: "ok", ...extra } as unknown as AgentEvent;
}

/** 造一条 assistant_message（收尾那句）。 */
function msg(text: string): AgentEvent {
  return { type: "assistant_message", content: text } as AgentEvent;
}

describe("承诺面：只认最新且获批方案里的 create", () => {
  it("方案里 create 的文件 = 承诺", () => {
    const r = promisedCreates(plan([{ action: "create", path: "pelican.html", summary: "s" }]));
    expect(r).toEqual([{ path: "pelican.html", action: "create" }]);
  });

  it("modify 不是「要造一个文件」，不算承诺", () => {
    const r = promisedCreates(plan([{ action: "modify", path: "a.html" }]));
    expect(r).toEqual([]);
  });

  it("没有 files 字段 = 没有承诺（不是「承诺了没做」）", () => {
    expect(promisedCreates(plan(undefined))).toEqual([]);
    expect(promisedCreates([])).toEqual([]);
  });

  it("脏数据不炸：files 不是数组 / 元素不是对象 / path 不是字符串，一律跳过", () => {
    expect(promisedCreates(plan("nope"))).toEqual([]);
    expect(promisedCreates(plan([1, null, "x"]))).toEqual([]);
    expect(promisedCreates(plan([{ action: "create" }]))).toEqual([]);
    expect(promisedCreates(plan([{ action: "create", path: 42 }]))).toEqual([]);
  });

  it("待审批或拒绝的方案不构成交付承诺", () => {
    const files = [{ action: "create", path: "unapproved.txt" }];
    expect(promisedCreates(plan(files, null))).toEqual([]);
    expect(promisedCreates(plan(files, false))).toEqual([]);
  });

  it("最新的拒绝提案取代更早获批的方案", () => {
    const events = [
      ...plan([{ action: "create", path: "old.txt" }]),
      ...plan([{ action: "create", path: "rejected.txt" }], false),
    ];
    expect(promisedCreates(events)).toEqual([]);
  });
});

describe("落盘面：只认真实凭据，不认模型自述", () => {
  it("write_file 成功且有 change 回执 = 落盘", () => {
    const evs: AgentEvent[] = [
      { type: "tool_call", id: "c1", name: "write_file", args: { path: "a.html" } } as AgentEvent,
      result("c1", true, { change: "created" }),
    ];
    expect([...deliveredPaths(evs)]).toEqual(["a.html"]);
  });

  it("edit_file 修改既有文件也算落盘", () => {
    const evs: AgentEvent[] = [
      { type: "tool_call", id: "c1", name: "edit_file", args: { path: "a.html" } } as AgentEvent,
      result("c1", true, { change: "modified" }),
    ];
    expect([...deliveredPaths(evs)]).toEqual(["a.html"]);
  });

  it("写工具失败 = 没落盘（失败的工具调用不产出文件）", () => {
    const evs: AgentEvent[] = [
      { type: "tool_call", id: "c1", name: "write_file", args: { path: "a.html" } } as AgentEvent,
      result("c1", false, {}),
    ];
    expect(deliveredPaths(evs).size).toBe(0);
  });

  it("worker worktree 的写入在合并前不算主工作区交付", () => {
    const evs: AgentEvent[] = [
      ...plan([{ action: "create", path: "a.html" }]),
      {
        type: "tool_call", id: "worker-write", name: "write_file", agent_id: "worker-1",
        args: { path: "a.html" },
      } as AgentEvent,
      result("worker-write", true, {
        agent_id: "worker-1",
        artifact: { kind: "html", path: "a.html" },
        changedPaths: ["a.html"],
      }),
    ];
    expect(deliveredPaths(evs)).toEqual(new Set());
    expect(findPhantomDelivery(evs)?.missing).toEqual(["a.html"]);
  });

  it("artifact.path 也算落盘凭据", () => {
    const evs: AgentEvent[] = [result("c-render", true, { artifact: { kind: "html", path: "a.html" } })];
    expect([...deliveredPaths(evs)]).toEqual(["a.html"]);
  });

  it("失败结果携带的 artifact 不算交付", () => {
    const evs: AgentEvent[] = [result("c-render", false, { artifact: { kind: "html", path: "a.html" } })];
    expect(deliveredPaths(evs)).toEqual(new Set());
  });

  it("路径归一：./a.html 与 a.html 是同一个文件", () => {
    const evs: AgentEvent[] = [
      { type: "tool_call", id: "c1", name: "write_file", args: { path: "./a.html" } } as AgentEvent,
      result("c1", true, { change: "created" }),
    ];
    const promised = promisedCreates(plan([{ action: "create", path: "a.html" }]));
    expect(findPhantomDelivery([...plan([{ action: "create", path: "a.html" }]), ...evs])).toBeNull();
    expect(promised).toHaveLength(1);
  });

  it("changedPaths 中的 .. 片段归一到实际相对路径", () => {
    const evs: AgentEvent[] = [result("c-patch", true, { changedPaths: ["nested/../canonical.txt"] })];
    expect([...deliveredPaths(evs)]).toEqual(["canonical.txt"]);
    expect(promisedCreates(plan([{ action: "create", path: "canonical.txt" }]))).toHaveLength(1);
    expect(findPhantomDelivery([
      ...plan([{ action: "create", path: "canonical.txt" }]),
      ...evs,
    ])).toBeNull();
  });
});

describe("幽灵交付：承诺了却没落盘", () => {
  it("承诺造 a.html 但整轮没写 ⇒ 报出来（实测里连中两趟的那种）", () => {
    const evs: AgentEvent[] = plan([{ action: "create", path: "pelican.html" }]);
    const r = findPhantomDelivery(evs);
    expect(r).not.toBeNull();
    expect(r!.missing).toEqual(["pelican.html"]);
  });

  it("承诺了也真写了 ⇒ 一声不出", () => {
    const evs: AgentEvent[] = [
      ...plan([{ action: "create", path: "a.html" }]),
      { type: "tool_call", id: "c1", name: "write_file", args: { path: "a.html" } } as AgentEvent,
      result("c1", true, { change: "created" }),
    ];
    expect(findPhantomDelivery(evs)).toBeNull();
  });

  it("写了别的、漏了承诺的那个 ⇒ 报漏掉的那一个（措辞能分清两种失败）", () => {
    const evs: AgentEvent[] = [
      ...plan([{ action: "create", path: "a.html" }, { action: "create", path: "b.html" }]),
      { type: "tool_call", id: "c1", name: "write_file", args: { path: "a.html" } } as AgentEvent,
      result("c1", true, { change: "created" }),
    ];
    const r = findPhantomDelivery(evs);
    expect(r!.missing).toEqual(["b.html"]);
  });

  it("没有承诺就不出声：没方案的任务不是幽灵交付", () => {
    expect(findPhantomDelivery([msg("做完了")])).toBeNull();
  });

  it("重复的承诺只报一次（方案里写两遍同一个文件不当两条）", () => {
    const evs: AgentEvent[] = [
      ...plan([{ action: "create", path: "a.html" }, { action: "create", path: "a.html" }]),
    ];
    expect(findPhantomDelivery(evs)!.missing).toEqual(["a.html"]);
  });

  it("历史哨兵不能跳过当前这轮的交付检查", () => {
    const history: AgentEvent[] = [
      { type: "user_message", content: "旧任务" } as AgentEvent,
      ...plan([{ action: "create", path: "old.txt" }]),
      result(DELIVERY_GUARD_CALL_ID, false),
      { type: "user_message", content: "新任务" } as AgentEvent,
      ...plan([{ action: "create", path: "new.txt" }]),
    ];
    const current = eventsForCurrentRun(history);
    expect(current.some((e) => e.type === "tool_result" && e.callId === DELIVERY_GUARD_CALL_ID)).toBe(false);
    expect(findPhantomDelivery(history)?.missing).toEqual(["new.txt"]);
  });

  it("worker 子流的交付哨兵不属于父会话当前轮", () => {
    const events: AgentEvent[] = [
      { type: "user_message", content: "父任务" } as AgentEvent,
      result(DELIVERY_GUARD_CALL_ID, false, { agent_id: "worker-1" }),
    ];
    expect(eventsForCurrentRun(events).some((e) =>
      e.type === "tool_result" && e.callId === DELIVERY_GUARD_CALL_ID)).toBe(false);
  });

  it("shell 真正创建了承诺文件时按工作区最终状态算已交付", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "delivery-shell-"));
    try {
      const promise = plan([{ action: "create", path: "from-shell.txt" }]);
      const result = await run_shell.run(
        { command: "printf 'ok' > from-shell.txt" },
        { workspace, snapshot: false } as never,
      );
      expect(result.ok).toBe(true);
      expect(promisedCreates(promise)).toHaveLength(1);
      expect(findPhantomDelivery(promise, workspace)).toBeNull();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("写入后又删除：有成功写事件也不算交付，最终文件状态才是真值", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "delivery-delete-"));
    try {
      const promised = plan([{ action: "create", path: "gone.txt" }]);
      await writeFile(join(workspace, "gone.txt"), "temporary", "utf8");
      const writeEvents: AgentEvent[] = [
        { type: "tool_call", id: "c1", name: "write_file", args: { path: "gone.txt" } } as AgentEvent,
        result("c1", true, { change: "created" }),
      ];
      await rm(join(workspace, "gone.txt"));

      expect(findPhantomDelivery([...promised, ...writeEvents], workspace)?.missing).toEqual(["gone.txt"]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("空转：零工具又没收尾", () => {
  it("零 tool_call 且无收尾消息 ⇒ 报出来（实测第三趟：196 个 delta 后直接结束）", () => {
    const r = findEmptyRun([{ type: "user_message", content: "写一个页面" } as AgentEvent]);
    expect(r).not.toBeNull();
    expect(r!.toolCalls).toBe(0);
  });

  it("零工具但有收尾消息 ⇒ 那是正常收束，不出声", () => {
    expect(findEmptyRun([msg("我知道了")])).toBeNull();
  });

  it("零工具但有流式正文 ⇒ 那是正常回答，不出声", () => {
    const evs: AgentEvent[] = [
      { type: "assistant_delta", callId: "a1", text: "这是完整回答" } as AgentEvent,
    ];
    expect(findEmptyRun(evs)).toBeNull();
  });

  it("worker 的流式正文不能替父会话收尾", () => {
    const evs: AgentEvent[] = [
      { type: "user_message", content: "父任务" } as AgentEvent,
      { type: "assistant_delta", callId: "w1", text: "worker 内部回答", agent_id: "worker-1" } as unknown as AgentEvent,
    ];
    expect(findEmptyRun(evs)).not.toBeNull();
  });

  it("有工具调用 ⇒ 不管有没有收尾都不算空转", () => {
    const evs: AgentEvent[] = [
      { type: "tool_call", id: "c1", name: "read_file", args: {} } as AgentEvent,
      result("c1", true),
    ];
    expect(findEmptyRun(evs)).toBeNull();
  });

  it("被截断的那一轮不判空转（它零工具零收尾，但**正在交付**）", () => {
    // 说到一半被收走（输出预算/内容策略）：事件流上同样是零工具、零收尾，
    // 而模型其实正在说话——判成「什么都没做」既冤枉，又把下一轮引错方向。
    const evs: AgentEvent[] = [
      { type: "assistant_delta", callId: "c1", text: "函数长这样：" } as AgentEvent,
      { type: "turn_truncated", callId: "c1", outcome: "output_budget" } as unknown as AgentEvent,
    ];
    expect(findEmptyRun(evs)).toBeNull();
  });

  it("先说话后调工具：收尾在工具之后不算空转（顺序也站得住）", () => {
    const evs: AgentEvent[] = [
      msg("我先看看"),
      { type: "tool_call", id: "c1", name: "write_file", args: { path: "a.html" } } as AgentEvent,
      result("c1", true, { change: "created" }),
    ];
    expect(findEmptyRun(evs)).toBeNull();
  });
});

describe("哨兵 callId：两件事不许共用一枚", () => {
  it("交付断言与自动验证拍是两枚不同的 id", () => {
    expect(DELIVERY_GUARD_CALL_ID).toBe("harness-delivery-guard");
    expect(DELIVERY_GUARD_CALL_ID).not.toBe("harness-auto-verify");
  });
});
