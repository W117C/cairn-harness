// 度量台的对账面：把两次（或多次）`pnpm bench` 的读数放在一起，回答一个问题——
// **「这次改动到底有没有变好，还是只是噪声？」**
//
// 为什么必须有这只模块：`pnpm bench` 已经能产出成功率/token/耗时/内存四读数，
// 但**单次读数什么都证明不了**。本仓自己在 2026-09-30 踩过一次：同一配置跑 4 次，
// 开关两个方向各有一次成败 ⇒ 拿单次成功率当结论是错的。要判"改动有效"，
// 至少需要三样东西：两次**同配置**运行给出的**噪声带**、一次改动后的读数、以及
// **同一批任务**这个前提（任务集换了，分母就换了，横比无意义）。
//
// 本模块只做这几件事，不碰跑法（跑法在 `scripts/loop-eval.ts`，是既有的尺，改了就没法横比）：
//   ① 读 `readings.json`（形状 = `{r, g}[]`，由 loop-eval 写出），口径不对就**出声**而不是静默跳过；
//   ② 算**噪声带**：同配置两次运行的逐指标绝对差；
//   ③ 判：改动后的读数相对基线，**逐指标**落在噪声带内还是带外，方向是改善还是退化；
//   ④ **跨指标合取闸**（`outcomeGate`）：结果类（成功率/达标数）超带退化 ⇒ 整表**禁止读作改善**，
//      成本类那几项「变好」只是副作用（事办砸了当然省钱）；
//   ⑤ **身份闸**（`identityOf`）：读数缺 `headSha`／`ranAt`／`model` 任一 ⇒ 归因面不许印成可比读数，
//      只当量级。
//
// 诚实标注（这条比结论本身重要）：**两点噪声带是弱证据**。
// 它只能挡住"改动幅度比机器抖动还小"这种假改善，挡不住系统性偏差；
// 真要下结论请把 `--reps` 提上去、把同一配置多跑几份读数喂给 `--baseline`。
import { readFileSync } from "node:fs";

/** 跑器写出的单条读数。只取对账需要的字段——跑器加字段不会打崩本模块。 */
export interface Row {
  id: string;
  /** 这一趟真拨的模型名（归因键）。缺省空串＝读数来自没有这个键的存量语料 ⇒ 判不出，不是判成同面。 */
  model: string;
  /** 这一趟跑在哪个 rev 上（身份键之一）。空串＝跑器没盖章 ⇒ 身份闸咬。 */
  headSha: string;
  /** 这一趟的时刻，ISO-8601 字符串（身份键之一）。空串＝身份闸咬。 */
  ranAt: string;
  tokensIn: number;
  tokensOut: number;
  seconds: number;
  rssPeakMb: number;
  toolFailures: number;
  repeats: number;
  /** 该条任务这一轮是否达标（跑器的判卷结果）。 */
  ok: boolean;
  /** 这一行是第几次重复（`r.rep`，1..reps）。pass^k／pass@k 要把同一靶子的多次重复并起来 ⇒ 缺它就只能按「每靶一行」退化处理。
   *  缺省 undefined（存量语料没这格）＝这行的重复序号**未知**，不许当成 0/1 蒙进 pass^k 的分母。 */
  rep?: string;
  /** 跑这一趟用的步数帽（`--max-steps`，身份键之一）。空串＝没盖章（存量语料）。 */
  maxSteps?: string;
  /** 这一趟声明的重复次数（`--reps`，身份键之一）。空串＝没盖章。**与 `repeats`（重复动作指标）不是一回事**。 */
  reps?: string;
  /** 这一趟属于哪一副臂（A/B 的臂名；缺省由跑器落到 `--system`，见 `loop-eval.ts` 的 `ARM`）。空串＝没盖章。 */
  arm?: string;
}

/** 一份读数文件的汇总。 */
export interface Totals {
  tasks: number;
  passed: number;
  successRate: number;
  tokensIn: number;
  tokensOut: number;
  seconds: number;
  rssPeakMb: number;
  toolFailures: number;
  repeats: number;
}

/** 逐指标的方向：数字越小越好 / 越大越好。 */
const LOWER_IS_BETTER: ReadonlySet<keyof Totals> = new Set([
  "tokensIn", "tokensOut", "seconds", "rssPeakMb", "toolFailures", "repeats",
]);
const HIGHER_IS_BETTER: ReadonlySet<keyof Totals> = new Set(["passed", "successRate"]);

/** **结果类指标**（「成功率／达标数」这一族，即"事情办成了没有"）。
 *
 *  它就是上面那张方向表里「越大越好」的那一侧——复用而不是另立一份名单：
 *  两处各存一份就会各自漂移，而闸判错方向比没有闸更坏（本模块的整条理由）。
 *  闸的判据因此建在**指标语义**上，不建在指标名的字符串匹配上。 */
const OUTCOME_METRICS: ReadonlySet<keyof Totals> = HIGHER_IS_BETTER;

/** 参与对账的指标（顺序即打印顺序）。`tasks` 不参与——它是前提不是结果，见 `compare` 的护栏。 */
export const METRICS: readonly (keyof Totals)[] = [
  "successRate", "passed", "tokensIn", "tokensOut", "seconds", "rssPeakMb", "toolFailures", "repeats",
];

export type Verdict = "beyond-noise" | "within-noise";
export type Assessment = "better" | "worse" | "noise" | "unknown";

export interface MetricLine {
  metric: keyof Totals;
  baseline: number;
  candidate: number;
  delta: number;
  band: number | null;
  verdict: Verdict | "unknown";
  assessment: Assessment;
}

export interface Comparison {
  /** 任务集是否一致。不一致 ⇒ 一切逐指标结论作废（分母变了）。 */
  sameTaskSet: boolean;
  baselineTasks: string[];
  candidateTasks: string[];
  lines: MetricLine[];
}

function num(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`读数形状不对：${what} 不是有限数（实读 ${JSON.stringify(v)}）`);
  }
  return v;
}

/** 身份键的取值：**非空字符串才算有**。缺键、空串、类型不对 ⇒ 一律空串（＝缺章）。
 *
 *  这里不抛，是因为存量语料本来就没这些键——本模块要的是「读得动 + 大声说没身份」，
 *  不是「读不动」。放宽方向只有一个：不许把缺章读成有章。 */
function identityStr(v: unknown): string {
  return typeof v === "string" && v !== "" ? v : "";
}

/** 数值型身份键（`maxSteps`／`reps`／`rep`）：**有限数取字符串、非空串原样、其余一律空串（＝缺章）**。
 *
 *  为什么不是 `identityStr`：跑器把帽/次数写成数字（`maxSteps: 20`），存量语料根本没这格（undefined）。
 *  两者必须分得开——把「20」读成「有身份」而把「undefined」读成「0/空」正是本条要防的：
 *  缺章要**可见地缺**，不许用 0 冒充一个合法的帽值。 */
function identityNum(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return identityStr(v);
}

/** 解析一份 `readings.json`。
 *
 *  形状**必须**是 loop-eval 写的那一种（`{r, g}[]`），不认识的形状**直接抛**：
 *  静默跳过一条读数，等于把一个没被算进去的分母当成"通过"——本仓点名的
 *  「取不到 ≠ 没问题」那一族。 */
export function parseReadings(text: string, label = "readings"): Row[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`${label} 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(raw)) throw new Error(`${label} 顶层不是数组（实读 ${typeof raw}）`);
  if (raw.length === 0) throw new Error(`${label} 是空数组：没有分母，不算读数`);
  return raw.map((el, i) => {
    if (typeof el !== "object" || el === null) throw new Error(`${label}[${String(i)}] 不是对象`);
    const rec = el as Record<string, unknown>;
    const r = rec["r"];
    if (typeof r !== "object" || r === null) {
      throw new Error(`${label}[${String(i)}] 缺 r（期望 loop-eval 写出的 {r, g} 形状）`);
    }
    const rr = r as Record<string, unknown>;
    const g = rec["g"];
    const gOk = typeof g === "object" && g !== null ? (g as Record<string, unknown>)["ok"] : undefined;
    if (typeof gOk !== "boolean") {
      throw new Error(`${label}[${String(i)}] 缺 g.ok（判卷结果）——没有它就不该进分母`);
    }
    const id = rr["id"];
    if (typeof id !== "string" || id === "") throw new Error(`${label}[${String(i)}] 缺 r.id`);
    const res = (rr["resources"] ?? {}) as Record<string, unknown>;
    return {
      id,
      model: typeof rr["model"] === "string" ? rr["model"] : "",
      // 身份键取 `r` 内层，兼容盖在 `{r, g}` 记录外层的写法（写侧最终落哪一层由 #63 定）。
      headSha: identityStr(rr["headSha"] ?? rec["headSha"]),
      ranAt: identityStr(rr["ranAt"] ?? rec["ranAt"]),
      tokensIn: num(rr["tokensIn"], `${label}[${String(i)}].r.tokensIn`),
      tokensOut: num(rr["tokensOut"], `${label}[${String(i)}].r.tokensOut`),
      seconds: num(rr["seconds"], `${label}[${String(i)}].r.seconds`),
      rssPeakMb: typeof res["rssPeakMb"] === "number" ? res["rssPeakMb"] : 0,
      toolFailures: num(rr["toolFailures"], `${label}[${String(i)}].r.toolFailures`),
      repeats: num(rr["repeatedSameAction"], `${label}[${String(i)}].r.repeatedSameAction`),
      ok: gOk,
      // 逐靶配对（#90）需要的四枚身份/序号键：内层 `r` 优先，兼容盖在 `{r, g}` 外层的写法（与 headSha/ranAt 同规则）。
      rep: identityNum(rr["rep"] ?? rec["rep"]),
      maxSteps: identityNum(rr["maxSteps"] ?? rec["maxSteps"]),
      reps: identityNum(rr["reps"] ?? rec["reps"]),
      arm: identityStr(rr["arm"] ?? rec["arm"]),
    };
  });
}

export function totalsOf(rows: readonly Row[]): Totals {
  const passed = rows.filter((r) => r.ok).length;
  const sum = (f: (r: Row) => number): number => rows.reduce((a, r) => a + f(r), 0);
  return {
    tasks: rows.length,
    passed,
    successRate: rows.length === 0 ? 0 : passed / rows.length,
    tokensIn: sum((r) => r.tokensIn),
    tokensOut: sum((r) => r.tokensOut),
    seconds: sum((r) => r.seconds),
    rssPeakMb: Math.max(0, ...rows.map((r) => r.rssPeakMb)),
    toolFailures: sum((r) => r.toolFailures),
    repeats: sum((r) => r.repeats),
  };
}

/** 一份读数里的任务集合（去重排序）。用于"分母是否同一个"这条护栏。 */
export function taskIds(rows: readonly Row[]): string[] {
  return [...new Set(rows.map((r) => r.id))].sort();
}

export type ModelFaceState = "same" | "differs" | "unknown";

/** 两臂的**模型归因面**：钱与 token 的差值能不能归因给"改动"，前提是两个臂拨的是同一个模型。 */
export interface ModelFace {
  state: ModelFaceState;
  baseline: string[];
  candidate: string[];
}

/**
 * 三态，**没有第四态**（这一格 2026-10-02 之前根本不存在：基准路径绕过 `createUsageAttributor`，
 * 行内没有归因键 ⇒ 跨模型 A/B 的差值被当成提示词的效果，见 outputs/capability-rescore-2026-10-02）。
 *  - `same`：两臂各自只有**一个**非空模型名且相同；
 *  - `differs`：任何一侧出现两个以上名字（**含同一臂内混档**——那连噪声带的前提都不是同配置），或两臂名字不同；
 *  - `unknown`：有任何一行缺键（空串）。缺键**不许**判成 same：存量语料就是这一档，
 *    取不到＝未证，不是通过（本仓「没有静默出口」那条数据层规矩）。
 */
export function modelFace(baseline: readonly Row[], candidate: readonly Row[]): ModelFace {
  const names = (rows: readonly Row[]): string[] => [...new Set(rows.map((r) => r.model))];
  const b = names(baseline);
  const c = names(candidate);
  if ([...b, ...c].includes("")) return { state: "unknown", baseline: b, candidate: c };
  if (b.length !== 1 || c.length !== 1) return { state: "differs", baseline: b, candidate: c };
  return b[0] === c[0] ? { state: "same", baseline: b, candidate: c } : { state: "differs", baseline: b, candidate: c };
}

/** 把归因面渲染成对账表最上面的那一行出声。`same` 也要印——"没人被挡"这件事得看得见。 */
export function renderModelFace(f: ModelFace): string {
  if (f.state === "same") return `模型归因面：同一档（${f.baseline.join("/")}）✅`;
  if (f.state === "unknown") {
    return "模型归因面：⚠ **判不出**——读数里有行没有归因键（存量语料 / 跑器未盖章）。" +
      "跨模型的差值不能归因给改动；这一格按「取不到＝未证」处理，不按同面处理。";
  }
  return `模型归因面：❌ **不同面**——基线 ${f.baseline.join("/") || "（空）"} ↔ 改动 ${f.candidate.join("/") || "（空）"}。` +
    "两臂拨的不是同一个模型（或同一臂内混了档）⇒ 逐指标差值里混着模型本身的差，不许当改动效果。";
}

/** **身份闸**（2026-10-05 补）。为什么它排在归因面前头：一份读数不知道自己跑在哪个 rev、
 *  哪一时刻，就**连「这是同一次改动的读数」这个前提都没证**——此时哪怕模型档名齐了，
 *  下面的表也只能当量级看。盘上现读的 readings.json 全部没有这三个键，所以这道闸**今天一定会咬**，
 *  这是设计意图不是事故（写侧该往哪盖、盖什么键，交 `scripts/loop-eval.ts` 那一头，见 #63）。 */
export const IDENTITY_KEYS = ["headSha", "ranAt", "model"] as const;
export type IdentityKey = (typeof IDENTITY_KEYS)[number];

export interface IdentityRuling {
  /** true 只在**三个键每一行都非空**时成立；任一行缺任一键 ⇒ false（fail-closed，不取「多数有就算」）。 */
  ok: boolean;
  /** 缺过的键（按 IDENTITY_KEYS 顺序去重）——空数组当且仅当 `ok`。 */
  missing: IdentityKey[];
  /** 逐键的缺章行数（分母 = `rows`）。修的人要靠这个数知道要去盖章还是去换读数。 */
  counts: Record<IdentityKey, number>;
  rows: number;
}

/** 三键里任一缺章就咬。传进来的应当是**两侧全部**行（与 `modelFace` 同面）。 */
export function identityOf(rows: readonly Row[]): IdentityRuling {
  const counts: Record<IdentityKey, number> = { headSha: 0, ranAt: 0, model: 0 };
  for (const r of rows) {
    for (const k of IDENTITY_KEYS) if (r[k] === "") counts[k] += 1;
  }
  const missing = IDENTITY_KEYS.filter((k) => counts[k] > 0);
  return { ok: missing.length === 0, missing, counts, rows: rows.length };
}

/** 身份闸的固定出口文案（判卷钉逐字；改这一句要同批改判卷）。 */
export const IDENTITY_SENTENCE = "读数无身份键 ⇒ 只能当量级，不能当结论";

/** 身份面：咬与不咬**两态不同形**。不咬也要印——「没人被挡」这件事得看得见。 */
export function renderIdentityFace(id: IdentityRuling): string {
  if (id.ok) {
    return `读数身份面：✅ 三个身份键齐（headSha／ranAt／model，共 ${String(id.rows)} 行）——差值可以归因给这次改动。`;
  }
  const detail = id.missing.map((k) => `${k} 缺 ${String(id.counts[k])}/${String(id.rows)} 行`).join("；");
  return `读数身份面：❌ **${IDENTITY_SENTENCE}**（${detail}）。` +
    "rev／时刻／档名任一没盖章 ⇒ 这份读数不知道自己是谁跑的、什么时候跑的。" +
    "下面那行模型归因面连同整张表，都只按量级读，不按可比读数读。";
}

/* ───────────────── 逐靶配对面（ledger #90，2026-10-05 补）─────────────────
 * 为什么身份闸之上还要这一格：身份闸只回答"这份读数有没有盖章"，**没回答**"盖了同一枚章的两趟，
 * 逐靶到底哪几个翻红了"。本仓 2026-10-05 实测：同一装配跑两遍，12 个靶子里有 3 个翻面（单趟翻面率
 * 8–25%）。没有「靶子 id ↔ 每趟成败」的逐靶配对，就分不出「真的多拿下 1 个靶」与「噪声底」——
 * 一把 1 靶的增益本该看得见，此前看不见。这一格**只做配对**，上面任何一张表、闸门、出口码都不改。
 *
 * 三条口径：
 *   ⑴ **面（face）**＝除 ranAt 之外的全部身份键（headSha／model／maxSteps／reps／arm）。同一面＝同一批分母；
 *      ranAt 是**区分同面内不同趟**的键，不进面签名（否则同配置跑两遍就永远配不成对，而噪声带正需要它两遍）。
 *   ⑵ **unknown-face**：任一身份键缺失 ⇒ 这条读数连自己是谁跑的都判不出，单独成条、**不参与**任何同面配对，
 *      且在报告里**逐字出声**（本仓"取不到 ≠ 没问题"那条：缺章绝不并进可比组里蒙读数，也不许用 0/空冒充有）。
 *   ⑶ 每靶在某趟的成败＝该趟内这一靶各次重复的 **pass^k**（次次过才算绿）；翻转＝同一面里两趟这一值不同。 */

/** 构成「面」的身份键（同分母签名）——`ranAt` 有意不在内（见 ⑵ 上方的 ⑴）。 */
export const PAIR_FACE_KEYS = ["headSha", "model", "maxSteps", "reps", "arm"] as const;
/** 定位「一趟 run」所需的全部身份键＝面键＋ranAt。任一缺失 ⇒ 这条读数落进 unknown-face。 */
export const RUN_IDENTITY_KEYS = ["headSha", "ranAt", "model", "maxSteps", "reps", "arm"] as const;

/** 取一条读数的某一枚身份键值：缺省（undefined／空串）一律收成空串＝缺章。
 *  取值口径复用 `parseReadings` 里的 `identityStr`／`identityNum`（那里已把数值键转成字符串），
 *  这里只判"有没有"——不在配对这一层再抄一份"什么算缺章"。 */
function identVal(row: Row, key: (typeof RUN_IDENTITY_KEYS)[number]): string {
  return (row[key] ?? "") as string;
}

/** 一条读数的「面签名」；任一**面键**缺章 ⇒ null（＝判不出面）。 */
export function faceKeyOf(row: Row): string | null {
  const vals = PAIR_FACE_KEYS.map((k) => identVal(row, k));
  if (vals.some((v) => v === "")) return null;
  return PAIR_FACE_KEYS.map((k, i) => `${k}=${String(vals[i])}`).join("|");
}

/** 一条读数的「趟签名」（面＋ranAt）；任一身份键缺章 ⇒ null（＝unknown-face）。 */
export function runKeyOf(row: Row): string | null {
  const vals = RUN_IDENTITY_KEYS.map((k) => identVal(row, k));
  if (vals.some((v) => v === "")) return null;
  return RUN_IDENTITY_KEYS.map((k, i) => `${k}=${String(vals[i])}`).join("|");
}

/** 每靶的重复观测：pass@k＝至少一次过，pass^k＝次次过；k＝这一靶在这批行里出现的次数。 */
export interface TargetReps {
  target: string;
  k: number;
  passAtK: boolean;
  passTopK: boolean;
}

/** 逐靶 pass@k／pass^k（按靶 id 排序，稳定输出）。一个靶在 2 次重复里过 1 次 ⇒ pass@2=true 而 pass^2=false，
 *  这两个数**必须能分别取到**——只报其一就会把"抖一次也过"读成"稳过"。 */
export function passK(rows: readonly Row[]): TargetReps[] {
  const oks = new Map<string, boolean[]>();
  for (const r of rows) {
    const list = oks.get(r.id);
    if (list) list.push(r.ok);
    else oks.set(r.id, [r.ok]);
  }
  return [...oks.entries()]
    .map(([target, list]) => ({
      target,
      k: list.length,
      passAtK: list.some((x) => x),
      passTopK: list.every((x) => x),
    }))
    .sort((a, b) => a.target.localeCompare(b.target));
}

/** 一批行里「每靶一趟成败」＝pass^k（各次重复全过才绿）。翻面对账用它把多重复的一趟压成每靶一个值。 */
function runOutcomeByTarget(rows: readonly Row[]): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const r of rows) m.set(r.id, m.has(r.id) ? (m.get(r.id) ?? false) && r.ok : r.ok);
  return m;
}

/** 两个 run 之间的逐靶成败翻转。只对**两边都出现**的靶计数（单边靶没有"同一靶对同一靶"可言，不进分母）。 */
export interface FlipRuling {
  /** 两边都有、且 pass^k 不同的靶数。 */
  flips: number;
  /** 参与比较的靶数（两边交集）。 */
  compared: number;
  /** 翻红的靶 id（排序）。 */
  flipped: string[];
}

export function targetFlips(a: readonly Row[], b: readonly Row[]): FlipRuling {
  const ao = runOutcomeByTarget(a);
  const bo = runOutcomeByTarget(b);
  const both = [...ao.keys()].filter((id) => bo.has(id)).sort();
  const flipped = both.filter((id) => ao.get(id) !== bo.get(id));
  return { flips: flipped.length, compared: both.length, flipped };
}

/** 一个面：签名相同的一堆趟。`paired` 只在**同面 ≥2 趟**时为真——这才谈得上同分母翻转/噪声底。 */
export interface FacePair {
  face: string;
  ranAts: string[];
  paired: boolean;
  /** 最早两趟之间的翻转数；paired=false 时恒 0（没得比）。 */
  flips: number;
  compared: number;
  flipped: string[];
}

/** 配对总表。`faces` 是**有身份**的组；`unknown` 是缺身份、被排除在配对之外的读数（单独出声，不并进任何面）。 */
export interface FaceIndex {
  faces: FacePair[];
  unknown: number;
  unknownIds: string[];
}

export function indexFaces(rows: readonly Row[]): FaceIndex {
  const unknownIds: string[] = [];
  // face → ranAt → rows[]：先用趟签名判"这条有没有身份"，落进面后再按 ranAt 分成同面内的不同趟。
  const byFace = new Map<string, Map<string, Row[]>>();
  for (const r of rows) {
    if (runKeyOf(r) === null) {
      unknownIds.push(r.id);
      continue;
    }
    const face = faceKeyOf(r) ?? ""; // runKey 非空 ⇒ 面键必齐全 ⇒ 这里的 null 分支不可达，仅类型兜底
    const runs = byFace.get(face) ?? new Map<string, Row[]>();
    const list = runs.get(r.ranAt);
    if (list) list.push(r);
    else runs.set(r.ranAt, [r]);
    byFace.set(face, runs);
  }
  const faces: FacePair[] = [];
  for (const [face, runs] of [...byFace.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const ranAts = [...runs.keys()].sort();
    const paired = ranAts.length >= 2;
    const t = paired
      ? targetFlips(runs.get(ranAts[0]!) ?? [], runs.get(ranAts[1]!) ?? [])
      : { flips: 0, compared: 0, flipped: [] as string[] };
    faces.push({ face, ranAts, paired, flips: t.flips, compared: t.compared, flipped: t.flipped });
  }
  return { faces, unknown: unknownIds.length, unknownIds };
}

/** unknown-face 那一格的逐字句（判卷钉这一句；改它要同批改判卷）。 */
export const UNKNOWN_FACE_SENTENCE = "unknown-face 读数不参与同面配对";

/** 单个面的配对行。`flips:` 这个数字就是"这一面里翻了几个靶"——同面两趟时才有意义。 */
export function renderFacePair(f: FacePair): string {
  const head = `面【${f.face}】：同面 ${String(f.ranAts.length)} 趟`;
  if (!f.paired) return `${head} ⇒ 只 1 趟，无从配对（噪声带要同面两趟以上；这一面不比翻转）`;
  return (
    `${head}（${f.ranAts.join(" / ")}）⇒ 逐靶比较 ${String(f.compared)} 个共同靶，flips: ${String(f.flips)}` +
    `（翻转靶：${f.flipped.join("、") || "无"}）`
  );
}

/** 配对面总表。`unknown > 0` 时那句必须**出声**——否则"少了几条没身份的读数"就成了静默出口，
 *  而那正是本条缺陷的原始形状（两副不同形状的读数被当成同分母一起比）。 */
export function renderPairing(idx: FaceIndex): string {
  const out: string[] = ["── 逐靶配对面（同面才比，缺身份的不进分母）──"];
  if (idx.faces.length === 0) out.push("  没有任何**有身份**的读数可配对。");
  for (const f of idx.faces) out.push("  " + renderFacePair(f));
  out.push(
    idx.unknown > 0
      ? `  ⚠ ${UNKNOWN_FACE_SENTENCE}：${String(idx.unknown)} 条缺身份键（headSha／ranAt／model／maxSteps／reps／arm 任一）` +
          "——取不到＝未证，绝不并进上面任一可比面里蒙读数。"
      : `  ${UNKNOWN_FACE_SENTENCE}：0 条（全部读数都盖齐了身份键）✅`,
  );
  return out.join("\n");
}

/** **噪声带**：同配置两次运行的逐指标绝对差。
 *
 *  它回答的是"什么都不改，两次跑能差多少"。改动幅度落在这个带里 ⇒ 判不出好坏。
 *  两点样本是弱证据，所以调用方**必须**把 `--baseline` 给两份以上；
 *  只有一份时本函数返回 null，`compare` 会把结论标成 unknown，而不是假装判得出。 */
export function noiseBand(a: Totals, b: Totals): Totals {
  const diff = (k: keyof Totals): number => Math.abs(a[k] - b[k]);
  return {
    tasks: diff("tasks"),
    passed: diff("passed"),
    successRate: diff("successRate"),
    tokensIn: diff("tokensIn"),
    tokensOut: diff("tokensOut"),
    seconds: diff("seconds"),
    rssPeakMb: diff("rssPeakMb"),
    toolFailures: diff("toolFailures"),
    repeats: diff("repeats"),
  };
}

function assess(metric: keyof Totals, delta: number): Assessment {
  if (delta === 0) return "noise";
  if (LOWER_IS_BETTER.has(metric)) return delta < 0 ? "better" : "worse";
  if (HIGHER_IS_BETTER.has(metric)) return delta > 0 ? "better" : "worse";
  return "unknown";
}

/** 逐指标对账。
 *
 *  `band` 为 null ⇒ 噪声带不可得（只给了一份基线），此时 `verdict` 一律 `unknown`——
 *  **不许**退化成"带内"：那正是"没量到当成通过"。 */
export function compare(
  baseline: Totals,
  candidate: Totals,
  band: Totals | null,
  baselineTasks: readonly string[],
  candidateTasks: readonly string[],
): Comparison {
  const sameTaskSet =
    baselineTasks.length === candidateTasks.length &&
    baselineTasks.every((id, i) => id === candidateTasks[i]);
  const lines: MetricLine[] = METRICS.map((metric) => {
    const delta = candidate[metric] - baseline[metric];
    const b = band === null ? null : band[metric];
    const verdict: Verdict | "unknown" =
      b === null ? "unknown" : Math.abs(delta) > b ? "beyond-noise" : "within-noise";
    return {
      metric,
      baseline: baseline[metric],
      candidate: candidate[metric],
      delta,
      band: b,
      verdict,
      assessment: verdict === "unknown" ? "unknown" : verdict === "within-noise" ? "noise" : assess(metric, delta),
    };
  });
  return { sameTaskSet, baselineTasks: [...baselineTasks], candidateTasks: [...candidateTasks], lines };
}

/** **跨指标合取闸**：逐指标各判各的，正是这张表最大的误读面。
 *
 *  实跑为证（2026-10-05，离线取仓内既有语料）：基线 `outputs/eval-base-a|b`（同配置两次，12 条）、
 *  候选 `outputs/bench-reps3-2026-10-02` ⇒ **5 项超带 = 3 项 ★改善（输入 token／输出 token／墙钟）
 *  ＋ 2 项退化，其中成功率从 70.8% 崩到 5.6%**。一次「跑废了」能被这张表印成「改动有效」——
 *  省下来的钱是**没干活**省下来的，不是效果。
 *
 *  闸的判据建在**已经算出来的指标语义**上（`OUTCOME_METRICS` = 方向表里「越大越好」那一侧），
 *  不靠指标名的字符串匹配。写成纯函数，由 `renderReport` 调用，判卷直接测它。 */
export interface OutcomeRuling {
  /** true ⇒ 本表禁止读作改善：不许出现任何「★改善」。 */
  blocked: boolean;
  /** 超带且方向为差的结果类指标（闸就是被它们咬住的）。 */
  degraded: (keyof Totals)[];
  /** 因为闸而不许印成改善的超带项（成本类那一族）。 */
  suppressed: (keyof Totals)[];
}

export function outcomeGate(cmp: Comparison): OutcomeRuling {
  const beyond = cmp.lines.filter((l) => l.verdict === "beyond-noise");
  const degraded = beyond
    .filter((l) => OUTCOME_METRICS.has(l.metric) && l.assessment === "worse")
    .map((l) => l.metric);
  const blocked = degraded.length > 0;
  return {
    blocked,
    degraded,
    suppressed: blocked ? beyond.filter((l) => l.assessment === "better").map((l) => l.metric) : [],
  };
}

/** 合取闸的固定出口文案（判卷钉逐字；改这一句要同批改判卷）。 */
export const GATE_SENTENCE = "⇒ 本表禁止读作改善；成本类超带只是副作用";
/** 闸咬住时，成本那一格的判定列改印这个——**不含**「★改善」三个字。 */
const BETTER_UNDER_GATE = "副作用（禁读改善）";

/** 单份读数的取值（多个基线文件取逐指标均值，让"噪声带"有个中心）。 */
export function meanTotals(all: readonly Totals[]): Totals {
  if (all.length === 0) throw new Error("meanTotals：空数组");
  const avg = (f: (t: Totals) => number): number => all.reduce((a, t) => a + f(t), 0) / all.length;
  return {
    tasks: avg((t) => t.tasks),
    passed: avg((t) => t.passed),
    successRate: avg((t) => t.successRate),
    tokensIn: avg((t) => t.tokensIn),
    tokensOut: avg((t) => t.tokensOut),
    seconds: avg((t) => t.seconds),
    rssPeakMb: avg((t) => t.rssPeakMb),
    toolFailures: avg((t) => t.toolFailures),
    repeats: avg((t) => t.repeats),
  };
}

const LABEL: Readonly<Record<keyof Totals, string>> = {
  tasks: "任务数",
  passed: "达标数",
  successRate: "成功率",
  tokensIn: "输入 token",
  tokensOut: "输出 token",
  seconds: "墙钟(秒)",
  rssPeakMb: "内存峰(MB)",
  toolFailures: "工具失败",
  repeats: "重复动作",
};

function fmt(metric: keyof Totals, v: number): string {
  if (metric === "successRate") return `${(v * 100).toFixed(1)}%`;
  if (metric === "seconds") return v.toFixed(1);
  return String(Math.round(v));
}

/** 渲染成人看的对照表。`band` 未知时**明说判不出**，不给假结论；
 *  结果类超带退化时**整表禁止读作改善**（`outcomeGate`）。 */
export function renderReport(cmp: Comparison, bandSource: string): string {
  const gate = outcomeGate(cmp);
  const out: string[] = [];
  out.push(`噪声带来源：${bandSource}`);
  if (!cmp.sameTaskSet) {
    out.push("");
    out.push("❌ **任务集不一致 ⇒ 逐指标结论全部作废**（分母变了，横比无意义）");
    out.push(`   基线：${cmp.baselineTasks.join(", ")}`);
    out.push(`   改动：${cmp.candidateTasks.join(", ")}`);
    return out.join("\n");
  }
  out.push(`任务集一致（${String(cmp.baselineTasks.length)} 条）✅`);
  out.push("");
  out.push("指标          基线        改动        差值       噪声带      判定");
  for (const l of cmp.lines) {
    const bandTxt = l.band === null ? "不可得" : fmt(l.metric, l.band);
    const verdictTxt =
      l.verdict === "unknown" ? "判不出" : l.verdict === "within-noise" ? "带内"
        : l.assessment === "better" ? (gate.blocked ? BETTER_UNDER_GATE : "★改善") : "⚠退化";
    out.push(
      `${LABEL[l.metric].padEnd(12)}  ${fmt(l.metric, l.baseline).padStart(10)}  ${fmt(l.metric, l.candidate).padStart(10)}  ` +
        `${fmt(l.metric, l.delta).padStart(9)}  ${bandTxt.padStart(9)}  ${verdictTxt}`,
    );
  }
  out.push("");
  const beyond = cmp.lines.filter((l) => l.verdict === "beyond-noise");
  if (cmp.lines.every((l) => l.verdict === "unknown")) {
    out.push("⚠ 噪声带不可得（只给了一份基线）⇒ **判不出改动的效果**。请把同一配置多跑一份喂 --baseline。");
  } else if (beyond.length === 0) {
    out.push("结论：所有指标都在噪声带内 ⇒ **这次改动没有可观测效果**（别声称变好了）。");
  } else if (gate.blocked) {
    // 那句禁止的话排在任何「省了多少钱」之前，且退化项照常印——闸只挡误读，不挡证据。
    out.push(`❌ ${gate.degraded.map((m) => LABEL[m]).join("、")} 超带退化 ${GATE_SENTENCE}`);
    out.push(
      `   闸挡下的超带项：${gate.suppressed.map((m) => LABEL[m]).join("、") || "无"}` +
        "——活儿没办成当然省 token 与时间，那是副作用，不许写成效果。",
    );
  } else {
    const better = beyond.filter((l) => l.assessment === "better");
    const worse = beyond.filter((l) => l.assessment === "worse");
    out.push(
      `结论：${String(beyond.length)} 项超出噪声带 —— 改善 ${String(better.length)} 项（${better.map((l) => LABEL[l.metric]).join("、") || "无"}）；` +
        `退化 ${String(worse.length)} 项（${worse.map((l) => LABEL[l.metric]).join("、") || "无"}）`,
    );
  }
  out.push("");
  out.push("读法：噪声带 = **同配置两次运行**的差。改动幅度落在带内 ⇒ 判不出好坏，不许当成功。");
  out.push("      两点样本是弱证据：要下结论请提高 --reps 并多喂几份 --baseline。");
  out.push("      合取闸：结果类（成功率/达标数）超带退化 ⇒ 成本类再漂亮也不构成「改善」。");
  return out.join("\n");
}

/** 出口码：调用方**不读文本**也要能区分四种面。0 之外一律出声，不静默降级。
 *
 *  与既有的 `2`（用法错）分开，别挤在一起。任务集不一致那格今天**不占码**——它已有整表作废的
 *  文本面，而闸的码要留给「表可比但结论被禁」这一族；把两族混进一个码，调用方就分不出该修什么。 */
export function exitCodeOf(identity: IdentityRuling, gate: OutcomeRuling): number {
  if (!identity.ok && gate.blocked) return 5;
  if (!identity.ok) return 3;
  if (gate.blocked) return 4;
  return 0;
}

/** 出口码那一行的逐字说明（也是给人看的汇总面）。 */
export function renderExitFace(code: number): string {
  const why: Record<number, string> = {
    0: "表可信（身份齐、无结果类超带退化）",
    3: "身份闸咬住：读数无身份键，整表只当量级",
    4: "合取闸咬住：结果类超带退化，本表禁止读作改善",
    5: "两道闸都咬：既无身份键，结果类又超带退化",
  };
  return `〔出口码 ${String(code)}：${why[code] ?? "未知码"}｜0=可信 3=身份闸 4=合取闸 5=两道都咬；用法错=2〕`;
}

/** 从 argv 取一个可重复的 flag（`--baseline a --baseline b`）。 */
function pickAll(argv: readonly string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === flag) out.push(argv[i + 1] ?? "");
  return out.filter((s) => s !== "");
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("report.ts")) {
  const argv = process.argv.slice(2);
  const basePaths = pickAll(argv, "--baseline");
  const candPaths = pickAll(argv, "--candidate");
  if (basePaths.length === 0 || candPaths.length === 0) {
    process.stderr.write(
      "用法：node --import tsx scripts/eval/report.ts --baseline <readings.json> [--baseline <再来一份同配置的>] --candidate <readings.json>\n" +
        "  噪声带需要**两份同配置**的基线；只给一份会把结论标成「判不出」。\n",
    );
    process.exit(2);
  }
  const baseRows = basePaths.map((p) => parseReadings(readFileSync(p, "utf8"), p));
  const candRows = candPaths.map((p) => parseReadings(readFileSync(p, "utf8"), p));
  const baseTotals = baseRows.map((r) => totalsOf(r));
  const candTotals = candRows.map((r) => totalsOf(r));
  const band = baseTotals.length >= 2 ? noiseBand(baseTotals[0]!, baseTotals[1]!) : null;
  const bandSource =
    baseTotals.length >= 2
      ? `${basePaths[0] ?? ""} ↔ ${basePaths[1] ?? ""}（同配置两次）`
      : `不可得：只给了 ${String(baseTotals.length)} 份基线`;
  const cmp = compare(
    meanTotals(baseTotals),
    meanTotals(candTotals),
    band,
    taskIds(baseRows[0]!),
    taskIds(candRows[0]!),
  );
  // 归因面打在表**之前**：两臂不同档时，下面那张表的差值里没有一行能归因给改动。
  const face = modelFace(baseRows.flat(), candRows.flat());
  // 身份闸打在归因面**之前**：连 rev／时刻都没盖章的读数，档名再齐也只能当量级——
  // 这一行必须**先**印，否则下一行的「同一档 ✅」会被读成可比读数（那正是本闸要挡的）。
  const identity = identityOf([...baseRows.flat(), ...candRows.flat()]);
  process.stdout.write(renderIdentityFace(identity) + "\n");
  process.stdout.write(renderModelFace(face) + "\n\n");
  // 逐靶配对面：身份闸说"有没有盖章"，这一格说"盖同一枚章的两趟逐靶翻了几个"（#90）。
  // 两侧**全部**行一起进配对，缺身份的那几条会被单独成条并出声，不并进可比面。
  process.stdout.write(renderPairing(indexFaces([...baseRows.flat(), ...candRows.flat()])) + "\n\n");
  process.stdout.write(renderReport(cmp, bandSource) + "\n");
  // 出口码落在两道闸上：调用方不必 parse 文本就能分清「可信 / 只有量级 / 禁止读作改善」。
  const code = exitCodeOf(identity, outcomeGate(cmp));
  process.stdout.write(renderExitFace(code) + "\n");
  process.exit(code);
}
