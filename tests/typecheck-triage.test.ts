// typecheck 门的归因面（纯函数，不 spawn 进程）：别人未跟踪的草稿把整树 tsc 弄红时，
// 必须一眼看出「HEAD 干净」，否则每回都要开一次 HEAD worktree 对照（本仓已发生两次）。
// 判定不被这里放宽：退出码照抄 tsc，草稿也是错，只是不该记在 HEAD 账上。
import { describe, expect, it } from "vitest";
import { triageTypecheck, triageVerdict } from "../scripts/lib/typecheck-triage";

const ERR_A = "scripts/sidebar-probe.ts(31,7): error TS2345: Argument of type 'x' is not assignable.";
const ERR_A2 = "scripts/sidebar-probe.ts(40,9): error TS18046: 'v' is of type 'unknown'.";
const ERR_B = "src/agent/loop.ts(12,3): error TS2322: Type 'number' is not assignable to type 'string'.";

describe("typecheck 报错归因", () => {
  it("全在未跟踪草稿：tracked 空、scratch 列出该文件，并明说 HEAD 类型干净", () => {
    const t = triageTypecheck([ERR_A, ERR_A2].join("\n"), new Set(["scripts/sidebar-probe.ts"]));
    expect(t.total).toBe(1); // 同一文件多条错只算一个文件
    expect(t.tracked).toEqual([]);
    expect(t.scratch).toEqual(["scripts/sidebar-probe.ts"]);
    const v = triageVerdict(t);
    expect(v.join("\n")).toContain("未跟踪草稿");
    expect(v.join("\n")).toContain("HEAD 态类型干净");
  });

  it("混合：草稿与 HEAD 缺陷分开列（HEAD 那部分照常是红，不给豁免）", () => {
    const t = triageTypecheck([ERR_A, ERR_B].join("\n"), new Set(["scripts/sidebar-probe.ts"]));
    expect(t.tracked).toEqual(["src/agent/loop.ts"]);
    expect(t.scratch).toEqual(["scripts/sidebar-probe.ts"]);
    const v = triageVerdict(t).join("\n");
    expect(v).toContain("HEAD 内 1 个");
    expect(v).not.toContain("HEAD 态类型干净"); // 有真缺陷时不得说这句
  });

  it("路径含空格也能解析（本仓目录名就有空格；按空白切会截出半个路径）", () => {
    const spaced = "/Users/ze/Downloads/deepseek harness/scripts/ui probe.ts(5,1): error TS2304: Cannot find name.";
    const t = triageTypecheck(spaced, new Set(["/Users/ze/Downloads/deepseek harness/scripts/ui probe.ts"]));
    expect(t.scratch).toEqual(["/Users/ze/Downloads/deepseek harness/scripts/ui probe.ts"]);
    expect(t.tracked).toEqual([]);
  });

  it("零报错不打任何归因行；git 不可用时（空集）一律按 HEAD 内报（保守）", () => {
    expect(triageVerdict(triageTypecheck("", new Set()))).toEqual([]);
    const t = triageTypecheck(ERR_B, new Set());
    expect(t.tracked).toEqual(["src/agent/loop.ts"]);
    expect(t.scratch).toEqual([]);
  });
});
