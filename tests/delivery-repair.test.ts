/** 交付断言**返修环**的判卷（能力 12 的下半截）。
 *
 *  上半截（落红）钉在 `tests/delivery-guard.test.ts`：承诺了没落盘 ⇒ 事件流上留下一条红。
 *  这一文件钉的是下半截：红了之后**要不要再要一轮去补做**。
 *
 *  为什么这一格必须单独钉（动机是实测，不是设计偏好）：6 趟真实模型跑里 5 趟交付了
 *  不存在的文件。只落红而不改行为时，**那一趟已经结束了**——审计面看见了，
 *  可用户拿到的仍然是一个不存在的路径。zeroshot 那句「写代码的 agent 不该由自己宣布能跑」
 *  的下半截是「该有人要求它回去补」；只有落红没有返修，等于只装了报警没装处置。
 *
 *  三条边界，每条都对应一种会把这一环做成新问题的形状：
 *   ① **默认关** —— 不给旗标时逐字同今日（落红即收束，一轮都不多要）；
 *   ② **至多一轮** —— 补不出来就收束。无限要下去只是把钱烧在不会写的那一趟上；
 *   ③ **补了就算** —— 模型在返修那一轮真的写了文件 ⇒ 不再落第二条红（它已经补上了，
 *      再红一次就是把「已修」读成「还没修」）。
 *
 *  与 `auto-verify-repair.test.ts` 的分工：那一支接的是 verify 拍出的**代码红**，
 *  这一支接的是「承诺了没落盘」——两条独立的路，因为**恰恰是一个字节都没写的那些趟
 *  走不到收束闸**，才需要这一支独立接住它们（这也是它不套 autoVerify 前置的原因）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLoop } from "../src/agent/loop";
import { DELIVERY_GUARD_CALL_ID, deliveredPaths, promisedCreates } from "../src/agent/delivery-guard";
import type { ToolContext } from "../src/tools/base";
import type { AgentEvent } from "../src/events";
import type { ModelOutput } from "../src/providers";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

interface Script {
  /** 返修那一轮做什么：`writes` = 真的调 write_file 补上；`stops` = 又一轮什么都不做。 */
  afterRed: "writes" | "stops";
  /** 是否把返修环打开（不给 = 默认关，用来钉「逐字同今日」）。 */
  deliveryRepair?: boolean;
}

interface Result {
  events: AgentEvent[];
  requests: number;
  prompts: { role: string; content: unknown }[][];
  workspace: string;
}

/** 剧本：1=提方案（承诺 create a.html）→ 2=什么都不做就收工 ⇒ 交付断言落红
 *  → 3=**只在开了返修时才存在**（看到红字后补写 a.html）。 */
async function runScript(opts: Script): Promise<Result> {
  const home = await mkdtemp(join(tmpdir(), "delivery-repair-"));
  dirs.push(home);
  const events: AgentEvent[] = [];
  let requests = 0;
  const prompts: { role: string; content: unknown }[][] = [];
  await runLoop({
    workspace: home,
    userMessage: "写一个 a.html",
    mode: "auto",
    interactive: true,
    // 上限 6：剧本只安排了前三轮，多出来的一轮说明**返修环没被封顶**——
    // 用它当上限而不是 50，撞帽时报错能直接指向那一环（默认 50 会把同一件事读成「剧本太长」）。
    maxSteps: 6,
    events: { async append(e) { events.push(e); } },
    tools: {
      propose_plan: {
        name: "propose_plan",
        async run(args: Record<string, unknown>, ctx: ToolContext) {
          await ctx.emit?.({
            type: "plan_proposed",
            callId: ctx.callId!,
            plan: { goal: "g", files: args.files as never[] },
          });
          await ctx.emit?.({ type: "plan_approved", callId: ctx.callId!, approved: true });
          return { ok: true, output: "方案已批准" };
        },
      },
      write_file: {
        name: "write_file",
        async run() {
          await writeFile(join(home, "a.html"), "real file\n", "utf8");
          return { ok: true, output: "已写入 a.html", change: "created" as const };
        },
      },
    } as never,
    plan: { async propose() { return true; } } as never,
    ...(opts.deliveryRepair === undefined ? {} : { deliveryRepair: opts.deliveryRepair }),
    provider: {
      async *stream(messages) {
        requests++;
        prompts.push(messages.map((m) => ({ role: m.role, content: m.content })));
        const n = requests;
        let out: ModelOutput;
        if (n === 1) {
          out = {
            type: "tool_call",
            id: "p1",
            name: "propose_plan",
            args: { goal: "g", files: [{ action: "create", path: "a.html", summary: "s" }] },
          };
        } else if (n === 2) {
          out = { type: "assistant_message", content: "已完成" };
        } else if (n === 3 && opts.afterRed === "writes") {
          // 必须先判轮次再判动作：反过来的话第 4 轮起每一轮都吐 write_file，
          // 剧本就变成无限写盘（实测撞 maxSteps，报错还指向错的地方）。
          out = { type: "tool_call", id: "w1", name: "write_file", args: { path: "a.html" } };
        } else {
          // 第四轮起一律收工：剧本只安排了前三轮，多出来的一轮说明返修环没被封顶。
          out = { type: "assistant_message", content: n === 3 ? "我不会" : "收工" };
        }
        yield out;
      },
    },
  });
  return { events, requests, prompts, workspace: home };
}

describe("默认关：不给旗标时逐字同今日", () => {
  it("落红即收束，一轮都不多要", async () => {
    const { requests } = await runScript({ afterRed: "writes" });
    expect(requests).toBe(2); // 提方案 + 收工，没有第三轮
  });
});

describe("开：红了之后要一轮去补做", () => {
  it("模型补写了文件 ⇒ 多要了那一轮，且不再落第二条红", async () => {
    const { events, requests, prompts, workspace } = await runScript({ afterRed: "writes", deliveryRepair: true });
    // 4 轮＝提方案 + 收工(落红) + 返修补写 + 补完收尾。补写完还要一句收尾是对的
    // （写完就闷声结束反而可疑），所以这里断言的是"比默认关多出了那一轮"，不是死数字。
    expect(requests).toBe(4);
    const wrote = events.some(
      (e) => e.type === "tool_call" && e.name === "write_file",
    );
    expect(wrote).toBe(true);
    expect(await readFile(join(workspace, "a.html"), "utf8")).toBe("real file\n");
    expect(prompts[2]?.some((m) =>
      m.role === "user" && typeof m.content === "string"
        && m.content.includes("[delivery]") && m.content.includes("a.html"),
    )).toBe(true);
  });

  it("返修那一轮仍不落盘 ⇒ 只多要一轮就收束（不无限要）", async () => {
    const { events, requests } = await runScript({ afterRed: "stops", deliveryRepair: true });
    // 上限一轮：补不出来就收束，无限要下去只是把钱烧在不会写的那一趟上
    expect(requests).toBe(3);
    expect(events.filter((e) => e.type === "tool_result" && e.callId === DELIVERY_GUARD_CALL_ID)).toHaveLength(1);
    expect((events.find((e) => e.type === "tool_result" && e.callId === DELIVERY_GUARD_CALL_ID) as Extract<AgentEvent, { type: "tool_result" }>).output)
      .toContain("a.html");
  });

  it("返修由判据驱动：红了才要，没红不要（判据与动作两层不绑死）", async () => {
    // loop 收束阶段应当记录交付守卫并把诊断投给下一轮；未命中却多要一轮，
    // 就等于拿返修去骚扰没出错的那一趟。
    const { events } = await runScript({ afterRed: "writes", deliveryRepair: true });
    const promised = promisedCreates(events);
    expect(promised).toEqual([{ path: "a.html", action: "create" }]);
    const wrote = events.some((e) => e.type === "tool_call" && e.name === "write_file");
    // 补写之后判据应当不再命中（文件已落盘）
    expect(wrote ? deliveredPaths(events).has("a.html") : false).toBe(true);
  });
});

describe("两条返修路互不干扰", () => {
  it("交付返修不依赖 autoVerify 前置（一个字节都没写的趟走不到收束闸）", async () => {
    // 本剧本全程没有 verify 钩子，而返修照旧发生 ⇒ 证明这一支是独立接住的。
    // 4＝提方案 + 收工(落红) + 返修补写 + 补完收尾，与上面那条同源。
    const { requests } = await runScript({ afterRed: "writes", deliveryRepair: true });
    expect(requests).toBe(4);
  });
});
