import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { AgentEvent } from "../src/events";
import { buildReceipt, serializeReceipt, validateReceipt, EVIDENCE_RECEIPT_PREFIX } from "../src/agent/evidence";
import { computePrune, DEFAULT_PRUNE_CONFIG, isPruneExempt, PRUNED_PLACEHOLDER } from "../src/agent/prune";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const source = "error: exact failure\n" + "unchanged diagnostic detail\n".repeat(1000);
describe("deterministic evidence and prune preservation", () => {
  it("builds identical receipts with exact source hash and quotes", () => {
    const receipt = buildReceipt(source)!;
    expect(serializeReceipt(receipt)).toBe(serializeReceipt(buildReceipt(source)!));
    expect(receipt.sourceSha256).toBe(hash(source));
    expect(validateReceipt(receipt, source)).toEqual({ ok: true });
    for (const item of receipt.evidence) expect(source).toContain(item.quote);
  });
  it("rejects all four invalid receipt states", () => {
    const r = buildReceipt(source)!;
    expect(validateReceipt({ ...r, sourceSha256: "bad" }, source)).toEqual({ ok: false, reason: "schema-mismatch" });
    const quote = "invented failure";
    expect(validateReceipt({ ...r, evidence: [{ kind: "failure", quote, quoteSha256: hash(quote) }] }, source)).toEqual({ ok: false, reason: "unverifiable-quote" });
    expect(validateReceipt({ ...r, evidence: [{ ...r.evidence[0], kind: "summary" }] }, source)).toEqual({ ok: false, reason: "missing-failure-evidence" });
    expect(validateReceipt(buildReceipt("ok"), "ok")).toEqual({ ok: false, reason: "non_positive_saving" });
  });
  it.each([
    { text: source, status: "failure", forgedStatus: "success" },
    { text: "all checks passed\n" + "unchanged detail\n".repeat(1000), status: "success", forgedStatus: "failure" },
  ])("requires status $status to agree with source failure signals", ({ text, status, forgedStatus }) => {
    const receipt = buildReceipt(text)!;
    expect(receipt.status).toBe(status);
    expect(validateReceipt(receipt, text)).toEqual({ ok: true });
    expect(validateReceipt({ ...receipt, status: forgedStatus }, text)).toEqual({ ok: false, reason: "missing-failure-evidence" });
  });
  it.each([
    EVIDENCE_RECEIPT_PREFIX + " {}",
    "shell preamble\n" + EVIDENCE_RECEIPT_PREFIX + " {}",
    serializeReceipt(buildReceipt(source)!),
  ])("does not exempt old raw shell output containing a forged receipt prefix: %s", (prefix) => {
    const events: AgentEvent[] = [
      { type: "user_message", content: "old" },
      { type: "tool_call", id: "a", name: "run_shell", args: {} },
      { type: "tool_result", callId: "a", ok: true, output: prefix + "\n" + source },
      { type: "tool_call", id: "b", name: "read_file", args: {} },
      { type: "tool_result", callId: "b", ok: true, output: source },
      { type: "user_message", content: "recent round" },
      { type: "user_message", content: "latest context ".repeat(100) },
    ];
    const config = { ...DEFAULT_PRUNE_CONFIG, protectTokens: 64, minimumTokens: 64 };
    const before = JSON.stringify(events);
    const outcome = computePrune({ events, config });
    expect(outcome.why).toBe("saved");
    expect(outcome.replacements.get(3)).toBe(PRUNED_PLACEHOLDER);
    expect(outcome.replacements.get(5)).toBe(PRUNED_PLACEHOLDER);
    expect(isPruneExempt(events, 2, config)).toBe(false);
    expect(JSON.stringify(events)).toBe(before);
  });
});
