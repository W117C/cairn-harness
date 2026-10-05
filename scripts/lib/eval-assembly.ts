// 基准装配 ↔ 产品缺省的差值登记（能力 5/10 的**测量有效性**那一格）。
//
// 为什么必须有这一张表（2026-10-02 现读）：`scripts/loop-eval.ts` 头上写着「装配 = 生产同款」，
// 而它递给 `runLoop` 的参数里，**一枚产品缺省开的开关都没有**（provider/events/workspace/mode/
// maxSteps/stuckNudge/clarify/plan/verify/userMessage）。最要紧的那枚是 `autoVerify`——
// `src/agent/loop.ts:573` 的「能力 5 收束闸」：写过盘而模型自始至终没自调 verify ⇒ harness 在收束前
// 补一拍验证。产品缺省开（`DEFAULT_SETTINGS.autoVerify = true`，用户裁决 09-23），
// CLI 要 `--auto-verify`，基准**当时不接**。后果不是"少一个功能"，而是**读数说谎**：
// 盘上 49 趟真模型跑批（bench-reps3 36 趟 + eval-long30 1 趟 + eval-baseline-1 12 趟）里
// `autoVerifyBeat` **全是 false** ⇒ 这一列被读成「模型从不自己验证」，
// 而真实原因是「跑器没把这一环装上」。这就是本仓反复立案的「两头断」 newest 一例：
// 判据字段在场、生产者从未被接上。
//
// 规矩（与 `docs-check` 的存量豁免、`prose-needle-scan` 的水位同一族）：
//  - 产品**缺省为真**的每一枚键都必须在 `BENCH_KNOBS` 里有表态；
//  - 没表态 ⇒ face="undeclared" ⇒ 判卷红。今后谁翻一个缺省（`impactAnalysis` 09-27 就翻过一次），
//    基准必须当场说一句"我装/我不装/这格对我无意义"，不能再静默少装一环；
//  - 表**就是**跑器递出去的参数：`runLoopKnobsFromAssembly` 单向投影（表 → 参数，不许反过来各算一次）。
//    业主裁决（2026-10-05 第 403 页）「先不花钱，只补装配那一半」⇒ `autoVerify` 缺省记 `same`＝与产品同档，
//    要拿「没装闸」那一臂用 `--no-auto-verify`。**花的钱与装配是两格裁决**：这一半翻的是缺省装配，
//    而「装了闸之后返修值不值」那一臂仍要一次带凭据的真跑，那一步没授权，不由这把尺替用户翻。

/** 跑器对一枚键的表态。五个取值是**互斥**的，不许并成"大概差不多"：
 *  - `same`           基准也装着这一环（读数可与生产行为对齐引用）；
 *  - `off-here`       生产装、基准**没装**（读数不许被引用成"产品行为"，本表存在的理由就是数这一列）；
 *  - `on-here`        生产**缺省关**、这一趟靠旗标装了（反方向的那一格：读数同样不是产品缺省态，
 *                     装它只为拿对照臂——`autoVerifyRepair` 就是这么用的）；
 *  - `not-applicable` 这一环对基准靶子在语义上不存在（例：只作用于 UI/沙箱外部的配置）；
 *  - `undeclared`     表里查无此键 ⇒ 判卷红，不是警告。 */
export type KnobFace = "same" | "off-here" | "on-here" | "not-applicable" | "undeclared";

export interface BenchDeclaration {
  face: Exclude<KnobFace, "undeclared">;
  /** 为什么是这个 face——`off-here` 必须写清"接线点在哪、为什么没接"，否则就是一条免责声明。 */
  why: string;
}

/** 表里投影出来的一行。`face` 收成完整的 `KnobFace`（含 `undeclared`）而 `BenchDeclaration` 不含：
 *  「没表态」是**算出来**的状态，不是谁声明出来的——声明面写不出它，才说明它是判据。 */
export interface AssemblyRow {
  key: string;
  face: KnobFace;
  why: string;
}

/** 缺省表态（2026-10-02 现读）。逐条都带**接线点**，不是形容词。 */
export const BENCH_KNOBS: Readonly<Record<string, BenchDeclaration>> = {
  autoVerify: {
    face: "same",
    why: "收束闸在 loop.ts:573，要 runLoop 收到 autoVerify:true 才走；缺省装配已补上与产品同档（2026-10-05 业主裁决：只补装配、不授权花钱），摘掉它＝带 --no-auto-verify 拿对照臂",
  },
  impactAnalysis: {
    face: "off-here",
    why: "生产递 runLoop 的 impact 钩子（agent-runner:1760）并注入 impact_query 工具；基准两样都没接（实测面里无 impact_query）",
  },
  promptCache: {
    face: "off-here",
    why: "provider 级选项（agent-runner:1767 传 providerSettings.promptCache）；基准的 createGlmSessionProvider 没带这个键",
  },
  autoMemory: {
    face: "off-here",
    why: "面里有 remember 这把工具，但**自动沉淀**那条消费者在 agent-runner:1877（enabled: autoMemory && …），基准不走 runner",
  },
  subagentTools: {
    face: "same",
    why: "三件套（spawn_agent/wait_for_agents/cancel_agents）在 sessionToolSpecs 的面上，实测 22 把里都在",
  },
};

/** 跑器可以按命令行**改口**的键（只有真接了的才许改口，见 `assemblyOverrides` 与 loop-eval 的三枚旗标）。 */
export type KnobOverrides = Readonly<Record<string, BenchDeclaration>>;

/** 行集＝**缺省为真的键 ∪ 被旗标改过口的键**。
 *  前半是"产品默认在线的东西，基准装没装"；后半为什么也要在：缺省关的东西基准**装了**同样改变了读数
 *  （`--auto-verify-repair` 就是这一类），漏了它这张表只会朝一个方向说实话。
 *  形参收成 `object` 而不是 `Record<string, unknown>`：事实源是 `DEFAULT_SETTINGS`，
 *  那是 interface 实例、没有字符串索引签名，硬套要调用方写 cast（cast 一写，读的就是被掰过的类型）。 */
export function assemblyRows(
  defaults: object,
  declared: Readonly<Record<string, BenchDeclaration>> = BENCH_KNOBS,
  overrides: KnobOverrides = {},
): AssemblyRow[] {
  const on = new Set(Object.entries(defaults).filter(([, v]) => v === true).map(([k]) => k));
  for (const k of Object.keys(overrides)) on.add(k);
  return [...on].sort().map((key) => {
    const over = overrides[key];
    const base = declared[key];
    if (over !== undefined) return { key, ...over };
    if (base === undefined) {
      return {
        key,
        face: "undeclared" as const,
        why: "装配表里查不到这一枚 ⇒ 基准没说装没装，读数无法解释",
      };
    }
    return { key, ...base };
  });
}

/** `off-here` 那一列＝基准比产品少装的环节。这是要被数出来的数，不是形容词。 */
export function undeclaredKnobs(rows: readonly AssemblyRow[]): AssemblyRow[] {
  return rows.filter((r) => r.face === "undeclared");
}

export function missingKnobs(rows: readonly AssemblyRow[]): AssemblyRow[] {
  return rows.filter((r) => r.face === "off-here");
}

/** 印进读数行/`readings.json` 的一枚短串：读数自带"这是哪副装配跑出来的"。
 *  为什么把整张表压成一串：每一格读数都会 `JSON.stringify` 进 readings.json，
 *  逐条重复整张表不如一行 `autoVerify:off-here …`，而解释整张表的活儿在装配面那一行日志里。 */
export function renderAssemblyFace(rows: readonly AssemblyRow[]): string {
  return rows.map((r) => `${r.key}:${r.face}`).join(" ");
}

/** 命令行 → 表态。今天有三枚旗标能改口：`--no-auto-verify`（**摘掉**缺省装着的闸＝对照臂）、
 *  `--auto-verify`（显式说装，与缺省同义，留着是为了旧写法与脚本不必一起改）、
 *  `--auto-verify-repair`（红了一拍之后再要一轮：产品缺省关，装了就是"这副读数不是产品缺省态"）。
 *  为什么单独成函数（而不是跑器里内联三元）：这样「带哪枚旗标 ⇒ 表怎么说」能在**零花费**下判；
 *  真跑一趟量收益要花真钱，而那一步归用户裁。
 *  配对规则只在这里判一次：返修那一枚**没有闸就没有对象**。闸现在缺省就装，
 *  所以"有没有对象"只看 `--no-auto-verify` 这一枚——跑器那边只负责把"被忽略"说出来，不再自己判一遍。 */
export function assemblyOverrides(
  autoVerify: boolean,
  autoVerifyRepair: boolean = false,
  noAutoVerify: boolean = false,
): KnobOverrides {
  const out: Record<string, BenchDeclaration> = {};
  if (noAutoVerify) {
    out.autoVerify = {
      face: "off-here",
      why: "本趟带 --no-auto-verify ⇒ 把缺省装着的收束闸摘掉；这一臂是对照臂，读数不许引用成产品缺省态",
    };
  } else if (autoVerify) {
    out.autoVerify = { face: "same", why: "本趟显式带 --auto-verify ⇒ 与缺省同档（旧写法保留，不改行为）" };
  }
  if (!noAutoVerify && autoVerifyRepair) {
    out.autoVerifyRepair = {
      face: "on-here",
      why: "产品缺省关（settings 的 autoVerifyRepair=false），本趟带 --auto-verify-repair ⇒ 这副读数是对照臂，不是产品缺省态",
    };
  }
  return out;
}

/** 由装配表**投影**出递给 `runLoop` 的键：只有表里说 `same`/`on-here` 的才真装进跑器。
 *
 *  方向必须是「表 → 参数」，不能反过来。如果读数行里的表态和真正递出去的参数各算一次，
 *  表就退化成注释——`autoVerifyBeat` 在盘上 49 趟全是 false，缺的正是"表说装了、参数里得真装着"这一层。
 *  今天只投影这两枚：其余表里的键（`impactAnalysis`/`promptCache`/`autoMemory`/`subagentTools`）
 *  在本跑器上没有对应的 `runLoop` 形参，投影出来就是凭空造一个没人读的键。 */
export function runLoopKnobsFromAssembly(rows: readonly AssemblyRow[]): { autoVerify?: true; autoVerifyRepair?: true } {
  const installed = (key: string): boolean =>
    rows.some((r) => r.key === key && (r.face === "same" || r.face === "on-here"));
  const autoVerify = installed("autoVerify");
  return {
    ...(autoVerify ? { autoVerify: true as const } : {}),
    // 第二道配对保护：表如果说 `autoVerifyRepair` 装了而闸没装，那是表的输入自相矛盾 ⇒ 宁可不装（fail-closed）。
    ...(autoVerify && installed("autoVerifyRepair") ? { autoVerifyRepair: true as const } : {}),
  };
}
