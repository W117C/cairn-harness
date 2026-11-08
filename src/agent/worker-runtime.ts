// worker 会话型 provider / 压缩运行时（B9 增量投影）。
//
// 从 orchestrator.ts 拆出：模块只依赖 worker 的内存事件数组与注入的 system/tools/model，
// 不反向依赖编排器。公开面仍由 orchestrator.ts 按原路径 re-export。
import type { AgentEvent } from "../events";
import type { ModelOutput, Provider } from "../providers";
import type { GlmMessage, GlmToolSpec } from "../providers/glm";
import { createContextProjector, type ContextMessage, type ContextProjector } from "./context";
import {
  calibrateFactor,
  estimateContextTokens,
  runCompaction,
  shouldCompact,
  type CompactionConfig,
  type Summarizer,
} from "./compaction";
import { WorkerCancelled, defaultWorkerModel, type WorkerModel } from "./worker-model";
import { workerToolSpecs } from "./worker-shell-tools";

/** worker 会话型 provider：忽略 loop 传入 messages，每轮从 worker 内存态事件现拼上下文（sidechat 同构）。
 *  M3c：worker 压缩（§7.5）挂在每轮组装前——超阈值走同一 runCompaction 链路（零第二套摘要实现），
 *  compaction 事件进 worker 内存态（投影生效）+ 落主流（agent_id 归因）+ 摘要 usage 计入该 worker。 */
export interface WorkerCompactionRuntime {
  agentId: string;
  config: CompactionConfig;
  summarizer?: Summarizer;
  toolsSchemaChars: number;
  /** 压缩事件落流口（主流 emit；agent_id 已在事件上）。 */
  onCompaction: (e: AgentEvent) => Promise<void>;
  /** 摘要调用 usage 归因（§7.5 计入 usage(agent_id)，§4.4.10 不破例）。 */
  onUsage: (u: { inputTokens: number; outputTokens: number }) => void;
}

export function createWorkerProvider(opts: {
  readEvents: () => AgentEvent[];
  system: GlmMessage[];
  model?: WorkerModel;
  tools?: GlmToolSpec[];
  signal?: AbortSignal;
  /** M3c：worker 压缩运行时（缺省 undefined = 不压缩——既有路径字节不变）。 */
  compaction?: WorkerCompactionRuntime;
}): Provider {
  const tools = opts.tools ?? workerToolSpecs();
  // B9：同一 worker 的内存事件数组跨轮复用一台折叠器。只有 append-only 窗口可以增量 push；
  // compaction / verify_result / 任务声明 / 回退等改写投影元数据的事件一到，就弃缓存全量重投影。
  let cachedProjector: ContextProjector | null = null;
  return {
    stream(): AsyncIterable<ModelOutput> {
      return runOneRound();
    },
  };
  async function* runOneRound(): AsyncGenerator<ModelOutput> {
    if (opts.signal?.aborted) throw new WorkerCancelled();
    const events = opts.readEvents();
    const factor = calibrateFactor(events);
    let projector = cachedProjector;
    if (projector === null || projector.invalidation(events) !== null) {
      projector = createContextProjector(events);
      cachedProjector = projector;
    } else {
      for (let i = projector.count; i < events.length; i++) projector.push(i);
    }
    let projected: ContextMessage[] = projector.finalize();
    if (opts.compaction) {
      const compacted = await maybeCompactWorkerEvents(opts.compaction, events, projected, factor, opts.system);
      if (compacted) {
        // 压缩事件已推入同一份 events：它改写排除集与摘要注入位，旧折叠器即刻作废。
        projector = createContextProjector(opts.readEvents());
        cachedProjector = projector;
        projected = projector.finalize();
      }
    }
    const msgs: GlmMessage[] = [...opts.system, ...(projected as GlmMessage[])];
    const model = opts.model ?? defaultWorkerModel;
    // 取消信号必须进到适配器：只在生成前/后检查 aborted 只能拦住「还没开始」的调用，
    // 正在等上游 SSE 的那一轮仍会占着连接与 token，cancelAgent 看起来成功了、实际没停。
    yield* model(msgs, tools, opts.signal === undefined ? undefined : { call: { signal: opts.signal } });
    if (opts.signal?.aborted) throw new WorkerCancelled();
  }
}

/** worker 子流压缩（§7.5）：估算（system+工具 schema 全量计入）→ shouldCompact → runCompaction。
 *  成功：compaction 事件（agent_id 归因）进 worker 内存态 + 落主流；摘要 usage 追加 usage(agent_id) 事件。
 *  B9：投影由调用方传入（每轮一次）；返回是否发生了压缩（调用方据此重投影）。 */
async function maybeCompactWorkerEvents(
  c: WorkerCompactionRuntime,
  events: AgentEvent[],
  projected: ContextMessage[],
  factor: number,
  system: GlmMessage[],
): Promise<boolean> {
  const systemChars = system.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  const estimate = estimateContextTokens(projected, { systemChars, toolSchemaChars: c.toolsSchemaChars }, factor);
  const decision = shouldCompact(estimate, c.config);
  if (!decision) return false;
  const outcome = await runCompaction({
    events,
    trigger: decision.trigger,
    reason: decision.reason,
    ...(decision.trigger !== "overflow" && c.summarizer ? { summarizer: c.summarizer } : {}),
    config: c.config,
  });
  if (!outcome.ok) return false; // 压缩失败不阻断 worker（下一轮重判；overflow 兜底仍在）
  // worker 内存态推入**不带 agent_id** 的压缩事件（worker 投影生效，keep_first=task+context 由
  // system 块结构性保障）；落主流时才加 agent_id 归因（主投影按 agent_id 跳过 worker 压缩事件，
  // 其 compressed_event_ids 是 worker 内存态序号，对主流照搬会错误摘除主事件——context.isWorkerCompaction）。
  events.push(outcome.event);
  await c.onCompaction({ ...outcome.event, agent_id: c.agentId } as AgentEvent);
  if (outcome.event.usage) {
    c.onUsage(outcome.event.usage);
    await c.onCompaction({
      type: "usage",
      inputTokens: outcome.event.usage.inputTokens,
      outputTokens: outcome.event.usage.outputTokens,
      agent_id: c.agentId,
    } as AgentEvent);
  }
  return true;
}
