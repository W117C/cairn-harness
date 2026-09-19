// 变异表针脚静态预检的判据本体（scripts/lib/mutate-gates.ts）。
// 动因（2026-09-19）：把被锚定的实现搬进共用原语后忘了改指锚点 ⇒ 那条变异成了空操作，
// 而要等整张表跑完才会红——整跑常被并发堵几天。这条秒级门把「重构后改指」变成机械要求。
import { describe, expect, it } from "vitest";
import {
  auditNeedles, classifyArgs, isLineWiseApply, needleHits, needleProblemLine, needleSeverity,
} from "../scripts/lib/mutate-gates";

const SRC = "const a = 1;\nconst b = a + 1;\nconst a2 = 1;\n";

describe("needleHits", () => {
  it("唯一命中记 1，无命中记 0，多处命中如实计数", () => {
    expect(needleHits("const b = a + 1;", SRC)).toBe(1);
    expect(needleHits("const z = 9;", SRC)).toBe(0);
    expect(needleHits("const ", SRC)).toBe(3);
  });

  it("空针脚与源文件读不到用负值区分开（两者后果不同，不能都算 0）", () => {
    expect(needleHits("", SRC)).toBe(-2);
    expect(needleHits("const b = a + 1;", null)).toBe(-1);
  });
});

describe("needleSeverity", () => {
  it("hits=1 通过；>1 只待复认；0/负值是阻断", () => {
    expect(needleSeverity(1)).toBe("ok");
    expect(needleSeverity(3)).toBe("warn");
    expect(needleSeverity(0)).toBe("blocking");
    expect(needleSeverity(-1)).toBe("blocking");
    expect(needleSeverity(-2)).toBe("blocking");
  });
});

describe("auditNeedles", () => {
  const entries = [
    { id: "good", srcRel: "src/a.ts", needle: "const b = a + 1;" },
    { id: "stale", srcRel: "src/a.ts", needle: "const gone = 1;" },
    { id: "ambiguous", srcRel: "src/a.ts", needle: "const " },
    { id: "missing-src", srcRel: "src/gone.ts", needle: "x" },
  ];
  const read = (rel: string) => (rel === "src/a.ts" ? SRC : null);

  it("只报命中次数 ≠ 1 的，并按传入顺序", () => {
    expect(auditNeedles(entries, read).map((p) => p.id)).toEqual(["stale", "ambiguous", "missing-src"]);
  });

  it("读取次数 = 不同源文件数（全表 220 条指向约 90 个文件，逐条重复读会把秒级门拖成分钟级）", () => {
    let reads = 0;
    auditNeedles(entries, () => { reads++; return SRC; });
    expect(reads).toBe(2); // src/a.ts 与 src/gone.ts；同文件的四条只读一次
  });

  it("空表零问题（新增门在表为空时不得假红）", () => {
    expect(auditNeedles([], () => null)).toEqual([]);
  });
});

describe("needleProblemLine", () => {
  it("针脚失效：说清是哪条、哪个源、以及该怎么修（改指）", () => {
    const line = needleProblemLine({ id: "stale", srcRel: "src/a.ts", hits: 0, needle: "const gone = 1;" });
    expect(line).toContain("stale");
    expect(line).toContain("src/a.ts");
    expect(line).toContain("变异必然不生效");
    expect(line).toContain("const gone = 1;");
  });

  it("多处命中：给出次数，不替人下结论", () => {
    const line = needleProblemLine({ id: "ambiguous", srcRel: "src/a.ts", hits: 3, needle: "const " });
    expect(line).toContain("命中 3 处");
  });

  it("针脚超长只截前 60 字（一行一条，门输出要能扫）", () => {
    const line = needleProblemLine({ id: "long", srcRel: "src/a.ts", hits: 0, needle: "x".repeat(300) });
    expect(line.length).toBeLessThan(160);
  });
});

describe("classifyArgs（未知 flag 必须当场拒，不能退化成「跑全表」）", () => {
  it("已知 flag 各归其 mode，位置参数进 targets", () => {
    expect(classifyArgs(["--list"])).toEqual({ mode: "list", unknown: [], targets: [] });
    expect(classifyArgs(["--check-needles"])).toEqual({ mode: "check-needles", unknown: [], targets: [] });
    expect(classifyArgs(["a-id", "b-id"])).toEqual({ mode: "run", unknown: [], targets: ["a-id", "b-id"] });
  });

  it("无参数仍是 run（缺省语义不被这条破坏）", () => {
    expect(classifyArgs([]).mode).toBe("run");
  });

  it("拼错/未实现的 flag 落进 unknown，且不混进 targets", () => {
    const p = classifyArgs(["--cheek-needles", "some-id"]);
    expect(p.unknown).toEqual(["--cheek-needles"]);
    expect(p.targets).toEqual(["some-id"]);
  });
});

describe("isLineWiseApply（逐行式 apply 的多处命中即设计）", () => {
  it("认得 split/map 式写法，普通单点 replace 不误判", () => {
    expect(isLineWiseApply('(s) => s.split("\\n").map((l) => (l.includes("e.output") ? l : l)).join("\\n")')).toBe(true);
    expect(isLineWiseApply('(s) => s.replace("if (a) {", "if (false) {")')).toBe(false);
  });
});
