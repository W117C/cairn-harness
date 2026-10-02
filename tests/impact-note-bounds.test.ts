// impact 回注提示的体积面（能力 9）。无跨文件调用点是**最常见**分支，
// 而它的 symbols 清单此前逐字 join——大文件的上百个定义（含函数内局部名）会整串进 tool_result。
// 查询端（tools/impact-query.ts）对同一份清单一直有 SYMS_CAP，这一头没有：又一处只在一头生效。
import { describe, expect, it } from "vitest";
import { contextNoteFor, IMPACT_CONTEXT_SYMBOLS_PER_FILE, type FileImpactReport } from "../src/agent/impact";

function report(symbols: string[], up: FileImpactReport["up"] = [], face?: { files: number; cap: number; candidates: number }, ambiguous: string[] = []): FileImpactReport {
  // ambiguousSymbols 从 10-02 起**两个消费者都读**：查询端那句早就有，注入端此前不说 ⇒
  // 缺省开的写后回注会把"波及 M 个文件"讲得比事实硬（下面那条反向证人钉住两态必须不同输出）。
  // graphFiles / graphCap / graphCandidates **被摘要读**（09-30 起）：图非全量时那句覆盖面自述
  // 要进回注，缺省给"收全"的一组 ⇒ 其余用例逐字不受影响（反向对照另有专条）。
  const face2 = face ?? { files: 1, cap: 1, candidates: 1 };
  return { file: "src/a.ts", symbols, up, truncated: false, graphFiles: face2.files, graphCap: face2.cap, graphCandidates: face2.candidates, ambiguousSymbols: ambiguous };
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

  it("同名歧义要说在「波及 M 个文件」这句旁边，且只在真有歧义时出（两态必须不同输出）", () => {
    // 真仓形状：一个 `private readFile` 的名字，被 scripts/gates.ts 之类调 fs.readFile 的文件"算成"调用方。
    const up: FileImpactReport["up"] = [
      { file: "scripts/gates.ts", symbol: "readFile", line: 12 },
      { file: "src/agent/ledger.ts", symbol: "readFile", line: 156 },
    ];
    const withAmb = contextNoteFor(report(["readFile"], up, undefined, ["readFile"]));
    const without = contextNoteFor(report(["readFile"], up));
    expect(withAmb).toContain("波及 2 个文件");
    expect(withAmb).toContain("1 个符号在别的文件也有同名定义");
    expect(withAmb).toContain("可能混有无关文件");
    // 反向证人：同一份 up 清单，只是没有歧义 ⇒ 限定句必须完全不出（出了它就是恒真文案，量不到任何东西）
    expect(without).not.toContain("同名定义");
    expect(without).toContain("波及 2 个文件");
    // 只多这一句：摘掉限定句后两句必须逐字相同（不许顺手改掉别的字节，尤其不许改掉覆盖面自述那句）
    expect(withAmb.replace(/；其中 [0-9]+ 个符号在别的文件也有同名定义，波及数按名字图算 ⇒ 清单里可能混有无关文件/, "")).toBe(without);
  });
});
