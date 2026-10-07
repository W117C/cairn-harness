/* M5b 路由开关的**第五环**：旗标值经生产入口一路走到「worker 真拨的那一档」。
 *
 * 现读账本（第 410 页自己写的那条未证）：`--bandit` / `--cascade` 补上之后，证的只是
 * ①解析正确（`tests/routing-flags.test.ts` 打 `parseRoutingFlags` / `resolveRoutingFlags` 两只纯函数）
 * ②矛盾旗标拒跑 ③缺省逐字节等价 ④三跳接线在。**没有一条判卷从 `handleAgentRun` 走过这条通道**：
 *  · `tests/bandit-runtime.test.ts` 与 `tests/cascade-wiring.test.ts` 都自备 `routing` /
 *   `banditStatePath` / `cascadeUpgrade` opts（机制面是真的，但绕过了 `over → runAgent →
 *   buildSessionOrchestrator → orchestratorExtras` 那三跳）；
 *  · `tests/main-run-routing.test.ts` 走的是主会话那一档的传输面，不派 worker ⇒ 碰不到路由决策。
 * 于是「翻了真换档」这一格仍是空的——本文件填的就是这一格。
 *
 * 形状（守本仓成文纪律）：从生产入口打进去（`handleAgentRun(req, {workspace, logPath})`），
 * 主会话走仓里既有的剧本通道（`M3A_MAIN_SCRIPT`），worker 走真档位 + `vi.stubGlobal("fetch")` 的
 * 假回包 ⇒ **零真钱**。读数取两块：盘上事件流（`replay(logPath)`）＋那一跳 HTTP 请求体里的模型名
 * ——后者是「档位真的换了」的唯一硬证据，事件流里的 `model` 只是申报面。
 * 断言吃的是**被观测的那一条决策的产物**（`routing_decision.picked` → 档位表反查调用名），
 * 不在测试里再算一遍选档（`tierForStage` / `routeFor` 一次都没被本文件调用）。
 *
 * ⚠️ 本文件**不证**「开了更省钱」，也**不证** reason=bandit 那一支：
 *  「真省钱」在合成流里原理上不可证（单价来自价表占位行，用量是剧本喂的固定 token 数），
 *   这里只钉「钱与归因跟着选中的那一档走」这个形状。
 *  bandit 那一支证不动的原因写在文件末尾的「仍缺的那一根」里——不是没写用例，是构造不出输入。
 *
 * 分辨力自检（本文件落地时实测，不是推算）：把 `runOnce` 里那句 `...(c.over ?? {})` 摘掉
 * （等价于「三跳通道断了：CLI 的值没递进 `handleAgentRun`」）⇒ 6 条红 4 条
 * （开 / A ≠ 旧值 / override 顶掉盘上的 true / 计价形状），而「关」与「只改设置盘那一位」两条
 * 仍绿——正是它们不该被这根断线影响。读数：开 = `picked glm-strong`、真拨 `glm-5.2-pro`、
 * `spent_usd 0.012`；关 = 零 `routing_decision`、真拨 `glm-5.2`、`spent_usd 0.003`。
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { replay, type AgentEvent } from "../src/events";
import { handleAgentRun, initSettingsStore } from "../src/main/agent-runner";
import { effectiveModelTable, findSpecByNameOrId } from "../src/providers/registry";
import { GLM_DEFAULT_MODEL, GLM_ENDPOINT, glmDefaultModelName } from "../src/providers/glm";

type Decision = Extract<AgentEvent, { type: "routing_decision" }>;
type Spawned = Extract<AgentEvent, { type: "agent_spawned" }>;
type Result = Extract<AgentEvent, { type: "agent_result" }>;

const dirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  dirs.length = 0;
});

/** worker 那一跳的假回包：一次 no-tool 收束 + 固定用量。
 *  token 数两态**完全相同**（同一份剧本、同一个角色面）⇒ 后面「钱跟着档走」那条才有同分母。 */
const WORKER_SSE = [
  'data: {"id":"wire-1","choices":[{"delta":{"content":"verdict: pass\\n评审完成，无需改动。"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1000,"completion_tokens":500}}',
  "data: [DONE]",
];

function streamResponse(lines: readonly string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

/** 主会话剧本：只派**一个只读评审 worker**，且不报 `model`。
 *  为什么必须不报：`args.model` 在路由那一支是 **pin**（`routeFor` 优先吃它，reason 会变成 pinned），
 *  而演示通道（`M3A_AGENTS_DEMO`）又**靠** `args.model` 找剧本——两头撞车。
 *  所以这里走「路由合成真实 provider 档位」那一路（`agent-runner` 的注释原话：注入模型面会强制
 *  `routedSpec=null`），worker 真拨的每一跳由本文件的 fetch 桩接住，不落一分真钱。
 *  角色点 `review`：静态档位表给 strong，而 harness 缺省 worker 档是 standard ⇒ 两态有可观测的差。 */
function mainScript(): string {
  return [
    JSON.stringify({ type: "tool_call", id: "sp-1", name: "spawn_agent", args: { mode: "read", role: "review", task: "评审这次改动是否安全" } }),
    JSON.stringify({ type: "assistant_message", content: "已派评审 worker。" }),
  ].join("\n") + "\n";
}

interface RunCase {
  /** 写进临时设置盘的键（生产入口读的就是这一份）。 */
  settings?: Record<string, unknown>;
  /** `handleAgentRun` 的 runtime override（CLI `--bandit/--cascade` 落的那两个槽）。 */
  over?: { routingBandit?: boolean; routingCascade?: boolean };
}

interface Reading {
  events: AgentEvent[];
  dials: { url: string; body: Record<string, unknown> }[];
  decisions: Decision[];
  spawned: Spawned | undefined;
  result: Result | undefined;
  /** 真拨出去的那个模型名（取第一跳；本文件只派一个 worker，全部跳都必须与它一致）。 */
  dialed: string | undefined;
  res: { ok: boolean; error?: string };
}

/** 从生产入口跑一场，读数取**盘上事件流**（replay）＋ fetch 桩留下的请求体。 */
async function runOnce(c: RunCase): Promise<Reading> {
  const home = await mkdtemp(join(tmpdir(), "m5b-wire-home-"));
  const ws = await mkdtemp(join(tmpdir(), "m5b-wire-ws-"));
  dirs.push(home, ws);
  await writeFile(
    join(home, "settings.json"),
    JSON.stringify({ autoMemory: false, autoVerify: false, impactAnalysis: false, ...(c.settings ?? {}) }),
    "utf8",
  );
  initSettingsStore(join(home, "settings.json"));
  const scriptPath = join(home, "main.jsonl");
  await writeFile(scriptPath, mainScript(), "utf8");

  vi.stubEnv("M3A_MAIN_SCRIPT", scriptPath);
  vi.stubEnv("M3A_AGENTS_DEMO", ""); // 演示通道缺席：worker 走真档位，不靠 args.model 找剧本
  vi.stubEnv("M1E_SAFE_MODE", "");
  vi.stubEnv("CAIRN_API_KEY", "test-key-never-logged"); // spawn 的 fail-closed 门要凭据；请求体由下面的桩接住
  vi.stubEnv("CAIRN_MODEL", GLM_DEFAULT_MODEL); // 「旧值」钉死成 harness 缺省那一档，别让宿主环境混进分母

  const dials: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      dials.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return streamResponse(WORKER_SSE);
    }),
  );

  const logPath = join(home, "events.jsonl");
  const res = await handleAgentRun(
    { message: "派一个评审 worker 看这份改动", mode: "auto" },
    { workspace: ws, logPath, unattended: true, ...(c.over ?? {}) },
  );
  expect(res.ok, "生产入口没跑成：" + JSON.stringify(res)).toBe(true);

  // worker 子流是异步落盘的（主 run 收束时那一笔可能还没写）⇒ 等终态；等不到就在断言里点名。
  let events = await replay(logPath);
  const deadline = Date.now() + 25_000;
  while (!events.some((e) => e.type === "agent_result") && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    events = await replay(logPath);
  }
  const decisions = events.filter((e): e is Decision => e.type === "routing_decision");
  const spawned = events.find((e): e is Spawned => e.type === "agent_spawned");
  const result = events.find((e): e is Result => e.type === "agent_result");
  return {
    events,
    dials,
    decisions,
    spawned,
    result,
    dialed: typeof dials[0]?.body.model === "string" ? (dials[0].body.model as string) : undefined,
    res,
  };
}

/** 前置自检：这一场**确实**派出了一个跑完的 worker。
 *  少了它，「零 routing_decision」会被「worker 根本没起来」满足（本仓点名的假绿形状）。 */
function assertWorkerRan(r: Reading): void {
  expect(r.dials.length, "一次模型调用都没发生 ⇒ 这一格根本没跑到被路由的那件事").toBeGreaterThan(0);
  expect(r.spawned, "事件流里没有 agent_spawned ⇒ worker 没起来，后面的断言全是空转").toBeDefined();
  expect(r.result?.status, "worker 没收到 done 终态 ⇒ 「决策变了」不能被半路失败冒充").toBe("done");
}

describe("路由开关经生产入口真换档（handleAgentRun → runAgent → buildSessionOrchestrator → orchestratorExtras → 真拨的那一档）", () => {
  it(
    "开（override routingCascade=true，盘上两枚显式 false）：routing_decision 落流、reason 是路由那一支，picked 就是真拨的那一档",
    { timeout: 120_000 },
    async () => {
      const r = await runOnce({ settings: { routingBandit: false, routingCascade: false }, over: { routingCascade: true } });
      assertWorkerRan(r);

      expect(r.decisions).toHaveLength(1);
      const decision = r.decisions[0]!;
      // reason 必须是「档位表」那一支：这一支只在 opts.routing===true 时才可能存在（未路由时 routeFor 压根不被调）。
      expect(decision.reason).toBe("tier-default");
      expect(decision.stage).toBe("review");
      const table = effectiveModelTable();
      expect(table.some((s) => s.id === decision.picked), "picked 不在档位表上：" + String(decision.picked)).toBe(true);
      expect(decision.candidates.map((c) => c.id).sort()).toEqual(table.map((s) => s.id).sort());

      const spec = table.find((s) => s.id === decision.picked)!;
      // 申报面：派活事件带的就是决策选中的那一档，而不是模型自己报的字符串。
      expect(r.spawned?.model).toBe(decision.picked);
      // 归因面：真拨的模型名（价表反查键）也必须是同一档 ⇒ 决策与花钱的是同一件事。
      expect(r.spawned?.usage_model).toBe(spec.model);
      // 落点面：每一跳 HTTP 请求体都吃这一档，没有「事件选了 A、请求发了 B」。
      expect(r.dials.every((d) => d.body.model === spec.model), "请求体模型名与 picked 不符：" + JSON.stringify(r.dials.map((d) => d.body.model))).toBe(true);
      expect(r.dials.every((d) => d.url === GLM_ENDPOINT)).toBe(true);
    },
  );

  it(
    "关（同一输入、同一剧本，盘上与 override 都没有这两枚）：一条 routing_decision 都不许出现，而 worker 仍真跑完并拨 harness 缺省档",
    { timeout: 120_000 },
    async () => {
      const r = await runOnce({ settings: { routingBandit: false, routingCascade: false } });
      assertWorkerRan(r);

      // 这一半是「两副装配都没事件 ⇒ 断言恒真」的闸：上面那条的红不能被「worker 没起来」满足。
      expect(r.decisions).toHaveLength(0);
      const table = effectiveModelTable();
      // 未路由 ⇒ 申报面没有 model（既不是档位 id 也不是模型名）：路由事件是这条通道唯一的产物。
      expect(r.spawned?.model).toBeUndefined();
      // 而真拨的是 harness 缺省那一档（旧值）。
      expect(r.dialed).toBe(glmDefaultModelName());
      expect(table.some((s) => s.model === r.dialed), "缺省档不在表上？取料面与观测面不一致").toBe(true);
    },
  );

  it(
    "A ≠ 旧值：同一场剧本两态各跑一次，真拨的模型名与档位都必须换",
    { timeout: 180_000 },
    async () => {
      // 这条才是「翻了真换档」本体：前两态各钉一次，差值只能归旗标（唯一变量）。
      const on = await runOnce({ over: { routingCascade: true } });
      assertWorkerRan(on);
      const off = await runOnce({ settings: { routingBandit: false, routingCascade: false } });
      assertWorkerRan(off);

      expect(on.decisions).toHaveLength(1);
      expect(off.decisions).toHaveLength(0);
      // 旧值 = harness 缺省 worker 档（未路由那一路真拨的名字）。
      expect(off.dialed).toBe(glmDefaultModelName());
      expect(on.dialed).toBeDefined();
      expect(on.dialed).not.toBe(off.dialed);
      // 档位轴也要真的换过：两边都按**各自观测到的真拨名**反查档位（不是测试自己重选一遍）。
      const table = effectiveModelTable();
      const onTier = table.find((s) => s.id === on.decisions[0]!.picked)?.tier;
      const offTier = findSpecByNameOrId(table, off.dialed ?? "")?.tier;
      expect(onTier, "picked 反查不到档位").toBeDefined();
      expect(offTier, "旧值反查不到档位").toBeDefined();
      expect(onTier).not.toBe(offTier);
    },
  );

  it(
    "只改设置盘那一位（settings.routingCascade=true，override 一个不给）：生产入口照样换档",
    { timeout: 120_000 },
    async () => {
      // `resolveRoutingFlags` 的**右半边**（回落到 settings）此前只有纯函数测过：把
      // `over.X ?? settings.X` 改成 `over.X ?? false`，纯函数那条照绿——这里让它红。
      const r = await runOnce({ settings: { routingCascade: true } });
      assertWorkerRan(r);
      expect(r.decisions).toHaveLength(1);
      expect(r.decisions[0]!.reason).toBe("tier-default");
      const spec = effectiveModelTable().find((s) => s.id === r.decisions[0]!.picked)!;
      expect(r.spawned?.model).toBe(spec.id);
      expect(r.dialed).toBe(spec.model);
      expect(r.dialed).not.toBe(glmDefaultModelName());
    },
  );

  it(
    "override 顶掉盘上的 true（over.routingCascade=false + settings.routingCascade=true）⇒ 关",
    { timeout: 120_000 },
    async () => {
      // 三态语义里「覆盖」那一支也得在真通路上兑现，否则 CLI 的 `--no-cascade` 只是一串字。
      const r = await runOnce({ settings: { routingCascade: true }, over: { routingCascade: false } });
      assertWorkerRan(r);
      expect(r.decisions).toHaveLength(0);
      expect(r.spawned?.model).toBeUndefined();
      expect(r.dialed).toBe(glmDefaultModelName());
    },
  );

  it(
    "计价形状：同一份用量，开的那一场按 picked 那一档折钱，且未标定的行必须自己声明未标定",
    { timeout: 180_000 },
    async () => {
      // 两态的 token 数逐字相同（同一份 WORKER_SSE）⇒ 差值只能来自「哪一档的单价」。
      const on = await runOnce({ over: { routingCascade: true } });
      assertWorkerRan(on);
      const off = await runOnce({});
      assertWorkerRan(off);

      const onSpent = on.result?.artifacts.spent_usd;
      const offSpent = off.result?.artifacts.spent_usd;
      expect(typeof onSpent, "开路由的那一场没算出价 ⇒ 价格标签没跟着档位走").toBe("number");
      expect(typeof offSpent).toBe("number");
      expect(onSpent!).toBeGreaterThan(offSpent!);
      // 诚实边界：GLM 三行是价表占位（官方页数字没抓到），所以这条**只**能说「钱跟着档走」。
      expect(on.result?.artifacts.price_calibrated, "占位价行被标成已标定 ⇒ 这条会被读成省了钱").toBe(false);
    },
  );
});

/* ---- 仍缺的那一根（bandit 那一支，本文件证不动，逐条现读） ----
 *
 * 1) 值确实传到：`src/main/agent-runner.ts:387-388` 把 `routing.routingBandit` 展开成
 *    `{ routing: true, banditStatePath: join(ROOT, ".agent", "routing-bandit.json") }`，
 *    `ROOT` = `resolve(dirname(import.meta.url), "..", "..")`（同文件 :158），即 **harness 安装目录**，
 *    与 `RunOptions.workspace` / `handleAgentRun` 的 over.workspace **无关**，也没有任何 env 槽能改它
 *    （对照：`globalPermissionsPath` 吃 `DSH_APPDATA`、catalog 吃 `CAIRN_CATALOG_DIR`、影响面吃
 *    `M7_IMPACT_TAGS_DIR`——这一枚是死的）。
 * 2) 于是判卷无法在临时工作区里播种：`tests/bandit-runtime.test.ts` 之所以能「固定种子 + 偏斜臂」，
 *    是因为它自备 `banditStatePath`（`join(work, "routing-bandit.json")`）。走生产入口时那份状态盘
 *    只有一个落点 = `<repo>/.agent/routing-bandit.json`，而它**不在 .gitignore 里**
 *    （`git check-ignore -v` 现读不命中）⇒ 播种＝往共享工作树拉一个 untracked 文件，
 *    清理＝删一个不属于本判卷的文件，中间窗口里隔壁会话的同名 run 还会与它互染。
 * 3) 副作用不可选：`reason=bandit`  ⇒ `handle.routeArm` 被登记（`orchestrator.ts:710-715`）⇒
 *    worker 收束时 `rewardBandit` 必调 `saveBanditState`（`orchestrator.ts:1955-1968`），
 *    done / failed / cancelled 三路都落笔。也就是说**只要让 reason 走到 bandit，就一定会写那个文件**，
 *    除了把 worker 永久吊住（留一个在途 worker + 未结束的流）之外没有绕开的形状。
 * 4) 还有一条独立的：本仓 `isScripted ⇒ price=null`（`orchestrator.ts:614-626`）——冻结剧本不拨号
 *    也不付钱，所以「开了真省钱」在合成流里原理上不可证；上面那条只钉「钱与归因跟着选中的档走」。
 *
 * 要补上「翻了真换档（bandit 臂）」这一格，缺的是生产侧的一个入参，不是测试侧的一个用例：
 *    `orchestratorExtras` 的 `banditStatePath` 需要一个**工作区/数据盘口径**（同 `M7_IMPACT_TAGS_DIR`
 *    那族：判卷全落 tmp，绝不落工作区），或由 `RunOptions` 递一个显式路径。
 * 那之前，本文件能钉的到「旗标翻了 ⇒ 路由决策存在 ⇒ 决策那一档就是真拨的那一档 ⇒ 钱跟着它走」为止。
 */
