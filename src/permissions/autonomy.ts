// M1c 评估管线（§11.7.1）：纯函数 evaluate(tool, args, session)，四层固定序、先命中先短路：
//   L0 硬边界（只读档摘除 + M1b 方案门，deny 位次最前——摘除的工具规则库不能复活）
//   → L1 deny 规则 → L2 ask 规则（任何档位含自主档都绕不过）
//   → L3 档位层（规则库 allow 命中放行 / session_kind 记忆 / 逐次审批）
//   → L4 风险层（三通道，critical 任何档强制审批——allow 规则也批不掉 critical）。
// 零私有状态：规则库与放行集是仅有的两个输入源；断路器计数在 session 入参里，evaluate 只读不写
// （调用方经 note* helper 更新）——同一输入两次调用结果一致。
import { FROZEN_TABLE_REL } from "../frozen";
import { TOOL_NAMES, type ToolName } from "../tools/base";
import type { PermissionMode } from "./index";
// 方案门的活判据。直接从 plan-state 拿（不能拿 ./index——index 正 re-export 本文件的符号）。
import { planGateLive } from "./plan-state";
import { judgeChain, normalizeCommand, type ChainVerdict, type PermissionRule } from "./rules";
import {
  isNetworkCommand,
  isShellFamily,
  maxRisk,
  modelRisk,
  RISK_ORDER,
  sandboxRisk,
  staticRisk,
  type RiskFinding,
  type RiskLevel,
} from "./risk";

/** 判据层 = **决定这次判果的那条判据**（不是代码行号：行号会漂，判据名不会）。
 *  L3-mode 与 L4-* 的分工：前者是「档位规定要问人」，后者是「风险/注解/网络把本来能放的抬成了要问」。
 *  新增一层必须同时在 tests/gate-audit.test.ts 的用例表里给它一条，否则穷尽断言红。 */
export const GATE_LAYERS = [
  "L0-hard", "L1-deny", "L2-ask-rule",
  "L3-rule", "L3-scope", "L3-mode",
  "L4-critical", "L4-risk", "L4-mcp-unannotated", "L4-network", "L4-pass",
  // `X-` = 判定发生在 `evaluate` **之外**的那一面（今天只有会话末沉淀轮：工具白名单 + 合并审批）。
  // 单列一层而不是借 `L3-mode` / `L2-ask-rule` 的名字：借名会把"一次问答覆盖整轮"的量混进逐次审批的
  // 分母里，而 §7 第 2 步的免批率与 ECE 恰好是按 `layer × verdict` 逐格算的。
  "X-distill",
] as const;

export type GateLayer = (typeof GATE_LAYERS)[number];

/** 人工/自动结果的枚举（唯一事实源；`GateMeta.verdict` 由它派生）。
 *  复跑面 `scripts/replay/gate-outcomes.ts` 要按 `layer × verdict` 铺全矩阵——
 *  没有这只运行时数组，它就会在新增一种结果时**静默少一列**（读数看着完整，其实漏计）。 */
export const GATE_VERDICTS = ["auto-approved", "approved", "rejected", "timeout", "unattended", "denied"] as const;
export type GateVerdict = (typeof GATE_VERDICTS)[number];

/** 一次权限判定的完整留痕（进 tool_result.gate）。有了它，「当时判了什么、人怎么答的」
 *  才能从事件流回放——这条留痕就是为了第 3 步要的正例（人拒了几次）；
 *  读数面：`scripts/replay/gate-outcomes.ts`。 */
export interface GateMeta {
  layer: GateLayer;
  /** auto-approved = 没问人；approved = 问过且人批了；rejected / timeout / unattended = 问过没成；
   *  denied = 门直接拦（未执行）。 */
  verdict: GateVerdict;
  /** deny 分支缺席：那三条硬边界在风险层**之前**短路，当时并没有算过风险。缺字段比编一个值诚实。 */
  risk?: RiskLevel;
  /** 当时生效的档位。`evaluate` 一侧**必带**（构造口 `gateBase` 要求入参，判卷另钉一条"gateBase 的产物必带 mode"）；
   *  档位机之外的判定（`X-distill`）没有档位可言 ⇒ **宁缺不编**：编一个就等于把不受档位管的量算进该档的免批率。 */
  mode?: PermissionMode;
  /** 人工批准时人选的 scope（§10.4）；自动放行与被拦缺席。 */
  scope?: AskScope;
  /** 命中的规则 id 或 scopeKey（只有 L3-rule / L3-scope 有）。 */
  ruleId?: string;
}

/** 自动放行来源审计（§11.7.5）：**由 gate 派生**，语义与历史逐字一致——只有规则库 allow 与
 *  scope 记忆两种放行记 auto；末行放行、人工批准、拒绝一律不记。留痕统一由 gate 承担。 */
export interface AutoMeta {
  source: "rule" | "session_scope";
  ruleId?: string;
}

export function autoOf(gate: GateMeta | undefined): AutoMeta | undefined {
  if (gate === undefined || gate.verdict !== "auto-approved") return undefined;
  if (gate.layer === "L3-rule") return { source: "rule", ...(gate.ruleId !== undefined ? { ruleId: gate.ruleId } : {}) };
  if (gate.layer === "L3-scope") return { source: "session_scope", ...(gate.ruleId !== undefined ? { ruleId: gate.ruleId } : {}) };
  return undefined;
}

/** 规则层拒绝 / 出卡那一句理由（L1-deny 与 L2-ask 共用一个构造口，免得两处的边界说明各写各的又漂）。
 *  卡面必须说得出**禁的是哪一段**与**按什么匹配**：09-22 那条过覆盖裁决的教训是
 *  `deny "git push --force"` 顺带禁掉 `--force-with-lease` 时，卡上只有一个 ruleId，
 *  用户既看不懂为什么被拦、也不知道该改哪条规则。 */
function ruleHitReason(
  kind: string,
  chain: Extract<ChainVerdict, { ruleId: string }>,
  note?: string,
): string {
  const boundary = chain.pattern !== undefined ? "——匹配按完整 token 为界" : "";
  return `${kind}（${chain.ruleId}）${boundary}${note !== undefined ? "；" + note : ""}`;
}

/** 判定留痕的公共部分（layer / risk / mode / ruleId）。**故意不含 verdict**——
 *  自动放行、人批、人拒、超时、无人值守这些结果只有持有审批结果的那一侧知道，
 *  由主会话 / MCP / worker 三处出口各自补上，共用同一个构造口免得三份各抄一遍又漂。 */
export function gateBase(d: EvaluateDecision, mode: PermissionMode): Omit<GateMeta, "verdict"> {
  const ruleId = d.verdict === "approve" ? d.auto?.ruleId : undefined;
  return {
    layer: d.layer,
    mode,
    ...("risk" in d ? { risk: d.risk } : {}),
    ...(ruleId !== undefined ? { ruleId } : {}),
  };
}

/** 带判定留痕的工具结果：gatedTool 附 gate，loop 透传进 tool_result 事件并由 autoOf 派生 auto。
 * ToolResult 本体在 src/tools（只读白名单外），故此处做结构扩展而非改动它。 */
export interface ToolResultWithAudit {
  ok: boolean;
  output: string;
  gate?: GateMeta;
}

export type EvaluateDecision =
  | { verdict: "approve"; risk: RiskLevel; layer: GateLayer; auto?: AutoMeta }
  | { verdict: "ask"; reason: string; risk: RiskLevel; riskReasons: string[]; layer: GateLayer }
  | { verdict: "deny"; reason: string; layer: GateLayer };

/** 审批 scope 三档（§10.4 回写 / §11.7.5）。 */
export type AskScope = "once" | "session_kind" | "always";

/** 会话内断路器阈值（§11.7.6）：连续自动放行上限 50。 */
export const MAX_AUTO_APPROVALS = 50;
/** critical 连续被拒 N 次 → 提示降档回默认。 */
export const CRITICAL_DENIAL_LIMIT = 3;

/** 一档的细档政策（§11.7.2 矩阵的行；粗档表在 permissions/index.ts）。
 *  三个字段各有一个「只有这一档在此格上给出不同答案」的判卷用例，见
 *  `tests/permission-mode-guided.test.ts`。
 *  为什么是表不是 if 链：旧写法是 `if (s.mode === "default") … if (s.mode === "auto") …`，
 *  **表外值既不报错也不出卡**——它一路掉到风险层，静默拿到 auto 的行为
 *  （2026-09-23 实测：造一个不存在的档位名，write_file 直接 L4-pass 放行）。
 *  `Record<PermissionMode, …>` 让"少一档"变成编译错误，运行时兜底再取默认档（fail-closed）。 */
export interface ModePolicy {
  /** 写向是否逐笔审批（default/read-only 是；guided/auto 否）。 */
  readonly writeAsk: boolean;
  /** 是否吃「本会话允许这类」的记忆快捷（auto 不吃：它本来就没有逐笔卡可跳，断路器因此零计数）。 */
  readonly scopeMemory: boolean;
  /** 风险层送审线。 */
  readonly riskAskAt: RiskLevel;
  /** 卡面文案里的档位名。 */
  readonly label: string;
}

const MODE_POLICY: Record<PermissionMode, ModePolicy> = {
  // 只读档的写向在 L0 就被摘除，这一行只兜住"写向漏到 L3"的路径（同默认档口径，不静默放行）。
  "read-only": { writeAsk: true, scopeMemory: true, riskAskAt: "high", label: "只读档" },
  default: { writeAsk: true, scopeMemory: true, riskAskAt: "high", label: "默认档" },
  guided: { writeAsk: false, scopeMemory: true, riskAskAt: "medium", label: "引导档" },
  auto: { writeAsk: false, scopeMemory: false, riskAskAt: "high", label: "自主档" },
};

/** 导出给对账判卷：表必须**恰好**覆盖 `PERMISSION_MODES`（少一档 = 编译不过 + 判卷红）。 */
export function modePolicyTable(): Record<PermissionMode, ModePolicy> {
  return { ...MODE_POLICY };
}

function policyOf(mode: PermissionMode): ModePolicy {
  // 类型内四档都已列表；走到兜底只可能是未升级的持久化值或外部构造者 ⇒ 按默认档，不按最松档。
  return MODE_POLICY[mode] ?? MODE_POLICY.default;
}

export interface AutonomySession {
  mode: PermissionMode;
  /** 两层规则库加载结果（deny/ask/allow 并集）。 */
  rules: PermissionRule[];
  /** session_kind 放行集：会话内存放行，不落盘。key = scopeKey()。 */
  sessionScopes: ReadonlySet<string>;
  /** 沙箱可用性：null = 未接线（不触发装不下通道）；false = 自检过但降级。 */
  sandboxAvailable: boolean | null;
  /** 方案门（M1b）：**活委托**，不是快照也不是镜像布尔。缺省挂 planGateLive() ⇒ 任何执行体
   *  （主会话 / worker / 级联）在每次 evaluate 时读当前异步上下文的 plan 态。
   *  上一版是 `planBlocked: boolean` 由调用方每次 evaluate 前刷新，而刷新只接在主会话三处——
   *  worker 那条路从不刷，于是「先批后写」对 spawn 出的 worker 整条失效（评审 C6）。
   *  判据仍归 evaluate 只读；测试可注入 `() => true/false` 保持同一输入两次调用结果一致。 */
  planBlocked: () => boolean;
  /** 判卷面硬闸（L0）：冻结表声明的判卷文件集合（`frozenJudgePathSet(workspace)`）。
   *  空集 = 该工作区没声明判卷面 ⇒ 零行为（用户自己的仓库不被我们的判卷纪律约束）。 */
  frozenJudgePaths: ReadonlySet<string>;
  /** 断路器：会话内连续 scope 自动放行计数（调用方维护）。 */
  consecutiveAutoApprovals: number;
  breakerTripped: boolean;
  consecutiveCriticalDenials: number;
}

export function newAutonomySession(
  mode: PermissionMode,
  init: {
    rules?: PermissionRule[];
    sessionScopes?: Set<string>;
    sandboxAvailable?: boolean | null;
    planBlocked?: () => boolean;
    frozenJudgePaths?: ReadonlySet<string>;
  } = {},
): AutonomySession {
  return {
    mode,
    rules: init.rules ?? [],
    sessionScopes: init.sessionScopes ?? new Set<string>(),
    sandboxAvailable: init.sandboxAvailable ?? null,
    planBlocked: init.planBlocked ?? planGateLive,
    frozenJudgePaths: init.frozenJudgePaths ?? NO_JUDGE_SURFACE,
    consecutiveAutoApprovals: 0,
    breakerTripped: false,
    consecutiveCriticalDenials: 0,
  };
}

/** 写向工具（含 shell 写面）：只读档摘除、方案门、沙箱通道按此判定。
 *  注：shell_ro 是静态白名单只读面，**不算**写向——否则只读档会把 worker 的只读 shell 一并摘掉；
 *  shell_rw 可执行任意非 git 命令，必须计入写向（否则沙箱降级通道对它整体失效）。 */
const SIDE_EFFECT_TOOLS: ReadonlySet<string> = new Set([
  "write_file",
  "edit_file",
  "run_shell",
  "shell_rw",
  // 派生 worker 会写盘且花真钱（并发预算 + token 代价）：计入写向 ⇒ 只读档从模型面一并摘除。
  // 派生本身的审批在 orchestrator 按风险分级出卡（租约相交 / pipeline / supervise / merge）。
  // 变异锚点：删掉本行 ⇒ session-tools「只读档随写向工具一并摘除」必红（实测）。
  "spawn_agent",
]);

export function isSideEffectTool(tool: string): boolean {
  return SIDE_EFFECT_TOOLS.has(tool);
}

/** scope 记忆键：shell 类按归一化命令全串（出网审计粒度），其余按工具级（「此类」语义）。
 *  键里保留字面工具名——主会话 run_shell 与 worker shell_rw/shell_ro 的放行集不互相串门。 */
export function scopeKey(tool: ToolName, args: Record<string, unknown>): string {
  if (isShellFamily(tool) && typeof args.command === "string") {
    return tool + "\u241F" + normalizeCommand(args.command);
  }
  return tool + "\u241F*";
}

export function isNetworkCommandCall(tool: ToolName, args: Record<string, unknown>): boolean {
  if (!isShellFamily(tool)) return false;
  return isNetworkCommand(typeof args.command === "string" ? args.command : undefined);
}

interface RiskChannels {
  risk: RiskLevel;
  reasons: string[];
}

/** §11.7.2「MCP 工具」那一行的输入：server 在 tools/list 里自带的注解。
 *  `annotated` = server **给过** annotations 对象（哪怕只给了 title）；没给 = 无注解 ⇒ 按写处理，
 *  而且自主档也不自动放行——表里豁免的是"写注解"，不是"什么都没标"。 */
export interface McpGrade {
  annotated: boolean;
  readOnly?: boolean;
  destructive?: boolean;
}

/** 第四风险通道：注解。destructiveHint 是 server 自己声明"会破坏远端状态" ⇒ high，
 *  自主档也要送审（§11.7.2 自主列的"risk≥high 送审"）。 */
export function annotationRisk(mcp?: McpGrade): RiskFinding | null {
  return mcp?.destructive === true ? { level: "high", reason: "MCP destructiveHint=true（注解通道）" } : null;
}

/** MCP scoped 注册名（`mcp__plugin_<p>_<s>__<t>` 与 `mcp__<server>__<t>` 两种形态都算）。 */
export function isMcpScopedName(name: string): boolean {
  return name.startsWith("mcp__");
}

/** 这次调用算不算写向：MCP 只有 server 自己标了 readOnlyHint 才算读（fail-closed），
 *  其余（写注解 / 无注解 / 注解里根本没有 readOnly 字段）都按写管；非 MCP 走静态写向表。
 *  入参是 `string` 而非 `ToolName`：MCP 的 scoped 名不在那个联合里，规格面按名判时也拿的是裸名。 */
export function isWriteCall(tool: string, mcp?: McpGrade): boolean {
  if (mcp === undefined) return isSideEffectTool(tool);
  return !(mcp.annotated && mcp.readOnly === true);
}

/** 空判卷面（缺省值）：共享一个实例，省掉每次 new Set 的分配。 */
const NO_JUDGE_SURFACE: ReadonlySet<string> = new Set<string>();

/** 调用参数里的目标路径 → 工作区相对的 posix 串。
 *  返回 null = 不归本闸管：非字符串 / 空 / 绝对路径 / 带 `..`（那些落在工作区外，
 *  冻结表的键是工作区相对路径，拿它们去查集合只会得到假阴性——不如显式不判，
 *  越界写另有路径校验那一层管）。 */
function judgeTargetPathOf(args: Record<string, unknown>): string | null {
  const p = args.path;
  if (typeof p !== "string" || p === "") return null;
  const rel = p.split("\\").join("/").replace(/^\.\//, "");
  if (rel.startsWith("/") || rel.split("/").includes("..")) return null;
  return rel;
}

function collectRisk(
  tool: ToolName,
  args: Record<string, unknown>,
  s: AutonomySession,
  mcp?: McpGrade,
): RiskChannels {
  const ann = annotationRisk(mcp);
  const findings: (RiskFinding | null)[] = [
    staticRisk(tool, args),
    modelRisk(args),
    // 沙箱通道仍按静态表判：它说的是「本仓 Seatbelt 罩不住的本地写面」，MCP 调用根本不经过那层，
    // 无注解的 MCP 写在下面 L0/档位层按写处理（不是靠这条通道抬风险）。
    sandboxRisk(s.sandboxAvailable, tool, isSideEffectTool(tool)),
    ann,
  ];
  let risk: RiskLevel = "none";
  const reasons: string[] = [];
  for (const f of findings) {
    if (f === null || f.level === "none") continue;
    risk = maxRisk(risk, f.level);
    reasons.push(f.reason);
  }
  return { risk, reasons };
}

/** 四层评估管线（纯函数，先命中先短路）。
 *  `mcp` = 该工具的 MCP 注解（非 MCP 调用不传）；§11.7.2 的 MCP 那一行没有别的输入源。 */
export function evaluate(
  tool: ToolName,
  args: Record<string, unknown>,
  s: AutonomySession,
  mcp?: McpGrade,
): EvaluateDecision {
  const cmd = isShellFamily(tool) && typeof args.command === "string" ? args.command : undefined;
  // 名字带 `mcp__` 就是 MCP 调用：调用方没递注解时**按无注解处理**（写向、fail-closed）。
  // 把"少传一个参数"读成"这不是 MCP"，等于把本次要修的洞换成另一种形状再埋一遍。
  const grade: McpGrade | undefined = isMcpScopedName(tool) ? (mcp ?? { annotated: false }) : undefined;
  const channels = collectRisk(tool, args, s, grade);
  const risk = channels.risk;

  // ---- L0 硬边界：只读档摘除（规则库不能复活被摘除的工具）+ 方案门（M1b 写禁）----
  if (s.mode === "read-only" && isWriteCall(tool, grade)) {
    return {
      verdict: "deny",
      layer: "L0-hard",
      reason: grade === undefined ? "只读档摘除写向工具" : "只读档只放行带 readOnlyHint 注解的 MCP 工具（§11.7.2 只读注解白名单）",
    };
  }
  // 方案门同样按「写向」的统一口径判：一个 allow 规则能复活未批 plan 期间的 MCP 写调用，
  // 却复活不了 write_file——同一轮里两种口径就是这条规则的漏洞形状。
  if (s.planBlocked() && isWriteCall(tool, grade)) {
    return {
      verdict: "deny",
      layer: "L0-hard",
      reason:
        grade === undefined
          ? "方案门：先批后写（当前没有已批准的方案）"
          : "方案门：先批后写（当前没有已批准的方案；MCP 未标 readOnlyHint 按写处理）",
    };
  }

  // ---- L0 判卷面：冻结表点名的文件，任何档位、任何 allow 规则都写不了 ----
  // 放在 deny/ask/allow 之前与只读档、方案门同层，理由是同一条：**规则库不许复活被硬闸摘掉的动作**。
  // 真模型评测实测到模型会改 `tests/todo.test.ts`（`BASE_SYSTEM` 纪律 6 明文禁止却没拦住），
  // ⇒ 判卷面的完整性不能靠提示词自觉。
  if (s.frozenJudgePaths.size > 0 && isWriteCall(tool, grade)) {
    const target = judgeTargetPathOf(args);
    if (target !== null && s.frozenJudgePaths.has(target)) {
      return {
        verdict: "deny",
        layer: "L0-hard",
        reason:
          `判卷文件冻结：${target}（sha256 基线在 ${FROZEN_TABLE_REL}）` +
          "——判据有缺陷请写 BLOCKED.md 要求换判据，不许改代码去绕",
      };
    }
  }

  // ---- L1 deny 规则：命中即拦 ----
  const chain = judgeChain(s.rules, tool, cmd);
  if (chain.verdict === "deny") {
    return { verdict: "deny", layer: "L1-deny", reason: ruleHitReason("deny 规则命中", chain) };
  }

  // ---- L2 ask 规则：命中即强制审批，任何档位含自主档都绕不过 ----
  // 「总是允许」的前缀命中后还剩载荷（consentGap）也走这一层：决策根据同样是"规则层要问人"，
  // 只是命中的是 allow 条目的**同意范围**而不是某条 ask 规则，所以 reason 分开写。
  if (chain.verdict === "ask") {
    return {
      verdict: "ask",
      layer: "L2-ask-rule",
      reason:
        chain.consentGap === true
          ? `「总是允许」不覆盖这条命令的载荷（原规则 ${chain.ruleId}）`
          : chain.headBeyondKnown === true
            ? ruleHitReason("deny 命中但降为必问", chain, `命令首词「${chain.headToken ?? ""}」不在已知包装器表里，判不准它是包装器还是被输出的文本`)
            : ruleHitReason("ask 规则命中", chain),
      risk,
      riskReasons: channels.reasons,
    };
  }

  // ---- L3 档位层 ----
  // 规则库 allow 命中放行（§11.7.2 矩阵）；但 critical 任何档位强制审批，allow 规则也批不掉
  if (chain.verdict === "allow") {
    if (risk === "critical") {
      return {
        verdict: "ask",
        layer: "L4-critical",
        reason: "critical 任何档位强制审批（allow 规则不豁免）",
        risk,
        riskReasons: channels.reasons,
      };
    }
    return { verdict: "approve", layer: "L3-rule", risk, auto: { source: "rule", ruleId: chain.ruleId } };
  }
  const policy = policyOf(s.mode);
  // 断路器：凡吃 scope 记忆的档位，触发后一律退回逐次审批（§11.7.6「直至会话重开」）。
  // auto 不吃记忆 ⇒ 那条计数在 auto 永远不涨，本式对 auto 恒等于 policy.writeAsk。
  const askEachWrite = policy.writeAsk || (policy.scopeMemory && s.breakerTripped);
  if (isWriteCall(tool, grade)) {
    // 「本会话允许这类」在两档生效（默认档 / 引导档）：引导档的风险线以下本就直接放行，
    // 这条快捷存在的意义就是让**中风险**的那批（编辑、装包）也只问一次。
    const key = scopeKey(tool, args);
    // 单行不折：`autonomy-network-once` 锚点的针脚是这条表达式的一部分（拆行会把它顶成空操作）。
    const scopeAllowed = policy.scopeMemory && !s.breakerTripped && !isNetworkCommandCall(tool, args) && s.sessionScopes.has(key);
    if (scopeAllowed) {
      return { verdict: "approve", layer: "L3-scope", risk, auto: { source: "session_scope", ruleId: key } };
    }
    if (askEachWrite) {
      return {
        verdict: "ask",
        layer: "L3-mode",
        reason: s.breakerTripped
          ? `断路器触发：连续自动放行达 ${String(MAX_AUTO_APPROVALS)}，降级为逐次审批（直至会话重开）`
          : grade === undefined ? `${policy.label}逐次审批` : `${policy.label}逐次审批（MCP 未标 readOnlyHint）`,
        risk,
        riskReasons: channels.reasons,
      };
    }
  }

  // ---- L4 风险层：三通道任一命中即产生审批；critical 任何档位强制审批（自主档不是 bypass）----
  if (risk === "critical") {
    return { verdict: "ask", layer: "L4-critical", reason: "critical 任何档位强制审批", risk, riskReasons: channels.reasons };
  }
  // 出口顺序 = 今天的顺序（风险线在前、注解与网络在后），改顺序会让同一调用换一层，
  // askByLayer 读数与既有判据都会跟着动——本笔只换「哪条线」，不换「谁先答」。
  if (RISK_ORDER[risk] >= RISK_ORDER[policy.riskAskAt]) {
    return {
      verdict: "ask",
      layer: "L4-risk",
      reason: policy.writeAsk
        ? `风险≥${policy.riskAskAt} 送审`
        : `风险≥${policy.riskAskAt} 送审（${policy.label}）`,
      risk,
      riskReasons: channels.reasons,
    };
  }
  if (!policy.writeAsk) {
    const network = isNetworkCommandCall(tool, args);
    if (grade !== undefined && !grade.annotated) {
      // 表里自主/引导两列豁免的是"写注解"（server 明说了它是写），**什么都没标**不在豁免之列：
      // 让一个自报家门的 server 比沉默的 server 拿到更少审批，等于奖励不写注解。
      return {
        verdict: "ask",
        layer: "L4-mcp-unannotated",
        reason: `MCP 无注解：按写处理，${policy.label}亦逐次（§11.7.2 fail-closed）`,
        risk,
        riskReasons: channels.reasons,
      };
    }
    // 引导档的风险线已在 medium，网络命令在那之前就被上一条拦下了 ⇒ 这条出口服务的是自主档
    // （它的线是 high，出网审计要比一般动作严一级）。
    if (network && RISK_ORDER[risk] >= RISK_ORDER.medium) {
      return {
        verdict: "ask",
        layer: "L4-network",
        reason: "网络类命令 risk≥medium 送审（自主档，出网审计）",
        risk,
        riskReasons: channels.reasons,
      };
    }
  }

  return { verdict: "approve", layer: "L4-pass", risk };
}
// ---- 断路器 helper（调用方维护计数，evaluate 保持纯函数）----

/** scope 自动放行生效一次：计数 +1；达到上限即触发断路器（此后逐次审批，直至会话重开）。 */
export function noteScopeApproval(s: AutonomySession): void {
  s.consecutiveAutoApprovals += 1;
  if (s.consecutiveAutoApprovals >= MAX_AUTO_APPROVALS) s.breakerTripped = true;
}

/** 手工决议打断「连续」链（断路器计的是连续自动放行）。 */
export function noteManualDecision(s: AutonomySession): void {
  s.consecutiveAutoApprovals = 0;
}

export function noteCriticalDenial(s: AutonomySession): void {
  s.consecutiveCriticalDenials += 1;
}

export function noteCriticalResolved(s: AutonomySession): void {
  s.consecutiveCriticalDenials = 0;
}

/** critical 连续被拒达上限 → 降档提示（§11.7.6）。 */
export function downgradeSuggestion(s: AutonomySession): string | null {
  if (s.consecutiveCriticalDenials < CRITICAL_DENIAL_LIMIT) return null;
  return `critical 连续 ${String(s.consecutiveCriticalDenials)} 次被拒——建议降档回默认档`;
}

/** 模型可见工具表：只读档把写向工具摘除（§11.7.2，Claude bare-name deny 同构）。
 *  ⚠️ 覆盖范围**只有静态注册表那一组**（名单读 `TOOL_NAMES`，不再手抄第二份）；
 *  注入工具（`spawn_agent` / `remember` / 定时五件 / `cancel_agents` …）不在这里，
 *  它们的只读可达性由 `src/agent/tool-surface.ts` 声明、`tool-surface-parity` 拿真发货的
 *  `gateToolSpecs("read-only")` 逐行对账。原先这句写「与 gateToolSpecs 同源」是假的
 *  （实测面 20 把 / 表 10 把），而 `autonomy-check` 的只读断言读的是这张表 ⇒ 它证明的是静态子集。 */
export function toolTableFor(mode: PermissionMode): ToolName[] {
  const all: ToolName[] = [...TOOL_NAMES];
  if (mode === "read-only") {
    return all.filter((t) => !isSideEffectTool(t));
  }
  return all;
}
