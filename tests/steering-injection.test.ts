/** 第 9 点·用户干预注入（steering）的判据面。
 *
 *  这一组钉的是**边界**，不是「能塞进去」——塞进去本身是最容易的那半：
 *
 *  ① **插话不开新轮**。`eventsForCurrentRun()` 是交付断言（幽灵交付）、空转判定、进化信号、
 *     收尾复核与 round 读数**共同的**轮界取料口。若把插话当成 run 起点，它之前那一段的承诺
 *     与证据会整段静默失效 ⇒ **假绿**。实测形状：plan 承诺 create `a.ts` 而始终没落盘时，
 *     插一条插话会让 `findPhantomDelivery` 由 `{missing:["a.ts"]}` 变成 `null`。
 *  ② **但它必须是模型看得见的**，且落在 **tool_result 之后、下一次请求之前**。位置错了就是
 *     把指令插进「工具还在跑」的中间，事件流会出现没有回执的调用与半截上下文。
 *  ③ **取消后再插话不花新请求**：用户按下停止是更强的意图。
 *  ④ **缺省零行为**：不传盒子时字节与调用次数都不变（既有四条路径都走这条）。
 */
import { describe, expect, it } from "vitest";
import { runLoop } from "../src/agent/loop";
import { projectContext } from "../src/agent/context";
import { eventsForCurrentRun, findPhantomDelivery, isSteeringMessage } from "../src/agent/delivery-guard";
import { createSteeringChannel, STEERING_TEXT_MAX_CHARS } from "../src/agent/steering-channel";
import type { AgentEvent } from "../src/events";
import type { Provider, ProviderMessage } from "../src/providers";

const ev = (xs: unknown[]): AgentEvent[] => xs as AgentEvent[];

/** 一个真会造成幽灵交付的形状：plan 承诺 create a.ts，整轮没落盘。 */
const promiseShape = (): AgentEvent[] => ev([
  { type: "user_message", content: "把 a.ts 建出来" },
  { type: "plan_proposed", callId: "p1", plan: { files: [{ path: "a.ts", action: "create" }] } },
  { type: "plan_approved", callId: "p1", approved: true },
]);

describe("轮中插话不改写轮界（交付断言的命门）", () => {
  it("★ 带 origin:steering 的 user_message 之后，本轮承诺仍然算数", () => {
    const base = promiseShape();
    const withSteer = ev([...base, { type: "user_message", content: "顺便改 b.ts", origin: { kind: "steering", step: 1 } }]);
    // 轮界没移动：plan 仍在当前轮的取料范围内
    expect(eventsForCurrentRun(withSteer)).toHaveLength(4);
    expect(findPhantomDelivery(withSteer)).toEqual({ missing: ["a.ts"] });
  });

  it("★ 反面哨兵：用户真开新一轮（无 origin）时，上一轮的承诺不跨轮", () => {
    const newTurn = ev([...promiseShape(), { type: "user_message", content: "算了，改成 b.ts" }]);
    expect(eventsForCurrentRun(newTurn)).toHaveLength(1);
    expect(findPhantomDelivery(newTurn)).toBeNull();
  });

  it("sidechat / goal 来源照旧开新轮（只有 steering 是例外，别顺手放过别的 kind）", () => {
    const side = ev([...promiseShape(), { type: "user_message", content: "提升过来的结论", origin: { kind: "sidechat", session_id: "s", source_event_ids: [1] } }]);
    expect(eventsForCurrentRun(side)).toHaveLength(1);
    const goal = ev([...promiseShape(), { type: "user_message", content: "继续", origin: { kind: "goal", turn: 2, max_turns: 10 } }]);
    expect(eventsForCurrentRun(goal)).toHaveLength(1);
  });

  it("worker 的插话**根本不参与**父会话轮界（既有口径：先按 worker 归因摘掉）", () => {
    const workerSteer = ev([...promiseShape(), {
      type: "user_message", content: "worker 里的插话", agent_id: "a-1", origin: { kind: "steering", step: 1 },
    }]);
    // 缺省取料面把 worker 事件整条摘掉 ⇒ 3 条（不是 4）：插话与它那条 worker 归因一起不在场。
    // 这是既有纪律，**不是** steering 带来的：worker 的 user_message 任何时候都不能开父会话新轮。
    expect(eventsForCurrentRun(workerSteer)).toHaveLength(3);
    expect(eventsForCurrentRun(workerSteer, { includeWorkers: true })).toHaveLength(4);
    // 两条理由各自成立，且承诺面在两面都仍在（轮界没被 worker 插话推走）
    expect(findPhantomDelivery(workerSteer)).toEqual({ missing: ["a.ts"] });
  });

  it("判定按 kind 分支，不按文本：正文里恰好写着「插话」也不算", () => {
    const lookalike = ev([{ type: "user_message", content: "插话：这是用户真开的新一轮" }]);
    expect(isSteeringMessage(lookalike[0]!)).toBe(false);
    expect(eventsForCurrentRun(ev([...promiseShape(), ...lookalike]))).toHaveLength(1);
  });
});

describe("loop 的注入位：落在 tool_result 之后、下一次请求之前", () => {
  /** 跑一轮：第 1 拍发工具调用，并在请求发出后把插话塞进盒子（真实时序）。 */
  async function run(arm: {
    steering?: { take: () => readonly string[] | undefined };
    signal?: AbortSignal;
  }) {
    const log: AgentEvent[] = [];
    const requests: ProviderMessage[][] = [];
    let round = 0;
    const box = { pending: [] as string[] };
    const provider: Provider = {
      async *stream(messages) {
        requests.push(messages);
        round += 1;
        if (round === 1) {
          if (arm.steering !== undefined) box.pending.push("插话：顺手把 README 也改了");
          yield { type: "tool_call", id: "c1", name: "read_file", args: { path: "a" } };
        }
      },
    };
    await runLoop({
      provider,
      events: { async append(e: AgentEvent) { log.push(e); } },
      workspace: "/tmp",
      userMessage: "读一下 a",
      tools: { read_file: { name: "read_file", async run() { return { ok: true, output: "A" }; } } },
      ...(arm.steering !== undefined
        ? { steering: { take: () => { const out = box.pending; box.pending = []; return out.length > 0 ? out : undefined; } } }
        : {}),
      ...(arm.signal !== undefined ? { signal: arm.signal } : {}),
    });
    return { log, requests };
  }

  it("插话进第 2 次请求，且事件序在 tool_result 之后", async () => {
    const { log, requests } = await run({ steering: { take: () => undefined } });
    const kinds = log.map((e) => e.type);
    expect(kinds).toEqual(["user_message", "tool_call", "tool_result", "user_message"]);
    const steer = log.filter((e) => isSteeringMessage(e));
    expect(steer).toHaveLength(1);
    // 轮次序号：插话是在**第 1 拍请求已发出、工具已结算之后**发生的 ⇒ step 必须是 1（0-based 后的那一拍）。
    // 钉这个数是为了挡住「注入位挪到请求之前」那种改法：那时 step 会读成 0，而事件序看起来仍然合法。
    expect((steer[0] as { origin?: unknown }).origin).toEqual({ kind: "steering", step: 1 });
    expect(requests[1]?.filter((m) => m.role === "user").map((m) => m.content))
      .toEqual(["读一下 a", "插话：顺手把 README 也改了"]);
  });

  it("投影次序合法：user → assistant(tool_call) → tool → user（不拆 tool 配对）", async () => {
    const { log } = await run({ steering: { take: () => undefined } });
    expect(projectContext(log).map((m) => m.role)).toEqual(["user", "assistant", "tool", "user"]);
  });

  it("缺省不传盒子 = 零行为：只有一条 user_message、零插话", async () => {
    const { log, requests } = await run({});
    expect(log.filter((e) => e.type === "user_message")).toHaveLength(1);
    expect(log.filter((e) => isSteeringMessage(e))).toHaveLength(0);
    expect(requests).toHaveLength(2); // 调用次数也不变：仍是「调工具 → 回灌 → 收尾」
  });

  it("空插话不落事件（误触不该变成一条空洞的指令）", async () => {
    const log: AgentEvent[] = [];
    let round = 0;
    const box = { pending: [] as string[] };
    const provider: Provider = {
      async *stream() {
        round += 1;
        if (round === 1) { box.pending.push("   "); yield { type: "tool_call", id: "c1", name: "read_file", args: { path: "a" } }; }
      },
    };
    await runLoop({
      provider,
      events: { async append(e: AgentEvent) { log.push(e); } },
      workspace: "/tmp",
      userMessage: "读一下 a",
      tools: { read_file: { name: "read_file", async run() { return { ok: true, output: "A" }; } } },
      steering: { take: () => { const out = box.pending; box.pending = []; return out.length > 0 ? out : undefined; } },
    });
    expect(log.filter((e) => e.type === "user_message")).toHaveLength(1);
  });

  it("取消后迟到的那条插话既不落事件、也不再买一次请求", async () => {
    const controller = new AbortController();
    const log: AgentEvent[] = [];
    const requests: ProviderMessage[][] = [];
    // 真实时序：第 1 拍请求发出时盒子**还是空的**；请求发完之后用户才插话，同时按下停止。
    const box = { pending: [] as string[] };
    const provider: Provider = {
      async *stream(messages) {
        requests.push(messages);
        box.pending.push("迟到的插话");
        controller.abort();
        yield { type: "tool_call", id: "c1", name: "read_file", args: { path: "a" } };
      },
    };
    await runLoop({
      provider,
      events: { async append(e: AgentEvent) { log.push(e); } },
      workspace: "/tmp",
      userMessage: "读一下 a",
      tools: { read_file: { name: "read_file", async run() { return { ok: true, output: "A" }; } } },
      steering: { take: () => { const out = box.pending; box.pending = []; return out.length > 0 ? out : undefined; } },
      signal: controller.signal,
    });
    // 取消之后：既没落插话事件，也没换来第 2 次请求。
    // （注：这条**不**单独钉某一行 abort——本轮顶、步末、工具执行前后共有多处复查，
    //  单挪其中一处仍会被另一处收束。它钉的是行为口径，见 loop.ts 注入位那段注释。）
    expect(requests).toHaveLength(1);
    expect(log.filter((e) => isSteeringMessage(e))).toHaveLength(0);
  });
});

describe("通道（界面 → loop 那只盒子）", () => {
  it("push/take 的取出即清空：同一条不会被两拍各付一遍 token", () => {
    const box = createSteeringChannel();
    expect(box.take()).toBeUndefined();
    box.push("改下 README");
    expect(box.size()).toBe(1);
    expect(box.take()).toEqual(["改下 README"]);
    expect(box.take()).toBeUndefined(); // 已清空
    expect(box.size()).toBe(0);
  });

  it("同一拍连说几句 ⇒ 一次取走全部（顺序保留）", () => {
    const box = createSteeringChannel();
    box.push("第一句");
    box.push("第二句");
    expect(box.take()).toEqual(["第一句", "第二句"]);
  });

  it("纯空白 / 空串不进货（误触不该变成一条空洞的指令）", () => {
    const box = createSteeringChannel();
    box.push("   ");
    box.push("");
    box.push("\n\t ");
    expect(box.take()).toBeUndefined();
  });

  it("超帽截断**并保留**，且正文里说清被截过（不静默截）", () => {
    const box = createSteeringChannel();
    const long = "a".repeat(STEERING_TEXT_MAX_CHARS + 500);
    box.push(long);
    const [out] = box.take()!;
    expect(out!.length).toBeGreaterThan(STEERING_TEXT_MAX_CHARS);
    expect(out!).toContain("截断");
    expect(out!.startsWith("a".repeat(STEERING_TEXT_MAX_CHARS))).toBe(true);
  });

  it("首尾空白被去掉（人打字常带换行，不该原样进模型）", () => {
    const box = createSteeringChannel();
    box.push("  改下 README  \n");
    expect(box.take()).toEqual(["改下 README"]);
  });
});
