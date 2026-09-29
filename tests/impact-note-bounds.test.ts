// impact 回注提示的体积面（能力 9）。无跨文件调用点是**最常见**分支，
// 而它的 symbols 清单此前逐字 join——大文件的上百个定义（含函数内局部名）会整串进 tool_result。
// 查询端（tools/impact-query.ts）对同一份清单一直有 SYMS_CAP，这一头没有：又一处只在一头生效。
import { describe, expect, it } from "vitest";
import { contextNoteFor, IMPACT_CONTEXT_SYMBOLS_PER_FILE, type FileImpactReport } from "../src/agent/impact";

function report(symbols: string[], up: FileImpactReport["up"] = []): FileImpactReport {
  // graphFiles / graphCandidates / ambiguousSymbols 只服务查询端的自述（覆盖面、同名歧义），
  // 注入摘要 contextNoteFor 三支都不读 ⇒ 这里给真值即可。
  return { file: "src/a.ts", symbols, up, truncated: false, graphFiles: 1, graphCandidates: 1, ambiguousSymbols: [] };
}

describe("无跨文件调用点分支的符号清单有界", () => {
  it("300 个定义只列前 4 个，并如实报出总数与全量位置", () => {
    const symbols = Array.from({ length: 300 }, (_unused, i) => "sym" + String(i));
    const r = report(symbols);
    const note = contextNoteFor(r);
    expect(note).toContain("等 300 个（全量在 impact_report 事件）");
    expect(note).toContain("sym0");
    expect(note).toContain("sym" + String(IMPACT_CONTEXT_SYMBOLS_PER_FILE - 1));
    expect(note).not.toContain("sym" + String(IMPACT_CONTEXT_SYMBOLS_PER_FILE));
    expect(note.length).toBeLessThan(300); // 旧实现：300 个名字逐字 join
    expect(note).toContain("无跨文件调用点");
    // 收窄只作用在注入面：报告本体（事件与面板的数据源）必须还是全量，
    // 否则「全量在 impact_report 事件」这句就是假话。
    expect(r.symbols).toHaveLength(300);
  });

  it("符号数不超过每文件帽时逐字列出（零回归：不加计数尾）", () => {
    const note = contextNoteFor(report(["alpha", "beta"]));
    expect(note).toContain("alpha, beta");
    expect(note).not.toContain("等 ");
  });

  it("无定义时仍写「（无）」", () => {
    expect(contextNoteFor(report([]))).toContain("定义符号 （无）");
  });

  it("有跨文件调用点的分支不受这条收窄影响", () => {
    const note = contextNoteFor(report(["alpha"], [{ file: "src/b.ts", symbol: "alpha", line: 7 }]));
    expect(note).toContain("跨文件调用点");
    expect(note).toContain("alpha(L7)");
  });
});
