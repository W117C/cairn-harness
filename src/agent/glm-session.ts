// 暗卷用会话型 provider：src/providers 只读（M1a 定稿），本文件只调用 streamGlm 不改它。
// 职责：从事件日志重建 OpenAI 兼容对话历史（含 tool_calls / tool 角色），把工具结果反馈回模型，
// 使真实 GLM 能多轮调用 clarify / propose_plan / write_file / verify。
import { createEventLog, replayIncremental, type AgentEvent, type CompactionUsage } from "../events";
import { isSideEffectTool, isWriteCall, type McpGrade, type PermissionMode } from "../permissions";
import { streamGlm, type GlmMessage, type GlmToolSpec } from "../providers/glm";
import { DEFAULT_MODEL_TABLE, findSpecByNameOrId } from "../providers/registry";
import type { ModelOutput, Provider, ProviderCall } from "../providers";
import { projectContext, type ContextMessage } from "./context";
import { buildMemoryInjection, type MemoryInjection } from "./memory/inject";
import { REMEMBER_DESCRIPTION } from "../tools/remember";
import { computePrune, writePruneAttachments } from "./prune";
import { basename, dirname, join } from "node:path";
import { createMapBuilder, type MapBuilder } from "./map/build";
import {
  DEFAULT_COMPACTION_CONFIG,
  CompactionCoordinator,
  calibrateFactor,
  estimateContextTokens,
  shouldCompact,
  withModelBudget,
  type AssemblyOverhead,
  type CompactionConfig,
  type Summarizer,
  type SummarizerInput,
  type SummarizerOutput,
} from "./compaction";
import type { SolpiRuntime } from "./solpi-runtime";
import type { RequestMeter } from "./metering";
import { deriveProgressBoundaries } from "./economics";
import { planSurfaceBudget } from "./model-surface";

type RawMessage = Record<string, unknown>;

/** 模型面降配梯的 core 身份：从 `gateToolSpecs()` **派生**，不另抄一份工具名清单
 *  （抄了就又是一处「规格与实现两处手写」）。 */
const CORE_SURFACE_TOOL_NAMES: ReadonlySet<string> = new Set(gateToolSpecs().map((s) => s.function.name));


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
        description: "工作区内容搜索（ripgrep 正则）；按文件分组返回，上限 100 命中。改代码前要现场就给 context，搜字面串给 fixed_strings",
        parameters: obj(
          {
            pattern: { type: "string", description: "正则表达式（Rust 语法，忽略大小写写 (?i) 前缀）" },
            path: { type: "string", description: "限定目录或文件（workspace 相对，缺省全工作区）" },
            context: { type: "number", description: "命中行前后各 N 行上下文（1–5，缺省 0）：命中行前缀 Line N:，上下文行前缀 \"N |\"。省掉为拼 old_string 再读一次文件的那一轮" },
            fixed_strings: { type: "boolean", description: "按字面串匹配——搜含 ( . $ [ 的串（路径、报错原文、函数调用形状）时用，否则会被正则语义曲解或直接报错" },
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
    // P-1 补漏：lsp 在可执行面真实存在（TOOLS / toolTableFor / sidechat 白名单都在表内），
    // 但模型可见面此前没有它 ⇒ 模型永远调不到一个已接线的工具。二者必须同源。
    {
      type: "function",
      function: {
        name: "lsp",
        description:
          "LSP 查询（需工作区 .agent/lsp.json 配置；未配置时返回明确不可用原因）：" +
          "definition / references / hover / documentSymbol / workspaceSymbol / implementation；行列均 1-based",
        parameters: obj(
          {
            operation: {
              type: "string",
              enum: ["definition", "references", "hover", "documentSymbol", "workspaceSymbol", "implementation"],
              description: "查询类型",
            },
            path: { type: "string", description: "workspace 相对路径（workspaceSymbol 可省略）" },
            line: { type: "number", description: "行号（1-based）" },
            column: { type: "number", description: "列号（1-based）" },
            symbol: { type: "string", description: "workspaceSymbol 的查询串" },
          },
          ["operation"],
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
    // M3 编排原语此前「可执行但不可见」：TOOLS.spawn_agent 早已运行时注入（agent-runner），
    // 模型面却没有它的规格 ⇒ 主会话永远无法分解任务/派 worker（与 lsp 同类缺陷）。
    // tier/model 故意不写 enum：权威校验在 orchestrator（clampTier + fail-visible 收窄），
    // 在此再抄一份档位表就是两套真相漂移。
    {
      type: "function",
      function: {
        name: "spawn_agent",
        description:
          "派生子 agent 分担任务：read=只读调研，write=写盘实现（声明写租约），pipeline=多阶段依赖链，supervise=受限自环。worker 看不到本会话历史，task 必须自包含。",
        parameters: obj(
          {
            task: { type: "string", description: "自包含任务书：目标 / 涉及文件 / 验收口径（mode=pipeline 时可空，由 stages 承载）" },
            mode: { type: "string", enum: ["read", "write", "pipeline", "supervise"], description: "worker 档位" },
            resources: { type: "array", items: { type: "string" }, description: "mode=write 的写租约 glob（与活跃写 worker 相交即拒）" },
            stages: {
              type: "array",
              items: obj({ role: { type: "string" }, task: { type: "string" }, gate: { type: "boolean" } }, ["role"]),
              description: "mode=pipeline 的阶段序列（批准后冻结，变更请求被拒）",
            },
            depends_on: { type: "array", items: { type: "string" }, description: "依赖的 agent_id（上游终态后才放行）" },
            tier: { type: "string", description: "模型档位名（缺省走档位表路由；非法值 fail-visible 拒绝/钳制）" },
            max_turns: { type: "integer", description: "worker 轮次上限" },
          },
          ["task", "mode"],
        ),
      },
    },
    // W1a 收队原语：与 spawn_agent 同族——「派得出去、收不回来」正是本仓反复复发的
    // 「能力已发货、产品路径绕过它」缺陷族（join 原语此前只有验收脚本在调）。
    // 规格面与实例面必须同笔落地，tests/tool-surface-parity.test.ts（G-B）钉这条。
    {
      type: "function",
      function: {
        name: "wait_for_agents",
        description:
          "收队：等本批子 agent 到终态并一次拿回状态/摘要/用量。派生过 worker 后先调它再下结论；" +
          "缺省等全部，可给 agent_ids 只等其中几个。",
        parameters: obj(
          {
            agent_ids: { type: "array", items: { type: "string" }, description: "缺省 = 本会话全部 worker" },
            timeout_ms: { type: "number", description: "等待上限 ms（缺省 120000）" },
          },
          [],
        ),
      },
    },
    // M2d：记忆写入唯一入口（§8.1.4）；只读档随写向工具一并摘除
    {
      type: "function",
      function: {
        name: "remember",
        description: REMEMBER_DESCRIPTION,
        parameters: obj(
          {
            scope: { type: "string", enum: ["project", "global"], description: "只认顶层参数：project=项目层 .agent/（团队共享），global=用户全局记忆" },
            kind: { type: "string", enum: ["architecture", "decision", "preference", "memory"], description: "写入目标：前三者映射项目层根三文件，memory 写记忆笔记" },
            op: { type: "string", enum: ["append", "replace"], description: "append 追加（decision/memory 缺省）、replace 整段改写（architecture/preference 缺省）" },
            type: { type: "string", enum: ["user", "feedback", "project", "reference"], description: "kind=memory 必带" },
            topic: { type: "string", description: "kind=memory 必带（1-64 位字母/数字/连字符/下划线）" },
            content: { type: "string", description: "要写入的正文原文" },
            old_content: { type: "string", description: "op=replace 必带：当前原文（须精确命中，否则报错重试）" },
          },
          ["scope", "kind", "content"],
        ),
      },
    },
  ];
  if (mode === "read-only") {
    // 只读档连同编排原语一并摘除：spawn_agent 靠 SIDE_EFFECT_TOOLS，wait_for_agents 不是写向工具
    // （不该被方案门挡），所以只能显式点名——漏摘就是「模型看得见、执行面白名单挡着」那类两头断。
    return specs.filter((s) =>
      !isSideEffectTool(s.function.name) && s.function.name !== "remember" && s.function.name !== "wait_for_agents",
    );
  }
  return specs;
}

/** 运行时注入的工具（插件 skill / MCP server 工具）的模型可见规格。
 *  MCP 侧 parameters 直接是 server 的 inputSchema 原文——不翻译、不裁剪，避免两套 schema 漂移。 */
export interface SessionPluginTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** MCP server 自带注解（§11.7.2 分级输入）。非 MCP 注入项不传 = 按静态写向表判。 */
  grade?: McpGrade;
}

/** 主会话模型可见工具面：与可执行面同源的唯一组装入口。
 *  基础规格来自 gateToolSpecs（按 mode 摘除写向工具），再叠加运行时注入的插件/MCP 工具规格
 *  （注入项也过同一份 mode 判定：只读档只放行带 readOnlyHint 的 MCP 工具，用的是门里那个 isWriteCall）。
 *  同名冲突 = 跳过注入项并计入 skipped（fail-visible 返回给调用方，不静默覆盖基础工具）。
 *  §9.3 的 `disallowed-tools` 走**同一份**判定来源（调用方给 loop 活闸用的那个谓词）：worker 侧是
 *  「规格面 + 实例面 + loop 硬闸」三重（filterWorkerSpecs / filterWorkerTable 同口径），主会话此前
 *  只有后两重 ⇒ 被摘的工具仍占着模型可见清单，模型白叫一次再吃一句"不可用"。 */
export function sessionToolSpecs(
  opts: {
    mode?: PermissionMode;
    pluginTools?: readonly SessionPluginTool[];
    /** 返回摘除者（skill / command 的调用名）= 该工具本 turn 不可用；null / undefined = 保留。 */
    skillDenial?: (name: string) => string | null;
  } = {},
): { specs: GlmToolSpec[]; skipped: string[]; removed: { name: string; by: string }[]; note: string } {
  const specs = gateToolSpecs(opts.mode);
  const seen = new Set(specs.map((s) => s.function.name));
  const skipped: string[] = [];
  for (const tool of opts.pluginTools ?? []) {
    if (tool.name === "" || seen.has(tool.name)) {
      skipped.push(tool.name);
      continue;
    }
    // 只读档的写向摘除同样覆盖注入项，且用的是权限门那一份谓词（isWriteCall）：门必拒的 MCP 工具
    // 还挂在模型清单上 = 白叫一轮再吃一句拒绝（任务 #39 同名形状）。基础工具那半在 gateToolSpecs。
    if (opts.mode === "read-only" && isWriteCall(tool.name, tool.grade)) continue;
    seen.add(tool.name);
    specs.push({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    });
  }
  if (!opts.skillDenial) return { specs, skipped, removed: [], note: "" };
  const kept: GlmToolSpec[] = [];
  const removed: { name: string; by: string }[] = [];
  for (const s of specs) {
    const by = opts.skillDenial(s.function.name);
    if (by) removed.push({ name: s.function.name, by });
    else kept.push(s);
  }
  // 摘除也要说得出口：可见清单静默少几把工具，等于让模型自己猜哪把没了（下一跳才吃一句"不可用"）。
  // 清单不会被摘空：`remember` / `spawn_agent` 这类不在 ToolName 键域里的规格根本不可申报（装载即出声）。
  const note = removed.length === 0 ? "" :
    "[skill 工具面] 本 turn 已按 disallowed-tools 从可见工具表摘除：" +
    removed.map((r) => r.name + "（由 " + r.by + "）").join("、");
  return { specs: kept, skipped, removed, note };
}

/** 事件日志 → OpenAI 兼容消息序列。
 *  M1d：改走组装器投影 projectContext——compaction 感知（跳过被压 id、offset 注入摘要、fresh start），
 *  assistant_delta 合并与 tool 角色映射逻辑与旧版逐字同构。 */
export async function buildGlmHistory(logPath: string): Promise<RawMessage[]> {
  return projectContext(await replayIncremental(logPath)) as unknown as RawMessage[];
}

/** GLM 暗卷摘要器：非流式单轮调用（thinking/streaming 关），只调用只读的 src/providers/glm.ts。 */
export function createGlmSummarizer(model?: string, meter?: RequestMeter, transport: typeof streamGlm = streamGlm): Summarizer {
  return async (input: SummarizerInput): Promise<SummarizerOutput> => {
    const modelName = model && model !== "" ? model : (process.env.M0_MODEL ?? "glm-5.2");
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
    let truncated: string | undefined;
    for await (const e of transport(msgs, { stream: false, model: modelName, ...(meter ? { metering: { meter, category: "summary" as const } } : {}) }, undefined, { signal: input.signal })) {
      if (e.type === "assistant_delta") text += e.text;
      else if (e.type === "usage") usage = { inputTokens: e.inputTokens, outputTokens: e.outputTokens };
      // 非流式分支同样会报「没写完」（providers/openai.ts 读 finish_reason）。收下但不声张就等于
      // 没收——半份摘要会被当成完整结论落进记录，而它替掉的旧事件已经不会再回来了。
      else if (e.type === "turn_truncated") truncated = e.stop_reason;
    }
    if (!text.trim()) throw new Error("GLM 摘要器返回空摘要");
    return { text, usage, model: modelName, ...(truncated !== undefined ? { truncated } : {}) };
  };
}

export interface GlmSessionCompaction {
  config?: Partial<CompactionConfig>;
  /** 缺省 = M0_API_KEY 在场时用 GLM 暗卷摘要器。 */
  summarizer?: Summarizer;
  /** system prompt / 工具 schema / 记忆注入开销字符数（触发估算全量计入，§7.3(a)）。 */
  overhead?: AssemblyOverhead;
  /** §9.5：自动压缩档的 PreCompact 生产者（trigger 恒为 "auto"——手动压缩走 agent-runner 那条）。
   *  缺省 undefined = 零行为（无插件会话与既有事件流字节不变）。 */
  onPreCompact?: (trigger: "manual" | "auto") => Promise<void>;
}

/** 会话型 provider：每次 stream 从日志重建历史，直接转发网络增量；轮次结束由 loop 控制。
 *  M1d：每次组装前做双条件触发检查——命中即压缩（compaction 事件落盘）再重组装（fresh start）。
 *  M2b：组装投影叠加 prune 类型化裁剪（§7.4，本地零 LLM）+ 符号地图注入（§6.4，指纹缓存；
 *  两者任一异常静默降级为无裁剪/无地图，绝不阻断 loop）。 */
/** M2d：单轮消息组装（纯函数）——system → 记忆块（固定回注，每轮重注）→ 符号地图（首轮）→ 历史投影。
 *  压缩接缝（§8.1.9）：记忆块在组装层注入，压缩器永不触达；压缩后重组装自然重注。 */
export function composeTurnMessages(opts: {
  system?: string;
  mapText?: string | null;
  memory?: Pick<MemoryInjection, "project" | "global">;
  history: ContextMessage[];
  /** M2e：插件注入面（skill 路由清单 + SessionStart/重挂上下文），缺省零行为。 */
  skills?: string;
  /** 模型面预算降配的如实说明（`model-surface` 出品）。缺省零行为。
   *  刻意排在最后一个 system 块：这一句本来就只在「池子满了」那几轮出现，放前头会把
   *  可缓存前缀自己抖掉——而它要省的就是这份缓存。 */
  surfaceNote?: string;
}): GlmMessage[] {
  const msgs: GlmMessage[] = [];
  if (opts.system) msgs.push({ role: "system", content: opts.system });
  if (opts.memory?.project) msgs.push({ role: "system", content: opts.memory.project });
  if (opts.memory?.global) msgs.push({ role: "system", content: opts.memory.global });
  if (opts.skills) msgs.push({ role: "system", content: opts.skills });
  if (opts.mapText) {
    msgs.push({
      role: "system",
      content: "[符号地图] 仓库符号索引（def/ref 排名，预算内渲染；用于先看仓库结构再探索）：\n" + opts.mapText,
    });
  }
  if (opts.surfaceNote) msgs.push({ role: "system", content: opts.surfaceNote });
  for (const m of opts.history) msgs.push(m);
  return msgs;
}

export function createGlmSessionProvider(
  logPath: string,
  opts: {
    system?: string;
    tools?: GlmToolSpec[];
    /** 逐请求重算的工具面。给了它就以它为准：§9.3 的 skill 可能在 run 中途才被点起来，
     *  构造时冻结的清单会把「摘掉」推迟到下一轮，而下一轮明明还能拒得更早（白叫一次 + 说明过期）。
     *  返回值同时带摘除说明，所以规格与解释永远同源同刻。 */
    requestFace?: () => { tools?: GlmToolSpec[]; note?: string };
    transport?: typeof streamGlm;
    /** Persist and publish system events through the owning session pipeline. */
    emit?: (event: AgentEvent) => Promise<void>;
    compaction?: GlmSessionCompaction;
    /** M2b：符号地图构建器（缺省 = 自建一个；workspace 从 M2B_WORKSPACE env 或 process.cwd()）。 */
    mapBuilder?: MapBuilder;
    /** M2b：地图工作区（缺省 M2B_WORKSPACE env 或 process.cwd()）。 */
    workspace?: string;
    /** M2b：地图开关（缺省开；单测/暗卷可关）。 */
    map?: boolean;
    /** M2e：插件注入面（skill 路由清单 / SessionStart 上下文 / 压缩后重挂投影）。缺省零行为。
     *  本 turn 的 disallowed-tools 摘除说明**不在这里**——它随工具面逐请求走 `requestFace`，
     *  两份都给就等于给"清单与解释不同步"留门。 */
    plugins?: {
      skillsRouting?: string;
      hookContext?: string;
      deriveRemount?: (events: AgentEvent[]) => string | null;
    };
    /** 真实通道模型名（缺省 = provider 层读 M0_MODEL env；settings.model 在场时优先）。 */
    model?: string;
    solpi?: SolpiRuntime;
  } = {},
): Provider {
  let round = 0; // 注入轮次（地图每 N 轮重算用）
  /** 本请求的压缩/预算配置：inputLimit 认模型真实窗口（registry.ctxWindow，此前零消费者）。
   *  优先级 = 模型窗口定基线 < 调用方显式 config；但**显式值也绝不超出模型窗口**——
   *  超窗 provider 必 400，把 fail-closed 让给远端不如本地钳住。
   *  触发判定、硬闸与压缩器的裁剪目标**共用这一处**（否则 200k 档上触发按 200k、裁剪仍按
   *  128k，白丢一段冷细节）。⚠️ 但"共用"今天是**靠输入不可变**才成立的，不是靠构造顺序：
   *  opts.model 是 run 开始时从 settings 取的一次性 primitive（全仓无写侧），所以下面构造时
   *  那次 budgetConfig() 与每请求现算的两次必然同值 ⇒ 现在没有「两把尺」。这条等价无东西守着：
   *  一旦 model 变成逐请求（按请求路由 / worker 热恢复），构造快照立刻成第二把尺——届时要把
   *  现取的 config 交给 coordinator（getter 或 setConfig），别继续假设三处同源。 */
  const budgetConfig = (): CompactionConfig => {
    const window = findSpecByNameOrId(DEFAULT_MODEL_TABLE, opts.model)?.ctxWindow;
    const merged: CompactionConfig = { ...withModelBudget(DEFAULT_COMPACTION_CONFIG, window), ...opts.compaction?.config };
    return typeof window === "number" ? { ...merged, inputLimit: Math.min(merged.inputLimit, window) } : merged;
  };
  const coordinator = opts.compaction
    ? new CompactionCoordinator({
        config: budgetConfig(),
        summarizer: opts.compaction.summarizer ?? (process.env.M0_API_KEY ? createGlmSummarizer(opts.model, opts.solpi?.meter, opts.transport) : undefined),
        ...(opts.compaction.onPreCompact ? { onPreCompact: opts.compaction.onPreCompact } : {}),
      })
    : null;
  const mapBuilder = opts.map === false ? null : opts.mapBuilder ?? createMapBuilder();
  const workspace = opts.workspace ?? process.env.M2B_WORKSPACE ?? process.cwd();
  const pluginContext = (events: AgentEvent[], liveNote?: string): string | undefined => {
    if (!opts.plugins) return undefined;
    const parts = [opts.plugins.skillsRouting, opts.plugins.hookContext, liveNote].filter((part): part is string => Boolean(part));
    try {
      const remount = opts.plugins.deriveRemount?.(events);
      if (remount) parts.push(remount);
    } catch (err) {
      console.debug("[plugins] 重挂投影失败，跳过:", err instanceof Error ? err.message : String(err));
    }
    return parts.length ? parts.join("\n\n") : undefined;
  };
  // prune 附件（§7.4 存盘回取）：目录与事件日志同级 ⇒ 与日志同生命周期，删会话目录即一起清掉；
  // sessionId 取日志文件名，同一目录里并存的多个会话各有各的附件命名空间。
  const pruneAttachmentsDir = join(dirname(logPath), "prune-attachments");
  const pruneSessionId = basename(logPath).replace(/\.jsonl$/u, "");
  const assemble = async (): Promise<{ events: AgentEvent[]; history: ReturnType<typeof projectContext> }> => {
    // A5（审查根因 5）：增量重放——每轮只解析追加段（旧实现全量读盘+全量投影，整会话 O(n²)）
    const events = await replayIncremental(logPath);
    // M2b prune：本地计算裁剪投影（异常静默 → 无裁剪）
    let replacements: Map<number, string> | undefined;
    try {
      // §7.4「存盘回取」的生产入口：附件目录放在事件日志旁边（同生命周期、同一清理面），
      // sessionId 用日志文件名（同一目录里每个会话一份命名空间）。缺了这一步，打桩里那行
      // 「原文已存附件 …」就是指向空气的路径 —— 本仓点名的「两头断」。
      const outcome = computePrune({ events, attachmentsDir: pruneAttachmentsDir, sessionId: pruneSessionId });
      if (outcome.why === "saved" && outcome.replacements.size > 0) {
        replacements = outcome.replacements;
        await writePruneAttachments(events, outcome, pruneAttachmentsDir, pruneSessionId);
      }
    } catch (err) {
      console.debug("[prune] 计算失败，本轮跳过裁剪:", err instanceof Error ? err.message : String(err));
    }
    if (opts.solpi?.ledger) replacements = await opts.solpi.project(events, replacements);
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
  let successfulRequests = 0, requestsAtBoundary = 0, lastBoundaryCount = 0;
  const boundarySamples: number[] = [];
  return {
    stream(_messages, _tools, call): AsyncIterable<ModelOutput> {
      return turnGenerator(call);
    },
  };
  async function* turnGenerator(call?: ProviderCall): AsyncGenerator<ModelOutput> {
      call?.signal?.throwIfAborted();
      let { events, history } = await assemble();
      // 逐请求工具面：给了 requestFace 就每轮现算（run 中途激活的 skill 下一轮就不再出现在清单里），
      // 否则沿用构造时那份。整轮只用这一个 `tools`——散落着读 opts.tools 会出现同轮两种口径。
      const face = opts.requestFace?.();
      const declaredTools = face ? face.tools : opts.tools;
      // 模型面总预算（每请求固定成本）。落这一层而不是工具表面那一层，理由有二：
      // ① 这里同时握有 system 文本与**最终**工具表——预算要按真实要发出去的字节判；
      // ② 每一条装配路径都过这里（主会话 / worker / 靶场 / 探针 / 暗卷都从本 provider 走），
      //   接在 `sessionToolSpecs` 上则会漏掉直接传 `tools:` 的调用方。
      const surface = declaredTools && declaredTools.length > 0
        ? planSurfaceBudget({
            specs: declaredTools,
            systemChars: opts.system?.length ?? 0,
            coreNames: CORE_SURFACE_TOOL_NAMES,
          })
        : null;
      const tools = surface ? surface.specs : declaredTools;
      const liveNote = face?.note;
      // 降配说明单独成块，不搭 `liveNote` 那条便车：`liveNote` 经 `pluginContext` 进 skills 块，
      // 而没有插件/技能的会话根本没有那一块——接在那儿就是「生产者在、消费者不在」。
      const surfaceNoteText = surface?.note ?? "";

      // M2d 固定回注（§8.1.5/§8.1.9）：每轮组装重读两层记忆并重注（压缩后自然重注）；异常静默跳过
      let memory: MemoryInjection = { project: null, global: null, charsCurrent: 0, charsLimit: 0, tokens: 0, truncated: false };
      try {
        memory = await buildMemoryInjection({ workspace });
      } catch (err) {
        console.debug("[memory] 注入失败，静默跳过:", err instanceof Error ? err.message : String(err));
      }
      const memoryChars = (memory.project?.length ?? 0) + (memory.global?.length ?? 0);
      let skillsBlock = pluginContext(events, liveNote);
      // M2b 符号地图：仅首轮（历史尚短）注入；异常静默跳过（§6.4 失败降级）。
      // A-4：地图文本先于压缩判定构建——它是**本请求真实要发出去的内容**，
      // 不计进 overhead 的硬预算判定会偏低（与 §7.3(a)「全量计入」同源）。
      const buildMapText = async (historyForMap: ContextMessage[]): Promise<string | null> => {
        if (!mapBuilder || historyForMap.length > 2) return null;
        try {
          const built = await mapBuilder.build({
            workspace,
            mentionedIdents: mentionedFromEvents(events),
            contextFiles: contextFilesFromEvents(events),
            maxInputTokens: 128_000,
            nowRound: round++,
          });
          return built.text || null;
        } catch (err) {
          console.debug("[map] 注入失败，静默跳过:", err instanceof Error ? err.message : String(err));
          return null;
        }
      };
      let mapText = await buildMapText(history);
      // M1d 触发检查：估算含 system/tools/记忆全量开销；B（硬兜底）→ overflow 紧急截断
      if (coordinator && opts.compaction) {
        const factor = calibrateFactor(events);
        const overhead: AssemblyOverhead = {
          systemChars: (opts.system?.length ?? 0) + (skillsBlock?.length ?? 0),
          toolSchemaChars: tools ? JSON.stringify(tools).length : 0,
          ...opts.compaction.overhead,
          memoryChars,
          mapChars: mapText?.length ?? 0,
        };
        const estimate = estimateContextTokens(history, overhead, factor);
        const decision = shouldCompact(estimate, budgetConfig());
        const boundaries = opts.solpi?.flags.economicCompaction ? deriveProgressBoundaries(events) : [];
        const outcome = await coordinator.maybeCompact(events, decision, { overhead, signal: call?.signal,
          ...(opts.solpi?.flags.economicCompaction ? { economics: {
            state: opts.solpi.economics(events), requestsPerBoundary: boundarySamples,
            // Plans specify files, not a trusted count of remaining completion boundaries.
            // Never invent horizon or cache pricing from assistant prose/default ratios.
            remainingBoundaries: null, avgIncrementTokens: null, cacheWriteReadRatio: null,
          } } : {}) });
        if (boundaries.length > lastBoundaryCount) {
          if (lastBoundaryCount > 0) boundarySamples.push(successfulRequests - requestsAtBoundary);
          requestsAtBoundary = successfulRequests;
          lastBoundaryCount = boundaries.length;
        }
        call?.signal?.throwIfAborted();
        if (outcome?.ok) {
          if (opts.emit) await opts.emit(outcome.event);
          else {
            const log = createEventLog(logPath);
            try { await log.append(outcome.event); }
            finally { await log.close?.(); }
          }
          ({ events, history } = await assemble()); // fresh start：重组装（摘要 + tail）
          skillsBlock = pluginContext(events, liveNote);
          mapText = await buildMapText(history);
        } else if (outcome && outcome.kind === "failed" && coordinator.summarizerDisabled) {
          console.warn("[compaction] 连续摘要失败已达上限，本会话停用摘要（仅 overflow 紧急截断可用）");
        }
      }
      const msgs = composeTurnMessages({
        system: opts.system,
        mapText,
        memory,
        history,
        ...(skillsBlock ? { skills: skillsBlock } : {}),
        ...(surfaceNoteText ? { surfaceNote: surfaceNoteText } : {}),
      });
      // 最终装配硬闸：重挂/地图/JSON 包装均已确定，不能只检查压缩前的 overhead。
      // 无 tokenizer：沿用既有校准估算口径；超限 fail-closed，事件历史不删改。
      const finalConfig = budgetConfig();
      const finalChars = JSON.stringify({ messages: msgs, tools: tools ?? [] }).length;
      const finalEstimate = Math.ceil(finalChars / calibrateFactor(events));
      if (!Number.isFinite(finalConfig.inputLimit) || !Number.isFinite(finalConfig.maxOutputReserve) ||
          finalEstimate > finalConfig.inputLimit - finalConfig.maxOutputReserve) {
        throw new Error(`[context_budget_exceeded] final estimated input ${finalEstimate}; available ${finalConfig.inputLimit - finalConfig.maxOutputReserve}; request not sent`);
      }
      call?.signal?.throwIfAborted();
      yield* (opts.transport ?? streamGlm)(msgs, { ...(opts.model ? { model: opts.model } : {}),
        ...(opts.solpi?.meter ? { metering: { meter: opts.solpi.meter, category: "main" as const } } : {}) }, tools, call);
      successfulRequests++;
      opts.solpi?.sent(msgs, events);
  }
}
