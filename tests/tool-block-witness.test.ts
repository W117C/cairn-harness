// 六道「执行前就拦下」的硬闸，现在各自在落盘面上留了结构证人（`tool_result.blockedBy`）。
//
// 这一格的老形状是本仓第十三族：散文是唯一读者能拿到的东西。`[tool table]`／`[skill]`／
// `[permission denied]`／`unknown tool:` 四句各有判卷钉着**给人看的那半**，但没有任何一格钉住
// 「这一笔从未走到执行面」这件事在事件流里是**可读的**。规则 300 数过：结构字段缺席是三因同形
// （旧日志／没走到 exec／裸 settle 出口）——本笔把中间那因从"只能猜"变成"有一列"。
//
// 两条纪律带着（都别只写在注释里）：
// ⑴ 判卷**走真 runLoop**，不读 loop.ts 的字符串——文案与结构字段两头都要有证人，
//    因为「改文案不动结构」和「改结构不动文案」是两种不同的坏法（规则 236/254）；
// ⑵ 反面那一半必须钉住：真的工具失败（抛异常）**不许**带 `blockedBy`——
//    否则这一列变成"所有红都是闸拦的"，比没有这列更糟。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runLoop, type LoopOptions } from "../src/agent/loop";
import { TOOL_BLOCK_REASONS, type AgentEvent, type ToolResultEvent } from "../src/events";

const LOOP_SRC = readFileSync(fileURLToPath(new URL("../src/agent/loop.ts", import.meta.url)), "utf8");

/** 走一遍真 loop：只发一次 tool_call，第二轮不给输出（收束）。返回落盘的 tool_result。 */
async function settle(name: string, options: Partial<LoopOptions> = {}): Promise<ToolResultEvent[]> {
  const log: AgentEvent[] = [];
  let first = true;
  await runLoop({
    workspace: "/tmp",
    events: { async append(e) { log.push(e); } },
    tools: { read_file: { name: "read_file", async run() { return { ok: true, output: "正文" }; } } } as never,
    userMessage: "跑一次",
    provider: {
      async *stream() {
        if (first) {
          first = false;
          yield { type: "tool_call", id: "c1", name, args: {} } as never;
        }
      },
    },
    ...options,
  });
  return log.filter((e): e is ToolResultEvent => e.type === "tool_result");
}

// PreToolUse 阻断：只给 `run`（其余成员这一路读不到），故整体收窄一次再喂进去。
const blockedHook = {
  run: async () => ({ blocked: true, blockReason: "禁改 src/secret.ts" }),
} as unknown as LoopOptions["hooks"];

const ROWS = [
  { reason: "tool-table", name: "read_file", options: { allowedTools: [] }, prose: "不在本会话工具表" },
  { reason: "skill-denial", name: "read_file", options: { skillDenial: () => "demo-skill" }, prose: "disallowed-tools 摘除" },
  { reason: "verify-unwired", name: "verify", options: {}, prose: "未接线验证门" },
  { reason: "hook", name: "read_file", options: { hooks: blockedHook }, prose: "[hook blocked]" },
  { reason: "permission", name: "write_file", options: { mode: "read-only" }, prose: "[permission denied]" },
  { reason: "unknown-tool", name: "absent", options: {}, prose: "unknown tool" },
] satisfies { reason: string; name: string; options: Partial<LoopOptions>; prose: string }[];

describe("硬闸落点带结构证人：六道各印自己那一格", () => {
  /** 一条出口的正证：走真 loop 一次，落盘面既有散文也有那一列。
   *  ⚠️ 这里**不用 `it.each`**：锚点的 killer 指针吃的是判卷文件里的字面标题，
   *  模板标题（`$reason：…`）在源文件里根本不存在 ⇒ 指针 not-found、选择子零命中，
   *  而两条元判卷（`mutate-anchor-titles`／`auditExpectFails`）当场红（第 225 页实测）。 */
  async function expectGate(row: (typeof ROWS)[number]): Promise<void> {
    const results = await settle(row.name, row.options);
    expect(results, `${row.prose} 这一路没落 tool_result ⇒ 判卷没走到被度量者`).toHaveLength(1);
    const hit = results[0]!;
    expect(hit.ok, "闸拦下的那一笔必须是红").toBe(false);
    expect(hit.output, "给人看的那半没撤：模型要知道是谁拦的、去哪条路改").toContain(row.prose);
    expect(hit.blockedBy, "被哪道闸拦的没有结构证人 ⇒ 与旧日志同形（规则 300）").toBe(row.reason);
  }

  const row = (reason: string): (typeof ROWS)[number] =>
    ROWS.find((r) => r.reason === reason) ?? (() => { throw new Error(`名单里没有 ${reason}`); })();

  it("工具表白名单摘除：这一闸拦下的那次调用带 blockedBy", async () => { await expectGate(row("tool-table")); });
  it("skill 的 disallowed-tools 摘除：这一闸拦下的那次调用带 blockedBy", async () => { await expectGate(row("skill-denial")); });
  it("verify 未接线：这一闸拦下的那次调用带 blockedBy", async () => { await expectGate(row("verify-unwired")); });
  it("PreToolUse 钩子阻断：这一闸拦下的那次调用带 blockedBy", async () => { await expectGate(row("hook")); });
  it("权限门拒绝：这一闸拦下的那次调用带 blockedBy", async () => { await expectGate(row("permission")); });
  it("执行面没有这把工具：这一闸拦下的那次调用带 blockedBy", async () => { await expectGate(row("unknown-tool")); });

  it("分母证人：出口名单与 `TOOL_BLOCK_REASONS` 逐字相等（多一格少一格都红）", async () => {
    const emitted: string[] = [];
    for (const row of ROWS) {
      const [hit] = await settle(row.name, row.options);
      if (hit?.blockedBy !== undefined) emitted.push(hit.blockedBy);
    }
    const uniq = [...new Set(emitted)].sort();
    expect(uniq, `实跑只印出 ${String(uniq.length)} 种原因：${uniq.join("、")}`).toEqual(
      [...TOOL_BLOCK_REASONS].sort(),
    );
  });

  it("反面：真的工具失败不许带这一列（缺席＝走到了执行面，不是被闸拦）", async () => {
    const results = await settle("read_file", {
      tools: { read_file: { name: "read_file", async run(): Promise<never> { throw new Error("TOOL_BLEW_UP"); } } } as never,
    });
    expect(results).toHaveLength(1);
    const hit = results[0]!;
    expect(hit.ok).toBe(false);
    expect(hit.output).toContain("TOOL_BLEW_UP");
    // 用 keys 而不是 `toBeUndefined()`：写了 `blockedBy: undefined` 也算把这一格编出来了。
    expect(Object.keys(hit), "工具自己失败被标成闸拦 ⇒ 归因方向整个反了").not.toContain("blockedBy");
  });

  it("反面⑵：verify 拍的红不走这一列（它有自己的 cause 归因，两族不许混）", async () => {
    const log: AgentEvent[] = [];
    let first = true;
    await runLoop({
      workspace: "/tmp",
      events: { async append(e) { log.push(e); } },
      tools: {} as never,
      userMessage: "跑一次",
      verify: { async run() { return { ok: false, results: [{ command: "node --version", ok: false, output: "[exit code: 1]" }] }; } },
      provider: {
        async *stream() {
          if (first) { first = false; yield { type: "tool_call", id: "c1", name: "verify", args: {} } as never; }
        },
      },
    });
    const beats = log.filter((e) => e.type === "verify_result");
    expect(beats, "这一路没产生 verify_result ⇒ 判卷走的是别的出口").toHaveLength(1);
    const results = log.filter((e): e is ToolResultEvent => e.type === "tool_result");
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect(r.blockedBy, "验证失败不是『被闸拦』").toBeUndefined();
  });
});

describe("六道的取值只有一个事实源", () => {
  /** 一条「在写死取值」的行：`blockedBy: "…"` 出现在右手边（含条件展开里的那种形状）。 */
  const blockLiterals = (src: string): string[] => [...src.matchAll(/blockedBy:\s*"([a-z-]+)"/gu)].map((m) => m[1]!);

  it("loop 里印出的每个取值都在枚举里，且枚举里没有白写的成员", () => {
    const lits = blockLiterals(LOOP_SRC);
    expect(lits.length, `只从 loop.ts 抽到 ${String(lits.length)} 处取值 ⇒ 尺没接上电`).toBeGreaterThanOrEqual(6);
    for (const v of lits) expect(TOOL_BLOCK_REASONS as readonly string[], `取值「${v}」不在枚举里`).toContain(v);
    expect(new Set(lits).size, `六处出口只用到 ${String(new Set(lits).size)} 种取值（有两处共用一种 ⇒ 分不开）`).toBe(
      TOOL_BLOCK_REASONS.length,
    );
  });

  it("抽取得不成立时尺要能读到副本形状（负控：判卷不是恒真）", () => {
    expect(blockLiterals('  blockedBy: "made-up-gate",')).toEqual(["made-up-gate"]);
    expect(blockLiterals('        ...(tool === undefined ? { blockedBy: "unknown-tool" } : {}),')).toEqual(["unknown-tool"]);
    // 注释里提一句字段名不算取值位
    expect(blockLiterals("// 见 `blockedBy` 的说明")).toEqual([]);
  });
});
