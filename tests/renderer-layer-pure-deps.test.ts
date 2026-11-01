import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkI3 } from "../scripts/renderer-layer-check";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(shared: string, throughLedger = false): { root: string; entry: string } {
  const root = mkdtempSync(join(tmpdir(), "cairn-pure-deps-"));
  roots.push(root);
  const write = (file: string, text: string): string => {
    const full = join(root, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
    return full;
  };
  write("src/agent/subflow.ts", shared);
  write("src/main/usage-ledger.ts", 'export { isWorker } from "../agent/subflow";');
  const target = throughLedger ? "main/usage-ledger" : "agent/subflow";
  const entry = write("apps/desktop/src/renderer/derived/session.ts", `export { isWorker } from "../../../../../src/${target}";`);
  return { root, entry };
}

describe("派生层共享纯依赖", () => {
  it("共享判据直接或经用量账本引用均可，且循环依赖不会无限递归", () => {
    for (const viaLedger of [false, true]) {
      const { root, entry } = fixture('import { isWorker as shared } from "../main/usage-ledger";\nexport const isWorker = (id: unknown) => typeof id === "string" && id !== "";', viaLedger);
      expect(checkI3([entry], root)).toEqual([]);
    }
  });

  it.each([
    ['时钟', 'export const isWorker = () => Date.now();'],
    ['随机', 'export const isWorker = () => Math.random();'],
    ['可变态', 'let counter = 0;\nexport const isWorker = () => ++counter;'],
    ['IO', 'import { readFileSync } from "node:fs";\nexport const isWorker = readFileSync;'],
  ])("经已登记账本间接引入%s仍拒绝并指出真正来源", (_name, source) => {
    const { root, entry } = fixture(source, true);
    const violations = checkI3([entry], root);
    expect(violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "I3", file: "src/agent/subflow.ts" }),
    ]));
  });

  it("登记一个纯模块不会放开整个 agent 目录", () => {
    const { root, entry } = fixture('export { isWorker } from "./runtime";');
    writeFileSync(join(root, "src/agent/runtime.ts"), "export const isWorker = 1;");
    expect(checkI3([entry], root)).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "I3", file: "src/agent/subflow.ts", message: expect.stringContaining("src/agent/runtime.ts") }),
    ]));
  });
});
