// 模型面（每请求固定成本）总预算。
//
// 「模型面」= 每一轮请求都要重送、且与本轮任务无关的那一坨：基础系统提示 + 工具规格 JSON。
// 装配探针把这一层叫 `cacheableBytes`（`src/agent/gym/probe.ts` 的分层按可缓存性切的），
// 本模块沿同一口径记账，不另起第二套层名。
//
// 为什么值得单独立一层：这一族的其他成员各有自己的帽（记忆 `MEMORY_TOKEN_BUDGET_DEFAULT`、
// skill 重挂 `SKILL_REMOUNT_TOKENS_TOTAL`、hook 上下文 `HOOK_CONTEXT_TOTAL_CHAR_LIMIT`、
// 单条 MCP 描述 `MCP_DESCRIPTION_CHAR_LIMIT`），**唯独模型面没有总闸**——MCP 工具是一条裸
// `specs.push`（`src/agent/glm-session.ts` 的 `sessionToolSpecs`）。逐件有帽、总和无人记账，
// 是同一族缺陷的形状：装三个话痨 server 就能把每轮固定成本抬高一个数量级，而没有任何一处会红。
//
// ⚠️ **口径更正（2026-10-03）**：本模块的帽只管**固定面**（`systemChars` + 工具 JSON），
// **不管易变侧**（记忆 / skills 块 / 符号地图 / 附件引用）。`SurfaceBudgetInput.volatileChars`
// 是给调用方的口子，但**生产调用点不传**（`glm-session.ts` 的 `planSurfaceBudget({specs, systemChars, coreNames})`）
// ⇒ 它恒为 0、`totalChars === fixedChars`，是一个恒等的装饰字段。此前本文件的注释与
// `MODEL_SURFACE_TOTAL_CHAR_LIMIT` 的文档都声称这顶帽管「固定面加易变 system 块的字符和」，
// 与实参不符——注释已按实参改写。
//
// **不把易变侧接进判定是有理由的，不是漏了**：
// ① 压缩那侧的开销估算（`AssemblyOverhead.toolSchemaChars`）要消费**降配后**的 tools
//    ⇒ 降配必须排在压缩判定之前；而压缩会重建 skills 块与地图，其真值要到降配之后才知道。
//    要「降配看得见易变侧」就得先解开这个循环，解不开。
// ② 即便解开了，梯级 A/B 的手段只有「压描述」与「丢工具」——**对记忆/skills 块一个字节都削不掉**，
//    只会因为记忆太大而误伤工具面。真正对得上手段的是渐进披露（按需装载），那是另一件事。
// ③ 易变侧另有两把**全量**的账在管它：压缩预算 `AssemblyOverhead`（含 skillsBlock /
//    memoryChars / mapChars / attachmentContext）与最终 fail-closed 硬闸 `finalChars`。
//    所以这不是「默默超支」，而是**最便宜的那把刀在压力真正来处永远拔不出来**。
// 易变侧仍然**可观测**：`surface_account` 事件的 `volatileChars` 及四个分项照实记（口径见
// `src/events/index.ts`）；本文件的 `ModelSurfaceAccount.volatileChars` 则保留给未来的
// 纯记账用途，**不得**在不重跑 MS1–MS6 基准的前提下被喂进 `fits()`。
//
// 单位一律字符（本仓定稿：`estimateTextTokens` 的 chars/4 英文口径对中文低估 3–4 倍，
// 帽以字符登记、断言锁字符数，见 docs/superpowers/specs/2026-09-19-orchestration-design.md）。
import type { GlmToolSpec } from "../providers/glm";

/** 池子上限：**固定面**（基础提示 + 工具 JSON）的字符数。
 *  取值口径：本仓缺省档固定面实测约 8.8k 字符 ⇒ 留约 2.7 倍余量——「装一个中等 MCP server
 *  不该碰到闸，装三个必碰到」。行业侧对照读数：工具定义到约 10k token 就该改为按需装载，
 *  50–70k token 是已知的失败区（见 outputs/model-surface-budget-2026-09-23/00-调研综述.md）。
 *
 *  **不含易变侧**：记忆 / skills 块 / 符号地图 / 附件引用各有自己的硬帽，见文件头口径更正。 */
export const MODEL_SURFACE_TOTAL_CHAR_LIMIT = 24_000;

/** 梯级 A 的紧帽：超预算时把可降档工具的描述压到这里。
 *  比 `MCP_DESCRIPTION_CHAR_LIMIT`（2048，装载期守住的单条上限）更狠，因为它只在**池子已满**时生效。 */
export const MODEL_SURFACE_TIGHT_DESC_CHAR_CAP = 600;

/** 一条工具规格在降配梯上的身份。 */
export type SurfaceTier =
  /** 基础工具表（`gateToolSpecs`）：梯级永不碰它。砍掉 `edit_file` 的后果是「agent 不会做事了」，
   *  不是「贵一点」，所以真装不下时要人来裁决——`unresolvable` 是合法终态。 */
  | "core"
  /** harness 自己注入、但被别处依赖（skill 调用 / 观测回取 / 影响面查询）：可压描述，最后才被丢。 */
  | "pinned"
  /** 插件与 MCP 带来的工具：可压描述、可从尾部整条丢。 */
  | "optional";

export const PINNED_SURFACE_TOOLS: ReadonlySet<string> = new Set(["skill", "obs_recall", "impact_query"]);

/** core 的身份由调用方交给它（`gateToolSpecs()` 的名字集），本模块不另抄一份工具表——
 *  抄了就是一处「规格与实现两处手写」，正是本仓的缺陷族。 */
export function surfaceTierOf(name: string, coreNames: ReadonlySet<string>): SurfaceTier {
  if (coreNames.has(name)) return "core";
  if (PINNED_SURFACE_TOOLS.has(name)) return "pinned";
  return "optional";
}

export interface SurfacePieceAccount {
  name: string;
  chars: number;
  tier: SurfaceTier | "system";
}

/** 一张账，不是一道闸：固定面逐件 + 易变块合计。降配判定读它，面板与 CLI 也读它。 */
export interface ModelSurfaceAccount {
  systemChars: number;
  toolSpecChars: number;
  fixedChars: number;
  /** 易变 system 块（记忆 / skills / 地图）。本模块不降它——它们各有自己的帽——只如实计入总账。 */
  volatileChars: number;
  totalChars: number;
  limitChars: number;
  overChars: number;
  /** 按字符降序：「砍谁最省，读这张表而不是猜」（与 `rankToolSpecs` 同一诉求）。 */
  pieces: SurfacePieceAccount[];
}

export function surfaceSpecChars(specs: readonly GlmToolSpec[]): number {
  return JSON.stringify(specs).length;
}

export interface SurfaceBudgetInput {
  systemChars: number;
  specs: readonly GlmToolSpec[];
  /** core 判定的权威来源：`new Set(gateToolSpecs(mode).map(s => s.function.name))`。 */
  coreNames: ReadonlySet<string>;
  volatileChars?: number;
  limitChars?: number;
}

export function accountModelSurface(input: SurfaceBudgetInput): ModelSurfaceAccount {
  const toolSpecChars = surfaceSpecChars(input.specs);
  const fixedChars = input.systemChars + toolSpecChars;
  const volatileChars = input.volatileChars ?? 0;
  const limitChars = input.limitChars ?? MODEL_SURFACE_TOTAL_CHAR_LIMIT;
  const pieces: SurfacePieceAccount[] = [
    { name: "system:base", chars: input.systemChars, tier: "system" },
    ...input.specs.map((s, i) => ({
      name: s.function.name,
      // 数组的方括号与逗号按位置计入首/末项 ⇒ 逐件相加恰等于序列化总数
      // （与 `rankToolSpecs` 同一手法：排行对得上账，才敢拿它决定砍谁）。
      chars: JSON.stringify(s).length +
        (i === 0 ? 1 : 0) +
        (i === input.specs.length - 1 ? 1 : 0) +
        (i < input.specs.length - 1 ? 1 : 0),
      tier: surfaceTierOf(s.function.name, input.coreNames),
    })),
  ];
  const totalChars = fixedChars + volatileChars;
  return {
    systemChars: input.systemChars,
    toolSpecChars,
    fixedChars,
    volatileChars,
    totalChars,
    limitChars,
    overChars: Math.max(0, totalChars - limitChars),
    pieces: pieces.sort((a, b) => b.chars - a.chars),
  };
}

export interface SurfacePlan<T extends GlmToolSpec = GlmToolSpec> {
  /** 送出去的那份。未超预算时与入参**逐字一致**（零回归支，测例锁的就是这一条）。 */
  specs: T[];
  account: ModelSurfaceAccount;
  /** 被压描述的工具名（数组序）。 */
  shortened: string[];
  /** 被整条丢弃的工具名（丢弃序 = 从尾向前的顺序）。 */
  dropped: string[];
  /** true ⇒ 降配梯走完仍超预算。此时**不**自动砍 core，只如实报红。 */
  unresolvable: boolean;
  /** 要贴给模型的那句话（与 skill 摘除 / hook 预算同一族纪律：省了谁必须说出去）。 */
  note: string;
  /** 与未降配版逐字符比对的「仍然可缓存的前缀字符数」——梯级 A 的代价就记在这里。 */
  prefixStableChars: number;
}

function capDescription(text: string, cap: number): string {
  if (text.length <= cap) return text;
  const lineEnd = text.lastIndexOf("\n", cap);
  const cut = lineEnd > Math.floor(cap * 0.5) ? lineEnd : cap;
  return text.slice(0, cut) + " …[模型面预算紧帽：描述已截断]";
}

/**
 * 降配梯（唯一实现点）：先降描述，再从尾部整条丢。
 *
 * 两条不显然的规矩，各由一个外部事实逼出来：
 * 1. **只从数组尾部丢，绝不中间摘**。缓存按前缀命中（顺序 tools → system → messages，上游任一
 *    变化会把它之后全部重写、写价 1.25×），中间摘一把就把它之后所有条目的缓存打掉；尾丢保住的
 *    前缀最长。这同时钉住了工具表的构造顺序（core 在前、plugin 在后）——那条不变量由
 *    `model-surface-check` 守，一旦破了本函数就变成在砍 core。
 * 2. **core 永不被自动砍**。池子装满时砍掉 `edit_file` / `verify` 换来的是「便宜的废会话」，
 *    比贵更坏。走到这一步报 `unresolvable`，由人降 MCP 装载或抬帽。
 */
export function planSurfaceBudget<T extends GlmToolSpec = GlmToolSpec>(
  input: SurfaceBudgetInput & { tightDescCapChars?: number },
): SurfacePlan<T> {
  const limitChars = input.limitChars ?? MODEL_SURFACE_TOTAL_CHAR_LIMIT;
  const tightCap = input.tightDescCapChars ?? MODEL_SURFACE_TIGHT_DESC_CHAR_CAP;
  const volatileChars = input.volatileChars ?? 0;
  const account = accountModelSurface({ ...input, limitChars, volatileChars });
  const fits = (specs: readonly T[]) =>
    input.systemChars + surfaceSpecChars(specs) + volatileChars <= limitChars;

  const originalSerialized = JSON.stringify(input.specs);
  // 这一支是**快路径**而非语义分支：梯级对未超帽输入本来就是 no-op（丢不动、压不着、note 为空）。
  // 留着它只为每轮少两次全量序列化——别为它造变异针脚（实测那条会存活，见 mutate-verify 的 ms-* 注记）。
  if (account.totalChars <= limitChars) {
    return {
      specs: [...input.specs] as T[],
      account,
      shortened: [],
      dropped: [],
      unresolvable: false,
      note: "",
      prefixStableChars: originalSerialized.length,
    };
  }

  // 梯级 A：可降档工具的描述压到紧帽；core 的描述一字不动（描述即行为契约）。
  const shortened: string[] = [];
  const tightened = input.specs.map((s) => {
    const name = s.function.name;
    if (surfaceTierOf(name, input.coreNames) === "core") return s as T;
    const desc = s.function.description ?? "";
    if (desc.length <= tightCap) return s as T;
    shortened.push(name);
    // 只换 description，其余字段整体保留 —— 结构上仍是同一种 T。
    return { ...s, function: { ...s.function, description: capDescription(desc, tightCap) } } as T;
  });

  // 梯级 B：从尾向前整条丢。optional 丢光再丢 pinned；core 不动。
  const working: T[] = [...tightened];
  const dropped: string[] = [];
  const dropTailOfTier = (tier: SurfaceTier) => {
    while (!fits(working)) {
      let cut = -1;
      for (let i = working.length - 1; i >= 0; i--) {
        if (surfaceTierOf(working[i]!.function.name, input.coreNames) === tier) {
          cut = i;
          break;
        }
      }
      if (cut < 0) return;
      dropped.push(working[cut]!.function.name);
      working.splice(cut, 1);
    }
  };
  dropTailOfTier("optional");
  if (!fits(working)) dropTailOfTier("pinned");
  const unresolvable = !fits(working);

  let prefix = 0;
  const after = JSON.stringify(working);
  const shared = Math.min(originalSerialized.length, after.length);
  while (prefix < shared && originalSerialized[prefix] === after[prefix]) prefix++;

  return {
    specs: working,
    account,
    shortened,
    dropped,
    unresolvable,
    note: surfaceNote({
      limitChars,
      shortened,
      dropped,
      unresolvable,
      tightCap,
      overChars: account.overChars,
    }),
    prefixStableChars: prefix,
  };
}

/** 如实说出去：省了谁、为什么、怎么拿回来。缺这一段就等于让模型自己猜哪把工具没了
 *  （`sessionToolSpecs` 里 skill 摘除那句 note 是先例）。 */
export function surfaceNote(parts: {
  limitChars: number;
  shortened: readonly string[];
  dropped: readonly string[];
  unresolvable: boolean;
  tightCap: number;
  overChars: number;
}): string {
  if (parts.shortened.length === 0 && parts.dropped.length === 0 && !parts.unresolvable) return "";
  const bits: string[] = [];
  if (parts.dropped.length > 0) {
    bits.push(
      "已整条移出可见工具表 " + String(parts.dropped.length) + " 把（" + parts.dropped.join("、") + "）" +
        "——它们本轮**不可调用**，需要它请在设置里减少启用的 MCP server/工具后重开；不要反复尝试调用",
    );
  }
  if (parts.shortened.length > 0) {
    bits.push("已把 " + String(parts.shortened.length) + " 把工具的描述压到 " + String(parts.tightCap) + " 字符");
  }
  if (parts.unresolvable) {
    bits.push("降配已走完仍超 " + String(parts.overChars) + " 字符：超出的部分在基础工具表里，需要人工裁决，harness 不自动砍");
  }
  return "[模型面预算 " + String(parts.limitChars) + " 字符已满（本轮超出 " + String(parts.overChars) + " 字符）] " + bits.join("；") + "。";
}

/** 门与测例的反向对照用料：一条话痨 MCP server 必把池子撑破
 *  （§2.3 原判据：「加一个话痨 MCP server 必红」）。描述用 CJK，避开 chars/4 的乐观口径。 */
export function chattyMcpFixture(toolCount: number, descChars: number): GlmToolSpec[] {
  return Array.from({ length: toolCount }, (_, i) => ({
    type: "function" as const,
    function: {
      name: "mcp__chatty__tool_" + String(i),
      description: "描".repeat(Math.max(1, Math.ceil(descChars / 3))),
      parameters: { type: "object", properties: { input: { type: "string" } } },
    },
  }));
}
