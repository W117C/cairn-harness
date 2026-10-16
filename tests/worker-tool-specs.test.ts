import { expect, it } from "vitest";
import { gateToolSpecs } from "../src/agent/session-provider";
import { workerToolSpecs, WORKER_TOOL_TABLE, WRITE_WORKER_TOOL_TABLE } from "../src/agent/orchestrator";

it.each(["read", "write"] as const)("%s worker exposes each executable tool exactly once", (mode) => {
  const specs = workerToolSpecs(mode);
  const names = specs.map((spec) => spec.function.name);
  expect(new Set(names).size).toBe(names.length);
  expect([...names].sort()).toEqual([...(mode === "write" ? WRITE_WORKER_TOOL_TABLE : WORKER_TOOL_TABLE)].sort());
});

it("write worker shares the remember parameters and retains main-checkout ownership guidance", () => {
  const base = gateToolSpecs().find((spec) => spec.function.name === "remember")!;
  const specs = workerToolSpecs("write").filter((spec) => spec.function.name === "remember");
  expect(specs).toHaveLength(1);
  expect(specs[0].function.parameters).toEqual(base.function.parameters);
  expect(specs[0].function.description).toContain("主 checkout");
  expect(gateToolSpecs().find((spec) => spec.function.name === "remember")).toEqual(base);
});
