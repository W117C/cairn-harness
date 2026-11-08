import { afterEach, expect, it, vi } from "vitest";
import { createWorkspaceOrchestrationBackend } from "../src/main/orchestration-backend";
import { DEFAULT_MODEL_TABLE } from "../src/providers/registry";
import type { MainModelSelection } from "../src/main/provider-runtime";

afterEach(() => vi.unstubAllEnvs());

function selection(id = "anthropic-cheap"): MainModelSelection {
  const spec = DEFAULT_MODEL_TABLE.find((row) => row.id === id)!;
  return { kind: spec.provider as MainModelSelection["kind"], spec, modelExplicit: true } as MainModelSelection;
}

it("fails closed when the selected provider has no key", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  expect(await createWorkspaceOrchestrationBackend("/tmp/orch-wiring-ws", "/tmp/orch-wiring-data", { selection: selection() })).toBeNull();
});

it("fails closed when the selected model has no complete calibrated tariff", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "fixture-key");
  expect(await createWorkspaceOrchestrationBackend("/tmp/orch-wiring-ws", "/tmp/orch-wiring-data", { selection: selection(), price: null })).toBeNull();
});
