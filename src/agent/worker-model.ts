import { readFile } from "node:fs/promises";
import type { ModelOutput } from "../providers";
import { streamGlm, type GlmMessage, type GlmToolSpec } from "../providers/glm";

// ---- worker 模型口（可注入：fixture 脚本明卷 / GLM 暗卷） ----

export type WorkerModel = (messages: GlmMessage[], tools: GlmToolSpec[]) => AsyncIterable<ModelOutput>;

/** 缺省 worker 模型：GLM 会话型（模型侧自持上下文口径与 sidechat/M2c-2 一致）。 */
export const defaultWorkerModel: WorkerModel = (messages, tools) => streamGlm(messages, {}, tools);

/** 脚本化 worker 模型（明卷）：按序吐出，跑完即停；capture 收集每轮真实上下文（canary 验收用）。 */
export function scriptedWorkerModel(script: ModelOutput[], capture?: GlmMessage[][]): WorkerModel {
  let cursor = 0;
  return async function* (messages) {
    capture?.push(messages);
    while (cursor < script.length) yield script[cursor++] as ModelOutput;
  };
}

/** 从 fixture JSONL 加载 worker 剧本（fixtures/agents/**，惰性单次读盘）。 */
export async function loadWorkerScript(fixturePath: string): Promise<ModelOutput[]> {
  const raw = await readFile(fixturePath, "utf8");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as ModelOutput);
}

/** 取消异常（provider/pipeline 在信号中止时抛出；runWorker 边界捕获后分类为 cancelled）。 */
export class WorkerCancelled extends Error {
  constructor() {
    super("worker cancelled");
    this.name = "WorkerCancelled";
  }
}
