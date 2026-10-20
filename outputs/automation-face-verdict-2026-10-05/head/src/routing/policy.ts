// M5b 路由策略层（§m5-proposal 步骤 7）：纯函数，无 IO，可单测。
// 优先级：pin（显式指定）> 档位表（按环角色）> 降级链（档位不可用走最近可用档，reason=fallback）。
// V1 只出静态档位表；bandit 在线学习（步骤 9）在 routeFor 外层启用，本模块只负责确定性选档。
// 输入特征 taskLength/estContextTokens 是步骤 9 bandit 的特征面，V1 暂不使用（契约先留，禁死代码）。
import { DEFAULT_MODEL_TABLE, type ModelSpec, type ModelTier } from "../providers/registry";
import { selectArm, type Posteriors, type RngState } from "./bandit";

export const TIER_ORDER: readonly ModelTier[] = ["cheap", "standard", "strong"];

/** 环角色 → 缺省档位（V1 静态表）。未知角色回落 standard。 */
const DEFAULT_ROLE_TIERS: Readonly<Record<string, ModelTier>> = {
  implement: "cheap",
  write: "cheap",
  read: "cheap",
  explore: "cheap",
  test: "standard",
  review: "strong",
};

export function tierForStage(stage: string | undefined): ModelTier {
  if (stage !== undefined && DEFAULT_ROLE_TIERS[stage]) return DEFAULT_ROLE_TIERS[stage];
  return "standard";
}

export interface RouteInput {
  /** 显式指定（pin）：model id 或档位名（cheap/standard/strong）。 */
  pin?: string;
  /** 环角色（implement/review/test/read/write/explore/自定义 plugin 角色名）。 */
  stage?: string;
  mode?: "read" | "write";
  /** 任务文本长度（字符数；步骤 9 bandit 特征）。 */
  taskLength?: number;
  /** 预估上下文长度（token；步骤 9 bandit 特征）。 */
  estContextTokens?: number;
  /** 可用档位表（注入便于单测与未来动态表；缺省 DEFAULT_MODEL_TABLE）。 */
  table?: readonly ModelSpec[];
  /** M5b 步骤 9：bandit 学习上下文（启用时档位选择走 Thompson Sampling，rngState 显式推进）。 */
  bandit?: BanditContext;
}

/** bandit 上下文：posteriors 按 环角色|档位 键控；rngState 每轮推进（可持久化续跑）。 */
export interface BanditContext {
  posteriors: Posteriors;
  rngState: RngState;
  /** 探索率下限（缺省 0.05，防早熟收敛）。 */
  exploreEpsilon?: number;
}

export interface RoutingDecision {
  picked: string;
  tier: ModelTier;
  reason: "pinned" | "tier-default" | "bandit" | "cascade-upgrade" | "fallback";
  /** 降级/级联的来源档位（reason=fallback/cascade-upgrade 时必填）。 */
  from?: string;
  /** 候选档位（决策的可审计面：记"当时有哪些选择"，不只记结果）。 */
  candidates: { id: string; tier: string }[];
}

function candidatesOf(table: readonly ModelSpec[]): { id: string; tier: string }[] {
  return table.map((s) => ({ id: s.id, tier: s.tier }));
}

/** 降级链：从 desired 档向外找最近可用档（先向高档、再向低档，各自从紧邻开始）。 */
function fallbackOrder(desired: ModelTier): ModelTier[] {
  const idx = TIER_ORDER.indexOf(desired);
  const forward = TIER_ORDER.slice(idx + 1);
  const backward = TIER_ORDER.slice(0, idx).reverse();
  return [...forward, ...backward];
}

/** 路由决策（纯函数）。未知 pin / 空表 → fail-visible 抛错，绝不静默回落。 */
export function routeFor(input: RouteInput): RoutingDecision {
  const table = input.table ?? DEFAULT_MODEL_TABLE;
  const candidates = candidatesOf(table);

  // 1) pin 优先
  if (input.pin !== undefined) {
    const byId = table.find((s) => s.id === input.pin);
    if (byId) return { picked: byId.id, tier: byId.tier, reason: "pinned", candidates };
    const byTier = TIER_ORDER.find((t) => t === input.pin);
    if (byTier !== undefined) {
      const spec = table.find((s) => s.tier === byTier);
      if (!spec) throw new Error(`pin 档位 ${byTier} 在档位表无可用 spec`);
      return { picked: spec.id, tier: spec.tier, reason: "pinned", candidates };
    }
    throw new Error(`未知 pin: ${JSON.stringify(input.pin)}（既非 model id 也非档位名）`);
  }

  // 2) bandit 在线学习（步骤 9 启用）：臂 = 环角色 × 档位，Thompson Sampling 选档（reason=bandit）
  if (input.bandit) {
    const stage = input.stage ?? "default";
    const arms = TIER_ORDER.map((t) => ({ stage, tier: t }));
    const picked = selectArm(input.bandit.posteriors, input.bandit.rngState, arms, input.bandit.exploreEpsilon);
    const spec = table.find((s) => s.tier === picked.tier);
    if (spec) return { picked: spec.id, tier: picked.tier, reason: "bandit", candidates };
    // 选中档无 spec → 走降级链（reason=fallback）
    for (const t of fallbackOrder(picked.tier)) {
      const s = table.find((x) => x.tier === t);
      if (s) return { picked: s.id, tier: t, reason: "fallback", from: picked.tier, candidates };
    }
    throw new Error("档位表为空，无法路由");
  }

  // 3) 档位表（按环角色；未知角色回落 standard）
  const desired = tierForStage(input.stage);
  const direct = table.filter((s) => s.tier === desired);
  if (direct.length > 0) {
    return { picked: direct[0].id, tier: desired, reason: "tier-default", candidates };
  }

  // 3) 降级链：档位不可用 → 走最近可用档，reason=fallback + from
  for (const t of fallbackOrder(desired)) {
    const specs = table.filter((s) => s.tier === t);
    if (specs.length > 0) return { picked: specs[0].id, tier: t, reason: "fallback", from: desired, candidates };
  }
  throw new Error("档位表为空，无法路由");
}
