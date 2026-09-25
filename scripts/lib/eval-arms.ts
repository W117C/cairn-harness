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
