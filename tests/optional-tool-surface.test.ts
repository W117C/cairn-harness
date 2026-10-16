// 可选工具的「能力没开就不挂说明书」契约（2026-09-30 P1）。
//
// 动因是一组实测读数：每轮固定开销（工具说明书 + 系统提示词）**每一轮都要重送**，
// 而其中有一部分工具在「这个能力这一轮根本没开」时**必然失败**——挂着它只有成本没有能力。
// 2026-09-30 实测（`pnpm prompt-cost`）：
//   default 档 15 件 2286 tok/轮；摘掉 refine_goal(85) + remember(269) + lsp(186) ⇒ 12 件 ~1,746 tok/轮。
//   真模型端到端（跨 4 文件修 bug，同一靶子同一任务）：
//     改前 80,635 输入 tok / 90.0s / 16 轮 / verify ok
//     改后 59,527 输入 tok / 47.7s / 12 轮 / verify ok   ⇒ −26% tok、−47% 墙钟
//
// 这组钉三件：
//   ① 三个判据各自能单独把工具摘出模型面（不是「一起动」那种分不开的开关）；
//   ② 执行面**只累积不回退**——某一场需要过，就永久留着（否则执行面先摘、后一场规格面又挂上，
//      就是本仓点名的「模型看得见却调不到」）；
//   ③ 反面对照：都不摘时三把都在面上（否则上面几条可能全在空转）。
import { describe, expect, it } from "vitest";
import { OPTIONAL_TOOL_NAMES, sessionToolSpecs } from "../src/agent/session-provider";
import { WEB_CONTENT_TRUNCATION_HINT } from "../src/tools/output-ring";

const ALL_OPTIONAL = [
  ...OPTIONAL_TOOL_NAMES.goalTools,
  ...OPTIONAL_TOOL_NAMES.memoryTools,
  ...OPTIONAL_TOOL_NAMES.lspTools,
  ...OPTIONAL_TOOL_NAMES.subagentTools,
];

function names(omit?: readonly string[]): string[] {
  return sessionToolSpecs({ mode: "auto", ...(omit ? { omitTools: omit } : {}) })
    .specs.map((s) => s.function.name);
}

describe("可选工具面：能力没开就不挂说明书", () => {
  it("反面对照：三个判据都不成立时，三把工具都在面上（否则下面全是空转）", () => {
    const full = names();
    for (const n of ALL_OPTIONAL) expect(full, n + " 应当默认在面上").toContain(n);
  });

  it("每个判据各自能单独摘掉自己那一组（四组不是一个开关）", () => {
    expect(names(OPTIONAL_TOOL_NAMES.goalTools)).not.toContain("refine_goal");
    expect(names(OPTIONAL_TOOL_NAMES.memoryTools)).not.toContain("remember");
    expect(names(OPTIONAL_TOOL_NAMES.lspTools)).not.toContain("lsp");
    for (const n of OPTIONAL_TOOL_NAMES.subagentTools) expect(names(OPTIONAL_TOOL_NAMES.subagentTools)).not.toContain(n);
    // 摘一组不能顺手摘掉别的
    expect(names(OPTIONAL_TOOL_NAMES.lspTools)).toContain("remember");
    expect(names(OPTIONAL_TOOL_NAMES.memoryTools)).toContain("refine_goal");
    expect(names(OPTIONAL_TOOL_NAMES.subagentTools)).toContain("remember");
  });

  /* 子代理三件套是固定开销里**最大的一块**（611 tok/轮按说明书估算；实测整轮省 857），
     也是本组唯一一个由用户设置开关（settings.subagentTools）驱动的：缺省挂、关掉就整族摘。
     与另外三组的区别：那三组是「能力没开就必然失败」，这一组是「这一轮不需要派 worker」。 */
  it("子代理三件套整组进出：关掉省的是实打实的一大块，且三把一起走", () => {
    const full = names();
    const lean = names(OPTIONAL_TOOL_NAMES.subagentTools);
    const tokOf = (specs: readonly { function: { name: string } }[]): number =>
      Math.round(JSON.stringify(specs).length / 3.6);
    const saved = tokOf(sessionToolSpecs({ mode: "auto" }).specs)
      - tokOf(sessionToolSpecs({ mode: "auto", omitTools: OPTIONAL_TOOL_NAMES.subagentTools }).specs);
    expect(saved).toBeGreaterThan(500); // 实测 611；写 500 留出估算系数漂移的余量
    expect(lean.length).toBe(full.length - OPTIONAL_TOOL_NAMES.subagentTools.length);
  });

  it("三把全摘 ⇒ 面上只剩干活必需的那些，且省下的字节是实打实的", () => {
    const full = sessionToolSpecs({ mode: "auto" }).specs;
    const lean = sessionToolSpecs({ mode: "auto", omitTools: ALL_OPTIONAL }).specs;
    for (const n of ALL_OPTIONAL) expect(lean.map((s) => s.function.name)).not.toContain(n);
    expect(lean.length).toBe(full.length - ALL_OPTIONAL.length);
    // 字节口径（不写死 token 数：字符数是确定的，÷3.6 那个估算系数会随口径调整）
    const bytes = (x: typeof full): number => JSON.stringify(x).length;
    expect(bytes(lean)).toBeLessThan(bytes(full));
  });

  it("没开的那些能力对应的工具名不会被误摘：verify / propose_plan 永不进可选名单", () => {
    // verify 是收束闸的判据面、propose_plan 是唯一的写前门——它们是**所有档**的必需件，
    // 进了可选名单就等于「按能力把安全门摘了」。
    expect(ALL_OPTIONAL).not.toContain("verify");
    expect(ALL_OPTIONAL).not.toContain("propose_plan");
    const lean = names(ALL_OPTIONAL);
    expect(lean).toContain("verify");
    expect(lean).toContain("propose_plan");
  });
});

// 说明书与执行端那一句提示**同源**（第 323 页）。`web_fetch` 的 description 里那句
// 「正文太长会被截断并提示换更精确的地址」是模型每轮都在读的能力边界，而它承诺的那条出路
// 其实写在另一个文件里（`output-ring.ts` 的截断提示）。此前两边各写各的：谁改了提示，
// 说明书照样承诺——那是「话说了但没人兑现」的另一半（这里没人核这一对）。
describe("说明书里的能力边界要与执行端真给的提示对齐", () => {
  it("web_fetch 那句「正文太长会被截断并提示换更精确的地址」：规格与提示两头都得有这一件", () => {
    const spec = sessionToolSpecs({ mode: "auto" }).specs.find((s) => s.function.name === "web_fetch");
    expect(spec, "面上应当一直挂着 web_fetch（它不在可选名单里）").toBeTruthy();
    const desc = spec?.function.description ?? "";
    expect(desc).toContain("正文太长会被截断并提示换更精确的地址");
    // 出路那半句的真身：提示里必须真给「更精确的 URL」这条路，否则说明书是在教人走空门
    expect(WEB_CONTENT_TRUNCATION_HINT).toContain("更精确");
    expect(WEB_CONTENT_TRUNCATION_HINT).toContain("URL");
    // 反向：说明书不许把提示里根本没有的能力说成有（翻页／检索这一族由那一句自己否定）
    expect(desc).toContain("不会翻页");
    expect(WEB_CONTENT_TRUNCATION_HINT).toContain("不会替你翻页");
  });
});
