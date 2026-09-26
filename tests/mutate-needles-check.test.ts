// 变异表针脚静态预检的判据本体（scripts/lib/mutate-gates.ts）。
// 动因（2026-09-19）：把被锚定的实现搬进共用原语后忘了改指锚点 ⇒ 那条变异成了空操作，
// 而要等整张表跑完才会红——整跑常被并发堵几天。这条秒级门把「重构后改指」变成机械要求。
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  auditNeedles, classifyArgs, duplicateIds, isLineWiseApply, needleHits, needleMoveCause, needleMoveCauseSuffix, needleProblemLine, needleSeverity,
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

// 锚点 id 必须唯一：重复时 `mutate-verify <id>` 会同时跑两条，报告里两行同 id 不同改法，
// 读的人分不清哪条活着——而"某条锚点存活"是这张表唯一的产出。
// （2026-09-23 我自己往表尾插锚点时造成一例，`--check-needles` 当时照样报"全部可判定"。）
describe("锚点 id 唯一性 duplicateIds", () => {
  it("无重复 ⇒ 空数组；成对与三连都各报一次，count 如实", () => {
    expect(duplicateIds(["a", "b", "c"])).toEqual([]);
    expect(duplicateIds(["a", "b", "a"])).toEqual([{ id: "a", count: 2 }]);
    expect(duplicateIds(["x", "y", "x", "z", "y", "x"])).toEqual([
      { id: "x", count: 3 },
      { id: "y", count: 2 },
    ]);
  });

  it("空表与单条表不误报（判据不许把「没东西」读成「有重复」）", () => {
    expect(duplicateIds([])).toEqual([]);
    expect(duplicateIds(["only"])).toEqual([]);
  });
});

/** 第 130 页：红行要自己说清「谁把这段针脚搬走的」。
 *  动因不是抽象的：第 127 页我把一批针脚红**按文件**归属，结果指错了人——
 *  那条死针脚其实是我自己两页前留下的（`git log -S` 一条就点出来）。归属能机器查，就不该留给人猜。 */
describe("针脚红的归属（needleMoveCauseSuffix）", () => {
  const gone = { id: "m", srcRel: "src/a.ts", hits: 0, needle: "const z = 9;" };

  it("只有 hits===0 才谈成因：warn（多处命中）的针脚还在盘上，查归属只会误导", () => {
    expect(needleMoveCauseSuffix({ ...gone, hits: 3 }, { sha: "aaaaaaa", subject: "x" })).toBe("");
    expect(needleMoveCauseSuffix({ ...gone, hits: -1 }, null)).toBe("");
    expect(needleMoveCauseSuffix({ ...gone, hits: -2 }, { sha: "aaaaaaa", subject: "x" })).toBe("");
  });

  it("三态分开印，且「没查到」不许被压成「查到没人搬走」", () => {
    const found = needleMoveCauseSuffix(gone, { sha: "abc1234", subject: "修：把 x 收进共用件" });
    expect(found).toContain("谁搬走的：abc1234 修：把 x 收进共用件");
    // 未取（git 坏了／调用方没接线）与"历史里从未出现"必须是两句话，且都不许含"谁搬走的："
    const notTaken = needleMoveCauseSuffix(gone, undefined);
    const neverSeen = needleMoveCauseSuffix(gone, null);
    expect(notTaken).toContain("成因未取");
    expect(neverSeen).toContain("从未出现");
    expect(notTaken).not.toContain("谁搬走的：");
    expect(neverSeen).not.toContain("谁搬走的：");
    expect(notTaken).not.toBe(neverSeen);
  });

  it("判读行：成因接在行尾，且不吞掉原来那句（老 caller 不传 cause ⇒ 明说未取，不许留白）", () => {
    const withCause = needleProblemLine(gone, { sha: "abc1234", subject: "s" });
    expect(withCause).toContain("针脚已不在源文件里");
    expect(withCause).toContain("｜谁搬走的：abc1234");
    expect(needleProblemLine(gone)).toContain("成因未取");
    // 反向：warn 档不传 cause 也不该冒出"成因"字样
    expect(needleProblemLine({ ...gone, hits: 2 })).not.toContain("成因");
  });

  it("成因取法本身可测：三态由注入的 git 决定（本模块不许自己 spawn 子进程）", () => {
    const found = needleMoveCause(gone, () => "abc1234\u001f修：把 x 收进共用件\n");
    expect(found).toEqual({ sha: "abc1234", subject: "修：把 x 收进共用件" });
    expect(needleMoveCause(gone, () => "")).toBeNull();          // git 答"没有" ⇒ 从未出现
    expect(needleMoveCause(gone, () => null)).toBeUndefined();   // git 没答上来 ⇒ 成因未取
    // warn／-1／-2 一律不查（查了只会误导），并且**一次都不该调 git**：
    let calls = 0;
    const counting = (): string => { calls += 1; return ""; };
    expect(needleMoveCause({ ...gone, hits: 3 }, counting)).toBeUndefined();
    expect(needleMoveCause({ ...gone, hits: -1 }, counting)).toBeUndefined();
    expect(calls).toBe(0);
    // 多行输出只取第一条（`-1` 已限，但注入方可能给多行）
    expect(needleMoveCause(gone, () => "dead001\u001f甲\ndead002\u001f乙")).toEqual({ sha: "dead001", subject: "甲" });
  });

  it("真 git 一次：本仓那条已知死针脚必须被点到 1f16bea（第 121 页搬走文本的那笔）", () => {
    const run = (args: readonly string[]): string | null => {
      try {
        return execFileSync("git", [...args], { cwd: resolve(__dirname, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      } catch { return null; }
    };
    const c = needleMoveCause(
      { id: "unknown-tool-silently-dropped", srcRel: "src/agent/plugins/skills.ts", hits: 0, needle: 'out.unknown.push(behavior + ":" + item);' },
      run,
    );
    expect(c?.sha).toBe("1f16bea");
    expect(c?.subject).toContain("121");
  });

  it("接线：门真跑时必须把成因喂进行builder（grep 判据文件不等于接上了，这里钉调用点）", () => {
    const mjs = readFileSync(resolve(__dirname, "..", "scripts", "mutate-verify.mjs"), "utf8")
      .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(mjs).toContain("needleProblemLine(p, needleMoveCause(p, runGit))");
    // 反向：warn 档必须**不**带成因参数（它的针脚还在盘上，查归属会误导）
    expect(mjs).toContain('for (const p of warn) console.log("⚠️ " + needleProblemLine(p));');
  });
});
