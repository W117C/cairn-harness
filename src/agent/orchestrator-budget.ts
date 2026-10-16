// 三缝之一（orchestrator-budget）：会话成本闸 / 级联阶梯 / bandit 学习运行时，三个域的状态与逻辑。
// 2026-10-17 从 orchestrator.ts 抽出（同 provider-key-inject / orchestrator-config 先例：搬整段实现、
// 原路径留公开面）——Orchestrator 的对应方法保留为薄委托，类 API 与文件尾 barrel 逐字不变。
// 状态全装箱在此：三份**活引用**（sessionUsage / mainUsage / workers，不拷贝）+ 一份窄 opts 面 +
// 一个收尾回调（cleanupSuperseded 要用的 cleanupWrite 住 worker-merge 缝）。不反向 import orchestrator.ts。
import { effectiveModelTable, type ModelTier } from "../providers/registry";
import { loadBanditState, saveBanditState, updatePriced, type BanditState } from "../routing/bandit";
import { cascadeLadder } from "../routing/cascade";
import { costUsd } from "../routing/pricing";
import type { AgentEvent } from "../events";
import type { ToolResult } from "../tools/base";
import { bucketsSpendUsd, priceForModel, spentUsdFor, type SpendBucket } from "./orchestrator-join";
import type { WorkerHandle } from "./orchestrator-types";

export interface BudgetCascadeBanditDeps {
  /** 会话成本闸配置（构造期已归一为 null；见 OrchestratorOptions.budget）。 */
  budget: { maxUsd: number; pricePerMTok: number; priceModel?: string } | null;
  /** 全部 usage 累计（emit 包装里持续原地累加——必须收**引用**，不拷贝）。 */
  sessionUsage: { inputTokens: number; outputTokens: number };
  /** **只**统计无 agent_id 的 usage 事件（= 主会话自己那一跳）；同上收引用。 */
  mainUsage: { inputTokens: number; outputTokens: number };
  /** 活跃 worker 表（活引用；此处只读遍历）。 */
  workers: ReadonlyMap<string, WorkerHandle>;
  /** 三域只用到这几个开关 + emit（结构性窄面，OrchestratorOptions 直接可赋）。 */
  opts: {
    emit: (e: AgentEvent) => Promise<void>;
    routing?: boolean;
    cascadeUpgrade?: boolean;
    cascadeMaxUpgrades?: number;
    banditStatePath?: string;
  };
  /** 被淘汰档的收尾（实现在 worker-merge 缝；由 Orchestrator 构造时注入，避免反向依赖）。 */
  cleanupWrite: (w: WorkerHandle, why: "rejected") => Promise<void>;
}

/** 本类只被 orchestrator.ts 使用（薄委托的宿主）；不导出到文件尾 barrel。 */
export class BudgetCascadeBandit {
  /** 「设了成本上限却估不出价」同样只出声一次（闸不生效是用户必须知道的事实，但不刷屏）。 */
  private budgetInertWarned = false;
  /** 「上限设了却有一部分算不出价」只出声一次（闸晚触发的程度用户必须知道，但不刷屏）。 */
  private budgetPartialWarned = false;
  /** 级联前提不成立（开关开了但 routing 关着）只出声一次，不每环刷一遍。 */
  private cascadeWarned = false;
  /** M5b 步骤 9：bandit 在线学习状态（懒加载；routing+banditStatePath 双开才激活）。 */
  private banditState: BanditState | null = null;
  private banditLoading: Promise<BanditState | null> | null = null;

  constructor(private readonly deps: BudgetCascadeBanditDeps) {}

  /** 预算估价（纯查询）。两把尺按优先级：
   *  ① 用户手填的 `pricePerMTok`（输入+输出同价的粗口径）——语义逐字保留，填了就以它为准；
   *  ② 没填 ⇒ **分桶各按各档折**（主会话一桶按会话档、每个 worker 一桶按它自己那一档）。
   *  旧写法是「全部 token × 会话那一档」，而 worker 可以跑在别的档上（价表里 flash 与 strong 差 40 倍）
   *  ⇒ 上限会晚几十倍才触发，而同一屏的 worker 回执报的是真价：限制类判据与它要限制的那个读数分叉。
   *  都拿不到 ⇒ 0，但 `budgetBlocked` 会因此出声，不把 0 当成"这会话免费"。 */
  budgetEstimateUsd(): number {
    const spend = this.budgetSpendReading();
    return spend === null ? 0 : spend.usd;
  }

  /** 花费读数：`null` = 一桶都算不出（⇒ 闸惰掉但必须出声）；否则给出算得出的美元与**算不出的 token 数**
   *  （后者不折成 $0，也不静默吞：见 `bucketsSpendUsd` 的口径）。 */
  private budgetSpendReading(): { usd: number; unpricedTokens: number } | null {
    const b = this.deps.budget;
    if (!b) return null;
    if (b.pricePerMTok > 0) {
      // ① 手填单价：粗口径「一份单价 × 全部 token」，填这个数的人声明的就是"我这儿每百万 token 值这么多钱"
      const usage = { inputTokens: this.deps.sessionUsage.inputTokens, outputTokens: this.deps.sessionUsage.outputTokens };
      return { usd: ((usage.inputTokens + usage.outputTokens) / 1_000_000) * b.pricePerMTok, unpricedTokens: 0 };
    }
    // ② 唯一给钱的那一行
    return bucketsSpendUsd(this.budgetBuckets());
  }

  /** 成本闸的计价桶：主会话一桶按会话档，**每个 worker 一桶按它自己那一档**
   *  （回放桶 `realMoney: false` ⇒ 不产生真钱，也不算"算不出"，因此不触发告警）。 */
  private budgetBuckets(): SpendBucket[] {
    const b = this.deps.budget;
    return [
      {
        usage: { inputTokens: this.deps.mainUsage.inputTokens, outputTokens: this.deps.mainUsage.outputTokens },
        price: priceForModel(b?.priceModel ?? ""),
      },
      ...[...this.deps.workers.values()].map((w) => ({
        usage: { inputTokens: w.usage.inputTokens, outputTokens: w.usage.outputTokens },
        price: w.price ?? null,
        realMoney: w.price !== null,
      })),
    ];
  }

  /** 闸判定：maxUsd >0 且估价 ≥ 上限 → 拒绝新 spawn。估不出价 ⇒ 不拦，但**出声一次**：
   *  用户设的 BYOK 成本底线不许因为"单价没填且表里没这个模型"就静默变成不存在。
   *  只有一部分算得出时**照触**（已知的钱是真的），另外出声说这道闸可能晚于实际上限。 */
  budgetBlocked(): boolean {
    const b = this.deps.budget;
    if (!b || !(b.maxUsd > 0)) return false;
    const spend = this.budgetSpendReading();
    if (spend === null) {
      if (!this.budgetInertWarned) {
        this.budgetInertWarned = true;
        console.warn(
          "[budget] 会话成本上限 $" + String(b.maxUsd) + " 设了，但既没填单价、价表里也查不到模型 " +
          JSON.stringify(b.priceModel ?? "") + " ⇒ 这道闸本次不生效（不拿 $0 冒充实付）",
        );
      }
      return false;
    }
    if (spend.unpricedTokens > 0 && !this.budgetPartialWarned) {
      this.budgetPartialWarned = true;
      console.warn(
        "[budget] 会话成本上限 $" + String(b.maxUsd) + "：另有 " + String(spend.unpricedTokens) +
        " 个 token 价不可知未计入 ⇒ 这道闸只按算得出的那部分拦，可能**晚于**实际上限",
      );
    }
    return spend.usd >= b.maxUsd;
  }

  /** 成本闸拒绝（落流警告 + tool_result 拒绝，§2.4）。
   *  注意这一笔有**两个读者面**：下面那条自造 callId 的事件（`budget-<ts>`，流里没有对应的 tool_call，
   *  只出声）＋真正挂回模型那一次 `spawn_agent` 的返回体。`hold` 两处都盖：那一列描述的是「这一笔是
   *  harness 按住的」，与 callId 真不真无关。自造 callId 要不要换成真 callId（换成后两条会不会被
   *  `mergeToolResultsById` 折成一条模型可见消息）属裁决，不属这一笔——第 229 页登记为仍开的一半。 */
  async rejectOnBudget(callId?: string): Promise<ToolResult> {
    const estimate = this.budgetEstimateUsd().toFixed(4);
    const cap = String(this.deps.budget?.maxUsd ?? 0);
    // 落流事件挂真 callId（第 245 页登记的穿线，第 250 页折叠判定安全）：与返回体同 id，
    // mergeToolResultsById 并成一条、正文不丢；无 callId 的调用点才落回 budget-<ts>（照旧孤儿降级）。
    const rid = callId !== undefined && callId !== "" ? callId : "budget-" + String(Date.now());
    await this.deps.opts.emit({
      type: "tool_result",
      callId: rid,
      ok: false,
      hold: "budget",
      output: "[budget] 会话成本超限：估价 $" + estimate + " ≥ maxBudgetUsd $" + cap + "（编排扩张被拒；主 loop 不受闸）",
    } as AgentEvent).catch(() => {});
    return { ok: false, hold: "budget", output: "spawn_agent: [budget] 会话成本超限（估价 $" + estimate + " ≥ maxBudgetUsd $" + cap + "），新 spawn 被拒" };
  }

  /** W3② 本编排器已派 worker 的表价累计（价格不可知的不计；一个都算不出 → null，不报 $0）。
   *  与 `budgetEstimateUsd()` 是两件事：那条是**成本闸**的粗口径（单一可配单价 × 全部 token，含主 loop），
   *  这条按每个 worker 真实档位的表价折算，只回答「worker 花掉多少」。 */
  workerSpentSoFarUsd(): number | null {
    let total: number | null = null;
    for (const w of this.deps.workers.values()) {
      const s = spentUsdFor(w.price, w.usage);
      if (s === null) continue;
      total = (total ?? 0) + s.usd;
    }
    return total === null ? null : Math.round(total * 1e6) / 1e6;
  }

  /** 级联可用 = 开关开着 **且** routing 开着。后一条不是形式主义：
   *  阶梯起点取的是路由当时落到的档（handle.routeTier），升档也是靠 pin 换模型——
   *  routing 关着时这两件事都不存在，"升级"会退化成花两遍钱跑同一个模型。
   *  条件不成立时出声一次（不刷屏），别让人以为开关拨了就生效。 */
  cascadeReady(): boolean {
    if (this.deps.opts.cascadeUpgrade !== true) return false;
    if (this.deps.opts.routing !== true) {
      if (!this.cascadeWarned) {
        this.cascadeWarned = true;
        console.warn("[cascade] 需要 routing=true（阶梯起点与升档都走路由）；本次会话不级联");
      }
      return false;
    }
    return true;
  }

  /** 级联阶梯（**决策面**，从 runChain 里拆出来）：从「这一跑当时选了谁」往上取档，
   *  且只在同一 provider 的档位里取——跨厂商升档会把一次 BYOK 会话悄悄换成别家的 key。
   *  拆出去有两个理由：① §4.4.7 的「哑 sequencer」静态判据（agents-check N6c）要求 runChain
   *  源码段不碰档位表那一层，环只回答「要不要再花一遍钱」；② 这段判断值得单测（见 cascade-wiring）。
   *  取不到档（未路由 / pin 的 id 不在表上 / 预算用尽 / 已在最高档）⇒ 交空阶梯 + 一句可落流的说明，
   *  不猜一档、不把「无从判断」混成「已在最高档」。 */
  cascadePlanFor(agentId: string, budgetLeft: number): { from: ModelTier | undefined; ladder: { id: string; tier: ModelTier }[]; note: string } {
    const w = this.deps.workers.get(agentId);
    const from = w?.routeTier;
    // 精确按 id 查（不用 findSpecByNameOrId 的 id-or-model 两义匹配）：两义匹配一旦遇到
    // 「A 家的 model 名 == B 家的 id」就会算错家族，正好把跨厂商禁令从门缝里绕过去。
    const picked = effectiveModelTable().find((s) => s.id === w?.routePicked);
    if (from === undefined || picked === undefined) {
      return { from, ladder: [], note: "认不出这一跑当时选的模型（routeTier/routePicked 缺一方）⇒ 无从判断该往哪档升" };
    }
    if (budgetLeft <= 0) return { from, ladder: [], note: "整链升级预算已用尽（已花 " + String(this.deps.opts.cascadeMaxUpgrades ?? 2) + " 次额度）" };
    const ladder = cascadeLadder(from, effectiveModelTable().filter((s) => s.provider === picked.provider), budgetLeft);
    return { from, ladder, note: ladder.length > 0 ? "" : picked.provider + " 一家在 " + from + " 之上没有更高档" };
  }

  /** 被淘汰那一档的收尾：write 档的 worktree 必须回收——它已经是永远不会被采纳的候选，
   *  留在合并塔里只会被误当成一份可交付。动作与 supervise 的 rejectRings 同一条
   *  （cleanupWrite），这里不另开第二份清理路径。 */
  async cleanupSuperseded(agentId: string): Promise<void> {
    const w = this.deps.workers.get(agentId);
    if (w && w.mode === "write" && w.worktree) await this.deps.cleanupWrite(w, "rejected");
  }

  // ---- M5b 步骤 9：bandit 在线学习运行时接线（路由侧信道） ----
  // 背景：routeFor/toWorkerModel/routing_decision 在步骤 8 已落，bandit 机器（selectArm/
  //  updatePriced/持久化）也齐了，但两头都没接运行时——routeFor 从不收 bandit 上下文（reason
  //  永远不是 "bandit"），worker 完成时也没人回灌奖励。本段闭合：启用判定 → 懒加载 → 回灌。
  /** 启用判定（routing + banditStatePath 双开才激活）。 */
  banditEnabled(): boolean {
    return this.deps.opts.routing === true && typeof this.deps.opts.banditStatePath === "string" && this.deps.opts.banditStatePath !== "";
  }

  /** 懒加载 bandit 状态（首次 spawn 才读盘）。加载失败 → null：本次会话只走静态档位表，
   *  路由主路径与降级链完全不受影响（学习缺位不是路由失败）。 */
  async bandit(): Promise<BanditState | null> {
    if (!this.banditEnabled()) return null;
    if (this.banditState !== null) return this.banditState;
    if (this.banditLoading === null) {
      const path = this.deps.opts.banditStatePath as string;
      this.banditLoading = loadBanditState(path, (reason: string) => console.warn("[bandit] " + reason))
        .then((st) => {
          this.banditState = st;
          return st;
        })
        .catch((err) => {
          console.warn(
            "[bandit] 状态加载失败，本次会话不学习（路由降级链不受影响）:",
            err instanceof Error ? err.message : String(err),
          );
          return null;
        });
    }
    return this.banditLoading;
  }

  /** 奖励回灌：done **且客观证据不红** → reward=1；failed/cancelled 或 done+verify 红/stale → 0；
   *  代价按真钱 usage 折算（pricing.costUsd，§m5-proposal §1.3 口径）。仅 reason=bandit 的 worker
   *  记了臂——其余路由不污染学习面。best-effort 纪律：任何失败只 console.warn——
   *  学习是侧信道，绝不改写 worker 终态或阻断收束。 */
  async rewardBandit(w: WorkerHandle, status: "done" | "failed" | "cancelled"): Promise<void> {
    if (w.routeArm === undefined || w.routeModelId === undefined) return;
    const st = await this.bandit();
    if (st === null) return;
    try {
      // 「done」不等于「做成了」：客观证据说这一跑验过但红（failed）或验完又写了盘（stale）时按 0 计。
      // 否则级联一开，学习面恰好是在**被判失败的任务上**给便宜档加分（α 涨 β 不涨），
      // 越学越往「便宜但红」的方向倒——与这条能力存在的目的（少花冤枉钱）正好相反。
      // 证据 absent（这一路没跑过 verify）不改判据：没判据就不拿猜测改学习面（与级联 fail-closed 同口径）。
      const evidence = w.lastResult?.artifacts.verified;
      const reward = status === "done" && evidence !== "failed" && evidence !== "stale" ? 1 : 0;
      const cost = costUsd(w.routeModelId, w.usage);
      updatePriced(st.posteriors, w.routeArm, reward, cost);
      await saveBanditState(this.deps.opts.banditStatePath as string, st);
    } catch (err) {
      console.warn("[bandit] 奖励回灌失败（不影响 worker 终态）:", err instanceof Error ? err.message : String(err));
    }
  }
}
