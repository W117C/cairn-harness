import type { AuthorizedRedactedText, ObservationLedger, Projection, RecallInput } from "../agent/ledger.js";
import type { Tool, ToolResult } from "./base.js";

// 注：观测回取（obs_recall）与任何「向量检索 / RAG / embedding」增强能力都是**附加、可选**的。
// 系统在它们完全关闭（ObservationLedger.enabled 默认 false，见 ledger.ts:91）时必须正常工作；
// 启用只作为增强接入，且按既有权限管线（evaluate/gatedTool）与 fail-closed 纪律收束。
// 未发布 / 无凭据 / 无索引时一律降级为「不注入该工具面」，绝不静默假装可用。

/** Capture ONLY the host-authorized redacted ToolResult, after all permission and
 * redaction hooks. Full text stays in tool_result/events; the returned handle is
 * side metadata for later request projection. Never call this on raw stdout.
 * Raw streaming/spooling is deliberately not implemented here: persisting raw
 * bytes before whole-stream redaction would create a secret-bearing side channel. */
export async function captureObservation(
  ledger: ObservationLedger | undefined,
  input: { toolName: string; callId: string; result: ToolResult; source: AuthorizedRedactedText },
): Promise<{ result: ToolResult; observation?: Projection }> {
  if (!ledger?.enabled) return { result: input.result };
  if (input.source.kind !== "authorized-redacted-text" || input.source.text !== input.result.output) {
    return { result: input.result, observation: { text: input.result.output, archived: false,
      error: "ledger unavailable (EAUTH): source must equal authorized redacted event output" } };
  }
  return { result: input.result, observation: await ledger.capture({
    toolName: input.toolName, callId: input.callId, source: input.source,
  }) };
}

/** Inject into the session's existing gated tool map only when enabled. Do not
 * add to the frozen static registry. A tool instance closes over ONE session;
 * neither directory nor sessionId is accepted from model arguments. Page text is
 * <=16KB/400 lines; the small JSON cursor envelope is additional protocol bytes. */
export function createObservationRecallTool(ledger: ObservationLedger): Tool | undefined {
  if (!ledger.enabled) return undefined;
  return {
    name: "obs_recall",
    async run(args): Promise<ToolResult> {
      const allowed = new Set(["id", "by", "offset", "max", "byteInLine"]);
      if (Object.keys(args).some(key => !allowed.has(key)) || typeof args.id !== "string" ||
          (args.by !== undefined && args.by !== "bytes" && args.by !== "lines") ||
          [args.offset, args.max, args.byteInLine].some(v => v !== undefined && typeof v !== "number")) {
        return { ok: false, output: "obs_recall: EINVAL (invalid paging arguments)" };
      }
      try {
        const page = await ledger.recall(args as unknown as RecallInput);
        return { ok: true, output: JSON.stringify(page) };
      } catch (e) {
        const code = (e as { code?: string })?.code;
        return { ok: false, output: `obs_recall: ${typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? code : "EIO"} (archive unavailable; retain original event output)` };
      }
    },
  };
}
