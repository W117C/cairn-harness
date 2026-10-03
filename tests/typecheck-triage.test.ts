// typecheck 门的归因面（纯函数，不 spawn 进程）：别人未跟踪的草稿把整树 tsc 弄红时，
// 必须一眼看出「HEAD 干净」，否则每回都要开一次 HEAD worktree 对照（本仓已发生两次）。
// 第 330 页补第三档（任务 #33）：**已跟踪但工作树脏**的文件带着未提交 hunk 被报红时，从前读成「HEAD 内」——
// 主树两次现读同一形状（第 328 页补、第 329 页），所以这一档不许并进任何一头。
// 判定不被这里放宽：退出码照抄 tsc，草稿也是错，只是不该记在 HEAD 账上；「在飞 tracked」也不许换成豁免。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { triageTypecheck, triageVerdict } from "../scripts/lib/typecheck-triage";

const ERR_A = "scripts/sidebar-probe.ts(31,7): error TS2345: Argument of type 'x' is not assignable.";
const ERR_A2 = "scripts/sidebar-probe.ts(40,9): error TS18046: 'v' is of type 'unknown'.";
const ERR_B = "src/agent/loop.ts(12,3): error TS2322: Type 'number' is not assignable to type 'string'.";
const CLEAN = new Set<string>();

describe("typecheck 报错归因", () => {
  it("全在未跟踪草稿：head 空、scratch 列出该文件，并明说 HEAD 类型干净", () => {
    const t = triageTypecheck([ERR_A, ERR_A2].join("\n"), new Set(["scripts/sidebar-probe.ts"]), CLEAN);
    expect(t.total).toBe(1); // 同一文件多条错只算一个文件
    expect(t.head).toEqual([]);
    expect(t.scratch).toEqual(["scripts/sidebar-probe.ts"]);
    const v = triageVerdict(t);
    expect(v.join("\n")).toContain("未跟踪草稿");
    expect(v.join("\n")).toContain("HEAD 态类型干净");
  });

  it("混合：草稿与 HEAD 缺陷分开列（HEAD 那部分照常是红，不给豁免）", () => {
    const t = triageTypecheck([ERR_A, ERR_B].join("\n"), new Set(["scripts/sidebar-probe.ts"]), CLEAN);
    expect(t.head).toEqual(["src/agent/loop.ts"]);
    expect(t.scratch).toEqual(["scripts/sidebar-probe.ts"]);
    const v = triageVerdict(t).join("\n");
    expect(v).toContain("HEAD 内 1");
    expect(v).not.toContain("HEAD 态类型干净"); // 有真缺陷时不得说这句
  });

  it("路径含空格也能解析（本仓目录名就有空格；按空白切会截出半个路径）", () => {
    const spaced = "/Users/ze/Downloads/deepseek harness/scripts/ui probe.ts(5,1): error TS2304: Cannot find name.";
    const t = triageTypecheck(spaced, new Set(["/Users/ze/Downloads/deepseek harness/scripts/ui probe.ts"]), CLEAN);
    expect(t.scratch).toEqual(["/Users/ze/Downloads/deepseek harness/scripts/ui probe.ts"]);
    expect(t.head).toEqual([]);
  });

  it("★已跟踪但工作树脏 ⇒ 归「在飞改动中的 tracked」，既不算 HEAD 缺陷也不算草稿（两次现读的都是这一格）", () => {
    const t = triageTypecheck([ERR_A, ERR_B].join("\n"), new Set(["scripts/sidebar-probe.ts"]), new Set(["src/agent/loop.ts"]));
    expect(t.head, "隔壁未提交的 hunk 不该记在 HEAD 账上").toEqual([]);
    expect(t.dirtyTracked).toEqual(["src/agent/loop.ts"]);
    const v = triageVerdict(t).join("\n");
    expect(v).toContain("在飞改动中的 tracked 1");
    expect(v, "分不清就不许说这句（这一格要的是复认，不是假绿）").not.toContain("HEAD 态类型干净");
    expect(v, "也不许反过来把它当已证的 HEAD 缺陷").not.toContain("HEAD 内 1");
  });

  it("零报错不打任何归因行；工作树状态取不到时归「没有归位」，两头结论都不许给", () => {
    expect(triageVerdict(triageTypecheck("", CLEAN, CLEAN))).toEqual([]);
    // untracked 那一路 git 失败仍是空集（保守：绝不为草稿开脱），但 dirty=null 表示"这一格没量到"
    const t = triageTypecheck(ERR_B, CLEAN, null);
    expect(t.undetermined).toEqual(["src/agent/loop.ts"]);
    expect(t.head).toEqual([]);
    const v = triageVerdict(t).join("\n");
    expect(v).toContain("没有归位");
    expect(v).not.toContain("HEAD 态类型干净");
  });

  it("四档相加＝分母（哪一档被漏计或重复计，这一句就自己红）", () => {
    const cases: Array<[string, ReadonlySet<string>, ReadonlySet<string> | null]> = [
      [ERR_A, new Set(["scripts/sidebar-probe.ts"]), CLEAN],
      [ERR_B, CLEAN, CLEAN],
      [ERR_B, CLEAN, new Set(["src/agent/loop.ts"])],
      [ERR_B, CLEAN, null],
      [ERR_A + "\n" + ERR_B, new Set(["scripts/sidebar-probe.ts"]), new Set(["src/agent/loop.ts"])],
    ];
    for (const [out, un, dirty] of cases) {
      const t = triageTypecheck(out, un, dirty);
      const sum = t.head.length + t.dirtyTracked.length + t.scratch.length + t.undetermined.length;
      expect(sum, out).toBe(t.total);
      expect(triageVerdict(t).join("\n"), out).toContain("四档相加＝" + String(t.total));
    }
  });

  it("★接线：门把 dirtyTrackedSet 真的传进归因（算出来不接＝恒绿）", () => {
    const gate = readFileSync(fileURLToPath(new URL("../scripts/typecheck.ts", import.meta.url)), "utf8");
    expect(gate).toContain("triageTypecheck(out, untrackedSet(process.cwd()), dirtyTrackedSet(process.cwd()))");
    expect(gate).toContain('["diff", "--name-only", "HEAD"]');
    expect(gate).toContain("function dirtyTrackedSet(cwd: string): Set<string> | null {");
  });

  it("★工作树状态取不到时返回 null，不许退回空集（空集＝向归因谎报「全都干净」）", () => {
    const gate = readFileSync(fileURLToPath(new URL("../scripts/typecheck.ts", import.meta.url)), "utf8");
    expect(gate).toContain("if (r.status !== 0) return null;");
    expect(gate).not.toMatch(/dirtyTrackedSet[\s\S]{0,240}return new Set\(\);/u);
  });
});
