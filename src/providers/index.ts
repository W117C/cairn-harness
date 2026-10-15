import type { AssistantDeltaEvent, AssistantMessageEvent, ThinkingDeltaEvent, ToolCallEvent, TurnStopMissingEvent, TurnTruncatedEvent, UsageEvent } from "../events";

/** 模型单步输出：说话、逐字流式增量，或发起工具调用（+ usage 计量 + 非正常收尾的证据）。
 *  turn_truncated 只在被输出预算/内容策略收走时出现，正常收尾零新事件。 */
export type ModelOutput =
  | AssistantMessageEvent
  | AssistantDeltaEvent
  | ThinkingDeltaEvent
  | ToolCallEvent
  | UsageEvent
  | TurnTruncatedEvent
  | TurnStopMissingEvent;

/** 统一消息格式（中立交换形态；各适配器各自映射成自家协议的 wire 格式）。
 *  结构与 src/agent/context.ts 的 ContextMessage 投影产物一致 + system 角色，
 *  projectContext 产物可直接作为 messages 传入。 */
export interface ProviderMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  /** 多模态图片块（识图）。**缺席 = 这条消息没有图片**（绝大多数消息）⇒ 缺省零行为：
   *  纯文本消息在每一处 wire 映射里都逐字保持 `content: "..."` 原形状。
   *
   *  为什么直接放在 `ProviderMessage` 上而不是另立一个 `ProviderMessageWithImage`：
   *  会话组装处（`composeTurnMessages`）要往一个 `GlmMessage[]` 里同时推文本消息和带图消息，
   *  联合类型会让每一次 push 都要判类型。带图本就是「同一条消息多带一个字段」，
   *  让它可选即可——读它的人（wire 映射）自己判空。 */
  contentParts?: readonly ProviderContentImage[];
}

/** 多模态内容块（识图能力的唯一入口）。
 *
 *  为什么另立一个类型而不把 `content` 直接放宽成数组：`content: string | null` 是**四个适配器
 *  共读的形状**，把它放宽会让每一处 `m.content` 都变成一个需要判空的联合——而绝大多数消息
 *  仍然只有文本。带 image 的消息是新形状，让它在类型上就显式。
 *
 *  `image` 只收 data URL（`data:image/png;base64,...`），不收 http(s) URL：外链图片要过
 *  SSRF 闸才进得去请求体（`web_fetch` 的 `assertPublicUrl` 那一套），而 adapter 层不做网络
 *  判定。data URL 则天然只含 base64 字节，没有第二次出网。 */
export interface ProviderContentImage {
  type: "image";
  /** data URL（`data:image/png;base64,...`）。 */
  dataUrl: string;
}

/** 带图片的消息体：文本仍在 `content`（图片之外的话照常说），图片块进 `contentParts`。
 *  两者可同存（「你看这张图，顺便说明这三行」是识图最常见的用法）。 */
export type ProviderMessageWithImage = ProviderMessage;

/** 统一工具规格（中立）；openai 包成 {type:"function",function:{...}}、
 *  anthropic 映射 {name,description,input_schema}、gemini 映射 functionDeclarations。 */
export interface ProviderToolSpec {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

/** 单轮调用参数（C12，审查 P2）：取消信号——中止时在途 fetch/流读取随 signal 收束，
 *  取消不再只在轮界生效（在途请求至多等 60s 静默窗）。 */
export interface ProviderCall {
  signal?: AbortSignal;
}

/** 统一接口（§3.3）：一次 stream 调用 = 一轮模型输出的事件流。
 *  适配器无状态：按传入对话与工具规格发起该轮请求，把协议原生增量解析成事件逐条产出。 */
export interface Provider {
  stream(messages: ProviderMessage[], tools?: ProviderToolSpec[], call?: ProviderCall): AsyncIterable<ModelOutput>;
}

/** 旧 next() 形态（M1a 定稿）；冻结脚本注入的 scripted provider 仍是它，loop 做兼容分支。 */
export interface LegacyNextProvider {
  next(): Promise<ModelOutput | null>;
}

/** 把旧 next() 事件源包装成流式事件源：逐条拉取、惰性产出（含工具调用即断轮，
 *  与旧 loop「拉一条→执行→再拉」的日志顺序逐字节一致）。 */
export function streamFromNextSource(src: LegacyNextProvider): Provider["stream"] {
  let exhausted = false;
  return async function* (_messages, _tools) {
    if (exhausted) return;
    const batch: ModelOutput[] = [];
    for (;;) {
      const event = await src.next();
      if (!event) {
        exhausted = true;
        break;
      }
      batch.push(event);
      if (event.type === "tool_call") break; // 轮断点：工具执行发生在消费侧逐事件处理中
    }
    yield* batch;
  };
}
