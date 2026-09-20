import { readFile } from "node:fs/promises";
import type { AgentEvent } from "../events";
import type { ModelOutput, Provider } from "./index.js";

// 演示通道：M0A_MOCK_DELTA=1 时把剧本里的 assistant_message 拆成 assistant_delta 逐段吐出，
// 走与真流式完全相同的 delta 事件管线（合并→上屏）。默认关闭，M0 事件流逐字节不变。
const DELTA_MODE = process.env.M0A_MOCK_DELTA === "1";
const DELTA_CHUNK = 4; // 每段字符数（按码点切，避免劈开代理对）
const DELTA_PACE_MS = 120; // 演示节奏：人眼可见的逐字上屏

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 从 fixture JSONL 预录序列创建 mock provider（统一流式接口）：
// 按序惰性吐出预录的 assistant_message / tool_call / usage（for-await 拉取与工具执行交错，与旧
// next() 逐条拉取的日志顺序逐字节一致），序列跑完即停（之后 stream 产出为空 = 任务结束）。
// 为什么 `usage` 也在允许之列：它是真 provider 每轮都会发的输出（loop 直接落进事件流），
// 剧本不许它就是让所有「花钱口径」的判据只能靠手工注入事件——而「按手注入」测不到生产那一跳。
// 其余类型（tool_result / user_message …）仍一律拒收：那是运行时产物，不是模型输出。
export function createMockProvider(fixturePath: string): Provider {
  let script: ModelOutput[] | null = null;
  let cursor = 0;

  async function load(): Promise<void> {
    if (script) return;
    const raw = await readFile(fixturePath, "utf8");
    const parsed = raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as AgentEvent);
    const out: ModelOutput[] = [];
    let turn = 0;
    for (const e of parsed) {
      if (e.type === "assistant_message") {
        if (DELTA_MODE) {
          const chars = Array.from(e.content);
          for (let i = 0; i < chars.length; i += DELTA_CHUNK) {
            out.push({ type: "assistant_delta", callId: `mock-a${String(turn)}`, text: chars.slice(i, i + DELTA_CHUNK).join("") });
          }
        } else {
          out.push(e);
        }
        turn++;
      } else if (e.type === "tool_call" || e.type === "usage") {
        out.push(e);
      } else {
        throw new Error(`mock fixture 只允许 assistant_message/tool_call/usage，读到: ${JSON.stringify(e)}`);
      }
    }
    script = out;
  }

  return {
    async *stream() {
      await load();
      while (cursor < script!.length) {
        const event = script![cursor++];
        if (event && DELTA_MODE && event.type === "assistant_delta") await sleep(DELTA_PACE_MS);
        yield event;
      }
      // 序列跑完即停：之后 stream() 产出为空
    },
  };
}
