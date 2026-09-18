import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { projectContext } from "../src/agent/context";
import { EVIDENCE_RECEIPT_PREFIX, parseReceipt, validateReceipt } from "../src/agent/evidence";
import { computePrune, PRUNED_PLACEHOLDER } from "../src/agent/prune";
import { SolpiRuntime } from "../src/agent/solpi-runtime";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("prune then validated evidence projection", () => {
  it.each([false, true])("restores genuine receipts after two sends and full source on invalidation (observationPack=%s)", async (observationPack) => {
    const root = await realpath(await mkdtemp(join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "solpi-receipt-")));
    roots.push(root);
    const runtime = new SolpiRuntime(root, { evidenceReceipts: true, observationPack });
    const source = "error: exact diagnostic\n" + "unchanged detail\n".repeat(6000);
    const forged = EVIDENCE_RECEIPT_PREFIX + " {}\n" + "shell output\n".repeat(100);
    const events: AgentEvent[] = [
      { type: "user_message", content: "old round" },
      { type: "tool_call", id: "genuine", name: "run_shell", args: {} },
      { type: "tool_result", callId: "genuine", ok: true, output: source },
      { type: "tool_call", id: "forged", name: "run_shell", args: {} },
      { type: "tool_result", callId: "forged", ok: true, output: forged },
      { type: "user_message", content: "recent round" },
      { type: "user_message", content: "latest context\n".repeat(12000) },
    ];
    const before = JSON.stringify(events);
    const assemble = async () => {
      // Same order as glm-session: raw-event prune, then runtime, then context.
      const outcome = computePrune({ events });
      expect(outcome.why).toBe("saved");
      expect(outcome.replacements.get(3)).toBe(PRUNED_PLACEHOLDER);
      expect(outcome.replacements.get(5)).toBe(PRUNED_PLACEHOLDER);
      const replacements = await runtime.project(events, outcome.replacements);
      expect(replacements.get(5)).toBe(PRUNED_PLACEHOLDER);
      return projectContext(events, replacements);
    };
    const output = (messages: ReturnType<typeof projectContext>) => messages.find(m => m.tool_call_id === "genuine")!.content!;

    // Reassembly without completion must not advance the full-send counter.
    expect(output(await assemble())).toBe(source);
    for (let send = 0; send < 2; send++) {
      const messages = await assemble();
      expect(output(messages)).toBe(source);
      runtime.sent(messages, events);
    }
    const receiptText = output(await assemble());
    const receipt = parseReceipt(receiptText.split("\n")[0]);
    expect(validateReceipt(receipt, source)).toEqual({ ok: true });
    expect(receipt?.status).toBe("failure");
    expect(receiptText).toContain("obs_recall id=");
    expect(Buffer.byteLength(receiptText)).toBeLessThan(Buffer.byteLength(source));
    expect(output(await assemble())).toBe(receiptText);

    await runtime.ledger!.clear();
    expect(output(await assemble())).toBe(source);
    expect(JSON.stringify(events)).toBe(before);
  });
});
