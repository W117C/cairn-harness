// supervise 受限循环的**契约面**（模型申报 ⇄ 执行端解析 ⇄ 规格描述，三处一份事实源）。
//
// 为什么单开一个文件：这条线上的三处此前各有两份说法——执行端读 `args.supervise.maxStages`
// 并 fail-visible 校验，而 spawn_agent 的**规格里根本没有 supervise 这一支**（模型只能猜嵌套，
// 策略文案 `scripts/ga-strategy.ts` 已经在教它写 `maxStages=3`），类型注释又另写一份。
// 字段清单收在这里，规格由它生成、解析由它驱动 ⇒ 加一个契约字段那天，忘了写规格会当场被
// tests/supervise-contract.test.ts 判红（而不是像往常那样成为"装载读了、模型看不见"的新副本）。
//
// 一条刻意划出去的线：`budget` 不归模型申报。受限循环的钱是**会话成本闸**（人设），
// 模型申报它 = 自己给自己批预算；它出现时按未知键拒，并把"归人"说在话里。

export const SUPERVISE_MAX_STAGES_MIN = 1;
export const SUPERVISE_MAX_STAGES_MAX = 20;
/** 不申报时的环数（与 `spawnSupervise` 旧内联缺省逐字一致，不借这次整理偷偷改数）。 */
export const SUPERVISE_MAX_STAGES_DEFAULT = 6;

export interface SuperviseContract {
  maxStages: number;
  forbidden: string[];
}

/** 模型可申报的字段：名字 + 类型 + 给模型看的描述。规格的 properties 由这份生成，解析也按这份验键。 */
export const SUPERVISE_MODEL_FIELDS = [
  {
    name: "maxStages",
    type: "integer",
    description:
      "受限循环最多几环（" + String(SUPERVISE_MAX_STAGES_MIN) + "–" + String(SUPERVISE_MAX_STAGES_MAX) +
      " 的整数，缺省 " + String(SUPERVISE_MAX_STAGES_DEFAULT) + "）。按任务分解的步数给，别随手填上限。",
  },
  {
    name: "forbidden",
    type: "array",
    description:
      "禁改面 glob 列表（每环 worker 都吃这条约束，如 [\"src/generated/**\"]）；不申报 = 无禁改面。",
  },
] as const;

export interface SuperviseParseResult {
  contract: SuperviseContract | null;
  /** 拒因（人话，含合法键集/区间）；null = 通过。 */
  error: string | null;
}

/** 解析模型申报的契约。缺省（不申报/空对象）合法；任何越界或非预期形状都**出声拒**，
 *  不静默回落——"申报了但没生效"是本仓点名的形状（笔误键 = 模型以为自己禁了某面，实际没禁）。 */
export function parseSuperviseContract(raw: unknown): SuperviseParseResult {
  if (raw === undefined || raw === null) return { contract: { maxStages: SUPERVISE_MAX_STAGES_DEFAULT, forbidden: [] }, error: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { contract: null, error: "supervise 必须是一个对象（可申报 " + SUPERVISE_MODEL_FIELDS.map((f) => f.name).join(" / ") + "）" };
  }
  const o = raw as Record<string, unknown>;
  const legal: string[] = SUPERVISE_MODEL_FIELDS.map((f) => f.name);
  const unknown = Object.keys(o).filter((k) => !legal.includes(k));
  if (unknown.length > 0) {
    const owned = unknown.includes("budget")
      ? "；其中 budget 归人（会话成本闸），模型不能给自己批预算"
      : "";
    return {
      contract: null,
      error: "supervise 含不可申报的键：" + unknown.join("、") + owned +
        "；可申报的是 " + legal.join(" / ") + "（拼错的键不会生效，故直接拒）",
    };
  }
  let maxStages = SUPERVISE_MAX_STAGES_DEFAULT;
  if (o.maxStages !== undefined) {
    const m = o.maxStages;
    if (typeof m !== "number" || !Number.isInteger(m) || m < SUPERVISE_MAX_STAGES_MIN || m > SUPERVISE_MAX_STAGES_MAX) {
      return {
        contract: null,
        error: "supervise.maxStages 须为 " + String(SUPERVISE_MAX_STAGES_MIN) + "–" +
          String(SUPERVISE_MAX_STAGES_MAX) + " 的整数（fail-visible 拒绝，不回落缺省）",
      };
    }
    maxStages = m;
  }
  let forbidden: string[] = [];
  if (o.forbidden !== undefined) {
    if (!Array.isArray(o.forbidden) || o.forbidden.some((x) => typeof x !== "string" || x.trim() === "")) {
      return { contract: null, error: "supervise.forbidden 须为非空字符串数组（混进别的类型会被拒，而不是静默少禁一面）" };
    }
    forbidden = (o.forbidden as string[]).map((x) => x.trim());
  }
  return { contract: { maxStages, forbidden }, error: null };
}
