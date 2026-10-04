/**
 * 只读探针（人机协作那一格 · 可中断）。
 *
 * 不写盘、不起服务、不读凭据、不调模型：只在内存里喂 runLoop 一份脚本化 provider，
 * 观察「取消信号落在哪」与「落下来的事件流里有没有取消的痕迹」。
 *
 * 跑法：node --import tsx "outputs/handoff-face-2026-10-05/probe-interrupt.ts"
 */
import { runLoop } from "../../src/agent/loop";
import type { ModelOutput } from "../../src/providers";
import type { AgentEvent, ToolResultEvent } from "../../src/events";
import type { Tool } from "../../src/tools";

type Probe = { events: AgentEvent[]; threw: unknown | null };

/** 一份只进内存的事件汇（不落盘）。 */
const sink = (out: AgentEvent[]) => ({ append: async (e: AgentEvent) => { out.push(e); } });

/** provider：turn 序列里每一项是该轮要产出的事件；空数组 = 该轮无输出。 */
const scripted = (turns: ModelOutput[][]) => {
  let i = 0;
  return {
    async *stream() {
      const t = turns[i] ?? [];
      i += 1;
      for (const o of t) yield o;
    },
  };
};

async function run(turns: ModelOutput[][], signal?: AbortSignal, tools?: Record<string, Tool>): Promise<Probe> {
  const events: AgentEvent[] = [];
  let threw: unknown | null = null;
  try {
    await runLoop({
      workspace: process.cwd(),
      // 与生产主会话同档（agent-runner 冻结成 auto）。
      mode: "auto",
      interactive: true,
      userMessage: "探针：这条不是人话，是脚本喂的",
      provider: scripted(turns),
      events: sink(events),
      signal,
      ...(tools ? { tools } : {}),
      maxSteps: 5,
    } as never);
  } catch (err) {
    threw = err;
  }
  return { events, threw };
}

const say = (text: string): ModelOutput => ({ type: "assistant_message", content: text });
const call = (id: string, name: string): ModelOutput => ({ type: "tool_call", id, name, args: {} });

function summarize(events: AgentEvent[]): string {
  return events.map((e) => e.type).join(" → ");
}

const cancelTrace = (events: AgentEvent[]): boolean[] =>
  events.map((e) => e.type === "error" || (e.type === "tool_result" && /取消|中止|cancel/i.test((e as ToolResultEvent).output)));

async function main(): Promise<void> {
  const lines: string[] = [];
  const push = (s: string): void => { lines.push(s); };

  // A. 信号在起跑前就已 abort（第二轮/轮界取消的最简形状）
  {
    const c = new AbortController();
    c.abort();
    const r = await run([[say("不该被调用")]], c.signal);
    push(`A 轮界前已取消：threw=${r.threw === null ? "null（正常收束，不上抛）" : String(r.threw)}`);
    push(`  事件流=[${summarize(r.events)}]`);
    push(`  其中带「取消/中止/cancel」字样的事件数=${cancelTrace(r.events).filter(Boolean).length}`);
  }

  // B. 第 1 轮说完后取消 → 第 2 轮轮界收束
  {
    const c = new AbortController();
    const events: AgentEvent[] = [];
    let threw: unknown | null = null;
    try {
      await runLoop({
        workspace: process.cwd(),
        mode: "auto",
        interactive: true,
        userMessage: "探针 B",
        provider: scripted([[say("第一轮"), say("第一轮续")], [say("第二轮不该出现")]]),
        events: {
          append: async (e: AgentEvent) => {
            events.push(e);
            // 第一条 assistant_message 落盘即按停止
            if (e.type === "assistant_message" && !c.signal.aborted) c.abort();
          },
        },
        signal: c.signal,
        maxSteps: 5,
      } as never);
    } catch (err) {
      threw = err;
    }
    push(`B 轮界取消：threw=${threw === null ? "null（正常收束）" : String(threw)}`);
    push(`  事件流=[${summarize(events)}]`);
    push(`  「这一轮被取消」的结构化痕迹=${events.some((e) => e.type === "error") ? "有 error" : "无"}；散文痕迹=${cancelTrace(events).filter(Boolean).length}`);
  }

  // C. 工具执行中取消：工具自己 abort 再返回成功 → loop 是否打断这一轮
  {
    const c = new AbortController();
    const probeTool: Tool = {
      name: "read_file",
      async run() {
        c.abort(); // 模拟长驻工具跑到一半用户按停止
        return { ok: true, output: "探针：工具已落盘的那一份改动（模拟写成功）" };
      },
    };
    const r = await run(
      [[call("c1", "read_file")], [say("第二轮不该出现")]],
      c.signal,
      { read_file: probeTool },
    );
    push(`C 工具执行中取消：threw=${r.threw === null ? "null（loop 没被工具中断打断）" : String(r.threw)}`);
    push(`  事件流=[${summarize(r.events)}]`);
    const tr = r.events.find((e) => e.type === "tool_result") as ToolResultEvent | undefined;
    push(`  工具回执 ok=${String(tr?.ok)}｜blockedBy=${String(tr?.blockedBy)}｜gate=${String(tr?.gate === undefined ? "缺席" : tr.gate.layer + "/" + tr.gate.verdict)}`);
    push(`  取消后有没有「这条改动是被取消的那一轮写的」的任何标注=${tr === undefined ? "无回执" : Object.keys(tr).join(",")}`);
  }

  // D. 对照：provider 抛非取消错误时的留痕（说明「取消」这一支是刻意不落 error 的）
  {
    const events: AgentEvent[] = [];
    let threw: unknown | null = null;
    try {
      await runLoop({
        workspace: process.cwd(),
        mode: "auto",
        interactive: true,
        userMessage: "探针 D",
        provider: { async *stream() { throw new Error("boom：非取消错误"); } },
        events: sink(events),
        maxSteps: 2,
      } as never);
    } catch (err) {
      threw = err;
    }
    push(`D 非取消异常：threw=${threw === null ? "null" : "上抛（调用方拿 ok:false 返回值）"}`);
    push(`  事件流=[${summarize(events)}]｜含 error=${events.some((e) => e.type === "error")}`);
  }

  process.stdout.write(lines.join("\n") + "\n");
}

main().catch((err) => {
  process.stderr.write("探针自身失败: " + String(err) + "\n");
  process.exitCode = 1;
});
