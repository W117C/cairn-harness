// M5b 路由验收脚本（pnpm routing-check，第 25 道门；仿 agents-check 体例）。
// 段：
//   A 编排器接入（步骤 8）：A1 spawn 恰一条 routing_decision 且 agent_id 与 agent_spawned 匹配 /
//     A2 pin 模型 → reason=pinned 且 picked=pin / A3 无 modelFor 老路径零 routing_decision（零行为）/
//     A4 respawn 重派按 pin（routing_decision.picked === respawn.model）
//   B bandit 在线学习（步骤 9 追加）：B1 收敛 / B2 奖励取反反向验证 / B3 开关关闭零行为
//   C 级联升级（步骤 10 追加）：C1 恰好升级一次 / C2 maxRungs 有界 / C3 无 verify 不升级
// 注意：routing 路径的 worker 无 key 时模型调用即失败（fail-closed）——本脚本断言的是
// spawn 的决策面（routing_decision + agent_spawned），worker 终态不影响 A/B/C 的判定。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventLog, type AgentEvent } from "../src/events";
import { Orchestrator, scriptedWorkerModel } from "../src/agent/orchestrator";
import type { RespawnArgs } from "../src/agent/recovery";
import { DEFAULT_MODEL_TABLE } from "../src/providers/registry";
import { createRng, newBanditState, nextRandom, selectArm, update, updatePriced } from "../src/routing/bandit";
import { costUsd, DEFAULT_PRICE_TABLE, priceCoverage, priceOf } from "../src/routing/pricing";
import { routeFor } from "../src/routing/policy";
import { runCascade } from "../src/routing/cascade";
import { DEFAULT_SETTINGS, SettingsStore, validateSettings } from "../src/main/settings";

let pass = 0;
let fail = 0;
function check(cond: boolean, name: string, detail?: string): void {
  if (cond) {
    pass++;
    console.log("  ✅ " + name);
  } else {
    fail++;
    console.log("  ❌ " + name + (detail ? "（" + detail + "）" : ""));
  }
}

const ROOT = process.cwd();
const work = await mkdtemp(join(tmpdir(), "m5b-routing-check-"));

function newOrch(
  logPath: string,
  over: { routing?: boolean; modelFor?: () => ReturnType<typeof scriptedWorkerModel> } = {},
): { orch: Orchestrator; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const orch = new Orchestrator({
    logPath,
    workspace: join(ROOT, "fixtures", "todo-app"),
    parentMode: "default",
    emit: async (e) => {
      events.push(e);
      await createEventLog(logPath).append(e);
    },
    ...(over.routing ? { routing: true } : {}),
    ...(over.modelFor ? { modelFor: over.modelFor } : {}),
  });
  return { orch, events };
}

// ============================== A 编排器接入（步骤 8） ==============================
console.log("[routing-check] A 编排器接入（routing_decision / pin / 老路径零行为 / respawn 按 pin）");

{
  // A1：routing 路径每次 spawn 恰一条 routing_decision，agent_id 与 agent_spawned 匹配
  const p = join(work, "a1.jsonl");
  const { orch, events } = newOrch(p, { routing: true, modelFor: () => scriptedWorkerModel([]) });
  const r = await orch.spawn({ mode: "read", task: "只读调研：fixtures/todo-app 的 todo.ts 在哪？" }, { callId: "r-a1" });
  check(r.ok, "A1a routing 路径 spawn 受理");
  await orch.waitAll(15_000);
  const decs = events.filter((e) => e.type === "routing_decision");
  const spawned = events.filter((e) => e.type === "agent_spawned");
  check(decs.length === 1 && spawned.length === 1, "A1b 每次 spawn 恰有一条 routing_decision（" + String(decs.length) + "）");
  check(
    decs.length === 1 && spawned.length === 1 && decs[0]!.agent_id === spawned[0]!.agent_id,
    "A1c routing_decision.agent_id 与 agent_spawned 匹配",
  );
}

{
  // A2：pin 模型 → reason=pinned 且 picked=pin；agent_spawned.model 同步为 picked
  const p = join(work, "a2.jsonl");
  const { orch, events } = newOrch(p, { routing: true, modelFor: () => scriptedWorkerModel([]) });
  const r = await orch.spawn({ mode: "read", task: "pin 强档调研", model: "glm-strong" }, { callId: "r-a2" });
  check(r.ok, "A2a pin spawn 受理");
  await orch.waitAll(15_000);
  const dec = events.find((e) => e.type === "routing_decision") as Extract<AgentEvent, { type: "routing_decision" }> | undefined;
  check(dec !== undefined && dec.reason === "pinned" && dec.picked === "glm-strong", "A2 pin → reason=pinned 且 picked 等于 pin 值");
  const spawned = events.find((e) => e.type === "agent_spawned") as Extract<AgentEvent, { type: "agent_spawned" }> | undefined;
  check(spawned?.model === "glm-strong", "A2b agent_spawned.model 填选中的 model id");
  check(dec !== undefined && dec.candidates.length === DEFAULT_MODEL_TABLE.length, "A2c 候选面 = 全档位表（可审计）");
}

{
  // A3：无 modelFor / 无 routing 的老路径 → 零 routing_decision（零行为，不破坏既有门）
  const p = join(work, "a3.jsonl");
  const { orch, events } = newOrch(p, { modelFor: () => scriptedWorkerModel([]) }); // 空剧本：worker 首轮即收束
  const r = await orch.spawn({ mode: "read", task: "老路径调研" }, { callId: "r-a3" });
  check(r.ok, "A3a 老路径 spawn 受理（modelFor 剧本）");
  await orch.waitAll(15_000);
  check(events.filter((e) => e.type === "routing_decision").length === 0, "A3 老路径零 routing_decision 事件（零行为）");
}

{
  // A4：respawn 重派按 pin——routing_decision.picked === respawn.model，reason=pinned（恢复 = 原决策续跑，不二次路由）
  const p = join(work, "a4.jsonl");
  const { orch, events } = newOrch(p, { routing: true, modelFor: () => scriptedWorkerModel([]) });
  const respawnArgs: RespawnArgs = { task: "重派调研", mode: "read", model: "glm-flash", tier: "default" };
  const r = await orch.respawn(respawnArgs, { callId: "r-a4" });
  check(r.ok, "A4a respawn 受理");
  await orch.waitAll(15_000);
  const decs = events.filter((e) => e.type === "routing_decision");
  const dec = decs[decs.length - 1] as Extract<AgentEvent, { type: "routing_decision" }> | undefined;
  check(dec !== undefined && dec.reason === "pinned" && dec.picked === "glm-flash", "A4 respawn 重派落 routing_decision 且 picked === respawn.model（reason=pinned）");
}

{
  // A5（审查 S3-13）：路由分支的 model 是档位表合成的真实 provider spec，旧 fail-closed 条件
  // `!model && !M0_API_KEY` 在 routing=true 下永不成立 —— 无凭据也照派 worker，第一跳 401
  // 才死（白烧一轮 + 占并发预算 + 留一条必败 worker 记录）。现在无注入模型且无凭据当场拒。
  if (!process.env.M0_API_KEY) {
    const p = join(work, "a5.jsonl");
    const { orch, events } = newOrch(p, { routing: true }); // 故意不给 modelFor：真实凭据缺失
    const r = await orch.spawn({ mode: "read", task: "无凭据路由 spawn" }, { callId: "r-a5" });
    check(!r.ok, "A5a 路由路径无凭据 → 当场拒绝（不再造必败 worker）：" + r.output);
    check(!String(r.output).includes("401"), "A5b 拒绝原因可读（凭据缺失，非模型报错）");
    check(events.filter((e) => e.type === "routing_decision").length === 0, "A5c 拒绝路径零 routing_decision 孤儿事件（决策事件与 spawn 一对一）");
    await orch.waitAll(2_000);
  } else {
    console.log("  — A5 跳过：环境有 M0_API_KEY，路由路径本应放行（未证，不计入 pass）");
  }
}

// ============================== B bandit 在线学习（步骤 9） ==============================
console.log("[routing-check] B bandit 在线学习（收敛 / 反向验证 / 确定性 / settings 开关）");

const B_ARMS = [
  { stage: "impl", tier: "cheap" as const },
  { stage: "impl", tier: "strong" as const },
];

/** 明卷模拟：环境 RNG 与 bandit RNG 分开播种——整段模拟确定（同 seed 两次跑逐字段一致，§5.12）。 */
function simulate(
  seed: number,
  envSeed: number,
  opts: { cheapSuccess: number; strongSuccess: number; costWeight: number },
): { cheapPicks: number; strongPicks: number; picks: number[] } {
  const state = newBanditState(seed);
  const envRng = createRng(envSeed);
  let cheapPicks = 0;
  let strongPicks = 0;
  const picks: number[] = [];
  for (let i = 0; i < 200; i++) {
    const arm = selectArm(state.posteriors, state.rngState, B_ARMS, 0.05);
    if (arm.tier === "cheap") cheapPicks++;
    else strongPicks++;
    picks.push(arm.tier === "cheap" ? 0 : 1);
    const successProb = arm.tier === "cheap" ? opts.cheapSuccess : opts.strongSuccess;
    const cost = arm.tier === "cheap" ? 100 : 1000;
    const reward = nextRandom(envRng) < successProb ? 1 : 0;
    update(state.posteriors, arm, reward, cost, opts.costWeight);
  }
  return { cheapPicks, strongPicks, picks };
}

// B1：便宜档成功率 0.9 / 强档 0.95，代价不对称（cheap 100 / strong 1000，costWeight 0.001）
// → 折算后便宜档期望更高，200 轮后便宜档被选比例 > 0.8（代价感知的路由学习）
{
  const { cheapPicks } = simulate(42, 7, { cheapSuccess: 0.9, strongSuccess: 0.95, costWeight: 0.001 });
  check(cheapPicks / 200 > 0.8, "B1 明卷：代价折算后 200 轮便宜档被选比例 > 0.8", "cheap=" + String(cheapPicks) + "/200");
}

// B2 反向验证：奖励取反（便宜档真实成功率 0.1 / 强档 0.95，无代价干扰）→ 必须收敛到强档
// （证明 B1 的便宜档偏好来自奖励信号而非恒真——换奖励结构方向即反转）
{
  const { strongPicks } = simulate(42, 7, { cheapSuccess: 0.1, strongSuccess: 0.95, costWeight: 0 });
  check(strongPicks / 200 > 0.8, "B2 反向验证：奖励取反 → 收敛到强档（证明 B1 非恒真）", "strong=" + String(strongPicks) + "/200");
}

// B4（§5.12/§6.3#8）：同 seed 两次跑选择轨迹逐字段一致——随机性被显式管理，不碰 Math.random()
{
  const a = simulate(42, 7, { cheapSuccess: 0.9, strongSuccess: 0.95, costWeight: 0.001 });
  const b = simulate(42, 7, { cheapSuccess: 0.9, strongSuccess: 0.95, costWeight: 0.001 });
  check(JSON.stringify(a.picks) === JSON.stringify(b.picks), "B4 确定性：同 seed 两次跑选择轨迹逐字段一致");
  check(a.cheapPicks === b.cheapPicks && a.strongPicks === b.strongPicks, "B4b 同 seed 两次跑计数一致");
}

// B3 settings 开关：缺省 false（零行为）/ set 持久化（白名单未吞）/ 非布尔回退默认 / 无决策差异
{
  const dir = await mkdtemp(join(tmpdir(), "m5b-bandit-settings-"));
  try {
    const store = new SettingsStore(join(dir, "settings.json"));
    const def = await store.get();
    check(def.routingBandit === false, "B3a 缺省 routingBandit=false（零行为）");
    await store.set({ routingBandit: true });
    const after = await store.get();
    check(after.routingBandit === true, "B3b set({routingBandit:true}) 持久化成功（白名单未吞 routingBandit）");
    const validated = validateSettings({ ...DEFAULT_SETTINGS, routingBandit: "yes" });
    check(validated.routingBandit === false, "B3c 非布尔 routingBandit 回退默认 false");
    // B3d（审查 S3-7 修正）：旧写法两次 routeFor({stage,table}) 同参自比 = 恒真式（f(x)===f(x)），
    // 字面量体检网抓不到（它不是 `1===1` 这类常量比较，而是运行时同参调用）。改成有判别力的三段：
    // ① 关档两次逐字一致（确定性，原意图）；② 开档（喂偏向 cheap 的训练后状态）确实走
    //    bandit 分支且与关档可区分（证明 ① 不是巧合、开关有可观测效果）。
    const staticD = routeFor({ stage: "implement", table: DEFAULT_MODEL_TABLE });
    check(
      JSON.stringify(staticD) === JSON.stringify(routeFor({ stage: "implement", table: DEFAULT_MODEL_TABLE })),
      "B3d1 关档（不传 bandit）两次决策逐字一致（确定性）picked=" + staticD.picked,
    );
    const biased = newBanditState(42);
    for (let i = 0; i < 60; i++) {
      const arm = selectArm(biased.posteriors, biased.rngState, B_ARMS, 0);
      update(biased.posteriors, arm, 1, arm.tier === "strong" ? 5000 : 1, 0.001);
    }
    const onD = routeFor({ stage: "implement", table: DEFAULT_MODEL_TABLE, bandit: { ...biased, exploreEpsilon: 0 } });
    check(onD.reason === "bandit", "B3d2 开档走 bandit 分支（reason=bandit，非档位表）");
    check(
      onD.picked !== staticD.picked,
      "B3d3 开档决策与关档可区分（判据有判别力）on=" + onD.picked + " off=" + staticD.picked,
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ============================== C 级联升级（步骤 10） ==============================
console.log("[routing-check] C 级联升级（恰好升级一次 / maxRungs 有界 / 无 verify fail-closed）");

{
  // C1：便宜档必挂、standard 必过的剧本 → 恰好升级一次且最终成功
  let cheapRuns = 0;
  const r1 = await runCascade({
    hasJudge: true,
    maxRungs: 2,
    rungs: [
      { id: "glm-flash", tier: "cheap", run: async () => { cheapRuns++; return { ok: false, output: "[verify] 失败" }; } },
      { id: "glm-standard", tier: "standard", run: async () => ({ ok: true }) },
      { id: "glm-strong", tier: "strong", run: async () => ({ ok: true }) },
    ],
  });
  check(r1.ok && r1.finalId === "glm-standard" && r1.upgrades === 1, "C1 便宜档必挂 → 恰好升级一次且最终成功");
  check(
    r1.decisions.length === 2 && r1.decisions[0]!.reason === "tier-default" && r1.decisions[1]!.reason === "cascade-upgrade" && r1.decisions[1]!.from === "cheap",
    "C1b 每次升级落 cascade-upgrade 决策（from=cheap）",
  );
  check(cheapRuns === 1, "C1c 便宜档只执行一次（升级即换档，不重跑）");
}

{
  // C2：maxRungs=1 → 至多升一级即停（防无限爬升）：cheap 挂 → 升 standard 也挂 → 不得再升 strong
  const r2 = await runCascade({
    hasJudge: true,
    maxRungs: 1,
    rungs: [
      { id: "glm-flash", tier: "cheap", run: async () => ({ ok: false }) },
      { id: "glm-standard", tier: "standard", run: async () => ({ ok: false }) },
      { id: "glm-strong", tier: "strong", run: async () => ({ ok: true }) },
    ],
  });
  check(!r2.ok && r2.upgrades === 1 && r2.finalId === "glm-standard" && (r2.blockedNote ?? "").includes("maxRungs"), "C2 maxRungs=1 → 只升一级即停（不无限爬升到 strong）");
}

{
  // C3：无 verify 判据 → fail-closed 不升级，落一条显式说明（不猜、不空转放行）
  const r3 = await runCascade({
    hasJudge: false,
    rungs: [
      { id: "glm-flash", tier: "cheap", run: async () => ({ ok: false, output: "未找到 verify 配置" }) },
      { id: "glm-standard", tier: "standard", run: async () => ({ ok: true }) },
    ],
  });
  check(!r3.ok && r3.upgrades === 0, "C3 无 verify 配置 → 断言不升级");
  check((r3.blockedNote ?? "").includes("无 verify 判据"), "C3b fail-closed 显式说明落流（不静默放行）");
}

// ============================== F 价格表接线（M6：bandit 代价项换真钱） ==============================
console.log("[routing-check] F 价格表接线（覆盖护栏 / 真钱折算 / 真钱代价 bandit 收敛 / 反向验证）");

{
  // F1：价格表覆盖档位表全部 id（新增 model 忘配价 = 显式失败）
  check(priceCoverage().length === 0, "F1 价格表覆盖档位表全部 " + String(DEFAULT_MODEL_TABLE.length) + " 个 id（漂移护栏）");
  // F2：真钱折算已知用例（输入/输出分列计价）
  const c = costUsd("anthropic-standard", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
  check(Math.abs(c - 18.0) < 1e-9, "F2 costUsd 真钱折算（1M in + 1M out @anthropic-standard = $18）", "cost=" + String(c));
  check(priceOf("gemini-cheap").inputPerMTok === 0.1, "F2b 价格表读取");
  // F3/F4：真钱代价驱动的 bandit 收敛（cheap $0.2 vs strong $8 每 MTok，每轮 500 token）
  const moneyRun = (prices: { cheap: number; strong: number }, seed = 42, envSeed = 7): { cheapPicks: number; strongPicks: number } => {
    const state = newBanditState(seed);
    const envRng = createRng(envSeed);
    let cheapPicks = 0;
    let strongPicks = 0;
    for (let i = 0; i < 200; i++) {
      const arm = selectArm(state.posteriors, state.rngState, B_ARMS, 0.05);
      if (arm.tier === "cheap") cheapPicks++;
      else strongPicks++;
      const successProb = arm.tier === "cheap" ? 0.9 : 0.95;
      const pmt = arm.tier === "cheap" ? prices.cheap : prices.strong;
      const usd = (500 * pmt) / 1_000_000;
      const reward = nextRandom(envRng) < successProb ? 1 : 0;
      updatePriced(state.posteriors, arm, reward, usd);
    }
    return { cheapPicks, strongPicks };
  };
  const normal = moneyRun({ cheap: 0.2, strong: 8 });
  check(normal.cheapPicks / 200 > 0.8, "F3 真钱代价：cheap $0.2 vs strong $8 → 200 轮便宜档被选 > 0.8", "cheap=" + String(normal.cheapPicks) + "/200");
  const flipped = moneyRun({ cheap: 8, strong: 0.2 });
  check(flipped.strongPicks / 200 > 0.8, "F4 反向验证：价格对调（strong 便宜）→ 收敛强档（证明 F3 非恒真，真钱驱动）", "strong=" + String(flipped.strongPicks) + "/200");
  const again = moneyRun({ cheap: 0.2, strong: 8 });
  check(again.cheapPicks === normal.cheapPicks && again.strongPicks === normal.strongPicks, "F5 同 seed 两次跑计数一致（真钱代价确定性）");
}

await rm(work, { recursive: true, force: true }).catch(() => {});

console.log("[routing-check] " + (fail === 0 ? "全部断言通过 ✅" : String(fail) + " 项失败 ❌") + "（" + String(pass) + " ✅ / " + String(fail) + " ❌）");
process.exit(fail === 0 ? 0 : 1);
