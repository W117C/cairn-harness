// M5b 级联升级（§m5-proposal 步骤 10）：便宜档先跑 → 客观判据判定 → 不过则升一级重跑。
// judge 优先用客观判据（verify 结果）；目标仓库无 verify 配置时 **fail-closed 不升级**
// （不猜、不空转放行，与 verify.ts 的 fail-closed 纪律一致）。
// 每次升级落一条 routing_decision（reason=cascade-upgrade + from）。
import type { ModelTier } from "../providers/registry";
import { TIER_ORDER } from "./policy";

/** 升级阶梯（纯函数）：从 `startTier` **往上一档起**取 ≤ `maxUpgrades` 档，每档挑档位表里第一个 spec。
 *  起始档自己不进来——它已经跑过并被客观判据判没过，重跑同一档只会再花一遍钱得同一结果。
 *  返回空数组 = 上面没档了（调用方据此走 fail-closed，不造"升级了个寂寞"的空跑）。 */
export function cascadeLadder(
  startTier: ModelTier,
  table: readonly { id: string; tier: ModelTier }[],
  maxUpgrades = 2,
): { id: string; tier: ModelTier }[] {
  const idx = TIER_ORDER.indexOf(startTier);
  if (idx < 0) return [];
  const out: { id: string; tier: ModelTier }[] = [];
  for (const t of TIER_ORDER.slice(idx + 1, idx + 1 + maxUpgrades)) {
    const spec = table.find((s) => s.tier === t);
    if (spec) out.push({ id: spec.id, tier: spec.tier });
  }
  return out;
}

export interface CascadeRung {
  id: string;
  tier: ModelTier;
  /** 执行该档（跑 verify 等客观判据）。 */
  run: () => Promise<{ ok: boolean; output?: string }>;
}

export interface CascadeDecision {
  picked: string;
  tier: ModelTier;
  reason: "tier-default" | "cascade-upgrade" | "fallback";
  from?: string;
}

export interface CascadeResult {
  ok: boolean;
  finalId: string | null;
  finalTier: ModelTier | null;
  /** 逐次执行的决策（可审计面：每次执行一条，升级 = cascade-upgrade + from）。 */
  decisions: CascadeDecision[];
  /** 升级次数（≤ maxRungs）。 */
  upgrades: number;
  /** fail-closed 阻断说明（无 verify 判据 / 达到上限 / 无更高档）。 */
  blockedNote?: string;
}

export interface RunCascadeOptions {
  rungs: CascadeRung[];
  /** 客观判据是否可用（目标仓库有 verify 配置）。false → fail-closed 不升级。 */
  hasJudge: boolean;
  /** 升级上限（缺省 2）。 */
  maxRungs?: number;
}

/** 级联执行：便宜档先跑，fail 且有客观判据才升一级（≤ maxRungs）。 */
export async function runCascade(opts: RunCascadeOptions): Promise<CascadeResult> {
  const maxRungs = opts.maxRungs ?? 2;
  if (opts.rungs.length === 0) throw new Error("cascade: rungs 为空");
  const decisions: CascadeDecision[] = [];
  let upgrades = 0;
  let currentIdx = 0;
  for (;;) {
    const current = opts.rungs[currentIdx]!;
    // 首次执行：初始决策（tier-default）；此后每轮都是升级后的执行
    decisions.push({
      picked: current.id,
      tier: current.tier,
      reason: upgrades === 0 ? "tier-default" : "cascade-upgrade",
      ...(upgrades > 0 ? { from: opts.rungs[currentIdx - 1]!.tier } : {}),
    });
    const outcome = await current.run();
    if (outcome.ok) {
      return { ok: true, finalId: current.id, finalTier: current.tier, decisions, upgrades };
    }
    // 失败后：无客观判据 → fail-closed 不升级（不猜、不空转放行）
    if (!opts.hasJudge) {
      return {
        ok: false,
        finalId: current.id,
        finalTier: current.tier,
        decisions,
        upgrades,
        blockedNote: "无 verify 判据（fail-closed 不升级）：" + (outcome.output ?? "").slice(0, 120),
      };
    }
    if (upgrades >= maxRungs) {
      return {
        ok: false,
        finalId: current.id,
        finalTier: current.tier,
        decisions,
        upgrades,
        blockedNote: "达到 maxRungs=" + String(maxRungs) + " 上限，不升级（防无限爬升）",
      };
    }
    if (currentIdx + 1 >= opts.rungs.length) {
      return {
        ok: false,
        finalId: current.id,
        finalTier: current.tier,
        decisions,
        upgrades,
        blockedNote: "无更高档可升（已在最高档）",
      };
    }
    currentIdx++;
    upgrades++;
  }
}
