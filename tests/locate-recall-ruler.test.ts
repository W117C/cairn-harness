// 尺的自检（`scripts/lib/probe-self-check.ts`）＋它在 `probe-locate-recall` 里的接线。
//
// 立案动因（10-02 现读）：locate-recall 的正哨兵（枢纽文件）连着几轮在所有预算档 MISS，
// 而脚本**退 0** ⇒ 那天的能力复测把「A 臂 4/16」当成能力 1 的分数写进了报告，
// 没人被迫去看"哨兵失败 ⇒ 整张表的命中率不可引用"。本文件钉的就是"不响"这件事本身。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rulerSelfCheck } from "../scripts/lib/probe-self-check";

describe("尺的自检：正哨兵与负控各拦一种坏形状", () => {
  it("两格都正 ⇒ ok，why 空（自检不许无事生非）", () => {
    expect(rulerSelfCheck(true, false)).toEqual({ ok: true, why: "" });
  });

  it("正哨兵从没命中过 ⇒ 不 ok，且明说这一列不可引用", () => {
    const r = rulerSelfCheck(false, false);
    expect(r.ok).toBe(false);
    // 钉整句里那段唯一的措辞，不钉「不可引用」那种裸词：裸词在 `eval-arms.ts` 等处也有副本，
    // 改生产那句不会红（顶包候选，prose-needle-scan 现读点过名）。
    expect(r.why).toContain("命中率这一列不可引用");
  });

  it("负控命中 ⇒ 不 ok（松定义把变好的读数一起作废）", () => {
    const r = rulerSelfCheck(true, true);
    expect(r.ok).toBe(false);
    expect(r.why).toContain("命中定义太松");
  });

  /* 两格同时坏时的**先后**也是判据：负控比哨兵更坏（它作废整张表，包括"看起来变好"的那些），
   * 而两者的修法相反 ⇒ 先报哪个决定下一步去动哪里。钉"等于只有负控那一格的说明"，
   * 而不是再抄一句生产文案（抄第二遍就成了顶包候选）。 */
  it("两种坏同时成立时先报负控，不许把更坏的那格藏在下一次迭代", () => {
    expect(rulerSelfCheck(false, true).why).toBe(rulerSelfCheck(true, true).why);
  });
});

describe("自检真的接在尺上（不是只写了一个函数）", () => {
  const src = readFileSync(fileURLToPath(new URL("../scripts/probe-locate-recall.ts", import.meta.url)), "utf8");

  it("尺吃 lib 里那一份判据，且自检不过就退非零", () => {
    expect(src).toContain('import { rulerSelfCheck } from "./lib/probe-self-check";');
    expect(src).toContain("const selfCheck = rulerSelfCheck(");
    expect(src).toContain("if (!selfCheck.ok) process.exit(1);");
  });

  /* 哨兵/负控的取样必须**跨全部预算档**取"任一档命中过"：
   * 从前只比最大档也行，但把 Map 写成只记最后一档，负控就永远采不到——那条变异由上面那条钉不住。
   * 针脚形状（10-02 改）：这行原来钉的是整串字面量 `rA > 0 || rB > 0`，本支加出第三臂（C＝只条件化）
   * 之后它判 0 命中——字面量针脚把「臂变多了」读成「接线没了」。改成**按臂枚举**的结构式判据：
   * 每一臂都得在取样条件里出现，且那一格不许只挑一档。 */
  it("每题的命中记录喂的是 hitAnyBudget，不是某单一档", () => {
    const guard = /if \(([^)]*)\)\s*hitAnyBudget\.set\(q\.id, true\);/u.exec(src)?.[1] ?? "";
    expect(guard, "取样那一行读不到（`hitAnyBudget.set` 的守卫形状变了）").not.toBe("");
    for (const arm of ["rA", "rC", "rB"]) {
      expect(guard.includes(arm), `取样条件里少了 ${arm} 这一臂 ⇒ 那一臂的命中采不到`).toBe(true);
    }
    expect(guard, "不许把取样收成「只看最大档」").not.toMatch(/bi === BUDGETS\.length - 1/);
    expect(src).toContain('rulerSelfCheck(hitAnyBudget.get("L-POS") === true, hitAnyBudget.get("L-NEG") === true)');
  });
});
