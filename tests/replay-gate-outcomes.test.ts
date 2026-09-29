// 复跑面 `replay:gate-outcomes` 的取料与计数判卷（judgment-layer §7 第 2 步的分子）。
//
// 这条读数面的存在理由与它守的错法同形：**"0 条人工判定"与"根本没有判定面"长得一模一样**。
// 所以判卷重点不在"数得对"，而在三件事：矩阵骨架铺满（新格子不会静默缺席）、
// join 不上的不丢、表外字面量单独记账（不许混进矩阵，也不许当没有）。
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GATE_LAYERS, GATE_VERDICTS } from "../src/permissions";
import { cellOf, emptyCells, tallyGateEvents } from "../scripts/replay/gate-outcomes";
import { execMixOf } from "../scripts/replay/verify-cause-mix";
import { REPLAY_READINGS } from "../scripts/replay-readings";

const call = (id: string, name: string) => ({ type: "tool_call", id, name, args: {} });
const result = (callId: string, gate?: { layer: string; verdict: string }) =>
  ({ type: "tool_result", callId, ok: true, output: "x", ...(gate ? { gate } : {}) });

describe("gate-outcomes 的矩阵骨架与表外值", () => {
  it("骨架格子数 = 层数 × 结果数（任一侧加值，格数自动跟上，不靠人记得补）", () => {
    expect(emptyCells().size).toBe(GATE_LAYERS.length * GATE_VERDICTS.length);
    for (const l of GATE_LAYERS) for (const v of GATE_VERDICTS) expect(emptyCells().has(cellOf(l, v))).toBe(true);
  });

  it("表外 layer / verdict 单独记账：既不混进矩阵，也不静默丢掉", () => {
    const t = tallyGateEvents([
      call("c1", "write_file"),
      result("c1", { layer: "L9-未来层", verdict: "approved" }),
      call("c2", "edit_file"),
      result("c2", { layer: "L3-mode", verdict: "某种新结果" }),
    ]);
    expect([...t.cells.values()].every((n) => n === 0)).toBe(true);
    expect(t.unknownLayer.get("L9-未来层")).toBe(1);
    expect(t.unknownVerdict.get("某种新结果")).toBe(1);
    expect(t.withGate).toBe(2); // 留痕在场这件事照常计数
  });
});

describe("gate-outcomes 的分母与两种口径", () => {
  it("只有受管工具进分母；join 不上 tool_call 的记 unmatched，不当没有", () => {
    const t = tallyGateEvents([
      call("c1", "write_file"),
      result("c1", { layer: "L3-mode", verdict: "approved" }),
      call("c2", "read_file"), // 非受管
      result("c2", { layer: "L3-mode", verdict: "approved" }),
      result("c3", { layer: "L3-mode", verdict: "approved" }), // 没有对应 tool_call
    ]);
    expect(t.gatedResults).toBe(1);
    expect(t.withGate).toBe(1);
    expect(t.unmatched).toBe(1);
  });

  it("同一份事件流上，两个读数面的 join 不上是同一个数（索引共用，不各抄一份）", () => {
    const raws = [
      call("c1", "run_shell"), result("c1"),
      result("ghost-a"), result("ghost-b"),
    ];
    expect(tallyGateEvents(raws).unmatched).toBe(2);
    expect(execMixOf(raws).unmatched).toBe(2);
  });

  it("denied 计可标（读数 A 口径）却不计问过人的——两个数不是一回事", () => {
    const t = tallyGateEvents([
      call("a", "write_file"),
      result("a", { layer: "L0-hard", verdict: "denied" }),
      call("b", "edit_file"),
      result("b", { layer: "L4-risk", verdict: "rejected" }),
      call("c", "run_shell"),
      result("c", { layer: "L4-pass", verdict: "auto-approved" }),
    ]);
    expect(t.labelable).toBe(2); // denied + rejected
    expect(t.humanAnswered).toBe(1); // 只有 rejected 问过并得到回答
    expect(t.rejected).toBe(1);
    expect(t.cells.get(cellOf("L4-pass", "auto-approved"))).toBe(1); // 免批那格也在矩阵里：它是分母的另一半
  });

  it("gate-outcomes 已在复跑面登记表里（登记 = 有文档引用它，docs-check D-8 两侧都盯）", () => {
    const ids = REPLAY_READINGS.map((r) => r.id);
    expect(ids).toContain("gate-outcomes");
    expect(new Set(ids).size).toBe(ids.length);
    const row = REPLAY_READINGS.find((r) => r.id === "gate-outcomes");
    expect(existsSync(new URL("../" + (row?.script ?? ""), import.meta.url))).toBe(true);
  });
});
