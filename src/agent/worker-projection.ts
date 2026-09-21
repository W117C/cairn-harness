import type { AgentEvent } from "../events";
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

/** 子流装饰：worker 的 tool_call/tool_result/usage/verify_result 带 agent_id（其余事件类型本体已带）。
 *  verify_result 是 2026-09-20 补进来的：W4a 让 worker 也跑自动验证之后，缺了归因就等于
 *  「worker 验过」冒充「父会话验过」——上下文红回流、父验证计量、假完成率三处都按这条判子流。 */
export function withAgentId(e: AgentEvent, agentId: string): AgentEvent {
  // turn_truncated 必须在列：provider 发这条事件时不知道自己在 worker 里，不加进来
  // 子流的截断就会以「主会话上一轮没说完」的形态落进父转录（context/goal 都会读错主体）。
  // 保持单行：既有锚点 verify-result-out-of-attribution 的针脚按这一行的前缀匹配，折行会把它抹掉。
  if (e.type === "tool_call" || e.type === "tool_result" || e.type === "usage" || e.type === "verify_result" || e.type === "turn_truncated") {
    return { ...e, agent_id: agentId } as AgentEvent;
  }
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
