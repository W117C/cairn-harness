// 双编排栈词汇单源判卷（ADR 0017）：同一个四态联合曾在主栈（WorkerEvidence）与
// 第二编排栈（EvidenceState）各定义一份、开始漂移。判据：联合字面量在 src/ 全仓只出现一次；
// 双栈都从零依赖叶子再导出。反向锚点：任何一侧再抄本地定义，本判卷当场红。
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) {
      if (name.name === "node_modules" || name.name === "vendor") continue;
      out.push(...walk(p));
    } else if (name.name.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
}

const UNION = /"verified"\s*\|\s*"failed"\s*\|\s*"stale"\s*\|\s*"absent"/;

describe("编排栈词汇单源（ADR 0017）", () => {
  it("证据四态联合在 src/ 全仓只有一处定义（src/events/evidence.ts）", () => {
    const hits = walk("src").filter((f) => UNION.test(readFileSync(f, "utf8")));
    expect(hits).toEqual(["src/events/evidence.ts"]);
  });

  it("双栈都从叶子再导出，边界面钉住", () => {
    const orch = readFileSync("src/orchestration/types.ts", "utf8");
    expect(orch).toContain('import type { WorkerEvidence as EvidenceState } from "../events/evidence"');
    expect(orch).not.toContain("export type EvidenceState =");
    const types = readFileSync("src/events/types.ts", "utf8");
    expect(types).toContain('export type { WorkerEvidence } from "./evidence"');
    expect(types).not.toContain("export type WorkerEvidence =");
  });
});
