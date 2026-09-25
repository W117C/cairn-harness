/** 语料的「臂」与「配对」——纯函数，供 `tests/eval-arms.test.ts` 消费。
 *
 * 为什么要有（第 88 页读完自己发现的缺陷）：`run-scorecard` 把 21 个文件、6 条臂、3 个实验族
 * **池成一个数**（`成功率 89%`、`每「一次成功」30,570 token`）。可语料里明明摆着
 * `loop-eval-v2-base` × `loop-eval-v2-short`（I1–I4 一一配对的 A/B）
 * 和 `ga-strategy-…` / `-rep2` / `-rep3`（同一配置的三次重复）。池化把这两件事压平成同一个数——
 * 而「一次策略差」与「重复抖动」的读法正好相反。本模块只回答两个问题：这条臂是谁、哪些格子真能配对。
 */

export interface ArmOf {
  /** 臂名（= 语料所在目录名），如 `loop-eval-v2-base`。 */
  arm: string;
  /** 剥掉日期 / `-repN` / 变体后缀后的实验族，如 `loop-eval-v2`。 */
  family: string;
  /** 变体名（`base`/`short`…）；同配置重复时为 null。 */
  variant: string | null;
  /** 第几轮重复（`-rep2`）；无则 1。 */
  rep: number;
}

const VARIANTS = ["base", "short", "long", "control", "treatment", "default"] as const;
const DATE = /-\d{4}-\d{2}-\d{2}/;

/** 从臂名拆 family / variant / rep。规则是**减法**：只剥已知的日期、`-repN` 与白名单变体后缀。
 *  剥不掉的部分留在 family 里 ⇒ 没登记过的新后缀会自成一族、**配不上对**（宁可漏配，
 *  也不许把两个不同实验硬凑成一对——那造出来的差值是假的）。 */
export function parseArm(arm: string): ArmOf {
  let rest = arm.replace(DATE, "");
  let rep = 1;
  const repMatch = /-rep(\d+)$/.exec(rest);
  if (repMatch !== null) {
    rep = Number(repMatch[1]);
    rest = rest.slice(0, rest.length - repMatch[0].length);
  }
  let variant: string | null = null;
  for (const v of VARIANTS) {
    if (rest.endsWith("-" + v)) {
      variant = v;
      rest = rest.slice(0, -(v.length + 1));
      break;
    }
  }
  rest = rest.replace(DATE, "").replace(/-+$/, "");
  return { arm, family: rest === "" ? arm : rest, variant, rep };
}

/** 文件名 → 任务键：剥扩展名与 `-repN`/变体词。`I2-rep1-base.events.jsonl` ⇒ `I2`；`fanout.events.jsonl` ⇒ `fanout`。 */
export function taskKey(file: string): string {
  const base = (file.split("/").pop() ?? file).replace(/\.events\.jsonl$|\.jsonl$/, "");
  return base
    .replace(/-rep\d+/g, "")
    .replace(new RegExp("-(" + VARIANTS.join("|") + ")(?=-|$)", "g"), "")
    .replace(/-+$/, "");
}

/** 完整路径 → 臂名（倒数第二段）。
 *  直接躺在**语料根**（`outputs`、app 的 `sessions`）下的文件没有臂 ⇒ 返回 `(无臂)` 而不是根目录名：
 *  根名不是实验条件，让它当臂就会把两个不相干的顶层文件当成"同一臂的两条流"来池化。 */
export function armOfPath(path: string, corpusRootNames: readonly string[] = ["outputs", "sessions"]): string {
  const segs = path.split("/").filter((s) => s !== "");
  if (segs.length < 2) return "(无臂)";
  const parent = segs[segs.length - 2]!;
  return corpusRootNames.includes(parent) ? "(无臂)" : parent;
}

/** 一格 = 一条臂上的一个任务。除 `arm`/`task` 之外的字段由调用方自带：
 *  分组只按这两个键，返回的还是调用方那个类型 ⇒ 取数不需要再 cast，也不许本模块规定"值长什么样"。 */
export interface Cell {
  arm: ArmOf;
  task: string;
}

export interface PairGroup<T extends Cell> {
  family: string;
  task: string;
  /** 至少两条臂才成为一组（按臂名稳定排序）。 */
  cells: T[];
  /** 组内是否存在**变体不同**的两臂 ⇒ 真 A/B；只有 rep 不同 ⇒ 同配置重复。
   *  两者都不成立（只有一条臂）时该组根本不会出现。 */
  hasAb: boolean;
  /** 组内臂数，读数要带这个数（"配上了"不等于"配得全"）。 */
  arms: number;
}

/** 按 family+task 组配对；只保留出现在 ≥2 条臂上的格。 */
export function groupPairs<T extends Cell>(cells: readonly T[]): PairGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const c of cells) {
    const k = c.arm.family + "\u0000" + c.task;
    const list = byKey.get(k);
    if (list === undefined) byKey.set(k, [c]);
    else list.push(c);
  }
  const out: PairGroup<T>[] = [];
  for (const [k, list] of [...byKey.entries()].sort()) {
    if (list.length < 2) continue;
    const cellsSorted = [...list].sort((a, b) => a.arm.arm.localeCompare(b.arm.arm));
    // null 也是 Set 的一个不同取值 ⇒ "base vs 无后缀" 同样算两条不同臂。
    const variants = new Set(cellsSorted.map((c) => c.arm.variant));
    out.push({
      family: k.split("\u0000")[0]!,
      task: k.split("\u0000")[1]!,
      cells: cellsSorted,
      hasAb: variants.size > 1,
      arms: cellsSorted.length,
    });
  }
  return out;
}

/* ——— 幅度的可引用性（第 89 页那句口径的棘轮版）———
 * 第 89 页把「A/B 每行的幅度必须先有同配置重复的噪声底才允许引用」写在了 dated 页的散文里。
 * 散文不算闸门：下一个读这张表的人（包括下轮的我）仍会把 `1.63×` 抄进结论。
 * 所以这条口径必须长在**读数面上**——让工具自己决定哪些数能当数用。
 * 判据取最严的那一格：噪声底必须来自**同一任务、同一条臂的重复**。
 * 别的任务/别的族的抖动不是本格的底（`fanout` 的 3.34× 约束不了 `I1` 的 1.63×），
 * 借来只会让一条读数看起来比它实际支撑得起的更硬。 */

/** `citable` 之外都不许把比值当结论引用。 */
export type MagnitudeVerdict = "citable" | "within-noise" | "unreplicated" | "degenerate" | "not-ab";

export interface VariantRep {
  /** 变体标签（`base`/`short`；无后缀的臂记 `(无后缀)`）。 */
  label: string;
  /** 该变体在**本格**上的重复次数（同配置 rep 的条数）。 */
  reps: number;
  /** 各次重复的 token，按 rep 升序。 */
  tokens: number[];
  /** 其中**有 token 上报**的条数（0＝那条 run 没上报 usage，属证据缺席，不算一次免费重复）。 */
  measured: number;
  /** 该臂的中位 token（只在有上报的那些次上取）—— 比值算这个数：逐条相加会让一条
   *  崩掉的 run 拽偏整臂，而把缺报当 0 会把整臂算便宜一倍。做成字段＝统计量有观测者（规则 80）。 */
  median: number;
}

export interface AbMagnitude {
  family: string;
  task: string;
  variants: VariantRep[];
  /** 两臂中位数之比（大/小）。有一臂为 0 或两臂同值时不取比值 ⇒ null。 */
  ratio: number | null;
  /** 本格自己的噪声底 = 各变体**内部**极差比的最大值（只在有上报的重复上取）；
   *  没有任何一臂凑得出两次有上报的重复 ⇒ null——"没底"与"底是 1.00×（零抖动）"是两回事。 */
  floor: number | null;
  /** 每条臂各自的重复次数下界（"配上了"≠"配得全"）。 */
  minReps: number;
  /** 其中真上报了 token 的重复次数下界 —— **引用资格判这个数**，不判 `minReps`。 */
  minMeasured: number;
  verdict: MagnitudeVerdict;
  reason: string;
}

function spread(values: readonly number[]): number | null {
  const pos = values.filter((v) => v > 0);
  if (pos.length < 2) return null;
  return Math.max(...pos) / Math.min(...pos);
}

/** 真中位（偶数个取中间两个的平均）。不取"上中位"：这个数会被抄进结论，
 *  统计量本身不许带方向性的偏（同一份数据两种"中位"差出一格的幅度）。 */
function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/** 一个 A/B 组的幅度可引用性。重复组也吃（它产出的是"底"），但会判成 `not-ab`。 */
export function magnitudeOfAb<T extends Cell & { tokens: number }>(g: PairGroup<T>): AbMagnitude {
  const byLabel = new Map<string, T[]>();
  for (const c of g.cells) {
    const label = c.arm.variant ?? "(无后缀)";
    const list = byLabel.get(label);
    if (list === undefined) byLabel.set(label, [c]);
    else list.push(c);
  }
  const variants: VariantRep[] = [...byLabel.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, cs]) => {
      const tokens = [...cs].sort((a, b) => a.arm.rep - b.arm.rep).map((c) => c.tokens);
      // token=0 的那次是**证据缺席**（那条 run 没上报 usage），不是"跑了且免费"：
      // 留着它当中位数会把一臂算便宜一倍，这是本模块最容易骗自己的一格。
      const pos = tokens.filter((v) => v > 0);
      return { label, reps: cs.length, measured: pos.length, tokens, median: median(pos) };
    });
  const minReps = Math.min(...variants.map((v) => v.reps));
  const minMeasured = Math.min(...variants.map((v) => v.measured));
  const floors = variants.map((v) => spread(v.tokens)).filter((x): x is number => x !== null);
  const floor = floors.length === 0 ? null : Math.max(...floors);
  const medians = variants.map((v) => v.median);
  const lo = Math.min(...medians);
  const hi = Math.max(...medians);
  const ratio = lo > 0 && hi > lo ? hi / lo : null;
  const labels = variants.map((v) => v.label).join(" vs ");

  let verdict: MagnitudeVerdict;
  let reason: string;
  if (variants.length < 2) {
    verdict = "not-ab";
    reason = `组内只有一条变体（${labels}）⇒ 这是同配置重复，不是 A/B，无从谈幅度`;
  } else if (medians.some((m) => m === 0)) {
    verdict = "degenerate";
    reason = `有一臂一次 token 上报都没有 ⇒ 比值无定义（不许读成 0× 或 ∞，也不许把缺报当免费）`;
  } else if (minMeasured < 2) {
    verdict = "unreplicated";
    reason =
      `每臂可用样本 ${String(Math.min(minReps, minMeasured))} 次（${labels}）⇒ 不足两次同配置重复，` +
      `本格没有自己的噪声底。他任务/他族的抖动不算本格的底（第 89 页口径）`;
  } else if (ratio === null) {
    verdict = "within-noise";
    reason = `两臂中位同值 ⇒ 无幅度可报（每臂 ${String(minMeasured)} 次重复的底 ${String(floor?.toFixed(2))}×）`;
  } else if (floor !== null && ratio <= floor) {
    verdict = "within-noise";
    reason = `幅度 ${ratio.toFixed(2)}× ≤ 本格噪声底 ${floor.toFixed(2)}× ⇒ 与"重跑一遍"分不开`;
  } else {
    verdict = "citable";
    reason = `幅度 ${ratio.toFixed(2)}× > 本格噪声底 ${String(floor?.toFixed(2) ?? "—")}×（每臂 ${String(minMeasured)} 次重复）`;
  }
  return { family: g.family, task: g.task, variants, ratio, floor, minReps, minMeasured, verdict, reason };
}

/** 两截：`magnitudeTail` = 比值 + 引用资格 + 为什么；两行装配函数在它们之上。
 *  比值**照印**但带着"不可引用"一起走：藏掉数字只会让人自己去 Excel 里除一个更差的数，
 *  留在眼前并标明资格，才是"读数带着它的口径"（规则 82 的同一族）。
 *  装配放在库里而不是报告里：判词与数字**必须同一行**才拦得住引用，而这只在字符串层面可测（规则 80）。 */
function magnitudeTail(m: AbMagnitude): string {
  const ratio = m.ratio === null ? "比值无定义" : m.ratio.toFixed(2) + "×";
  const tag = m.verdict === "citable" ? "幅度可引用" : "幅度不可引用（" + m.verdict + "）";
  return ratio + " " + tag + "：" + m.reason;
}

/** A/B 行：`cellLabels` 由调用方给（每臂的终态是调用方的字段，本模块不规定它长什么样）。 */
export function abRowLine(m: AbMagnitude, cellLabels: readonly string[]): string {
  return "    [A/B] " + m.family + "/" + m.task + " ⇒ " + cellLabels.join(" ｜ ") + " ‖ " + magnitudeTail(m);
}

/** 同配置重复行：它产出的正是"底"本身，所以读数要显式叫出这个名字。 */
export function repRowLine(m: AbMagnitude, cellLabels: readonly string[]): string {
  return "    [重复] " + m.family + "/" + m.task + " ⇒ " + cellLabels.join(" ｜ ") +
    " ‖ 噪声底=" + (m.floor === null ? "样本不足（不足两次同配置重复）" : m.floor.toFixed(2) + "×") +
    "（同配置抖动，不是策略差）";
}

export interface SignTest {
  /** 参与符号检验的格数（两臂中位不相等的那些）= 这条陈述的分母。 */
  pairs: number;
  /** 两臂中位同值的格数：它是"没差异"的证据，**不是**证据缺席 ⇒ 单列，不混进 `skipped`。 */
  ties: number;
  /** 被剔掉的格数：有一臂一次 token 上报都没有 ⇒ 只能报"证据缺席"，不许默默缩分母。 */
  skipped: number;
  /** 能报符号的方向；分母为 0 时 null，**不许读成 0/0=100%**。 */
  tokenDirection: { sign: "a-below-b" | "a-above-b"; agree: number; against: number } | null;
}

/** 符号（谁更省）与幅度（省几倍）是两件事：n=1 的配对仍支持"5/5 同向"这种陈述，
 *  但不支持任何倍率。本函数只算符号，并把它自己的分母交出去。
 *  **一臂 token=0 不算"更省"，算证据缺席** ⇒ 剔出分母并计入 `skipped`（否则 0 会白送一个方向）。
 *  方向以**排序靠前的变体**为参照（标签稳定 ⇒ 同一份语料两次跑出同一个说法）。 */
export function signTestToken(mags: readonly AbMagnitude[]): SignTest {
  const usable = mags.filter((m) => m.variants.length === 2 && m.variants.every((v) => v.median > 0));
  let below = 0;
  let above = 0;
  for (const m of usable) {
    const [a, b] = [m.variants[0]!.median, m.variants[1]!.median];
    if (a < b) below += 1;
    else if (a > b) above += 1;
  }
  const comparable = below + above;
  return {
    pairs: comparable,
    ties: usable.length - comparable,
    skipped: mags.length - usable.length,
    tokenDirection: comparable === 0 ? null : {
      sign: below >= above ? "a-below-b" : "a-above-b",
      agree: Math.max(below, above),
      against: Math.min(below, above),
    },
  };
}
