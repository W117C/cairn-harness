// 暗卷用会话型 provider：src/providers 只读（M1a 定稿），本文件只调用 streamGlm 不改它。
// 职责：从事件日志重建 OpenAI 兼容对话历史（含 tool_calls / tool 角色），把工具结果反馈回模型，
// 使真实 GLM 能多轮调用 clarify / propose_plan / write_file / verify。
import { createEventLog, replay, type AgentEvent, type CompactionUsage } from "../events";
import { isSideEffectTool, type PermissionMode } from "../permissions";
import { streamGlm, type GlmMessage, type GlmToolSpec } from "../providers/glm";
import type { ModelOutput, Provider } from "../providers";
import { projectContext } from "./context";
import { computePrune } from "./prune";
import { createMapBuilder, type MapBuilder } from "./map/build";
import {
  DEFAULT_COMPACTION_CONFIG,
  CompactionCoordinator,
  calibrateFactor,
  estimateContextTokens,
  shouldCompact,
  type AssemblyOverhead,
  type CompactionConfig,
  type Summarizer,
  type SummarizerInput,
  type SummarizerOutput,
} from "./compaction";

type RawMessage = Record<string, unknown>;

/** 三门 + 基础工具的 OpenAI function 规格（暗卷把工具面暴露给真实模型）。
 * M1c：mode=read-only 时写向工具从工具表摘除（§11.7.2，与 toolTableFor 同源）。 */
export function gateToolSpecs(mode?: PermissionMode): GlmToolSpec[] {
  const obj = (props: Record<string, unknown>, required: string[]): Record<string, unknown> => ({
    type: "object",
    properties: props,
    required,
  });
  const specs: GlmToolSpec[] = [
    {
      type: "function",
      function: {
        name: "read_file",
        description:
          "读取工作区内文件（workspace 相对路径）；支持 offset/limit（1-based 行号）；目录路径列出条目；二进制文件拒读",
        parameters: obj(
          {
            path: { type: "string", description: "workspace 相对路径" },
            offset: { type: "number", description: "起始行（1-based，缺省 1）" },
            limit: { type: "number", description: "最多读取行数（缺省 2000）" },
          },
          ["path"],
        ),
      },
    },
    {
      type: "function",
      function: {
        name: "grep",
        description: "工作区内容搜索（ripgrep 正则）；按文件分组返回，上限 100 命中",
        parameters: obj(
          {
            pattern: { type: "string", description: "正则表达式" },
            path: { type: "string", description: "限定目录或文件（workspace 相对，缺省全工作区）" },
          },
          ["pattern"],
        ),
      },
    },
    {
      type: "function",
      function: {
        name: "glob",
        description: "按 glob 模式列文件（尊重 .gitignore，排除 .git/node_modules/dist，上限 100）",
        parameters: obj(
          {
            pattern: { type: "string", description: "glob 模式（如 src/**/*.ts，缺省 **/*）" },
            path: { type: "string", description: "限定目录（workspace 相对，缺省全工作区）" },
          },
          [],
        ),
      },
    },
    {
      type: "function",
      function: {
        name: "edit_file",
        description:
          "精确字符串替换编辑；old_string 必须唯一匹配（多处匹配报错并给出处数），确要全部替换加 replace_all: true",
        parameters: obj(
          {
            path: { type: "string" },
            old_string: { type: "string", description: "要被替换的原文（必须唯一）" },
            new_string: { type: "string", description: "替换后的新文本" },
            replace_all: { type: "boolean", description: "全部替换（缺省 false）" },
          },
          ["path", "old_string", "new_string"],
        ),
      },
    },
    {
      type: "function",
      function: {
        name: "write_file",
        description: "写入工作区内文件（覆盖式）",
        parameters: obj(
          { path: { type: "string" }, content: { type: "string" } },
          ["path", "content"],
        ),
      },
    },
    {
      type: "function",
      function: {
        name: "run_shell",
        description: "在工作区内执行 bash 命令",
        parameters: obj({ command: { type: "string" } }, ["command"]),
      },
    },
    {
      type: "function",
      function: {
        name: "clarify",
        description: "任务有歧义时向用户提问；1–4 个问题，每问 2–4 个选项或缺省自由补充",
        parameters: obj(
          {
            questions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  question: { type: "string" },
                  header: { type: "string" },
                  multiSelect: { type: "boolean" },
                  options: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { label: { type: "string" }, description: { type: "string" } },
                      required: ["label"],
                    },
                  },
                },
                required: ["question"],
              },
            },
          },
          ["questions"],
        ),
      },
    },
    {
      type: "function",
      function: {
        name: "propose_plan",
        description: "写文件前提交方案等用户批准；批准前 write_file/run_shell 会被权限层拒绝",
        parameters: obj(
          {
            goal: { type: "string" },
            files: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  action: { type: "string", enum: ["create", "edit", "delete"] },
                  summary: { type: "string" },
                },
                required: ["path", "action", "summary"],
              },
            },
            approach: { type: "string" },
            verify: {
              type: "object",
              properties: {
                lint: { type: "array", items: { type: "string" } },
                test: { type: "array", items: { type: "string" } },
              },
            },
          },
          ["goal", "files"],
        ),
      },
    },
    {
      type: "function",
      function: {
        name: "verify",
        description: "按仓库 verify 配置跑 lint/test；通过则任务收束，失败会反馈错误继续修",
        parameters: obj({}, []),
      },
    },
  ];
  if (mode === "read-only") {
    return specs.filter((s) => !isSideEffectTool(s.function.name));
  }
  return specs;
}

/** 事件日志 → OpenAI 兼容消息序列。
 *  M1d：改走组装器投影 projectContext——compaction 感知（跳过被压 id、offset 注入摘要、fresh start），
 *  assistant_delta 合并与 tool 角色映射逻辑与旧版逐字同构。 */
export async function buildGlmHistory(logPath: string): Promise<RawMessage[]> {
  return projectContext(await replay(logPath)) as unknown as RawMessage[];
}

/** GLM 暗卷摘要器：非流式单轮调用（thinking/streaming 关），只调用只读的 src/providers/glm.ts。 */
export function createGlmSummarizer(): Summarizer {
  return async (input: SummarizerInput): Promise<SummarizerOutput> => {
    const msgs: GlmMessage[] = [
      { role: "system", content: input.system },
      {
        role: "user",
        content:
          (input.priorSummary ? "[上一份摘要（滚动合并输入）]\n" + input.priorSummary + "\n\n" : "") +
          "[压缩范围内的会话记录]\n" +
          input.conversation,
      },
    ];
    let text = "";
    let usage: CompactionUsage | undefined;
    for await (const e of streamGlm(msgs, { stream: false })) {
      if (e.type === "assistant_delta") text += e.text;
      else if (e.type === "usage") usage = { inputTokens: e.inputTokens, outputTokens: e.outputTokens };
    }
    if (!text.trim()) throw new Error("GLM 摘要器返回空摘要");
    return { text, usage, model: process.env.M0_MODEL ?? "glm-5.2" };
  };
}

export interface GlmSessionCompaction {
  config?: Partial<CompactionConfig>;
  /** 缺省 = M0_API_KEY 在场时用 GLM 暗卷摘要器。 */
  summarizer?: Summarizer;
  /** system prompt / 工具 schema / 记忆注入开销字符数（触发估算全量计入，§7.3(a)）。 */
  overhead?: AssemblyOverhead;
}

/** 会话型 provider：队列耗尽且上一轮含 tool_call 时重建历史再要下一轮；纯文本回复 = 任务结束。
 *  M1d：每次组装前做双条件触发检查——命中即压缩（compaction 事件落盘）再重组装（fresh start）。
 *  M2b：组装投影叠加 prune 类型化裁剪（§7.4，本地零 LLM）+ 符号地图注入（§6.4，指纹缓存；
 *  两者任一异常静默降级为无裁剪/无地图，绝不阻断 loop）。 */
export function createGlmSessionProvider(
  logPath: string,
  opts: {
    system?: string;
    tools?: GlmToolSpec[];
    compaction?: GlmSessionCompaction;
    /** M2b：符号地图构建器（缺省 = 自建一个；workspace 从 M2B_WORKSPACE env 或 process.cwd()）。 */
    mapBuilder?: MapBuilder;
    /** M2b：地图工作区（缺省 M2B_WORKSPACE env 或 process.cwd()）。 */
    workspace?: string;
    /** M2b：地图开关（缺省开；单测/暗卷可关）。 */
    map?: boolean;
  } = {},
): Provider {
  let queue: ModelOutput[] = [];
  let lastHadToolCalls: boolean | null = null; // null = 尚未请求过
  let round = 0; // 注入轮次（地图每 N 轮重算用）
  const coordinator = opts.compaction
    ? new CompactionCoordinator({
        config: opts.compaction.config,
        summarizer: opts.compaction.summarizer ?? (process.env.M0_API_KEY ? createGlmSummarizer() : undefined),
      })
    : null;
  const mapBuilder = opts.map === false ? null : opts.mapBuilder ?? createMapBuilder();
  const workspace = opts.workspace ?? process.env.M2B_WORKSPACE ?? process.cwd();
  const assemble = async (): Promise<{ events: AgentEvent[]; history: ReturnType<typeof projectContext> }> => {
    const events = await replay(logPath);
    // M2b prune：本地计算裁剪投影（异常静默 → 无裁剪）
    let replacements: Map<number, string> | undefined;
    try {
      const outcome = computePrune({ events });
      if (outcome.why === "saved" && outcome.replacements.size > 0) replacements = outcome.replacements;
    } catch (err) {
      console.debug("[prune] 计算失败，本轮跳过裁剪:", err instanceof Error ? err.message : String(err));
    }
    return { events, history: projectContext(events, replacements) };
  };
  // M2b 地图：上下文文件 = 最近 2 个 user_message 里提到的 workspace 相对路径 + 最近 read/edit 的文件
  const contextFilesFromEvents = (events: AgentEvent[]): string[] => {
    const out = new Set<string>();
    for (let i = events.length - 1; i >= 0 && out.size < 8; i--) {
      const e = events[i];
      if (e.type === "tool_call" && (e.name === "read_file" || e.name === "edit_file" || e.name === "write_file")) {
        const p = e.args.path;
        if (typeof p === "string") out.add(p);
      } else if (e.type === "user_message") {
        for (const m of e.content.match(/[\w./-]+\.[a-z]{1,5}/g) ?? []) out.add(m);
      }
    }
    return [...out];
  };
  const mentionedFromEvents = (events: AgentEvent[]): string[] => {
    const lastUser = [...events].reverse().find((e) => e.type === "user_message");
    if (!lastUser || lastUser.type !== "user_message") return [];
    const idents = new Set<string>();
    for (const m of lastUser.content.match(/[A-Za-z_][A-Za-z0-9_]{3,}/g) ?? []) idents.add(m);
    return [...idents];
  };
  // stream(messages, tools)：一次调用 = 一轮模型输出。messages/tools 由 loop 传入，但本会话型
  // provider 以事件日志为唯一事实源（compaction/prune/符号地图组装都在日志投影上，loop 拿不到），
  // 故忽略入参沿用构造时的 opts（gate-check 暗卷路径冻结依赖此契约）。
  return {
    stream(_messages, _tools): AsyncIterable<ModelOutput> {
      return turnGenerator();
    },
  };
  async function* turnGenerator(): AsyncGenerator<ModelOutput> {
    if (queue.length === 0) {
      if (lastHadToolCalls === false) return; // 模型收尾（纯文本）→ 任务结束
      let { events, history } = await assemble();
      // M1d 触发检查：估算含 system/tools/记忆全量开销；B（硬兜底）→ overflow 紧急截断
      if (coordinator && opts.compaction) {
        const factor = calibrateFactor(events);
        const estimate = estimateContextTokens(history, opts.compaction.overhead ?? {}, factor);
        const decision = shouldCompact(estimate, {
          ...DEFAULT_COMPACTION_CONFIG,
          ...opts.compaction.config,
        });
        const outcome = await coordinator.maybeCompact(events, decision);
        if (outcome?.ok) {
          await createEventLog(logPath).append(outcome.event);
          ({ events, history } = await assemble()); // fresh start：重组装（摘要 + tail）
        } else if (outcome && outcome.kind === "failed" && coordinator.summarizerDisabled) {
          console.warn("[compaction] 连续摘要失败已达上限，本会话停用摘要（仅 overflow 紧急截断可用）");
        }
      }
      const msgs: GlmMessage[] = [];
      if (opts.system) msgs.push({ role: "system", content: opts.system });
      // M2b 符号地图：仅首轮（历史尚短）注入；异常静默跳过（§6.4 失败降级）
      if (mapBuilder && history.length <= 2) {
        try {
          const built = await mapBuilder.build({
            workspace,
            mentionedIdents: mentionedFromEvents(events),
            contextFiles: contextFilesFromEvents(events),
            maxInputTokens: 128_000,
            nowRound: round++,
          });
          if (built.text) {
            msgs.push({
              role: "system",
              content: "[符号地图] 仓库符号索引（def/ref 排名，预算内渲染；用于先看仓库结构再探索）：\n" + built.text,
            });
          }
        } catch (err) {
          console.debug("[map] 注入失败，静默跳过:", err instanceof Error ? err.message : String(err));
        }
      }
      for (const m of history) msgs.push(m);
      queue = [];
      for await (const e of streamGlm(msgs, {}, opts.tools)) queue.push(e);
      lastHadToolCalls = queue.some((e) => e.type === "tool_call");
      if (queue.length === 0) return;
    }
    yield* queue.splice(0);
  }
}
