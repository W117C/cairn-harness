import type { AssistantMessageEvent, ToolCallEvent } from "../events";

/** 模型单步输出：要么说话，要么发起工具调用。 */
export type ModelOutput = AssistantMessageEvent | ToolCallEvent;

/** 模型端抽象：agent loop 每轮向它要下一条输出；序列耗尽返回 null 表示任务结束。 */
export interface Provider {
  next(): Promise<ModelOutput | null>;
}
