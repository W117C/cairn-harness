import type { AgentEvent } from "../events";
import type { ModelOutput } from "../providers";
import type { GlmToolSpec } from "../providers/glm";
import type { Tool } from "../tools/base";
import type { PipelineChain, WorkerContext, WorkerHandle } from "./orchestrator-types";
import { redactSecrets } from "./security/scan";

/** M3c 插件角色工具面裁剪（执行表）：allowedTools 白名单 ∩ 默认表 − disallowedTools；裁空 → 报错 fail-visible。
 *  铁律不变：无论怎么裁，spawn_agent/run_shell/merge/commit 根本不在默认表内（深度闸/合并权闸无法被「白名单」放大）。 */
export function filterWorkerTable(w: Pick<WorkerHandle, "allowedTools" | "disallowedTools" | "agentId">, table: Record<string, Tool>): Record<string, Tool> {
  const allow = w.allowedTools;
  const deny = new Set(w.disallowedTools ?? []);
  if ((allow === undefined || allow.length === 0) && deny.size === 0) return table;
  const out: Record<string, Tool> = {};
  for (const [name, tool] of Object.entries(table)) {
    if (deny.has(name)) continue;
    if (allow !== undefined && allow.length > 0 && !allow.includes(name)) continue;
    out[name] = tool;
  }
  if (Object.keys(out).length === 0) {
    throw new Error("worker " + w.agentId + " 工具面裁剪为空（frontmatter.tools 与默认面无交集；fail-visible）");
  }
  return out;
}

/** M3c 插件角色工具面裁剪（模型规格面）：与执行表同一 allow/deny 口径（两面一致，防「规格可见执行不可用」）。 */
export function filterWorkerSpecs(w: Pick<WorkerHandle, "allowedTools" | "disallowedTools">, specs: GlmToolSpec[]): GlmToolSpec[] {
  const allow = w.allowedTools;
  const deny = new Set(w.disallowedTools ?? []);
  if ((allow === undefined || allow.length === 0) && deny.size === 0) return specs;
  return specs.filter((s) => !deny.has(s.function.name) && (allow === undefined || allow.length === 0 || allow.includes(s.function.name)));
}

/** pipeline 链状态表（sequencer 只读呈现 + 整链 tool_result 的正文）。 */
export function chainTable(chain: PipelineChain): string {
  return chain.state
    .map((s) => {
      const verdict = s.verdict !== undefined ? " verdict=" + s.verdict : "";
      const preview = s.reportPreview !== undefined ? "｜" + s.reportPreview.replace(/\n/g, " ").slice(0, 80) : "";
      return "#" + String(s.index + 1) + " " + s.role + " " + (s.agentId ?? "（未 spawn）") + " " + s.status + verdict + preview;
    })
    .join("\n");
}

/** 子流归因面 = **worker 的 loop 能发出的全部事件类型**。
 *  写成这张表而不是手写 `e.type === ...` 的串，是因为漏一型太便宜而代价太贵：漏了的类型
 *  会以父会话事件的形态落进主转录（§4.4.4 说父上下文唯一接收物是 agent_result）。
 *  实测漏过的三类正是**带正文的那些**——assistant_message / assistant_delta 会以
 *  `{"role":"assistant","content":"worker 内部正文"}` 进父投影（父会话以为那句话是自己说的），
 *  error 会以父会话的错误上卡。provider 侧那一半由 Record 的穷尽性代劳：
 *  给 ModelOutput 加一型而不进这张表 ⇒ 编译不过（同一形状已在 sidechat 的 switch 上验过一次）。 */
const MODEL_OUTPUT_ATTRIBUTION: Record<ModelOutput["type"], true> = {
  assistant_message: true,
  assistant_delta: true,
  tool_call: true,
  usage: true,
  turn_truncated: true,
};
/** loop 自己合成的那一半（不是 provider 发的）。`user_message` 不在列：worker 的 runLoop
 *  从不带 userMessage 调用（任务文本走 worker-prompt 注入），所以它不是子流会发的东西。 */
const LOOP_ATTRIBUTION: readonly AgentEvent["type"][] = ["tool_result", "verify_result", "error"];

/** 需要（且应当）带 agent_id 的类型全集。导出让判据与实现读同一份，别再抄第二张表。 */
export const WORKER_STREAM_TYPES: ReadonlySet<AgentEvent["type"]> = new Set<AgentEvent["type"]>([
  ...(Object.keys(MODEL_OUTPUT_ATTRIBUTION) as AgentEvent["type"][]),
  ...LOOP_ATTRIBUTION,
]);

/** 子流装饰：worker 发的事件一律挂 agent_id（`agent_*` 那些由编排器自己发，本来就带）。
 *  verify_result 是 2026-09-20 补进来的：W4a 让 worker 也跑自动验证之后，缺了归因就等于
 *  「worker 验过」冒充「父会话验过」——上下文红回流、父验证计量、假完成率三处都按这条判子流。 */
export function withAgentId(e: AgentEvent, agentId: string): AgentEvent {
  if (WORKER_STREAM_TYPES.has(e.type)) return { ...e, agent_id: agentId } as AgentEvent; // 单行：锚点按这一行匹配
  return e;
}

/** 子流落流扫描：文本字段过 redactSecrets（密钥不进主转录 JSONL；worker 内存态保持原始事件）。
 *  B5（审查）：tool_call 的 args（write_file content 等）同样落主 JSONL——一并脱敏。 */
export function scanStreamEvent(e: AgentEvent): AgentEvent {
  if (e.type === "assistant_message") {
    return { ...e, content: redactSecrets(e.content).text };
  }
  if (e.type === "tool_result") {
    return { ...e, output: redactSecrets(e.output).text };
  }
  if (e.type === "tool_call") {
    try {
      const redacted = JSON.parse(redactSecrets(JSON.stringify(e.args)).text) as Record<string, unknown>;
      return { ...e, args: redacted };
    } catch {
      return e;
    }
  }
  return e;
}

export function digestArgs(args: Record<string, unknown>): string {
  const s = JSON.stringify(args);
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}

export function parseStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

export function parseWorkerContext(v: unknown): WorkerContext {
  if (typeof v !== "object" || v === null) return {};
  const r = v as Record<string, unknown>;
  return {
    ...(parseStringList(r.files).length > 0 ? { files: parseStringList(r.files) } : {}),
    ...(parseStringList(r.decisions).length > 0 ? { decisions: parseStringList(r.decisions) } : {}),
    ...(parseStringList(r.constraints).length > 0 ? { constraints: parseStringList(r.constraints) } : {}),
  };
}
