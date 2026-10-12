import { describe, it, expect } from "vitest";
import { extractSignals } from "../src/agent/evolution/signal.js";
import { strategyPatches, renderPatches, MAX_PATCHES_PER_RUN } from "../src/agent/evolution/strategy-patch.js";
import { runEvolution, loadEvolution, evolutionPromptNote, persistEvolution } from "../src/agent/evolution/index.js";
import type { AgentEvent } from "../src/events/index.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ev = (e: Record<string, unknown>): AgentEvent => e as unknown as AgentEvent;

describe("evolution extractSignals", () => {
  it("counts verify failures by cause and flags repeated cause ≥3", () => {
    const events: AgentEvent[] = [
      ev({ type: "verify_result", callId: "v1", ok: false, attempt: 1, maxAttempts: 3, cause: "pkg-manager", results: [] }),
      ev({ type: "verify_result", callId: "v2", ok: false, attempt: 2, maxAttempts: 3, cause: "pkg-manager", results: [] }),
      ev({ type: "verify_result", callId: "v3", ok: false, attempt: 3, maxAttempts: 3, cause: "pkg-manager", results: [] }),
    ];
    const s = extractSignals(events);
    expect(s.verifyFailuresByCause["pkg-manager"]).toBe(3);
    expect(s.repeatedVerifyCause).toBe("pkg-manager");
    expect(s.verifyOutcome).toBe("red");
  });

  it("green when last verify ok", () => {
    const events: AgentEvent[] = [
      ev({ type: "verify_result", callId: "v1", ok: true, attempt: 1, maxAttempts: 3, results: [] }),
    ];
    expect(extractSignals(events).verifyOutcome).toBe("green");
    expect(extractSignals(events).repeatedVerifyCause).toBeNull();
  });

  it("no verify ⇒ verifyOutcome none", () => {
    expect(extractSignals([]).verifyOutcome).toBe("none");
  });
});

describe("evolution strategyPatches", () => {
  it("emits verify-escalate on repeated cause", () => {
    const s = extractSignals([
      ev({ type: "verify_result", callId: "v1", ok: false, cause: "code", attempt: 1, maxAttempts: 3, results: [] }),
      ev({ type: "verify_result", callId: "v2", ok: false, cause: "code", attempt: 2, maxAttempts: 3, results: [] }),
      ev({ type: "verify_result", callId: "v3", ok: false, cause: "code", attempt: 3, maxAttempts: 3, results: [] }),
    ]);
    const p = strategyPatches(s);
    expect(p.some((x) => x.kind === "verify-escalate" && x.cause === "code")).toBe(true);
  });

  it("emits nothing when signals are clean (no false positive)", () => {
    const p = strategyPatches({
      verifyFailuresByCause: {}, repeatedVerifyCause: null, verifyOutcome: "green",
      goalDriftCount: 0, costMeasurable: true, tokensPerBoundary: 1000, spendAfterLastBoundary: 0, eventCount: 5,
    });
    expect(p).toHaveLength(0);
  });

  it("bounds patches to MAX_PATCHES_PER_RUN", () => {
    const p = strategyPatches({
      verifyFailuresByCause: { code: 5 }, repeatedVerifyCause: "code", verifyOutcome: "red",
      goalDriftCount: 3, costMeasurable: true, tokensPerBoundary: 999_000, spendAfterLastBoundary: 0, eventCount: 100,
    });
    expect(p.length).toBeLessThanOrEqual(MAX_PATCHES_PER_RUN);
  });

  it("renderPatches produces empty string for no patches", () => {
    expect(renderPatches([])).toBe("");
  });
});

describe("evolution store + wiring", () => {
  it("runEvolution persists and loadEvolution reads back", async () => {
    const ws = await mkdtemp(join(tmpdir(), "evo-"));
    try {
      const events: AgentEvent[] = [
        ev({ type: "verify_result", callId: "v1", ok: false, cause: "code", attempt: 1, maxAttempts: 3, results: [] }),
        ev({ type: "verify_result", callId: "v2", ok: false, cause: "code", attempt: 2, maxAttempts: 3, results: [] }),
        ev({ type: "verify_result", callId: "v3", ok: false, cause: "code", attempt: 3, maxAttempts: 3, results: [] }),
      ];
      const res = await runEvolution(events, ws, "test-session.jsonl");
      expect(res.persistedTo).not.toBeNull();
      expect(res.patches.length).toBeGreaterThan(0);
      const rec = await loadEvolution(ws);
      expect(rec).not.toBeNull();
      expect(rec!.patches).toHaveLength(res.patches.length);
      expect(rec!.fromSession).toBe("test-session.jsonl");
      const note = await evolutionPromptNote(ws);
      expect(note).toContain("[evolution]");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("loadEvolution returns null on missing/corrupt file (fail-closed, no fabrication)", async () => {
    const ws = await mkdtemp(join(tmpdir(), "evo-"));
    try {
      expect(await loadEvolution(ws)).toBeNull();
      const note = await evolutionPromptNote(ws);
      expect(note).toBe("");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("reverse validation: no repeated cause ⇒ no verify-escalate patch", () => {
    const s = extractSignals([
      ev({ type: "verify_result", callId: "v1", ok: false, cause: "code", attempt: 1, maxAttempts: 3, results: [] }),
      ev({ type: "verify_result", callId: "v2", ok: true, attempt: 2, maxAttempts: 3, results: [] }),
    ]);
    expect(s.repeatedVerifyCause).toBeNull();
    expect(strategyPatches(s).some((x) => x.kind === "verify-escalate")).toBe(false);
  });
});
