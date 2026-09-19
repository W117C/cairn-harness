import { readFile } from "node:fs/promises";
import type { ModelOutput } from "../providers";
import { streamGlm, type GlmMessage, type GlmToolSpec } from "../providers/glm";

// ---- worker 模型口（可注入：fixture 脚本明卷 / GLM 暗卷） ----

export type WorkerModel = ((messages: GlmMessage[], tools: GlmToolSpec[]) => AsyncIterable<ModelOutput>) & {
  /** W3②：「这一路不拨号、不付钱」的自述标记。只有 `scriptedWorkerModel` 打它——
   *  编排器的价格标签据此缺席（demo/checks 的冻结剧本若也报 $x，就是拿 0 用量冒充实付）。 */
  scripted?: true;
};

/** 缺省 worker 模型：GLM 会话型（模型侧自持上下文口径与 sidechat/M2c-2 一致）。 */
export const defaultWorkerModel: WorkerModel = (messages, tools) => streamGlm(messages, {}, tools);

/** 脚本化 worker 模型（明卷）：按序吐出，跑完即停；capture 收集每轮真实上下文（canary 验收用）。 */
export function scriptedWorkerModel(script: ModelOutput[], capture?: GlmMessage[][]): WorkerModel {
  let cursor = 0;
  const model: WorkerModel = async function* (messages) {
    capture?.push(messages);
    while (cursor < script.length) yield script[cursor++] as ModelOutput;
  };
  model.scripted = true;
  return model;
}

/** 是否「冻结剧本回放」——注入模型面（modelFor）与真实 provider 的唯一区分点。
 *  收在函数里而不是让调用方各写一次 cast：`RegistryWorkerModel` 与 `WorkerModel` 是两个类型，
 *  在 union 上直接取 `.scripted` 编译不过，写 cast 的那两处以后会各漂一份。 */
export function isScriptedModel(model: unknown): boolean {
  return typeof model === "function" && (model as WorkerModel).scripted === true;
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
