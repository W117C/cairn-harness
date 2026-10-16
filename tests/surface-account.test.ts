// P0 装配账（`surface_account`）的判据：落流、双基口径、采样、fail-open、投影不变。
//
// 为什么要这一份：这份账此前每请求都算、算完即丢，于是「真实面多大、有没有触发降配梯、省了谁」
// 在整个工程里没有任何一处可回放。加事件只是手段；**这几条判据才是「读数可信」的定义**：
//   ㈠ declared/sent 两个基不许混（混读会把送出面读成声明面，24k 帽下结论直接反）；
//   ㈡ 采样不许把「面变小」这一类抖动静默吃掉（旧版把它委托给 PC1–PC4，而那些判据只跑在
//      prefix-churn-check 的合成驱动器上）；
//   ㈢ 观测面失败不许打断模型请求；
//   ㈣ 它不许进模型上下文（进了就改写可缓存前缀）；
//   ㈤ 易变侧（记忆 / skills 块 / 地图 / 附件）四块必须照实进账——降配梯的口径只有
//      「system + 工具」（`model-surface.ts` 头注口径更正），那四块若也不记就彻底没有观测面；
//      且必须钉住它们是**压缩前快照**（不是上界）：压缩会重建 skills 块，且可能因为新增
//      重挂资格而**变大**（`plugins/index.ts` 的重挂只认已被 compaction 摘掉的激活记录）。
//
// 全部走**真 provider 装配链**（`createSessionProvider`），不 mock 到测不到东西。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionToolSpecs } from "../src/agent/session-provider";
import { projectContext } from "../src/agent/context";
import { replay, type AgentEvent } from "../src/events";
import type { GlmToolSpec } from "../src/providers/glm";

vi.mock("../src/agent/memory/inject", async () =>
  (await import("./helpers/memory-inject-mock")).memoryInjectMock(
    { project: null, global: null, charsCurrent: 0, charsLimit: 0, tokens: 0, truncated: false }));

function pluginFixture(n: number, descChars: number) {
  return Array.from({ length: n }, (_, i) => ({
    name: "mcp__chatty__tool_" + String(i),
    description: "描".repeat(descChars),
    parameters: { type: "object", properties: { input: { type: "string" } } },
  }));
}
/** 60 × 1200 字符的插件面必超 24k 帽（与 model-surface.test.ts 同一形状）。 */
const faceWith = (n: number, descChars: number): GlmToolSpec[] =>
  sessionToolSpecs({ mode: "default", pluginTools: pluginFixture(n, descChars) }).specs;

const SYSTEM = "你是测试用的基础提示。".repeat(40);

interface DriveOpts {
  tools?: GlmToolSpec[];
  requestFace?: () => { tools?: GlmToolSpec[]; note?: string };
  emit?: (e: AgentEvent) => Promise<void>;
  turns?: number;
  transport?: () => AsyncGenerator<unknown>;
  /** 易变侧注入：plugins 块 + 附件 + 假地图构建器（`drive` 默认关地图，见 map 字段）。 */
  plugins?: { skillsRouting?: string; hookContext?: string; deriveRemount?: (events: AgentEvent[]) => string | null };
  attachmentContext?: string;
  mapText?: string;
}

describe("P0 装配账落流", () => {
  let dir: string | null = null;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  async function drive(opts: DriveOpts): Promise<{ events: AgentEvent[]; path: string }> {
    dir = await mkdtemp(join(process.env.PI_SCRATCH_DIR!, "surface-account-"));
    const path = join(dir, "events.jsonl");
    await writeFile(path, JSON.stringify({ type: "user_message", content: "TASK" }) + "\n");
    const { createSessionProvider } = await import("../src/agent/session-provider");
    const provider = createSessionProvider(path, {
      // 地图默认关；要看 mapChars 就传 opts.mapText 并把 mapBuilder 接上（见下）。
      map: opts.mapText === undefined ? false : true,
      ...(opts.mapText !== undefined
        ? { mapBuilder: { build: async () => ({ kind: "ok", text: opts.mapText } as never) } }
        : {}),
      workspace: dir!,
      system: SYSTEM,
      ...(opts.tools ? { tools: opts.tools } : {}),
      ...(opts.requestFace ? { requestFace: opts.requestFace } : {}),
      ...(opts.emit ? { emit: opts.emit } : {}),
      ...(opts.plugins ? { plugins: opts.plugins } : {}),
      ...(opts.attachmentContext ? { attachmentContext: opts.attachmentContext } : {}),
      transport: (opts.transport ?? (async function* () {
        yield { type: "assistant_message" as const, content: "ok" };
      })) as never,
    });
    for (let i = 0; i < (opts.turns ?? 1); i++) {
      for await (const _ of provider.stream([])) void _;
    }
    return { events: await replay(path), path };
  }

  const accounts = (events: AgentEvent[]) =>
    events.filter((e): e is Extract<AgentEvent, { type: "surface_account" }> => e.type === "surface_account");

  it("未降配：declared 与 sent 相等，空数组在场而不是缺字段", async () => {
    const specs = faceWith(4, 50);
    const { events } = await drive({ tools: specs });
    const got = accounts(events);
    expect(got).toHaveLength(1);
    const a = got[0]!;
    expect(a.attemptSeq).toBe(1);
    expect(a.declaredToolCount).toBe(specs.length);
    expect(a.sentToolCount).toBe(specs.length);
    expect(a.declaredToolSpecChars).toBe(a.sentToolSpecChars);
    expect(a.overChars).toBe(0);
    expect(a.limitChars).toBe(24_000);
    expect(a.baseSystemChars).toBe(SYSTEM.length);
    // 空数组 = 确定没降配；与「旧版本没记这个字段」必须分得开（§3 取舍 3）。
    expect(a.shortened).toEqual([]);
    expect(a.dropped).toEqual([]);
    expect(a.unresolvable).toBe(false);
    expect(a.faceChanged).toBe(false);
    // 易变侧：缺项记 0，**不省略字段**——与「旧版本没记」必须分得开（同 §3 取舍 3）。
    expect(a.memoryChars).toBe(0);
    expect(a.skillsBlockChars).toBe(0);
    expect(a.mapChars).toBe(0);
    expect(a.attachmentContextChars).toBe(0);
    expect(a.volatileChars).toBe(0);
  });

  it("降配：declared 严格大于 sent，且两个基都在事件里", async () => {
    const specs = faceWith(60, 1_200);
    const { events } = await drive({ tools: specs });
    const got = accounts(events);
    expect(got).toHaveLength(1);
    const a = got[0]!;
    // 这一条就是评审 F6/A2 的判据：混基会让「送出面」被读成「声明面」。
    expect(a.declaredToolSpecChars).toBeGreaterThan(a.sentToolSpecChars);
    expect(a.declaredToolCount).toBe(specs.length);
    expect(a.sentToolCount).toBeLessThan(specs.length);
    expect(a.overChars).toBeGreaterThan(0);
    // 省了谁必须留名，否则读数回答不了「降配在丢谁」。
    expect(a.shortened.length + a.dropped.length).toBeGreaterThan(0);
    expect(a.unresolvable).toBe(false);
  });

  it("采样：面不变时不逐轮落流（第 2、3 轮零新增）", async () => {
    const { events } = await drive({ tools: faceWith(4, 50), turns: 3 });
    expect(accounts(events)).toHaveLength(1);
  });

  it("采样：面变小也看得见（旧版会把这一支静默吃掉）", async () => {
    const big = faceWith(5, 50);
    const small = faceWith(3, 50);
    let call = 0;
    const { events } = await drive({
      requestFace: () => ({ tools: call++ === 0 ? big : small }),
      turns: 3,
    });
    const got = accounts(events);
    expect(got).toHaveLength(2);
    expect(got[0]!.attemptSeq).toBe(1);
    // 面在第 2 轮就变小了；第 3 轮与第 2 轮同面 ⇒ 不再落（采样不是「每轮都落」）。
    expect(got[1]!.attemptSeq).toBe(2);
    // 面**变小**不触发降配（没超帽），所以它落盘只可能来自「面变了」这一支。
    expect(got[1]!.faceChanged).toBe(true);
    expect(got[1]!.overChars).toBe(0);
    expect(got[1]!.sentToolCount).toBe(small.length);
  });

  it("零工具面：不落事件（「没有读数」与「面=0」不许混）", async () => {
    const { events } = await drive({});
    expect(accounts(events)).toHaveLength(0);
  });

  it("易变侧四块照实进账：分项与合计都在事件里", async () => {
    // 这一条是「降配梯看不见的那一半」唯一的观测面：model-surface 的口径只有 system + 工具，
    // 这四块若不记，整个易变侧开销在工程里没有任何一处可回放。
    const routing = "[skills] a".padEnd(40, "x");
    const hookCtx = "[hooks] b".padEnd(60, "y");
    const remount = "[系统操作·skill 重挂]".padEnd(80, "z");
    const attach = "[附件引用（仅路径，尚未读取内容）]\n- file: path=\"a.txt\"";
    const mapText = "[符号地图]".padEnd(50, "m");
    const { events } = await drive({
      tools: faceWith(4, 50),
      plugins: { skillsRouting: routing, hookContext: hookCtx, deriveRemount: () => remount },
      attachmentContext: attach,
      mapText,
    });
    const a = accounts(events)[0]!;
    // pluginContext = 路由 + hook + liveNote + 重挂，四段用 \n\n 连接。
    expect(a.skillsBlockChars).toBe(routing.length + 2 + hookCtx.length + 2 + remount.length);
    // 记的是 mapInjectText 的产出，比正文多一段 coverageNote（build.ts:242-243）——
    // 断言「不小于正文」而不是逐字相等：正文相等会把包装层的任何变化都变成红。
    expect(a.mapChars).toBeGreaterThanOrEqual(mapText.length);
    expect(a.attachmentContextChars).toBe(attach.length);
    // 记忆在本测里恒为 0（memory/inject 被 mock 成空壳），这一格钉「不省略成 undefined」。
    expect(a.memoryChars).toBe(0);
    expect(a.volatileChars).toBe(a.memoryChars + a.skillsBlockChars + a.mapChars + a.attachmentContextChars);
    expect(a.volatileChars).toBeGreaterThan(0);
    // 关键：易变侧**不进**降配判定——baseSystemChars + 工具面没变，overChars 仍是 0。
    expect(a.overChars).toBe(0);
    expect(a.dropped).toEqual([]);
  });

  it("硬闸拦下：有工具面时盘上留一条账（钉住真值，防 final-budget 判据的零字节契约被悄悄推翻）", async () => {
    // 这一条**不是**在赞同一个好行为，而是在把一处已知互斥钉成可见的：
    // `tests/final-budget.test.ts:20` 要求「硬闸拦下时盘上零字节」，而本事件排在硬闸之前。
    // 今天两条不冲突，只因 final-budget 那个用例**不传工具面**。谁给它补上工具面，
    // 下面这条会先红并指向 `session-provider.ts` 调用点的取舍说明（判据赢，该动的是落点不是判据）。
    const transport = vi.fn(async function* () {
      yield { type: "assistant_message" as const, content: "ok" };
    });
    const dir2 = await mkdtemp(join(process.env.PI_SCRATCH_DIR!, "surface-gate-"));
    try {
      const path = join(dir2, "events.jsonl");
      await writeFile(path, JSON.stringify({ type: "user_message", content: "TASK" }) + "\n");
      const { createSessionProvider } = await import("../src/agent/session-provider");
      const provider = createSessionProvider(path, {
        map: false,
        workspace: dir2,
        system: SYSTEM,
        tools: faceWith(4, 50),
        // 60 万字符的重挂正文把最终硬闸顶爆（与 final-budget.test.ts 同一手法）。
        plugins: { deriveRemount: () => "x".repeat(600_000) },
        transport: transport as never,
      });
      await expect(async () => {
        for await (const _ of provider.stream([])) void _;
      }).rejects.toThrow("context_budget_exceeded");
      expect(transport).not.toHaveBeenCalled();
      const accounts2 = accounts(await replay(path));
      expect(accounts2).toHaveLength(1);   // ← 有账有请求都没有，但账落了盘
      expect(accounts2[0]!.attemptSeq).toBe(1);
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  });

  it("fail-open：落流抛错不许打断模型请求", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const specs = faceWith(4, 50);
      const { events } = await drive({
        tools: specs,
        emit: async () => { throw new Error("disk full"); },
      });
      expect(accounts(events)).toHaveLength(0);
      // fail-visible：出得来（进 stderr），但不升级成请求失败。
      expect(warn.mock.calls.some((c) => String(c[0]).includes("surface_account"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("投影不变：含 surface_account 的序列过 projectContext 逐字节相同", async () => {
    const base: AgentEvent[] = [
      { type: "user_message", content: "TASK" },
      { type: "assistant_message", content: "ok" },
      { type: "tool_call", id: "t1", name: "read_file", args: { path: "a.ts" } },
      { type: "tool_result", callId: "t1", ok: true, output: "x" },
    ];
    const withAccount: AgentEvent[] = [
      ...base.slice(0, 2),
      {
        type: "surface_account", attemptSeq: 1, declaredToolCount: 3, declaredToolSpecChars: 300,
        sentToolCount: 3, sentToolSpecChars: 300, baseSystemChars: 10, limitChars: 24_000,
        volatileChars: 40, memoryChars: 10, skillsBlockChars: 20, mapChars: 5, attachmentContextChars: 5,
        overChars: 0, shortened: [], dropped: [], unresolvable: false, prefixStableChars: 300,
        faceChanged: false,
      },
      ...base.slice(2),
    ];
    expect(JSON.stringify(projectContext(withAccount))).toBe(JSON.stringify(projectContext(base)));
  });

  it("落盘的事件真的能被回放读到（不依赖 emit 通道）", async () => {
    const specs = faceWith(4, 50);
    const { path } = await drive({ tools: specs });
    const raw = await readFile(path, "utf8");
    expect(raw).toContain('"surface_account"');
  });
});
