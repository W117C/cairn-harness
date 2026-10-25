// 工具门 + 插件工具面（规格面/执行面同源）——拆分面（同 provider-key-inject 先例）：实现从
// agent-runner.ts 搬来本轻模块，装配根按原路径继续导出，调用方零改动。
//   · gatedTool / gatedMcpTool：写向与 MCP 工具的统一门（四档 + 方案门 + 安全模式 gate + always 落库）。
//   · installPluginTools：插件面装进统一注册表（skill + scoped MCP 名）。
//   · sessionToolFace / pluginToolSpecsFromRuntime：模型可见规格面（与执行面同源，同进同退）。
// 本模块不反向依赖装配根：它只需要「当前会话」（审批门 + 自治档）这一处活状态，按回调注入。
import { join } from "node:path";
import { mkdir, realpath } from "node:fs/promises";
import { createActionFusion } from "../agent/action-fusion";
import { AUTOMATION_TOOL_NAMES } from "../agent/automation-surface";
import { sessionToolSpecs, type SessionPluginTool } from "../agent/session-provider";
import { currentPluginRuntime, type PluginRuntime } from "../agent/plugins";
import { MCP_ACTIVE_TOOL_LIMIT, mcpServerKey, type McpToolInfo } from "../agent/plugins/mcp";
import { annotateExecCause } from "../agent/verify";
import {
  downgradeSuggestion,
  evaluate,
  gateBase,
  isNetworkCommandCall,
  isWriteCall,
  loadPermissionRules,
  newAutonomySession,
  noteCriticalDenial,
  noteCriticalResolved,
  noteManualDecision,
  noteScopeApproval,
  scopeKey,
  type AskScope,
  type GateMeta,
  type GateVerdict,
  type PermissionMode,
  type PermissionRule,
  type ToolResultWithAudit,
} from "../permissions";
import { alwaysRulesPath, globalPermissionsPath, savePermissionRules, splitCommandChain } from "../permissions/rules";
import type { GlmToolSpec } from "../providers/glm";
import { TOOLS, type Tool, type ToolResult } from "../tools";
import type { ToolContext, ToolName } from "../tools/base";
import type { AskGate } from "./ask-gate";
import { annotateNetworkDenial, buildSandboxProfile, networkProfileFor, runInSandbox, type SandboxStatus } from "./sandbox";
import { MODEL_SHELL_TEST_ALIASES, mapSandboxTestCommandForWorkspace } from "./sandbox-test-command";

/** 门评估所需的会话态。主会话从 run scope/全局活读；没有 run scope 的独立面（sidechat）
 *  可以**显式**带一份进来——见 `gatedTool` 的 `fixedSession` 与 `readOnlyGateSession`。 */
export interface GateSession {
  askGate: AskGate | null;
  autonomy: ReturnType<typeof newAutonomySession>;
  sandbox: SandboxStatus | null;
  actionFusion?: ReturnType<typeof createActionFusion>;
}

export interface ToolGateDeps {
  /** 会话审批/自治状态（活读；无会话 = null ⇒ 工具门 fail-closed）。 */
  currentSession: () => GateSession | null;
}

let deps: ToolGateDeps | null = null;
/** 装配根启动时注入（可重入：判卷 `vi.resetModules` 重组时按新装配根重注）。 */
export function setToolGateDeps(d: ToolGateDeps): void {
  deps = d;
}
function D(): ToolGateDeps {
  if (!deps) throw new Error("tool-gates: 装配根未注入依赖（唯一入口 setToolGateDeps）");
  return deps;
}

export function denied(name: ToolName | string, mode: PermissionMode, why: string, gate?: GateMeta): ToolResult {
  return {
    ok: false,
    output: "[permission denied] " + name + " 在 " + mode + " 档下被门拒绝（" + why + "）",
    ...(gate ? { gate } : {}),
  } as ToolResultWithAudit;
}

/** 审批没成的四种结局 → 模型可见的那句话。
 *
 *  为什么要分开（2026-10-16 桌面端真实会话读数）：三种结局此前都回「未获批准」，
 *  于是一次**审批等待超时**（用户根本没看到卡）被模型读成「auto 档默认禁止写文件」，
 *  接着它换 shell 试、问权限、把同一份内容重写三遍，最后把这条错误诊断写进了项目记忆。
 *  下一轮装配时它作为经验回注——一次超时就这样变成了永久能力限制。
 *
 *  三件事必须各自说得出：① 发生了什么（等 60s 没人答 / 无人值守自动拒 / 人明确说不）；
 *  ② **这个工具没有执行**（否则模型会以为写了没报成功，再去覆盖一次）；
 *  ③ 下一步允许做什么（等审批变化 / 换合规路径 / 先提方案），不然它只能靠猜。
 *  统一出口：`verdict` 已经落在 gate 结构里，这句话是它的**同源文字面**，不是第二份判据。 */
export function askDenialText(reason: "user" | "timeout" | "unattended" | undefined): string {
  switch (reason) {
    case "timeout":
      return "审批等待超时（无人应答即按拒绝收束）——该工具没有执行。"
        + "这是授权状态尚未变化，不是本档位禁止这个工具：等用户回应审批卡、或提高权限档位/显式放行后再试，"
        + "不要据此得出「此档位不能用这个工具」的结论，也不要换一个工具继续试探同一件事。";
    case "unattended":
      return "无人值守 fail-closed：这一轮没有任何人能回应审批，审批请求被立即拒绝——该工具没有执行。"
        + "这不是档位或策略禁止，是执行方式（无人值守）不允许等待人工；"
        + "改用非交互允许的路径，或等有人的会话再做这一步。";
    default:
      return "用户明确拒绝了这次审批——该工具没有执行。"
        + "下一步：换一条合规路径，或用 propose_plan 把要改的内容提成方案再请批准；"
        + "不要用相同参数重发同一个调用。";
  }
}

/** 审批没成的统一出口：`verdict` 与文字同一处派生（不在两处各判一次）。 */
export function deniedByAsk(
  name: ToolName | string,
  mode: PermissionMode,
  reason: "user" | "timeout" | "unattended" | undefined,
  gate?: GateMeta,
): ToolResult {
  return denied(name, mode, askDenialText(reason), gate);
}

/** §9.3 权限联动的**解释面**：某条已激活 skill 申报过 `allowed-tools` 里的这个工具，
 *  但按原话的收紧点（放行不得越过当前权限档位），这条申报**不给免批**。
 *  为什么不悄悄生效算了？——那正是「装载即陈列」的反面教材：字段收下了却不兑现，
 *  而这里连"不兑现"都要说清楚是谁申报的、为什么没放行（能力 8：可解释）。
 *  ⚠️ 反过来把它折成规则库的一条 allow 才是错的：规则库 allow 能顶掉档位的逐次审批，
 *  等于插件作者替用户扩权。两个门共用这一份实现。 */
export function withSkillAllowNote(tool: string, reason: string): string {
  const invo = currentPluginRuntime()?.skillAllowNote(tool) ?? null;
  return invo === null ? reason
    : reason + "（" + invo + " 的 allowed-tools 申报过 " + tool + "，但申报不放行：当前档位仍需确认）";
}

/** `web_fetch` 在这个字面量联合里而不在 `TOOL_NAMES` 里：静态注册表（M2 起 10 工具，
 *  `tools-check.ts` 判据）不含它，M2a 起的运行时注入先例不碰它。`name as ToolName` 与
 *  `staticRisk` 里 `(tool as string) === "web_fetch"` 是同一处类型缝的两面。
 *
 *  读侧三把（`read_file`/`grep`/`glob`）在 2026-10-20 接进来（此前主会话没包它们 ⇒
 *  路径通道的判据在主会话这条路上一次也没跑过）。它们在 `TOOL_NAMES` 里 ⇒ 直接列名即可。 */
type GatedName = "write_file" | "edit_file" | "apply_patch" | "run_shell" | "web_fetch" | "web_search" | "diagnose" | "lsp" | "render_image" | "read_file" | "grep" | "glob";

/** 审批卡上要**多显示**的字段（纯展示面；不改执行语义，也不改模型给的 args）。
 *
 *  为什么要它（2026-10-19 独立评审追出）：`web_search` 的**目的地不在模型给的 args 里**——
 *  端点来自工作区的 `.agent/config.json`，模型只递了 `{query}` ⇒ 审批卡上只有 `{"query":"…"}`，
 *  人不知道这次要把查询发到哪去 ⇒ 那次批准是**不知情**的。而这一格正好是出网面：
 *  一个克隆来的仓只要带一份 `.agent/config.json`（`search.endpoint` + `allowLocalEndpoint:true`），
 *  端点就能指向回环/内网/云元数据地址，而卡上**看不出这件事**。
 *  ⇒ 端点必须上卡，批准才是知情的。 */
export type CardExtra = (args: Record<string, unknown>, ctx: ToolContext) => Record<string, unknown>;

export function gatedTool(
  name: GatedName,
  original: Tool,
  beforeExecute?: () => Promise<ToolResult | null>,
  cardExtra?: CardExtra,
  /** 显式会话：只有**不经过 runAgent**的独立面（sidechat 只读旁路）才该给。
   *  给定时不读 run scope/全局会话——旁路不得借主会话的档位与审批门；主会话的所有调用点
   *  都省这一位（行为逐字不变）。 */
  fixedSession?: GateSession,
): Tool {
  return {
    name,
    async run(args, ctx) {
      const s = fixedSession ?? D().currentSession();
      if (!s) return denied(name, "default", "工具门未接线（fail-closed）");
      // 方案门不再每次刷进 session 入参：权限会话里那份是**活委托**（permissions/plan-state），
      // worker 与主会话读同一份——上一版只在这三处主会话路径刷新镜像，worker 那条路从不刷 ⇒ 先批后写可绕。
      // M1e 设置页「产出代码安全模式」最小语义（§11.6）：gate = 写向工具在管线之前强制审批
      //（setSettings 转发 M1E_SAFE_MODE；src/permissions 冻结，最小接线在本模块）
      //
      // ⚠️ 范围必须是**写向**（2026-10-20 独立评审追出）：旧实现对**每个**进门工具都强制审批，
      // 而这条分支的语义与卡面文案都写着「写工具」。读侧三把（read_file/grep/glob）接进门之后，
      // 旧形状会让安全模式**每读一个文件都弹一张卡**——这不是更安全，是把设置变成噪声，
      // 人会开始闭眼点「允许」⇒ 反而更危险。判据用 `isWriteCall`（与 `gatedMcpTool` 同一口径：
      // 那条早就写了 `isWriteCall(name, info.grade)`，只有这条漏了）。
      // 不受影响的三把（lsp/render_image/web_fetch）：它们不是写向，但风险等级是 **high**
      // （`src/permissions/risk.ts`）⇒ 正常管线那层（L4-risk）在四档里照样出卡，
      // 安全模式这道**本来就是冗余的**（去掉它不改变任何一档的实际行为）。
      if (process.env.M1E_SAFE_MODE === "gate" && isWriteCall(name as ToolName)) {
        // 安全模式 gate 是**档位层**自己加的强制审批（发生在 evaluate 之前，所以没有 `d` 可交给
        // gateBase）；留痕直接构造，layer 用 L3-mode——它就是"档位规定要问人"的那一层。
        const modeGate = (verdict: GateVerdict): GateMeta => ({ layer: "L3-mode", mode: s.autonomy.mode, verdict });
        if (!s.askGate) return denied(name, s.autonomy.mode, "安全模式 gate 非交互（fail-closed）", modeGate("unattended"));
        const gateR = await s.askGate.request(name, args, { reason: "安全模式 gate：写工具强制审批", risk: "none", signal: ctx.signal });
        // 与下面那条审批分支同一个出口：三种结局（拒绝/超时/无人值守）各自说清，并**带上 verdict**。
        // 少了 verdict，`lessons.ts` 的 neverExecutedResult 判不出"工具没执行"，这次超时就会被
        // 记成"执行了但失败"⇒ 得出「这个工具用不了」的错误结论——与 askDenialText 修的是同一族。
        if (gateR.outcome !== "approved") {
          return deniedByAsk(name, s.autonomy.mode, gateR.reason,
            modeGate(gateR.reason === "unattended" ? "unattended" : gateR.reason === "timeout" ? "timeout" : "rejected"));
        }
      }
      const d = evaluate(name as ToolName, args, s.autonomy);
      const aMode = s.autonomy.mode;
      if (d.verdict === "deny") return denied(name, aMode, d.reason, { ...gateBase(d, aMode), verdict: "denied" });
      // 人工批准时人选的 scope（ask 分支才会赋值）——留痕要能回答「是谁放行的、放到哪一档」。
      let manualScope: AskScope | undefined;
      // 网络放行的取用面：只有「问过且批了」的网络命令才走 allow 支。
      // §11.4 红线：任何档位下「网络全开」都不是免批条件 ⇒ auto 档的 L4-pass 与无人值守都拿不到，
      // 判据挂在 verdict === "ask" → approved 这一条真实发生过的人工决议上，不挂在分类器上。
      const wantsNetwork = isNetworkCommandCall(name as ToolName, args);
      let humanApproved = false;
      if (d.verdict === "ask") {
        if (!s.askGate) return denied(name, aMode, "非交互模式（fail-closed）：" + d.reason, { ...gateBase(d, aMode), verdict: "unattended" });
        // 卡上多显示的字段（见 CardExtra 的注释）：只进**审批卡**，不进执行面，
        // 也不改模型给的 args（那一份是落盘的凭据，不能被展示面污染）。
        const extra = cardExtra !== undefined ? cardExtra(args, ctx) : {};
        const cardArgs = Object.keys(extra).length > 0 ? { ...args, ...extra } : args;
        // 连拦降级（§2.2 双向断路器）：**先算后问**——提示要说的是"此前已连续被拒 N 次"，
        // 挂在下一张卡上才赶得上做决定。不静默、不自动改档：只提示 + 给一键降档按钮。
        const breakerTip = downgradeSuggestion(s.autonomy);
        const r = await s.askGate.request(name, cardArgs, {
          // 网络命令的批准现在真的放行出网（此前批了也没用——OS 层从没写过 network 规则），
          // 所以把这层后果写进卡片理由：批准必须是知情的。
          reason: withSkillAllowNote(name, d.reason) + (wantsNetwork ? "｜批准 = 本次命令放行网络出网（一次性，不记忆）" : ""),
          risk: d.risk,
          riskReasons: d.riskReasons,
          // 审查待确认第 4 条（任务 4.3）：门侧早已支持 ctx.signal（D12），但调用侧没传 =>
          // run 取消后审批卡驻留到 60s 超时才收，会话/worker 在中间一直挂着。接上运行信号：
          // 取消即按拒绝收束（pending 同步出表，notifyOutcome 记 user）。gatedTool 与
          // gatedMcpTool 两处同形，一并接线。
          signal: ctx.signal,
          ...(breakerTip !== null ? { tierWarning: breakerTip } : {}),
        });
        if (r.outcome !== "approved") {
          if (d.risk === "critical") {
            noteCriticalDenial(s.autonomy);
            const tip = downgradeSuggestion(s.autonomy);
            if (tip) console.warn("[permissions] " + tip);
          }
          // 三种结局（拒绝 / 超时 / 无人值守）在文字面分开说：从前一律「未获批准」，
          // 于是「等 60s 没人答」被读成「这一档禁止这个工具」——实测已经沉淀成一条错误的永久经验。
          // verdict 那列不变（事件流早就是四个值），这里只把同一件事说明白。
          return deniedByAsk(name, aMode, r.reason,
            { ...gateBase(d, aMode), verdict: r.reason === "unattended" ? "unattended" : r.reason === "timeout" ? "timeout" : "rejected" });
        }
        // scope 回写（§10.4）：网络类命令强制 once（出网审计，scope 不放行）
        const effScope: AskScope = wantsNetwork ? "once" : r.scope;
        manualScope = effScope;
        // 人工批准已成立 ⇒ 这一条命令这一次执行可以走网络放行支（一次性，不写规则库、不入 scope）。
        // 「asked」由 d.verdict 现算，不另存状态——网络 profile 的三条条件里只有这一条是事件性的。
        humanApproved = true;
        if (effScope === "session_kind") {
          (s.autonomy.sessionScopes as Set<string>).add(scopeKey(name as ToolName, args));
        } else if (effScope === "always") {
          if (await persistAlwaysRule(ctx.workspace, name as ToolName, args)) {
            // 当前轮与下轮使用同一套规则加载/匹配语义，并保留全局和项目的拒绝约束。
            // 重载失败不许吃掉这次已批准的执行：`loadPermissionRules` 对读不出/解析不了的规则库
            // 是 fail-closed 抛错（拒载），而这里抛出去的结果是「人点了总是允许、规则也落了盘、
            // 工具却没执行」——下一次会话才会生效，本轮只见一句解析错误。授权已成立 ⇒ 执行优先，
            // 但失败必须留痕（与 persistAlwaysRule 同一口径：不阻断、不静默）。
            try {
              s.autonomy.rules = loadPermissionRules(join(ctx.workspace, ".agent", "permissions.json"), globalPermissionsPath());
            } catch (err) {
              console.error("[permissions] always 规则已落库，但重载失败（本次仍执行；下个会话生效）：", err instanceof Error ? err.message : String(err));
            }
          }
        }
        if (d.risk === "critical") noteCriticalResolved(s.autonomy);
        noteManualDecision(s.autonomy);
      } else if (d.auto?.source === "session_scope") {
        noteScopeApproval(s.autonomy); // 断路器计数（连续 scope 自动放行）
      }
      // 判定留痕：能走到这里只有两种可能——本来就不用问（auto-approved）或问过且批了（approved）。
      // 沙箱那两条 return 原先连 auto 审计都带不出去（同一条命令走不走沙箱留痕不一样），一并补上。
      const gateMeta: GateMeta = d.verdict === "ask"
        ? { ...gateBase(d, aMode), verdict: "approved", ...(manualScope !== undefined ? { scope: manualScope } : {}) }
        : { ...gateBase(d, aMode), verdict: "auto-approved" };
      const withGate = (r: ToolResult): ToolResult => ({ ...r, gate: gateMeta } as ToolResultWithAudit);
      // Internal fusion callback, never a model argument: revalidate after approval (which may wait).
      if (beforeExecute) {
        const blocked = await beforeExecute();
        if (blocked) return blocked;
      }
      // 审批、授权落盘和执行前复核都可能等待；取消后不再启动已批准的操作。
      if (ctx.signal?.aborted) return withGate({ ok: false, output: "[cancelled] 会话已取消，工具没有执行" });
      if (name === "run_shell" && s.sandbox !== null && s.sandbox.available) {
        const command = typeof args.command === "string" ? args.command : "";
        const mapped = mapSandboxTestCommandForWorkspace(command, ctx.workspace, MODEL_SHELL_TEST_ALIASES);
        // 缺省 deny：profile 里不写任何 network 规则 ⇒ 闭箱即全断网（sandbox:check ④ 钉着）。
        // allow 支的取用条件全部住在 networkProfileFor（网络放行永不免批）。
        const network = networkProfileFor({ wantsNetwork, asked: d.verdict === "ask", approved: humanApproved });
        if (beforeExecute) {
          // runInSandbox has no cancellation input. Reuse its profile, but launch via the existing
          // run_shell process-group/cancellation path; approval above evaluated the original lint.
          const tmp = join(await realpath(ctx.workspace), ".tmp");
          await mkdir(tmp, { recursive: true });
          if (ctx.signal?.aborted) return { ok: false, output: "cancelled before sandbox lint" };
          const quote = (s: string): string => "'" + s.replace(/'/g, "'\\''") + "'";
          const command = `TMPDIR=${quote(tmp)} exec /usr/bin/sandbox-exec -p ${quote(buildSandboxProfile(ctx.workspace, { network }))} bash -c ${quote(mapped)}`;
          // 这条出口经 run_shell 工具而非 runInSandbox，故同一判据的提示在这里补（两处共用一只函数）。
          return withGate(annotateNetworkDenial(await original.run({ command }, ctx), network));
        }
        const sand = await runInSandbox(mapped, { cwd: ctx.workspace, network, ...(ctx.signal ? { signal: ctx.signal } : {}) });
        // 上面那条注释说的是「经 run_shell 的那条出口」；这一条不经，故同一只归因函数在这里补
        // （verify 不走这条路，所以不会与它那句「测试脚本未被执行」叠两层）。
        return withGate(annotateExecCause(sand, { timedOut: sand.timedOut === true, exitCode: sand.exitCode ?? null }));
      }
      let result = await original.run(args, ctx);
      // 动作融合是**写向**功能（写完跑一次配置好的 lint；lint 失败不回滚那次写）。
      // ⚠️ 2026-10-20：读侧三把（read_file/grep/glob）接进门之后，这条若不设限 ⇒
      // **每一次读**都会去起一遍 lint 命令，并把 lint 输出拼进读的输出
      // （模型上下文里多出一段与读无关的噪声，且读的耗时被 lint 拖住）。
      // 口径用权限层那一份「算不算写向」（`isWriteCall`）——不另造一张表。
      if (isWriteCall(name as ToolName) && name !== "run_shell" && result.ok && s.actionFusion) {
        result = await s.actionFusion(result, args.path, ctx);
      }
      // 判定留痕进 tool_result（loop 透传并由 autoOf 派生 auto，零新事件类型）
      return withGate(result);
    },
  };
}

/** 独立只读面的门会话（sidechat）：不借主会话的 run scope/全局档位，也**不装审批门**——
 *  旁路无人值守，需要问人的调用一律 fail-closed，而不是悄悄放行或挂 60s。
 *  规则库照载（项目的 deny/allow 与主会话同源）；解析失败向外抛，由调用方显式拒绝这一轮。 */
export function readOnlyGateSession(workspace: string): GateSession {
  return {
    askGate: null,
    autonomy: newAutonomySession("read-only", {
      rules: loadPermissionRules(join(workspace, ".agent", "permissions.json"), globalPermissionsPath()),
    }),
    sandbox: null,
  };
}

/** M2e：MCP 工具统一注册表入口——与写工具同一条 evaluate 权限管线（无特权，§9.7）。 */
function gatedMcpTool(name: string, rt: PluginRuntime): Tool {
  return {
    name,
    async run(args, ctx) {
      const s = D().currentSession();
      if (!s) return denied(name, "default", "工具门未接线（fail-closed）");
      const info = rt.mcpTools.get(name);
      if (!info) return denied(name, s.autonomy.mode, "插件工具已停用或未注册");
      // 懒加载的防手滑：未激活 server / 未按工具激活的 scoped 名即使还残留在旧表里，也不许执行。
      if (!scopedToolActive(rt, name, info)) {
        return denied(name, s.autonomy.mode, "MCP 工具未激活（先用 mcp_activate）");
      }
      // 安全模式 gate 必须覆盖 MCP 写工具：旧实现只在 gatedTool 里加这道闸，
      // 把写操作搬到 MCP（annotations:{} = 非只读）就能在 guided/auto 下整体绕开「写前强制审批」。
      if (process.env.M1E_SAFE_MODE === "gate" && isWriteCall(name, info.grade)) {
        const modeGate = (verdict: GateVerdict): GateMeta => ({ layer: "L3-mode", mode: s.autonomy.mode, verdict });
        if (!s.askGate) return denied(name, s.autonomy.mode, "安全模式 gate 非交互（fail-closed）", modeGate("unattended"));
        const gateR = await s.askGate.request(name, args, { reason: "安全模式 gate：MCP 写工具强制审批", risk: "none", signal: ctx.signal });
        if (gateR.outcome !== "approved") {
          return deniedByAsk(name, s.autonomy.mode, gateR.reason,
            modeGate(gateR.reason === "unattended" ? "unattended" : gateR.reason === "timeout" ? "timeout" : "rejected"));
        }
      }
      const d = evaluate(name as ToolName, args, s.autonomy, info.grade); // MCP scoped 名进同一管线（规则/风险/档位全生效）
      const aMode = s.autonomy.mode;
      if (d.verdict === "deny") return denied(name, aMode, d.reason, { ...gateBase(d, aMode), verdict: "denied" });
      let manualScope: AskScope | undefined;
      if (d.verdict === "ask") {
        if (!s.askGate) return denied(name, aMode, "非交互模式（fail-closed）：" + d.reason, { ...gateBase(d, aMode), verdict: "unattended" });
        const breakerTip = downgradeSuggestion(s.autonomy);
        const r = await s.askGate.request(name, args, {
          reason: withSkillAllowNote(name, d.reason),
          risk: d.risk,
          riskReasons: d.riskReasons,
          // 审查待确认第 4 条（任务 4.3）：门侧早已支持 ctx.signal（D12），但调用侧没传 =>
          // run 取消后审批卡驻留到 60s 超时才收，会话/worker 在中间一直挂着。接上运行信号：
          // 取消即按拒绝收束（pending 同步出表，notifyOutcome 记 user）。gatedTool 与
          // gatedMcpTool 两处同形，一并接线。
          signal: ctx.signal,
          ...(breakerTip !== null ? { tierWarning: breakerTip } : {}),
        });
        if (r.outcome !== "approved") {
          // 连拦计数不认出口（2026-10-20）：计数此前只长在 gatedTool 那一侧，同一个会话里
          // 从 MCP 面拒掉的 critical 一次都不算 ⇒ "连续被拒 3 次"在这条路上永远到不了阈值，
          // 提示与一键降档成了半截功能。两个出口同源，才谈得上"连续"。
          if (d.risk === "critical") noteCriticalDenial(s.autonomy);
          return deniedByAsk(name, aMode, r.reason,
            { ...gateBase(d, aMode), verdict: r.reason === "unattended" ? "unattended" : r.reason === "timeout" ? "timeout" : "rejected" });
        }
        manualScope = r.scope;
        noteManualDecision(s.autonomy);
      } else if (d.auto?.source === "session_scope") {
        noteScopeApproval(s.autonomy);
      }
      // MCP 出口原先把 d.auto 丢了：读了它做断路器计数，却不往结果上挂（§11.7.5 的审计在这条路上
      // 一直是空的）。留痕统一走 gate，auto 由 loop 从 gate 派生。
      const gateMeta: GateMeta = d.verdict === "ask"
        ? { ...gateBase(d, aMode), verdict: "approved", ...(manualScope !== undefined ? { scope: manualScope } : {}) }
        : { ...gateBase(d, aMode), verdict: "auto-approved" };
      // 同一连接重复补连只重建外层记录；SDK 的 schema/grade 引用随真正重连更换。
      const current = rt.mcpTools.get(name);
      if (!current || current.inputSchema !== info.inputSchema || current.grade !== info.grade) {
        return { ok: false, output: "[permission denied] MCP 工具已停用或更新，请重新发起调用", gate: gateMeta } as ToolResultWithAudit;
      }
      const res = ctx.signal?.aborted
        ? { ok: false, output: "[cancelled] 会话已取消，工具没有执行" }
        : await rt.mcp.callTool(info.plugin, info.server, info.name, args, ctx.signal);
      return { ok: res.ok, output: res.output, gate: gateMeta } as ToolResultWithAudit;
    },
  };
}

/** 模型面/执行面/权限门共用的 active 判定：优先按工具（子集模式），退回家 server，最后宽容旧测试桩。 */
function scopedToolActive(
  rt: { isMcpToolActive?: (scoped: string) => boolean; isMcpServerActive?: (key: string) => boolean },
  scoped: string,
  info: { plugin: string; server: string },
): boolean {
  if (typeof rt.isMcpToolActive === "function") return rt.isMcpToolActive(scoped);
  if (typeof rt.isMcpServerActive === "function") return rt.isMcpServerActive(mcpServerKey(info.plugin, info.server));
  return true;
}

function mcpCatalogLine(rt: PluginRuntime): string {
  const rows = rt.mcpServerSummaries();
  if (rows.length === 0) return "当前没有已连接的 MCP server。";
  const shown = rows.slice(0, 20).map((s) => {
    const active = s.activeMode === "server"
      ? "（整台已激活）"
      : s.activeMode === "tools" ? "（按工具激活 " + String(s.activeToolCount) + " 把）" : "";
    const oversize = s.toolCount > MCP_ACTIVE_TOOL_LIMIT ? "（大 server：用 tools 子集激活）" : "";
    return "- " + s.key + " — " + String(s.toolCount) + " 把工具" + active + oversize;
  });
  const more = rows.length > 20 ? "\n（还有 " + String(rows.length - 20) + " 台未列出）" : "";
  return "MCP servers（先 mcp_list <server> 看工具名，再 mcp_activate；大 server 用 tools 只激活子集）：\n" +
    shown.join("\n") + more;
}

function mcpToolLines(rt: PluginRuntime, server: string): string {
  const tools = rt.mcpServerTools(server);
  if (!tools) {
    const available = rt.mcpServerSummaries().map((s) => s.key).join(", ") || "（无）";
    return "未找到 MCP server: " + server + "；可用：" + available;
  }
  const summary = rt.mcpServerSummaries().find((s) => s.key === server);
  const state = summary?.activeMode === "server"
    ? "（整台已激活）"
    : summary?.activeMode === "tools"
      ? "（按工具激活 " + String(summary.activeToolCount) + " 把）"
      : "（未激活；调用 mcp_activate 后下一轮请求可见）";
  const shown = tools.slice(0, 20).map((t) =>
    "- " + t.scopedName + (t.active ? "（已激活）" : "") + " — " + t.description);
  const more = tools.length > 20 ? "\n（还有 " + String(tools.length - 20) + " 把未列出）" : "";
  const oversize = tools.length > MCP_ACTIVE_TOOL_LIMIT
    ? "\n（该 server 有 " + String(tools.length) + " 把工具，整台激活会超过总帽；用 mcp_activate 的 tools 参数选择子集）"
    : "";
  return "MCP server " + server + state + "：\n" + shown.join("\n") + more + oversize;
}

/** 服务器级懒加载的三个元工具。它们只改 active 集，不执行外部 MCP 工具；
 *  真正的 scoped 工具仍走 `gatedMcpTool` 的同一条权限/审批管线。 */
function mcpListTool(rt: PluginRuntime): Tool {
  return {
    name: "mcp_list",
    async run(args) {
      const server = typeof args.server === "string" ? args.server.trim() : "";
      return { ok: true, output: server === "" ? mcpCatalogLine(rt) : mcpToolLines(rt, server) };
    },
  };
}

function mcpActivateTool(rt: PluginRuntime): Tool {
  return {
    name: "mcp_activate",
    async run(args) {
      const server = typeof args.server === "string" ? args.server.trim() : "";
      if (server === "") return { ok: false, output: "mcp_activate: server 参数必填（plugin/server，从 mcp_list 取）" };
      const one = typeof args.tool === "string" ? args.tool.trim() : "";
      const many = Array.isArray(args.tools)
        ? args.tools.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter((x) => x !== "")
        : [];
      if (one !== "" && many.length > 0) {
        return { ok: false, output: "mcp_activate: tool 与 tools 二选一（只激活一把用 tool，多把用 tools）" };
      }
      const selected = one !== "" ? [one] : many;
      const r = selected.length > 0
        ? rt.activateMcpTools(server, selected)
        : rt.activateMcpServer(server);
      if (!r.ok) return { ok: false, output: r.error ?? "激活失败" };
      const activeTools = r.tools.filter((t) => t.active);
      const shown = activeTools.slice(0, 20).map((t) => "- " + t.scopedName);
      const more = activeTools.length > 20 ? "\n（还有 " + String(activeTools.length - 20) + " 把未列出）" : "";
      return {
        ok: true,
        output: "已激活 " + server + "（" + String(activeTools.length) + " 把工具；当前 active " +
          String(rt.activeMcpToolCount()) + "/" + String(MCP_ACTIVE_TOOL_LIMIT) +
          " 把；schema 在下一轮请求进入模型面，本轮不要凭名字猜参数）：\n" + shown.join("\n") + more,
      };
    },
  };
}

function mcpReleaseTool(rt: PluginRuntime): Tool {
  return {
    name: "mcp_release",
    async run(args) {
      const server = typeof args.server === "string" ? args.server.trim() : "";
      if (server === "") return { ok: false, output: "mcp_release: server 参数必填（plugin/server）" };
      const tool = typeof args.tool === "string" ? args.tool.trim() : "";
      if (tool !== "") {
        const r = rt.releaseMcpTool(server, tool);
        return { ok: r.ok, output: r.ok ? "已释放 " + server + " / " + tool + "（下一轮不再出现）" : (r.error ?? "释放失败") };
      }
      const r = rt.releaseMcpServer(server);
      return {
        ok: r.ok,
        output: r.ok ? "已释放 " + server + "（移除 " + String(r.removed ?? 0) + " 把工具；下一轮不再出现）" : (r.error ?? "释放失败"),
      };
    },
  };
}

/** M2e：把插件面装进统一注册表——skill + MCP 目录/激活元工具 + **已激活**的 scoped MCP 工具。
 *  返回注入名清单（会话结束摘除）。未激活 server 的工具不装表：模型看不见，也不该调得动。 */
export function installPluginTools(rt: PluginRuntime): string[] {
  const injected: string[] = [];
  const table = TOOLS as unknown as Record<string, Tool>;
  if (rt.skills().length > 0) {
    table["skill"] = {
      name: "skill",
      async run(args) {
        const name = typeof args.name === "string" ? args.name : "";
        if (name.trim() === "") return { ok: false, output: "skill: name 参数必填（/plugin:name 或 /name）" };
        // §9.3 参数通道：模型传进来的 args 原文交给替换器（$ARGUMENTS / $1 / $name）。
        // 缺省空串而不是"不传"——正文里的 $ARGUMENTS 在无参数时按 CC 语义替换成空，
        // 留裸变量给模型只会让它以为要自己填。
        return rt.triggerSkill(name, typeof args.args === "string" ? args.args : "");
      },
    };
    injected.push("skill");
  }
  if (rt.mcpTools.size > 0) {
    table["mcp_list"] = mcpListTool(rt);
    table["mcp_activate"] = mcpActivateTool(rt);
    table["mcp_release"] = mcpReleaseTool(rt);
    injected.push("mcp_list", "mcp_activate", "mcp_release");
  }
  for (const [scoped, info] of rt.mcpTools) {
    // 最小测试桩没有 active 语义 ⇒ 保持旧行为（全部可执行）；生产 PluginRuntime 必有。
    if (!scopedToolActive(rt, scoped, info)) continue;
    table[scoped] = gatedMcpTool(scoped, rt);
    injected.push(scoped);
  }
  return injected;
}

/** 执行面补表：run 起点之后才出现的插件工具（典型：会话跑到一半，用户在面板上批准了插件）。
 *
 *  为什么需要它：模型面是逐请求重算的（provider 的 requestFace → sessionToolFace →
 *  pluginToolSpecsFromRuntime 读的是 `rt.mcpTools` 的**活引用**），而 `installPluginTools`
 *  写进全局 `TOOLS` 的执行表是**起点快照**。批准一落地，`rt.mcpTools` 立刻多出几个 scoped 名、
 *  模型下一轮就看见它们；可执行面那张表还是旧的 ⇒ 模型调它只会拿到 `unknown tool`。
 *  这正是「模型看到的工具 ≠ 能执行的工具」——本仓把这类分家当根因反复判死，这里补上同源一手。
 *
 *  同源：复用 `gatedMcpTool` 这一个构造（权限管线、安全模式闸、审计留痕全都走它），
 *  不另写一条执行路径。只补 `rt.mcpTools` 里**已经有**的名字：表里没有的仍由 loop 落
 *  `unknown tool`（fail-closed 方向不变，不会因为补表就放行一个没注册的工具）。 */
export function resolveLivePluginTool(name: string, rt: PluginRuntime): Tool | undefined {
  // 元工具也可能是 run 中途才「长出来」的（起点无插件 → 中途批准后才 connectMcp）：
  // 模型面由 requestFace 现算会列出它们，执行表却是起点快照 ⇒ 不补这一手，
  // 模型会看到 mcp_list/mcp_activate 却吃 unknown tool。与 scoped 工具同一条补表入口。
  if (rt.mcpTools.size > 0) {
    if (name === "mcp_list") return mcpListTool(rt);
    if (name === "mcp_activate") return mcpActivateTool(rt);
    if (name === "mcp_release") return mcpReleaseTool(rt);
  }
  const info = rt.mcpTools.get(name);
  if (!info) return undefined;
  if (!scopedToolActive(rt, name, info)) return undefined;
  return gatedMcpTool(name, rt);
}

/** 运行时注入工具的**模型可见规格**（与 installPluginTools 的可执行面一一对应）：
 *  skill（有受信 skill 时）与 MCP scoped 工具。MCP 参数直接复用 server 的 inputSchema 原文，
 *  不翻译不裁剪——两套 schema 各写一份正是「模型看到的工具 ≠ 能执行的工具」的根因。 */
export interface PluginToolSource {
  skills(): readonly unknown[];
  mcpTools: Map<string, McpToolInfo & { plugin: string; server: string }>;
  /** 生产实现必有；最小测试桩缺省时按「全部已激活」处理（保持旧测试的显式输入面）。
   *  按工具模式的判定优先于整台 server。 */
  isMcpToolActive?: (scoped: string) => boolean;
  isMcpServerActive?: (key: string) => boolean;
}

/** §9.3 的工具面：一次算出「模型可见规格 + 摘除说明 + 活闸谓词」三件，同源同刻。
 *  规格面与活闸必须一份谓词：两处各判一份就是「模型看到的工具 ≠ 能执行的工具」的镜像缺陷
 *  （这边是能看到却被拒）。纯算、不出声——告警由调用点在 run 起点喊一次，逐请求重算时不该反复刷屏。
 *  导出是为了让这条接线有判据：provider 那条分支要真 key 才走得到，接线本身不能因此永远没证据。 */
/** 插件工具面的两种喂法：一次性数组（run 起点快照）或 provider（每请求现算）。
 *  模型面若只认前者，run 中途新增的 MCP/插件工具就永远进不了清单——执行面能补表，
 *  模型面看不见，仍然是「能执行但看不见」。 */
export type PluginToolProvider = readonly SessionPluginTool[] | (() => readonly SessionPluginTool[]);

export function sessionToolFace(
  rt: { skillDenial(tool: string): string | null } | null,
  opts: { mode: PermissionMode; pluginTools?: PluginToolProvider; automationTools?: boolean; omitTools?: readonly string[] },
): { tools: GlmToolSpec[]; note: string; skipped: string[]; removed: { name: string; by: string }[]; skillDenial: ((tool: string) => string | null) | undefined } {
  const skillDenial = rt ? (tool: string): string | null => rt.skillDenial(tool) : undefined;
  const pluginTools = typeof opts.pluginTools === "function" ? opts.pluginTools() : opts.pluginTools ?? [];
  const face = sessionToolSpecs({
    mode: opts.mode,
    pluginTools,
    // 能力没开就不挂说明书（见 OPTIONAL_TOOL_NAMES）：与执行面 installAppTools 同进同退。
    ...(opts.omitTools !== undefined && opts.omitTools.length > 0 ? { omitTools: opts.omitTools } : {}),
    ...(skillDenial ? { skillDenial } : {}),
  });
  /* 定时五件：**规格面与执行面一起摘**，判据是同一个 `automationTools`。
   *
   *  为什么必须两面都摘（只摘一头都会比现状更糟，两头都是本仓点名的失败形状）：
   *  · 只摘实现不摘规格：`gateToolSpecs`（session-provider.ts:360）无条件 `push(automationToolSpecs())`，
   *    于是模型看得见、只吃得到 `unknown tool: automation_create`——比现状那句
   *    「调度器未初始化（fail-closed）」更难懂，还白烧一轮。
   *  · 只摘规格不摘实现：反过来，模型看得见工具却永远建不成功，正是「存在 ≠ 接线」本身。
   *  现状（两面都在、但没有调度器）反而不算坏：五件各自 fail-closed 说清楚在拒什么，
   *  唯一白烧的一轮是 `automation_create`（审批在 `needScheduler()` 之前）。
   *  摘掉之后一次性进程上模型连看都看不见它们 ⇒ 那轮也不用烧。 */
  const specs =
    opts.automationTools === false
      ? face.specs.filter((s) => !AUTOMATION_TOOL_NAMES.includes(s.function.name))
      : face.specs;
  return { tools: specs, note: face.note, skipped: face.skipped, removed: face.removed, skillDenial };
}

export function pluginToolSpecsFromRuntime(rt: PluginToolSource | null): SessionPluginTool[] {
  if (!rt) return [];
  const out: SessionPluginTool[] = [];
  if (rt.skills().length > 0) {
    out.push({
      name: "skill",
      description:
        "触发已加载的插件 skill（调用名见系统提示的 skill 路由表：/plugin:name 或 /name）；" +
        "返回该 skill 的全文指令，按指令继续执行",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "skill 调用名（/plugin:name 或 /name）" },
          // 规格面与执行面同源：installPluginTools 读的就是 args.args，两处必须一起有
          //（只在一处加 = 模型看不见参数面，或看得见却传不进替换器）。
          args: { type: "string", description: "传给 skill 的参数原文（正文里的 $ARGUMENTS / $1 / $name 按此替换；无参数可省略）" },
        },
        required: ["name"],
      },
    });
  }
  // 懒加载：目录/激活/释放三个小工具常驻；真正的 scoped 工具只在 active（整台或按工具）上出现。
  // 最小测试桩没有 active 语义时保持旧行为（不塞元工具、全部工具可见），
  // 这样 `session-tools.test.ts` 的显式 SessionPluginTool 输入面不被生产策略污染。
  const lazy = typeof rt.isMcpServerActive === "function" || typeof rt.isMcpToolActive === "function";
  if (lazy && rt.mcpTools.size > 0) {
    out.push(
      {
        name: "mcp_list",
        description: "列出已连接的 MCP server；给 server 时列出工具名（不加载 schema）。先取 key，再 mcp_activate。",
        parameters: {
          type: "object",
          properties: { server: { type: "string", description: "可选：plugin/server；省略则只列 server" } },
          additionalProperties: false,
        },
      },
      {
        name: "mcp_activate",
        description: "激活 MCP 工具；下一轮请求生效。默认整台 server；大 server 用 tool/tools 只激活子集。",
        parameters: {
          type: "object",
          properties: {
            server: { type: "string", description: "plugin/server" },
            tool: { type: "string", description: "可选：只激活这一把（bare 名或 scoped 名）" },
            tools: {
              type: "array",
              items: { type: "string" },
              description: "可选：只激活这些工具（与 tool 二选一）；server 超过总工具帽时用这个",
            },
          },
          required: ["server"],
          additionalProperties: false,
        },
      },
      {
        name: "mcp_release",
        description: "释放整台 server 或其中一把工具；下一轮不再出现在工具面。",
        parameters: {
          type: "object",
          properties: {
            server: { type: "string", description: "plugin/server" },
            tool: { type: "string", description: "可选：只释放这一把（bare 名或 scoped 名）" },
          },
          required: ["server"],
          additionalProperties: false,
        },
      },
    );
  }
  for (const [scoped, info] of rt.mcpTools) {
    if (!scopedToolActive(rt, scoped, info)) continue;
    // grade 随规格一起带出：档位对 MCP 的白名单在 sessionToolSpecs 那一处统一生效（同 isWriteCall 谓词），
    // 这里不再按 mode 各判一份——两处各判就是「模型看到的」与「门会拒的」重新分家的地方。
    out.push({ name: scoped, description: info.description, parameters: info.inputSchema, grade: info.grade });
  }
  return out;
}

// 宿主进程内的 always 追加串行化：锁住读取到保存的整段，避免并发批准丢掉另一项授权。
let alwaysRuleWrites: Promise<void> = Promise.resolve();

/** always scope 批准落库为 allow 条目（项目规则库，原子写）；拒绝永不生成规则。 */
async function persistAlwaysRule(workspace: string, name: string, args: Record<string, unknown>): Promise<boolean> {
  // #57（2026-10-05）：授权记录落**独立且被 git 忽略**的那一份，不写回受跟踪的 permissions.json。
  // 理由：受跟踪那份里可能有人写的项目策略（该随仓库走），而"这台机器上某人点过一次总是允许"
  // 是授权记录、属于机器——写在一起就等于谁 clone 谁继承。读侧由 loadPermissionRules 透明并入，
  // 所以批准过的规则照样生效（那一半已入库，见 src/permissions/rules.ts 的 ALWAYS_RULES_FILE）。
  const path = alwaysRulesPath(workspace);
  const write = alwaysRuleWrites.then(async () => {
    const existing = loadPermissionRules(path);
    // 命令链**逐段**匹配（`judgeChain` 先 `splitCommandChain`，再要求**每一段**都命中规则，
    // 否则整链 miss）⇒ 「总是允许」一条命令必须落成**每段各一条** allow：
    // 把 `pnpm test && echo done` 整条当 pattern 存，匹配时它已不是任何一段 ⇒ 这条授权
    // **永远匹配不上**——用户点过一次、回执照报成功、下一条同样的命令照旧弹卡。
    // 只存第一段也不够（余下的段 miss 照样整链 miss）。单段命令（绝大多数）形状不变。
    const rules = [...existing];
    if (name === "run_shell" && typeof args.command === "string") {
      for (const seg of splitCommandChain(args.command)) {
        rules.push({ behavior: "allow", tool: name, pattern: seg, scope: "always" });
      }
    } else {
      rules.push({ behavior: "allow", tool: name, scope: "always" });
    }
    await savePermissionRules(path, rules);
  });
  alwaysRuleWrites = write.catch(() => undefined);
  try {
    await write;
    return true;
  } catch (err) {
    // 落库失败不阻断本次已批准的执行，但必须可见（审计优先于静默）
    console.error("[permissions] always 规则落库失败:", err instanceof Error ? err.message : String(err));
    return false;
  }
}
