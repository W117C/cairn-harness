// provider 装配面：**选哪一家 / 造哪个 provider 实例**这两件事从装配根搬出来
// （结构债审查报告 #2 的第二缝「provider 装配」）。
//
// 抽因与本族其余几支同：装配根该是「谁接谁」的接线表，`createProvider` 却把「按 selection 分叉到
// mock / 会话 provider / 非会话 transport」这段**决策**连同它的依赖面一起揣在 1,800 行里。
//
// 本模块**不反向依赖装配根**（同 state-handlers / scheduler-runtime / demo-scripted 那一族）：
// 入参 `SessionProviderOptions` 自己声明（原先写作 `Pick<RunOptions, "logPath" | "workspace" |
// "attachments"> & {…}`），见该接口头上的说明。
import { createSessionProvider, gateToolSpecs, type SessionTransport } from "../agent/session-provider";
import type { SolpiRuntime } from "../agent/solpi-runtime";
import type { AgentEvent } from "../events";
import type { GlmToolSpec } from "../providers/glm";
import { createMockProvider } from "../providers/mock";
import { toWorkerModel, type RegistryWorkerModel } from "../providers/registry";
import type { ThinkingEffort } from "../providers/capabilities";
import type { Provider, ProviderToolSpec } from "../providers";
import { MOCK_FIXTURE, scriptedMainModelPath } from "./demo-scripted";
import {
  assertProviderKeyConfigured,
  providerKindFromEnv,
  selectionProviderId,
  type MainModelSelection,
} from "./provider-runtime";
import { formatAttachmentContext, type ValidatedRunAttachment } from "./run-attachments";
import { store } from "./settings-handlers";
import type { ProviderKind } from "./settings";

/** Explicit non-empty M0A_PROVIDER wins; empty means settings. Unknown env values fail visibly. */
export async function resolveProviderKind(): Promise<ProviderKind> {
  return providerKindFromEnv(process.env.M0A_PROVIDER) ?? (await store().get()).provider;
}

/** 主会话装配的入参面。
 *
 *  前三枚（`logPath` / `workspace` / `attachments`）原先写作 `Pick<RunOptions, …>` ——那会让本模块
 *  反向 import 装配根的类型，与「抽出来的模块不反向依赖装配根」这条口径相反（同 `state-handlers`
 *  头上的话）。所以在这里按同形声明。**这不是「同一谓词的第二份」**：两侧的关联由类型检查守着——
 *  装配根往这里递的就是 `RunOptions` 的那三枚，形状一旦分叉，调用点当场红。
 *  后几枚本来就只长在这条接缝上（装配根那个 `Pick` 之后的内联对象），随本面一起搬来。 */
export interface SessionProviderOptions {
  logPath: string;
  workspace: string;
  attachments?: ValidatedRunAttachment[];
  emit: (event: AgentEvent) => Promise<void>;
  plugins?: NonNullable<Parameters<typeof createSessionProvider>[1]>["plugins"];
  requestFace: () => { tools: GlmToolSpec[]; note: string };
  solpi?: SolpiRuntime;
  promptCache?: boolean;
  /** 思考档位（§S8）：一路带到适配器的请求体里。缺省 / "off" ⇒ 请求体里不出现这个字段。 */
  thinking?: ThinkingEffort;
  onPreCompact?: (trigger: "manual" | "auto") => Promise<void>;
  /** 本 provider 每次请求末尾追加的临时 user 消息（不进日志）：会话末沉淀轮送指令用。 */
  ephemeralUserTurn?: string;
  /** 识图活盒子：loop 读到图后，provider 在下一轮请求里取走附上（见 image-channel.ts）。
   *  与 `ephemeralImages`（一次性、调用方自己算好）是两条不同的时机。 */
  imageChannel?: { take: () => { type: "image"; dataUrl: string }[] };
  /** 本次请求附带的图片内容块（不进日志）：`read_image` 读到的图走这条进请求体。 */
  ephemeralImages?: readonly { type: "image"; dataUrl: string }[];
}

// Main-session wrapper + non-session transport share one selected registry model.
// Explicit fixture env paths still win, preserving frozen demo/e2e bytes.
export function createProvider(
  _userMessage: string,
  systemPrefix: string | undefined,
  selection: MainModelSelection,
  sessionOptions?: SessionProviderOptions,
): Provider {
  const scripted = scriptedMainModelPath();
  if (scripted !== null) return createMockProvider(scripted);
  if (selection.kind === "demo") return createMockProvider(MOCK_FIXTURE);

  // 取 provider id 必须走 selectionProviderId：`kind` 在自定义家那一支上是标签 "custom"，
  // 不是家名。直接传 kind 会让自定义 provider 在最后一米被误判成「未登记 env 映射」。
  assertProviderKeyConfigured(selectionProviderId(selection));
  const modelTransport: RegistryWorkerModel = toWorkerModel(selection.spec, {
    promptCache: sessionOptions?.promptCache === true,
    // "off" 等于没给：适配器只在拿到真实档位时才往请求体里加字段（逐字旧行为的边界就在这里）
    ...(sessionOptions?.thinking !== undefined && sessionOptions.thinking !== "off"
      ? { reasoningEffort: sessionOptions.thinking }
      : {}),
  });
  // createSessionProvider predates native adapters and exposes a GLM-shaped transport slot.
  // This adapter forwards cancellation + OpenAI/GLM metering while binding the already-resolved spec.
  const transport: SessionTransport = (messages, options, tools, call) => modelTransport(messages, tools ?? [], {
    call,
    ...(options?.stream !== undefined ? { stream: options.stream } : {}),
    ...(options?.metering ? { metering: options.metering } : {}),
  });
  const label = selection.spec.provider;

  if (sessionOptions) {
    const attachmentContext = formatAttachmentContext(sessionOptions.attachments ?? [], sessionOptions.workspace);
    return createSessionProvider(sessionOptions.logPath, {
      system: systemPrefix,
      workspace: sessionOptions.workspace,
      requestFace: sessionOptions.requestFace,
      compaction: {
        ...(sessionOptions.onPreCompact ? { onPreCompact: sessionOptions.onPreCompact } : {}),
      },
      emit: sessionOptions.emit,
      plugins: sessionOptions.plugins,
      solpi: sessionOptions.solpi,
      // Preserve the pre-CX main-session GLM default compaction budget. An explicit request/settings
      // model opts into the registry window; other providers always use their registry spec.
      ...(selectionProviderId(selection) !== "glm" || selection.modelExplicit ? { model: selection.spec.model } : {}),
      // 自由档位的名字查表恒为 undefined ⇒ 窗口必须由 spec 递进预算，否则 `--ctx-window` 只改到一半
      // （toWorkerModel 会丢掉 ctxWindow，只有这一条真的落到 inputLimit 上）。
      ...(selection.modelExplicit ? { ctxWindow: selection.spec.ctxWindow } : {}),
      transport,
      transportLabel: label,
      ...(sessionOptions.ephemeralUserTurn !== undefined ? { ephemeralUserTurn: sessionOptions.ephemeralUserTurn } : {}),
      ...(sessionOptions.imageChannel !== undefined ? { imageChannel: sessionOptions.imageChannel } : {}),
      ...(sessionOptions.ephemeralImages !== undefined ? { ephemeralImages: sessionOptions.ephemeralImages } : {}),
      ...(attachmentContext ? { attachmentContext } : {}),
    });
  }

  return {
    stream(messages, _tools: ProviderToolSpec[] | undefined, call) {
      const rememberTool = gateToolSpecs().filter((spec) => spec.function.name === "remember");
      return transport(messages, {}, rememberTool, call);
    },
  };
}
