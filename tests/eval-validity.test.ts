// 判卷分母口径的判卷（2026-10-02）。
//
// 缘起是一次**真实误报**：按计划书原命令跑 12 条 × 3 rep（36 趟），32 趟死在
// OpenRouter 免费档日配额（`X-RateLimit-Remaining: 0`，`requests=0/tok=0`），
// 而汇总照样印 **`合计 2/36 达标`** ⇒ 那个 `2/36` 报的是**限流器**，不是 agent。
//
// 这条判卷钉两向，**第二向比第一向要紧**：
//   ① 环境打断（未起步 / provider 报错）⇒ 判**无效**、不进分母；
//   ② **模型自己干坏事**（改了判卷面、verify 没过）⇒ 照旧**算数**、必须计入分母。
//      ②若被误伤，这个修正就变成了"把红跑藏起来"——那正是本仓最忌的形状。
import { describe, expect, it } from "vitest";
import { runValidity, tally } from "../scripts/lib/eval-validity";

const row = (requests: number, ok: boolean, fails: string[] = []) =>
  ({ r: { requests }, g: { ok, fails } });

describe("判卷分母：环境打断不算数，模型失败照旧算数", () => {
  it("① 未起步（0 请求）⇒ 无效，且说明里点明是 provider 侧", () => {
    const v = runValidity({ requests: 0 }, ["verify 未通过/未跑", "runLoop 抛错:GLM 请求失败 HTTP 429: Rate limit exceeded"]);
    expect(v.valid).toBe(false);
    expect(v.valid === false && v.why).toContain("未起步");
  });

  it("① 起步后被 429 打断 ⇒ 无效（不然「跑不成」会被记成「模型没做到」）", () => {
    const v = runValidity({ requests: 7 }, ['runLoop 抛错:GLM 请求失败 HTTP 429: {"error":{"message":"Rate limit exceeded"}}']);
    expect(v.valid).toBe(false);
    expect(v.valid === false && v.why).toContain("中途被打断");
  });

  it("★② 模型行为失败（改了判卷面 / verify 没过）⇒ **算数**，不许被这条修正藏起来", () => {
    expect(runValidity({ requests: 20 }, ["改了判卷面"]).valid).toBe(true);
    expect(runValidity({ requests: 20 }, ["verify 未通过/未跑"]).valid).toBe(true);
    // runLoop 抛错但**不是** provider 侧（模型自己造出的坏输出）⇒ 也要算数
    expect(runValidity({ requests: 9 }, ["runLoop 抛错:模型返回了无法解析的 tool_call"]).valid).toBe(true);
  });

  it("汇总：无效不进分母；全无效 ⇒ 拒绝出数（不许印 0/0）", () => {
    const mixed = tally([row(0, false, ["runLoop 抛错:HTTP 429"]), row(5, true), row(6, false, ["改了判卷面"])]);
    expect(mixed).toMatchObject({ pass: 1, total: 2, invalid: 1, refuse: false });
    const allBad = tally([row(0, false, ["runLoop 抛错:HTTP 429"]), row(0, false, ["runLoop 抛错:fetch failed"])]);
    expect(allBad.refuse).toBe(true);
    // 全部无效时 pass/total 都是 0——调用方据 refuse 拒绝出数，不许把它印成 "0/0"
    expect(allBad).toMatchObject({ pass: 0, total: 0, invalid: 2 });
  });

  it("那次实测的分布：32 趟 0 请求 + 4 趟起步 ⇒ 分母只能是 4，不是 36", () => {
    const rows = [
      ...Array.from({ length: 32 }, () => row(0, false, ["runLoop 抛错:GLM 请求失败 HTTP 429: Rate limit exceeded"])),
      row(7, true), row(8, false, ["verify 未通过/未跑"]), row(9, true), row(6, false, ["verify 未通过/未跑"]),
    ];
    const t = tally(rows);
    expect(t.total).toBe(4);
    expect(t.invalid).toBe(32);
    expect(t.pass).toBe(2);
    expect(t.refuse).toBe(false);
  });
});
