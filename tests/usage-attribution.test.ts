// usage 事件的模型归因：一笔钱到底花在哪一档上。
//
// 为什么单独立一面（2026-09-27 读数，outputs/cost-attribution-join-2026-09-27/probe-join-face.mts）：
// 评估面的 `$ / 成功任务` 一直报「不可测」，成因**不是价表缺档**——整份语料 166 条 usage 事件里
// 自带 `model` 0 条，而消费端 `run-scorecard.usageOfStream` 早就在读这一列（读到恒零 ⇒ 判 no-attribution）。
// 缺的是生产端那一半。本面钉住补齐后的三条纪律：只有真拨号才盖章、worker 不许借主会话那一档、
// 盖在事件本身上（live ≡ 盘）。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { createUsageAttributor } from "../src/agent/usage-attribution";
import { Orchestrator, scriptedWorkerModel, type SpawnArgs } from "../src/agent/orchestrator";
import { budgetPriceKeyOf, mainUsageModelOf, resolveRunModel, scriptedMainModelPath } from "../src/main/agent-runner";
import { priceForModel, spentUsdFor } from "../src/agent/orchestrator-join";
import { DEFAULT_MODEL_TABLE, PROVIDER_IDS, toWorkerModel } from "../src/providers/registry";
import { usageNameOf } from "../src/agent/worker-model";
import { costOf, usageOfStream } from "../scripts/replay/run-scorecard";

/** 三档真名，单价两两不同（本仓价表 flash 与 standard 差 4 倍）⇒ 混档必须改变钱数，判据才有分辨力。 */
const MAIN = "glm-5.2";
const WORKER = "glm-5.3-flash";
const DECLARED_ONLY = "glm-5.2-pro"; // 只有"申报/路由选中"才会出现的档，本 run 没真拨它
const USAGE = { inputTokens: 100_000, outputTokens: 10_000 };
const usdOf = (name: string): number | null => spentUsdFor(priceForModel(name), USAGE)?.usd ?? null;

type UsageEv = Extract<AgentEvent, { type: "usage" }>;
const usage = (extra: Partial<UsageEv> = {}): UsageEv => ({ type: "usage", ...USAGE, ...extra }) as UsageEv;
const spawned = (agentId: string, usageModel?: string, model?: string): AgentEvent =>
  ({
    type: "agent_spawned", agent_id: agentId, parent_event_id: 1, mode: "read", task: "t",
    max_turns: 5, permission_mode: "read-only",
    ...(model !== undefined ? { model } : {}),
    ...(usageModel !== undefined ? { usage_model: usageModel } : {}),
  }) as AgentEvent;

const SCRIPTED_ENVS = ["M3A_MAIN_SCRIPT", "M3A_AGENTS_DEMO", "M1B_GATE_FLOW", "M1C_AUTONOMY_SCRIPT", "M2A_LSP_DEMO"];
const envBackup: Record<string, string | undefined> = {};
for (const k of [...SCRIPTED_ENVS, "M0A_PROVIDER", "CAIRN_MODEL"]) envBackup[k] = process.env[k];
afterEach(() => {
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
/** 清掉全部剧本 env（`mainUsageModelOf` 读的是 process.env，这里给真值而不是文本）。 */
const clearScripted = (): void => { for (const k of SCRIPTED_ENVS) delete process.env[k]; };

describe("盖章器：五种输入各自的落法", () => {
  it("非 usage 事件原样放过（不许给 assistant_message 之类凭空补 model）", () => {
    const a = createUsageAttributor(() => MAIN);
    const msg = { type: "assistant_message", content: "hi" } as AgentEvent;
    expect(a.stamp(msg)).toBe(false);
    expect((msg as { model?: string }).model).toBeUndefined();
    expect(a.stamp(spawned("agent-1", WORKER))).toBe(false); // spawned 只进映射表，自己不被盖
  });

  it("取的是**调用时**的主会话档，不是建盖章器时的快照", () => {
    let main = "";
    const a = createUsageAttributor(() => main);
    const e1 = usage();
    expect(a.stamp(e1)).toBe(false); // 装配还没解析完 ⇒ 定不了价，宁可不盖
    main = MAIN;
    const e2 = usage();
    expect(a.stamp(e2)).toBe(true);
    expect(e2.model).toBe(MAIN);
  });

  it("生产者自己带了 model ⇒ 不覆盖（provider 回执比我们推断权威）", () => {
    const a = createUsageAttributor(() => MAIN);
    const e = usage({ model: "reported-by-provider" });
    expect(a.stamp(e)).toBe(false);
    expect(e.model).toBe("reported-by-provider");
  });

  it("worker 那一笔取 spawned 留的档，且**不许借主会话那一档**（纪律⑵）", () => {
    const a = createUsageAttributor(() => MAIN);
    a.stamp(spawned("agent-9", WORKER));
    const e = usage({ agent_id: "agent-9" });
    expect(a.stamp(e)).toBe(true);
    expect(e.model).toBe(WORKER);
    // 牙齿：借主档会算出另一个数 ⇒ 这条断言不是恒真
    expect(usdOf(WORKER)).not.toBe(usdOf(MAIN));
  });

  it("归因取「真拨的模型名」，不取 spawned 上那个申报档位", () => {
    // spawned.model 的语义是"派工时申报/路由选中的档位 id"；真拨哪一档由 modelFor 与路由决定。
    // 挂在申报档上 = 把第 145 页刚修掉的形状（按申报档折钱、按真拨档花钱）搬到归因面。
    const a = createUsageAttributor(() => MAIN);
    a.stamp(spawned("agent-7", WORKER, "glm-strong"));
    const e = usage({ agent_id: "agent-7" });
    expect(a.stamp(e)).toBe(true);
    expect(e.model).toBe(WORKER);
    expect(usdOf(WORKER)).not.toBe(usdOf(DECLARED_ONLY));
  });

  it("worker 从未在流里留过档 ⇒ 不盖（缺字段＝不可定价，由消费方出声，绝不借主档）", () => {
    const a = createUsageAttributor(() => MAIN);
    const e = usage({ agent_id: "agent-unknown" });
    expect(a.stamp(e)).toBe(false);
    expect(e.model).toBeUndefined();
  });

  it("spawned 缺 usage_model（剧本 worker：不拨号不付钱）⇒ 后面那笔也不盖", () => {
    const a = createUsageAttributor(() => MAIN);
    a.stamp(spawned("agent-8"));
    const e = usage({ agent_id: "agent-8" });
    expect(a.stamp(e)).toBe(false);
    expect(e.model).toBeUndefined();
  });

  it("空串 agent_id 不算「匿名的主会话用量」，也不写进映射表", () => {
    const a = createUsageAttributor(() => MAIN);
    a.stamp(spawned("", WORKER));
    const e = usage({ agent_id: "" });
    expect(a.stamp(e)).toBe(false);
  });
});

describe("跨面回路：盖章之后评估面的钱轴第一次可有数", () => {
  const rawStream = (): AgentEvent[] => [
    spawned("agent-1", WORKER),
    usage(),                      // 主会话两跳
    usage(),
    usage({ agent_id: "agent-1" }), // worker 一跳
  ];

  it("未盖章 ⇒ 判 no-attribution、usd=null（不许折成 $0）——这是修之前的真实读数", () => {
    const cost = costOf([usageOfStream(rawStream())]);
    expect(cost.measurable).toBe(false);
    expect(cost.usd).toBeNull();
    expect(cost.cause).toBe("no-attribution");
    expect(cost.unpricedTokens).toBe(3 * (USAGE.inputTokens + USAGE.outputTokens));
  });

  it("盖章后 ⇒ 可测，且逐笔按各自档折钱（两档合计 ≠ 全按主档）", () => {
    const events = rawStream();
    const a = createUsageAttributor(() => MAIN);
    for (const e of events) a.stamp(e);
    const totals = usageOfStream(events);
    expect(totals.modelAttributed).toBe(3);
    const cost = costOf([totals]);
    expect(cost.cause).toBe("");
    expect(cost.measurable).toBe(true);
    expect(cost.usd).toBeCloseTo((usdOf(MAIN) ?? 0) * 2 + (usdOf(WORKER) ?? 0), 6);
    // 反向牙齿：worker 借主档 ⇒ 总数会偏大；这一格正是 2026-09-23 那次 40 倍分叉的形状
    expect(cost.usd).not.toBeCloseTo((usdOf(MAIN) ?? 0) * 3, 6);
  });

  it("只盖到一部分 ⇒ 报「下界」而不是实付（`reason` 点名几条能定价）", () => {
    const events = rawStream();
    const a = createUsageAttributor(() => MAIN);
    a.stamp(events[0]); a.stamp(events[1]); // 漏掉 worker 那笔（它没进过 spawned）
    const cost = costOf([usageOfStream([events[1], usage({ agent_id: "agent-1" })])]);
    expect(cost.measurable).toBe(true);
    expect(cost.reason).toContain("1/2");
  });

  it("剧本主会话 ⇒ 主会话那两笔不盖，但 worker 真拨的钱不许跟着一起抹掉", () => {
    const events = rawStream();
    const a = createUsageAttributor(() => "");
    for (const e of events) a.stamp(e);
    const totals = usageOfStream(events);
    expect(totals.modelAttributed).toBe(1);      // 只有 worker 那一笔
    expect(totals.buckets.filter((b) => b.price === null)).toHaveLength(2);
    const cost = costOf([totals]);
    expect(cost.measurable).toBe(true);          // 真花过 ⇒ 报下界，不报「没花钱」
    expect(cost.usd).toBeCloseTo(usdOf(WORKER) ?? 0, 6);
    expect(cost.reason).toContain("1/3");
  });

  it("整条链都是剧本（主键空 + spawned 不带归因键）⇒ 仍判 no-attribution", () => {
    const events = [spawned("agent-1"), usage(), usage({ agent_id: "agent-1" })];
    const a = createUsageAttributor(() => "");
    for (const e of events) a.stamp(e);
    const cost = costOf([usageOfStream(events)]);
    expect(cost.cause).toBe("no-attribution");
    expect(cost.usd).toBeNull();
  });
});

describe("mainUsageModelOf / scriptedMainModelPath：装配与归因答同一个问题", () => {
  it("无剧本 env ⇒ 归因键 = 美元闸的价键 = 真拨那一档", () => {
    clearScripted();
    expect(scriptedMainModelPath({})).toBeNull();
    const sel = resolveRunModel({ provider: "glm", model: "" });
    expect(mainUsageModelOf(sel)).toBe(budgetPriceKeyOf(sel));
    expect(mainUsageModelOf(sel)).toBe(MAIN);
  });

  it("五个剧本通道逐个枚举 ⇒ 各指向自己的剧本，且归因键一律置空", () => {
    clearScripted();
    const sel = resolveRunModel({ provider: "glm", model: "" });
    process.env.M3A_MAIN_SCRIPT = "fixtures/scripted.jsonl";
    expect(scriptedMainModelPath()).toContain("fixtures/scripted.jsonl");
    expect(scriptedMainModelPath()?.startsWith("/")).toBe(true); // 相对路径要 resolve 成绝对（createProvider 按原样开文件）
    expect(mainUsageModelOf(sel)).toBe("");

    for (const [k, v] of [["M3A_MAIN_SCRIPT", ""], ["M3A_AGENTS_DEMO", "1"], ["M1B_GATE_FLOW", "1"],
      ["M1C_AUTONOMY_SCRIPT", "fixtures/x.jsonl"], ["M2A_LSP_DEMO", "1"]] as const) {
      if (v === "") delete process.env[k]; else process.env[k] = v;
    }
    expect(scriptedMainModelPath()).toContain("main-demo.jsonl");
    expect(mainUsageModelOf(sel)).toBe("");

    delete process.env.M3A_AGENTS_DEMO;
    process.env.M1B_GATE_FLOW = "1";
    expect(scriptedMainModelPath()).toContain("gate");
    delete process.env.M1B_GATE_FLOW;
    process.env.M1C_AUTONOMY_SCRIPT = "fixtures/auto.jsonl";
    expect(scriptedMainModelPath()).toBe("fixtures/auto.jsonl");
    delete process.env.M1C_AUTONOMY_SCRIPT;
    process.env.M2A_LSP_DEMO = "/abs/lsp.jsonl";
    expect(scriptedMainModelPath()).toBe("/abs/lsp.jsonl");
    clearScripted();
    expect(scriptedMainModelPath()).toBeNull();
  });

  it("剧本 env 同时在场时按声明顺序取胜（越靠前越显式）", () => {
    clearScripted();
    process.env.M3A_MAIN_SCRIPT = "fixtures/a.jsonl";
    process.env.M1B_GATE_FLOW = "1";
    expect(scriptedMainModelPath()).toContain("fixtures/a.jsonl");
  });

  it("demo 通道（非剧本）⇒ 空串：价不可知由消费方出声，绝不折成 $0", () => {
    clearScripted();
    expect(mainUsageModelOf(resolveRunModel({ provider: "demo", model: "" }))).toBe("");
    expect(usdOf("")).toBeNull();
  });
});

describe("真编排器：agent_spawned 上的归因键随「拨不拨号」分岔", () => {
  let work = "";
  let logPath = "";
  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "usage-attribution-orch-"));
    logPath = join(work, "events.jsonl");
    await writeFile(logPath, "", "utf8");
  });
  afterEach(async () => { await rm(work, { recursive: true, force: true }).catch(() => {}); });

  function makeOrch(modelFor: () => unknown): { orch: Orchestrator; events: AgentEvent[] } {
    const events: AgentEvent[] = [];
    const orch = new Orchestrator({
      logPath, workspace: work, parentMode: "default", modelFor: modelFor as never,
      emit: async (e) => { events.push(e); },
    });
    return { orch, events };
  }
  const spawnedOf = (events: AgentEvent[]) =>
    events.filter((e): e is Extract<AgentEvent, { type: "agent_spawned" }> => e.type === "agent_spawned");
  /** 非剧本 worker 面：空生成器 ⇒ `isScriptedModel` 认不出（它只认 `scripted === true` 这个自述标）。 */
  const silentRealModel = (): unknown => Object.assign(async function* () { /* 不吐输出，跑完即停 */ }, {});

  it("注入真拨模型 ⇒ 落 glmDefaultModelName 那一档，且跟着 CAIRN_MODEL 走（不是写死的名字）", async () => {
    clearScripted();
    delete process.env.CAIRN_MODEL;
    const { orch, events } = makeOrch(silentRealModel);
    await orch.spawn({ mode: "read", task: "调研 a.ts" } as SpawnArgs, { callId: "c1" });
    const [first] = spawnedOf(events);
    expect(first, "spawn 没落 agent_spawned ⇒ 下面全是空判").toBeDefined();
    expect(first?.usage_model).toBe("glm-5.2");
    await orch.cancelAll();

    process.env.CAIRN_MODEL = WORKER; // 真拨的缺省档换了 ⇒ 归因键跟着换
    const second = makeOrch(silentRealModel);
    await second.orch.spawn({ mode: "read", task: "调研 b.ts" } as SpawnArgs, { callId: "c2" });
    expect(spawnedOf(second.events)[0]?.usage_model).toBe(WORKER);
    await second.orch.cancelAll();
  });

  it("注入带自述名的模型 ⇒ 键用真名，且折价随它换档（旧实现两档注入给出同一个数）", async () => {
    clearScripted();
    delete process.env.CAIRN_MODEL;
    const named = (name: string): unknown => Object.assign(async function* () { /* 拨号替身 */ }, { usageName: name });
    for (const name of [WORKER, DECLARED_ONLY]) {
      const run = makeOrch(() => named(name));
      await run.orch.spawn({ mode: "read", task: "调研 " + name } as SpawnArgs, { callId: "n-" + name });
      expect(spawnedOf(run.events)[0]?.usage_model, name + " 这一档没落 spawned（空判）").toBe(name);
      await run.orch.cancelAll();
    }
    // 只比"名字对"不够：`modelFor` 注入时 `routedSpec` 是 null，旧实现退回 `glmDefaultModelName()`，
    // 而测试环境里 CAIRN_MODEL 恰好可以等于那个名字 ⇒ 名字对上、档位其实错。所以必须比"两档给出两个不同的数"。
    expect(usdOf(WORKER)).not.toEqual(usdOf(DECLARED_ONLY));
    expect(usdOf(DECLARED_ONLY)).not.toEqual(usdOf(MAIN));
  });

  it("反向哨兵：注入方没自述 ⇒ 仍落 harness 缺省档（那一格是诚实的替身语义，不许顺手改成静默丢归因）", async () => {
    clearScripted();
    process.env.CAIRN_MODEL = DECLARED_ONLY;
    const run = makeOrch(silentRealModel);
    await run.orch.spawn({ mode: "read", task: "调研 z.ts" } as SpawnArgs, { callId: "z1" });
    expect(spawnedOf(run.events)[0]?.usage_model).toBe(DECLARED_ONLY);
    await run.orch.cancelAll();
  });

  it("冻结剧本 worker ⇒ 键整个缺席（demo 通道的用量一旦可定价，评估面就会把没花过的钱当真钱）", async () => {
    clearScripted();
    const { orch, events } = makeOrch(() => scriptedWorkerModel([{ type: "assistant_message", content: "## 结论\n- 完\n\n## 证据路径\n- a.ts:1\n\n## 风险\n- 低\n\n## 未决问题\n- 无" }]));
    await orch.spawn({ mode: "read", task: "调研 c.ts" } as SpawnArgs, { callId: "c3" });
    const [first] = spawnedOf(events);
    expect(first, "本 setup 必须能落 spawned，否则上一条与这条都是空尺").toBeDefined();
    expect("usage_model" in first!).toBe(false);
    await orch.cancelAll();
  });
});

describe("接线：盖章点=主会话＋基准跑器两处，且不许再抄第二份剧本枚举", () => {
  const runner = () => readFileSync(fileURLToPath(new URL("../src/main/agent-runner.ts", import.meta.url)), "utf8");
  // 2026-10-17 搬迁：`scriptedMainModelPath` 随 fixtures 面搬去 `./demo-scripted.ts`。这一族里凡量
  // 「枚举只许活在哪个**函数**里」的尺，取料面就得跟着并料（同 `orchestrator-hold.test.ts` 的
  // ORCH_SRC_ALL 先例）——量的是「只许有一处」，不是「只许在某个文件里」。
  const demoScripted = () => readFileSync(fileURLToPath(new URL("../src/main/demo-scripted.ts", import.meta.url)), "utf8");
  const providerAssembly = () => readFileSync(fileURLToPath(new URL("../src/main/provider-assembly.ts", import.meta.url)), "utf8");
  const orch = () => readFileSync(fileURLToPath(new URL("../src/agent/orchestrator.ts", import.meta.url)), "utf8");

  it("pipeline 里 stamp 在 append **之前**（live 与盘必须同一个对象），且这一份文件里只有这一处盖章", () => {
    const t = runner();
    const stamp = t.indexOf("usageAttribution.stamp(e);");
    expect(stamp).toBeGreaterThan(-1);
    expect(t.indexOf("await log!.append(e);", stamp)).toBeGreaterThan(stamp);
    expect([...t.matchAll(/\.stamp\(/g)].length).toBe(1);
    // 空载自证：盖章器真被接进 pipeline 的那条队列里，不是只建不用
    expect(t).toMatch(/const usageAttribution = createUsageAttributor\(\(\) => mainUsageModel\);/);
    expect(t).toMatch(/mainUsageModel = mainUsageModelOf\(modelSelection\);/);
  });

  it("剧本 env 枚举整份只许活在 scriptedMainModelPath 里（装配与归因共用同一个式子）", () => {
    // 并料后再切片，**顺序即语义**：函数头住在 `./demo-scripted.ts`，`mainUsageModelOf` 仍在装配根，
    // 所以新模块那份要拼在前——否则 `indexOf` 两头颠倒，切出来是空串（本笔真踩过这一下）。
    // 中间那份 `provider-assembly` 是 `const scripted = scriptedMainModelPath();` 的新落点（下面那条断言）。
    const all = demoScripted() + "\n" + providerAssembly() + "\n" + runner();
    const fn = all.slice(all.indexOf("export function scriptedMainModelPath"), all.indexOf("export function mainUsageModelOf"));
    expect(fn.length).toBeGreaterThan(50); // 切片本身不许静默为空，否则下面全是恒真
    // `env.X` 这个形状只在真读 env 时出现（注释与文档写作裸名），所以按它计数。
    for (const k of ["M3A_MAIN_SCRIPT", "M1B_GATE_FLOW", "M1C_AUTONOMY_SCRIPT", "M2A_LSP_DEMO"]) {
      const re = new RegExp("env\\." + k + "\\b", "g");
      const total = [...all.matchAll(re)].length;
      expect(total, k + " 一处都没读 ⇒ 切片判据空载").toBeGreaterThanOrEqual(1);
      expect([...fn.matchAll(re)].length, k + " 被抄了第二份枚举").toBe(total);
    }
    // M3A_AGENTS_DEMO 刻意不在名单里：它在 scriptedMainModelPath 之外还答**另一个**问题
    // （`demoModelFor` = worker 用哪套剧本），那份不是本式的副本。
    // `const scripted = scriptedMainModelPath();` 2026-10-17 随 createProvider 搬去
    // `./provider-assembly.ts` ⇒ 这条也读并料面（上面那份 `all`）。
    expect(all).toMatch(/const scripted = scriptedMainModelPath\(\);/);
  });

  it("worker 侧：价格标签与归因键同分支同式子，且落进 spawned 事件", () => {
    const t = orch();
    expect(t, "price 又去读另一个变量 ⇒ 两处尺").toMatch(/price = priceForModel\(usageModel/);
    expect(t, "spawned 不带归因键 ⇒ worker 的钱永远定不了价").toMatch(
      /\.\.\.\(usageModel !== "" \? \{ usage_model: usageModel \} : \{\}\)/);
    expect(t, "归因键回到剧本通道 ⇒ 没花的钱会被当真钱").toMatch(/let usageModel = "";\n    if \(!isScriptedModel\(model\)\) \{/);
  });

  // ↓ 从「每份文件各自数一遍」升级成**全仓普查**。原写法挡得住"多抄一处"，挡不住"少一个消费者"：
  //   基准跑器从前根本不走这条层，而按文件计的那条断言在 agent-runner 里永远自洽 ⇒ 全绿。
  //   （本仓第 11 次同族的正解：producer 有判据、consumer 零观测 ⇒ 让被度量面自己交出调用点清单。）
  const ROOTDIR = fileURLToPath(new URL("..", import.meta.url));
  const sourceFilesUnder = (relDir: string): string[] => {
    const acc: string[] = [];
    const walk = (dir: string): void => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
        const p = join(dir, ent.name);
        if (ent.isDirectory()) { walk(p); continue; }
        if (ent.name.endsWith(".ts")) acc.push(relative(ROOTDIR, p));
      }
    };
    walk(join(ROOTDIR, relDir));
    return acc;
  };

  /** 定义文件自己不算调用点（它 export 这个函数）。 */
  const DEFINITION = join("src", "agent", "usage-attribution.ts");
  const callingFiles = (needle: RegExp): string[] =>
    [...sourceFilesUnder("src"), ...sourceFilesUnder("scripts")]
      .filter((rel) => rel !== DEFINITION)
      .filter((rel) => needle.test(readFileSync(join(ROOTDIR, rel), "utf8")))
      .sort();

  it("普查：建盖章器的只有两处（主会话 + 基准跑器），多一处＝再抄一份归因，少一处＝又有人绕过这条层", () => {
    expect(callingFiles(/createUsageAttributor\(/).sort())
      .toEqual([join("scripts", "loop-eval.ts"), join("src", "main", "agent-runner.ts")]);
    expect(callingFiles(/usageAttribution\.stamp\(/))
      .toEqual([join("scripts", "loop-eval.ts"), join("src", "main", "agent-runner.ts")]);
  });

  it("基准跑器：stamp 也在 append 之前，且模型名取 glmDefaultModelName（不许多一份 glm-5.2 副本）", () => {
    const rel = join("scripts", "loop-eval.ts");
    const t = readFileSync(join(ROOTDIR, rel), "utf8");
    const stamp = t.indexOf("usageAttribution.stamp(e);");
    expect(stamp, "跑器没盖章 ⇒ 基准语料的 usage 永远没有归因键").toBeGreaterThan(-1);
    expect(t.indexOf("await log.append(e);", stamp)).toBeGreaterThan(stamp);
    expect(t).toMatch(/createUsageAttributor\(glmDefaultModelName\)/);
    // 行内也要带上这个键：跑器把每趟的 events.jsonl 删掉（临时目录），盘上唯一留得住的是 readings.json
    expect(t).toMatch(/model: glmDefaultModelName\(\)/);
  });

  it("反面哨兵：普查这条不是空尺——同一套走法能数得出 src/agent 下的文件数（>10）", () => {
    expect(sourceFilesUnder("src/agent").length).toBeGreaterThan(10);
    expect(callingFiles(/createUsageAttributor\(/).length).toBe(2);
  });
});

// #22：注入面的自述名。归因键与价格标签吃同一个变量 ⇒ 没自述名时两者一起错档、永不互相打脸，
// 所以这一面必须**双向**钉：带名要随名字变，没名要留在缺省档（不许改成"静默不记账"，那会让 demo 面丢键）。
describe("自述名盖章点：toWorkerModel 一处，四个 provider 支共用", () => {
  it("表里每一档都带自述名，且四个 provider 都被枚举到（漏一支＝那一支静默错档）", () => {
    const seen = new Set<string>();
    for (const spec of DEFAULT_MODEL_TABLE) {
      seen.add(spec.provider);
      expect(toWorkerModel(spec).usageName, spec.id + " 这一档没带自述名").toBe(spec.model);
    }
    expect([...seen].sort()).toEqual([...PROVIDER_IDS].sort());
    expect(DEFAULT_MODEL_TABLE.length).toBeGreaterThan(PROVIDER_IDS.length); // 每支至少一档，别拿"表只有 4 行"糊过去
  });

  it("取值只有一个入口，且优先级写在式子里：自述名 > 路由 spec > 缺省档", () => {
    expect(usageNameOf(Object.assign(function* () {}, { usageName: "glm-5.2-pro" }))).toBe("glm-5.2-pro");
    expect(usageNameOf(function* () {})).toBe("");            // 没自述 ⇒ 空串，由调用方决定退哪一档
    expect(usageNameOf(undefined)).toBe("");
    expect(usageNameOf({ usageName: "不是函数" })).toBe("");   // 只有可调用对象才配自述
    expect(usageNameOf(Object.assign(function* () {}, { usageName: 42 } as never))).toBe(""); // 自述位必须是字符串
    const t = readFileSync(fileURLToPath(new URL("../src/agent/orchestrator.ts", import.meta.url)), "utf8");
    expect(t, "编排器绕过 usageNameOf 自己 cast ⇒ 第二份尺").toMatch(/usageModel = usageNameOf\(model\) \|\| routedSpec\?\.model \|\| glmDefaultModelName\(\);/);
  });
});
