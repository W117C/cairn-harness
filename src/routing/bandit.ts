// M5b bandit 在线学习（§m5-proposal 步骤 9 / §5.12 确定性口径）。
// Thompson Sampling：posterior = { alpha, beta }，selectArm / update 均为纯函数——
// 抽样随机态**显式传入、显式返回**，禁止 Math.random()（明卷断言要求逐字段可复现）。
// 臂 = 环角色 × 档位；reward = verify 全绿 ? 1 : 0，代价按 usage 折算进 beta（用量越大越惩罚）。
// 冷启动先验 α=β=2（不从 1/1 起步，避免前几轮方差过大的乱选）；最小探索率下限防早熟收敛。
// 持久化 { seed, rngState, posteriors }：seed 首次生成后不变，rngState 每轮推进，重启后轨迹连续。
import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "../atomic-write";
import type { ModelTier } from "../providers/registry";

/** mulberry32 随机态（显式推进：nextRandom 原地改 a 并返回 [0,1)）。 */
export interface RngState {
  a: number;
}

export function createRng(seed: number): RngState {
  return { a: seed >>> 0 };
}

/** 下一步随机数（[0,1)，mulberry32；原地推进 rngState——轨迹连续，重启后可续）。 */
export function nextRandom(state: RngState): number {
  state.a |= 0;
  state.a = (state.a + 0x6d2b79f5) | 0;
  let t = Math.imul(state.a ^ (state.a >>> 15), 1 | state.a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export interface Posterior {
  alpha: number;
  beta: number;
}

export function defaultPosterior(): Posterior {
  return { alpha: 2, beta: 2 }; // 冷启动先验（不从 1/1 起步）
}

export interface ArmKey {
  stage: string;
  tier: ModelTier;
}

export function armKeyOf(arm: ArmKey): string {
  return arm.stage + "|" + arm.tier;
}

export type Posteriors = Record<string, Posterior>;

/** Gamma 抽样（Marsaglia–Tsang 2000；shape<1 用 boost 变换）。确定性依赖 nextRandom 序列。 */
function sampleGamma(shape: number, rng: RngState): number {
  if (shape < 1) return sampleGamma(shape + 1, rng) * Math.pow(nextRandom(rng), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const u1 = Math.max(nextRandom(rng), 1e-12);
    const u2 = Math.max(nextRandom(rng), 1e-12);
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); // Box-Muller 标准正态
    const v = Math.pow(1 + c * z, 3);
    if (v <= 0) continue;
    const u3 = Math.max(nextRandom(rng), 1e-12);
    if (Math.log(u3) < 0.5 * z * z + d - d * v + d * Math.log(v)) return d * v;
  }
}

/** Beta(alpha,beta) 抽样：Beta = G(a)/(G(a)+G(b))。 */
function sampleBeta(p: Posterior, rng: RngState): number {
  const x = sampleGamma(p.alpha, rng);
  const y = sampleGamma(p.beta, rng);
  return x / (x + y);
}

/**
 * Thompson Sampling 选臂：每臂 Beta 抽样取最大；以 exploreEpsilon 概率均匀探索（防早熟收敛）。
 * 对同一 (posteriors, rngState) 与固定 seed → 选择序列确定（§5.12：同 seed 两次跑逐字段一致）。
 */
export function selectArm(
  posteriors: Posteriors,
  rng: RngState,
  arms: ArmKey[],
  exploreEpsilon = 0.05,
): ArmKey {
  if (arms.length === 0) throw new Error("bandit: 无臂可选");
  if (nextRandom(rng) < exploreEpsilon) {
    const i = Math.floor(nextRandom(rng) * arms.length);
    return arms[Math.min(i, arms.length - 1)]!;
  }
  let best = arms[0]!;
  let bestScore = -Infinity;
  for (const arm of arms) {
    const p = posteriors[armKeyOf(arm)] ?? defaultPosterior();
    const score = sampleBeta(p, rng);
    if (score > bestScore) {
      bestScore = score;
      best = arm;
    }
  }
  return best;
}

/** 奖励回灌：verify 全绿 → reward=1；代价按 usage 折算进 beta（用量越大 beta 越大 = 期望越低）。 */
export function update(
  posteriors: Posteriors,
  arm: ArmKey,
  reward: number,
  costTokens = 0,
  costWeight = 0,
): void {
  const key = armKeyOf(arm);
  const p = posteriors[key] ?? defaultPosterior();
  p.alpha += reward;
  p.beta += 1 - reward + costWeight * costTokens;
  posteriors[key] = p;
}

/** M6 真钱代价回灌（§m5-proposal §1.3 口径升级）：costUsd = 价格表折算的真钱成本，
 *  scale 让代价与 0/1 奖励同量级（缺省 1000：$0.001 ≈ 1 单位代价）。 */
export function updatePriced(
  posteriors: Posteriors,
  arm: ArmKey,
  reward: number,
  costUsd: number,
  scale = 1_000,
): void {
  const key = armKeyOf(arm);
  const p = posteriors[key] ?? defaultPosterior();
  p.alpha += reward;
  p.beta += 1 - reward + costUsd * scale;
  posteriors[key] = p;
}

// ---- 持久化（原子写 tmp + rename，照抄 SettingsStore.persist；seed 首次生成后不变） ----
export interface BanditState {
  seed: number;
  rngState: RngState;
  posteriors: Posteriors;
}

export function newBanditState(seed: number): BanditState {
  return { seed, rngState: createRng(seed), posteriors: {} };
}

/** 读取；文件缺失 = 首启无历史（正常新播种）；文件存在但损坏/畸形 = 学习历史无痕丢失，
 *  必须经 onCorrupt 显式告警（P2 审查：旧实现两者同路静默重播种，违背 fail-visible 纪律）。 */
export async function loadBanditState(path: string, onCorrupt?: (reason: string) => void): Promise<BanditState> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as BanditState;
    if (typeof raw.seed !== "number" || typeof raw.rngState?.a !== "number" || typeof raw.posteriors !== "object" || raw.posteriors === null) {
      throw new Error("bandit 状态损坏：字段缺失/畸形");
    }
    return raw;
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException)?.code === "ENOENT";
    if (!missing) {
      onCorrupt?.("bandit 状态文件损坏，已重播种（学习历史丢失）：" + (err instanceof Error ? err.message : String(err)));
    }
    return newBanditState(Date.now() >>> 0);
  }
}

export async function saveBanditState(path: string, state: BanditState): Promise<void> {
  await writeFileAtomic(path, JSON.stringify(state, null, 2));
}
