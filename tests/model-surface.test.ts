import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MODEL_SURFACE_TIGHT_DESC_CHAR_CAP,
  MODEL_SURFACE_TOTAL_CHAR_LIMIT,
  accountModelSurface,
  chattyMcpFixture,
  planSurfaceBudget,
  surfaceSpecChars,
  surfaceTierOf,
} from "../src/agent/model-surface";
import { gateToolSpecs, sessionToolSpecs } from "../src/agent/glm-session";
import type { GlmToolSpec } from "../src/providers/glm";

vi.mock("../src/agent/memory/inject", () => ({
  buildMemoryInjection: async () => ({ project: null, global: null, charsCurrent: 0, charsLimit: 0, tokens: 0, truncated: false }),
}));

const CORE: ReadonlySet<string> = new Set(gateToolSpecs().map((s) => s.function.name));
const SYSTEM_CHARS = 670;
/** 一条工具规格的序列化开销约 90 字符（名字 + parameters 骨架）——下面几处「刚好超/刚好不超」的
 *  条数都按这个口径算，改 fixture 形状时要把算式一起改，别只调数字。 */
const OVERHEAD_PER_TOOL = 100;

/** 注入口形状 = `SessionPluginTool`。描述按 **字符** 计（帽的口径是字符），且刻意用 CJK：
 *  ASCII 的 chars/4 折算会把读数算轻，本仓那条「中文低估 3–4 倍」的裁决就落在这里。 */
function pluginFixture(n: number, descChars: number) {
  return Array.from({ length: n }, (_, i) => ({
    name: "mcp__chatty__tool_" + String(i),
    description: "描".repeat(descChars),
    parameters: { type: "object", properties: { input: { type: "string" } } },
  }));
}
function faceWith(n: number, descChars: number): GlmToolSpec[] {
  return sessionToolSpecs({ mode: "default", pluginTools: pluginFixture(n, descChars) }).specs;
}
const totalAfter = (plan: { specs: GlmToolSpec[] }, systemChars = SYSTEM_CHARS) =>
  systemChars + surfaceSpecChars(plan.specs);
const namePrefixHolds = (plan: { specs: GlmToolSpec[] }, before: readonly GlmToolSpec[]) =>
  plan.specs.every((s, i) => s.function.name === before[i]!.function.name);

describe("模型面总预算：零回归支", () => {
  it("未超预算时逐字不改（帽没碰到就不该动装配一个字节）", () => {
    const specs = sessionToolSpecs({ mode: "default" }).specs;
    const acct = accountModelSurface({ systemChars: SYSTEM_CHARS, specs, coreNames: CORE });
    expect(acct.totalChars).toBeLessThanOrEqual(acct.limitChars); // 前提：缺省装配确实在帽内
    const plan = planSurfaceBudget({ specs, systemChars: SYSTEM_CHARS, coreNames: CORE });
    expect(JSON.stringify(plan.specs)).toBe(JSON.stringify(specs));
    expect(plan.note).toBe("");
    expect(plan.dropped).toEqual([]);
    expect(plan.shortened).toEqual([]);
    expect(plan.unresolvable).toBe(false);
  });
});

describe("模型面总预算：降配梯", () => {
  it("梯级 A（压描述）在 B（丢工具）之前：刚好超一点时一把都不丢", () => {
    // 8 条 × 2048 字符描述 ≈ 17.1k，加固定面 8.8k ⇒ 刚好破 24k；压到紧帽后远低于帽。
    const specs = faceWith(8, 2_048);
    const plan = planSurfaceBudget({ specs, systemChars: SYSTEM_CHARS, coreNames: CORE });
    expect(plan.account.totalChars).toBeGreaterThan(plan.account.limitChars);
    expect(plan.specs.length).toBe(specs.length);
    expect(plan.dropped).toEqual([]);
    expect(plan.shortened.length).toBe(8);
    for (const s of plan.specs) {
      if (s.function.name.startsWith("mcp__")) {
        expect(s.function.description!.length).toBeLessThanOrEqual(MODEL_SURFACE_TIGHT_DESC_CHAR_CAP + 40);
      }
    }
    expect(totalAfter(plan)).toBeLessThanOrEqual(MODEL_SURFACE_TOTAL_CHAR_LIMIT);
  });

  it("描述本就紧、只能丢工具时：从尾部丢且丢完回到帽内", () => {
    const specs = faceWith(80, 500); // 500 < 紧帽 ⇒ 梯级 A 无事可做
    const plan = planSurfaceBudget({ specs, systemChars: SYSTEM_CHARS, coreNames: CORE });
    expect(plan.shortened).toEqual([]);
    expect(plan.dropped.length).toBeGreaterThan(0);
    expect(totalAfter(plan)).toBeLessThanOrEqual(MODEL_SURFACE_TOTAL_CHAR_LIMIT);
    // 丢的顺序 = 数组从尾向前（尾丢，不是中间摘）
    expect(plan.dropped).toEqual(
      specs.slice(plan.specs.length).reverse().map((s) => s.function.name),
    );
  });

  it("尾丢 ⇒ 保留表是原表的位置前缀（中间摘会把可缓存前缀切断）", () => {
    const specs = faceWith(80, 500);
    const plan = planSurfaceBudget({ specs, systemChars: SYSTEM_CHARS, coreNames: CORE });
    expect(namePrefixHolds(plan, specs)).toBe(true);
    // 未压描述 ⇒ 除结尾 "]" 外前缀逐字不变，这一段缓存照旧命中
    expect(plan.prefixStableChars).toBe(JSON.stringify(plan.specs).length - 1);
  });

  it("梯级 A 的代价看得见：改写一把之后，它之后的缓存全废", () => {
    const specs = faceWith(8, 2_048);
    const plan = planSurfaceBudget({ specs, systemChars: SYSTEM_CHARS, coreNames: CORE });
    const before = JSON.stringify(specs);
    // 描述是同一字符的重复 ⇒ 分歧点在紧帽处，而不是该条目的开头：断言要按「第二把工具的起始偏移」判，
    // 那才是「这一把之后的缓存全部要重写」的准确位置。
    const secondMcpStart = before.indexOf('"mcp__chatty__tool_1"');
    expect(secondMcpStart).toBeGreaterThan(0);
    expect(plan.prefixStableChars).toBeLessThan(secondMcpStart);
    expect(plan.prefixStableChars).toBeLessThan(JSON.stringify(plan.specs).length);
  });

  it("core 永不被自动砍：帽紧到装不下时报 unresolvable 交人裁决", () => {
    const specs = faceWith(30, 1_200);
    const plan = planSurfaceBudget({ specs, systemChars: SYSTEM_CHARS, coreNames: CORE, limitChars: 1_000 });
    expect(plan.unresolvable).toBe(true);
    for (const name of CORE) expect(plan.specs.some((s) => s.function.name === name)).toBe(true);
    expect(plan.note).toContain(String(plan.account.overChars));
    // 走到 unresolvable 时仍要把 optional 丢干净——「报红」不等于「不降配」
    expect(plan.specs.every((s) => CORE.has(s.function.name))).toBe(true);
  });

  it("pinned（harness 注入且被别处依赖）在 optional 之后才轮到", () => {
    const specs = [
      ...gateToolSpecs(),
      { type: "function", function: { name: "skill", description: "s".repeat(50), parameters: {} } },
      ...chattyMcpFixture(6, 600 * 90),
    ] as GlmToolSpec[];
    // 帽给到「core + skill 装得下、mcp 装不下」：只该看到 mcp__ 被丢，skill 留下。
    const tight = specs.slice(0, CORE.size + 1).reduce((n, s) => n + JSON.stringify(s).length, 0) + SYSTEM_CHARS + 400;
    const plan = planSurfaceBudget({ specs, systemChars: SYSTEM_CHARS, coreNames: CORE, limitChars: tight });
    expect(plan.dropped.length).toBeGreaterThan(0);
    expect(plan.dropped.every((n) => n.startsWith("mcp__"))).toBe(true);
    expect(plan.specs.some((s) => s.function.name === "skill")).toBe(true);
    expect(plan.unresolvable).toBe(false);
  });

  it("省了谁必须说出去：note 点名每一把丢弃工具并写出帽值", () => {
    const specs = faceWith(80, 500);
    const plan = planSurfaceBudget({ specs, systemChars: SYSTEM_CHARS, coreNames: CORE });
    // 同一文件里 `capDescription` 也写着「模型面预算…」⇒ 收 note 这条独有的账（帽值＋超出量成对出现）
    expect(plan.note).toContain("字符已满（本轮超出");
    expect(plan.note).toContain(String(MODEL_SURFACE_TOTAL_CHAR_LIMIT));
    for (const name of plan.dropped) expect(plan.note).toContain(name);
  });
});

describe("模型面总预算：账", () => {
  it("逐件排行相加恰等于总账（对不上账的排行表不能拿去决定砍谁）", () => {
    const specs = faceWith(12, 900);
    const acct = accountModelSurface({ systemChars: SYSTEM_CHARS, specs, coreNames: CORE });
    expect(acct.pieces.reduce((n, p) => n + p.chars, 0)).toBe(acct.totalChars);
    expect(acct.toolSpecChars).toBe(surfaceSpecChars(specs));
    expect(acct.pieces[0]!.chars).toBeGreaterThanOrEqual(acct.pieces[acct.pieces.length - 1]!.chars);
  });

  it("身份判定：core 由传入的工具表决定，pinned 是 harness 注入项，其余按可降档", () => {
    expect(surfaceTierOf("edit_file", CORE)).toBe("core");
    expect(surfaceTierOf("obs_recall", CORE)).toBe("pinned");
    expect(surfaceTierOf("mcp__srv__x", CORE)).toBe("optional");
    // 不认识的注入名不得被当成 core —— 那样谁都砍不动它，帽就成摆设
    expect(surfaceTierOf("some_plugin_tool", CORE)).toBe("optional");
    expect(CORE.size).toBeGreaterThan(OVERHEAD_PER_TOOL / 8);
  });
});

describe("模型面总预算：接在真装配链上", () => {
  let dir: string | null = null;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it("provider 发出去的那份工具表已被降配，且 note 真的进了某个 system 消息", async () => {
    dir = await mkdtemp(join(process.env.PI_SCRATCH_DIR!, "model-surface-"));
    const path = join(dir, "events.jsonl");
    await writeFile(path, JSON.stringify({ type: "user_message", content: "TASK" }) + "\n");
    const specs = faceWith(60, 1_200);
    const sent: unknown[][] = [];
    const transport = async function* (...args: unknown[]) {
      sent.push(args);
      yield { type: "assistant_message" as const, content: "ok" };
    };
    const { createGlmSessionProvider } = await import("../src/agent/glm-session");
    const provider = createGlmSessionProvider(path, {
      map: false,
      workspace: dir,
      system: "你是测试用的基础提示。".repeat(40),
      tools: specs,
      transport: transport as never,
    });
    for await (const _ of provider.stream([])) void _;

    // 先断言载体动作真的发生：否则后面的断言读的是一个从没发出去的请求（本仓的假绿教训）。
    expect(sent.length).toBe(1);
    // 不 flatten：一摊平就分不清「工具数组」与「数组里的某条工具」了。
    const args = sent[0]! as unknown[];
    const toolArg = args.find(
      (a) => Array.isArray(a) && a.length > 0 && (a[0] as GlmToolSpec)?.function !== undefined,
    ) as GlmToolSpec[] | undefined;
    const msgsArg = args.find(
      (a) => Array.isArray(a) && a.some((m) => (m as { role?: string }).role === "system"),
    ) as { role: string; content?: string }[] | undefined;
    expect(toolArg).toBeDefined();
    expect(msgsArg).toBeDefined();

    expect(toolArg!.length).toBeLessThan(specs.length);
    for (const name of CORE) expect(toolArg!.some((s) => s.function.name === name)).toBe(true);
    const systemText = msgsArg!.filter((m) => m.role === "system").map((m) => m.content ?? "").join("\n");
    expect(systemText).toContain("模型面预算");
  });
});
