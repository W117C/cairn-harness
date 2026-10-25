import type { UsageLedgerPayload } from "../../../../src/main/ipc-protocol";
export type UsageAllState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: Extract<UsageLedgerPayload, { ok: true }> }
  | { status: "error"; error: string };
