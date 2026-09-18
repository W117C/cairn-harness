import type { AuthorizedRedactedText, ObservationLedger, Projection, RecallInput } from "../agent/ledger.js";
import type { Tool, ToolResult } from "./base.js";

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
