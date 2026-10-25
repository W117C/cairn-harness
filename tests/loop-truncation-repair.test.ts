/** 第 1 点·终止判定的另一半：**截断 ≠ 说完**（2026-10-23）。
 *
 *  缺陷形状（实测，不是推理）：模型被输出预算砍断时 provider 发 `turn_truncated`，
 *  而 loop 在那一拍直接 `return`——像「模型自己说完了」一样收束。
 *  更糟的是 `context.ts#truncationNote` **早就**生成了「那不是完整结论，别当成已答完；
 *  接着做完」这条 user 消息并注入投影，但**没有任何下一轮去读它**：
 *  实测请求数 = 1、提示在最终投影里、零消费者。一条没人读的提示与没有这条提示等价。
 *
 *  本组钉四件事，正反都要（缺了反向守卫，「永远多要一轮」也能全绿）：
 *   ① 截断 ⇒ 再要**一轮**，且那一轮**真的读到了**那条提示；
 *   ② 次次截断 ⇒ 至多续一轮（不无限要，与另两条返修环同一上限形状）；
 *   ③ `truncationRepair: false` ⇒ 逐字回到旧行为（一次也不多要）；
 *   ④ 没被截断的正常收束 ⇒ 零额外请求（这一支不许被顺手改宽）。
 */
import { describe, expect, it } from "vitest";
import { runLoop } from "../src/agent/loop";
import { projectContext } from "../src/agent/context";
import type { AgentEvent } from "../src/events";
import type { Provider, ProviderMessage } from "../src/providers";

interface Script {
  /** 每一拍做什么：`truncate` = 吐半句后报截断；`finish` = 正常收尾；`tools` = 调一个工具。 */
  readonly rounds: readonly ("truncate" | "finish" | "tools")[];
  readonly truncationRepair?: boolean;
}

async function run(script: Script) {
  const log: AgentEvent[] = [];
  const requests: ProviderMessage[][] = [];
  let round = 0;
  const provider: Provider = {
    async *stream(messages) {
      requests.push(messages);
      const kind = script.rounds[Math.min(round, script.rounds.length - 1)];
      round += 1;
      if (kind === "truncate") {
        yield { type: "assistant_delta", callId: "a" + String(round), text: "先写第一部分…" };
        yield {
          type: "turn_truncated", callId: "a" + String(round),
          stop_reason: "output_budget", outcome: "output_budget", outputTokens: 4096,
        } as never;
      } else if (kind === "tools") {
        yield { type: "tool_call", id: "t" + String(round), name: "read_file", args: { path: "a" } };
      } else {
        yield { type: "assistant_message", content: "写完了" };
      }
    },
  };
  await runLoop({
    provider,
    events: { async append(e: AgentEvent) { log.push(e); } },
    workspace: "/tmp",
    userMessage: "把文件写完",
    tools: { read_file: { name: "read_file", async run() { return { ok: true, output: "A" }; } } },
    ...(script.truncationRepair === false ? { truncationRepair: false } : {}),
  });
  return { log, requests, round };
}

const hasNote = (msgs: readonly ProviderMessage[]): boolean =>
  msgs.some((m) => String(m.content ?? "").includes("别当成已答完"));

describe("第 1 点：截断续跑（截断 ≠ 说完）", () => {
  it("★ 截断后真的再要一轮，且那一轮**读到了**「别当成已答完」那条提示", async () => {
    const { requests, round } = await run({ rounds: ["truncate", "finish"] });
    expect(round, "截断后被当成说完了 ⇒ 整段就停在那儿").toBe(2);
    expect(hasNote(requests[1]!), "提示生成了但没被任何一轮读到 = 没有这条提示").toBe(true);
  });

  it("★ 上限：次次截断也**至多续一轮**（不无限要，与 deliveryRepair/autoVerifyRepair 同形）", async () => {
    const { round } = await run({ rounds: ["truncate"] });
    expect(round).toBe(2);
  });

  it("关掉开关 ⇒ 逐字回到旧行为（一次都不多要）", async () => {
    const { round } = await run({ rounds: ["truncate", "finish"], truncationRepair: false });
    expect(round).toBe(1);
  });

  it("★ 反向哨兵：没被截断的正常收束 ⇒ 零额外请求（这一支不许被顺手改宽）", async () => {
    const { round } = await run({ rounds: ["finish"] });
    expect(round, "正常说完还多要一轮 = 每一场收束都白烧一次请求").toBe(1);
  });

  it("工具轮不会被误判成截断（两条收束语义不许混）", async () => {
    const { round } = await run({ rounds: ["tools", "finish"] });
    expect(round).toBe(2); // 工具回灌一次 + 收尾一次，没有额外续跑
  });

  it("截断提示在投影里仍只出现一次（续跑读的是同一条，不重复注入）", async () => {
    const { log } = await run({ rounds: ["truncate", "finish"] });
    const notes = projectContext(log).filter((m) => String(m.content ?? "").includes("别当成已答完"));
    expect(notes).toHaveLength(1);
  });
});

describe("撞帽与截断续跑不许互相顶掉", () => {
  /** 跑一趟：前 n-1 拍调工具，最后一拍按参数决定「只截断」还是「继续调工具」。 */
  async function run(opts: { lastStep: "truncate" | "tools"; cap: number }) {
    const log: AgentEvent[] = [];
    let round = 0;
    const provider: Provider = {
      async *stream() {
        round += 1;
        if (opts.lastStep === "truncate" && round >= opts.cap) {
          yield { type: "assistant_delta", callId: "a" + String(round), text: "半句" };
          yield {
            type: "turn_truncated", callId: "a" + String(round),
            stop_reason: "max_tokens", outcome: "output_budget", outputTokens: 4096,
          } as never;
          return;
        }
        yield { type: "tool_call", id: "t" + String(round), name: "read_file", args: { path: "a" } };
      },
    };
    let threw = "";
    try {
      await runLoop({
        provider,
        events: { async append(e: AgentEvent) { log.push(e); } },
        workspace: "/tmp",
        userMessage: "w",
        maxSteps: opts.cap,
        tools: { read_file: { name: "read_file", async run() { return { ok: true, output: "A" }; } } },
      });
    } catch (err) { threw = (err as Error).message; }
    return { round, threw, errors: log.filter((e) => e.type === "error").length };
  }

  it("撞帽那一拍同时被截断 ⇒ 撞帽照旧抛（续跑不许给撞帽多留一条命）", async () => {
    const r = await run({ lastStep: "truncate", cap: 3 });
    expect(r.round, "续跑越过 maxSteps = 步数帽在这条路上失效").toBeLessThanOrEqual(3);
    expect(r.threw).toContain("maxSteps");
    expect(r.errors, "撞帽必须落 error 事件（终态可见）").toBe(1);
  });

  it("纯撞帽（没有截断）同样是 throw + error，两路口径一致", async () => {
    const r = await run({ lastStep: "tools", cap: 3 });
    expect(r.threw).toContain("maxSteps");
    expect(r.errors).toBe(1);
  });

  // 诚实标注（2026-10-23，两条变异实测）：这两条**不**能分辨「续跑把撞帽吞掉」那类改法——
  // 撞帽只在 `step === maxSteps - 1` 设置，而那一刻无论 `continue` 还是 `return` 都到循环末尾，
  // 之后都落回同一句 throw。我试过两台变异（清 capReached / 截断那拍直接 return 吞掉帽），
  // **两台都存活**。保留这两条是因为它们钉的是**行为口径**（撞帽必抛 + 必落 error），
  // 不假装它们能分辨那个不存在的顺序差。真要分辨得先让撞帽能在非末步发生（那是另一处改动）。
});
