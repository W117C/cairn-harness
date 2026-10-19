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
import type { McpToolInfo } from "../agent/plugins/mcp";
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
import type { ToolName } from "../tools/base";
import type { AskGate } from "./ask-gate";
import { annotateNetworkDenial, buildSandboxProfile, networkProfileFor, runInSandbox, type SandboxStatus } from "./sandbox";
import { MODEL_SHELL_TEST_ALIASES, mapSandboxTestCommandForWorkspace } from "./sandbox-test-command";

export interface ToolGateDeps {
  /** 会话审批/自治状态（活读；无会话 = null ⇒ 工具门 fail-closed）。 */
  currentSession: () => {
    askGate: AskGate | null;
    autonomy: ReturnType<typeof newAutonomySession>;
    sandbox: SandboxStatus | null;
    actionFusion?: ReturnType<typeof createActionFusion>;
  } | null;
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
 *  `staticRisk` 里 `(tool as string) === "web_fetch"` 是同一处类型缝的两面。 */
type GatedName = "write_file" | "edit_file" | "apply_patch" | "run_shell" | "web_fetch" | "web_search" | "diagnose" | "lsp" | "render_image";

export function gatedTool(name: GatedName, original: Tool, beforeExecute?: () => Promise<ToolResult | null>): Tool {
  return {
    name,
    async run(args, ctx) {
      const s = D().currentSession();
      if (!s) return denied(name, "default", "工具门未接线（fail-closed）");
      // 方案门不再每次刷进 session 入参：权限会话里那份是**活委托**（permissions/plan-state），
      // worker 与主会话读同一份——上一版只在这三处主会话路径刷新镜像，worker 那条路从不刷 ⇒ 先批后写可绕。
      // M1e 设置页「产出代码安全模式」最小语义（§11.6）：gate = 写向工具在管线之前强制审批
      //（setSettings 转发 M1E_SAFE_MODE；src/permissions 冻结，最小接线在本模块）
      if (process.env.M1E_SAFE_MODE === "gate") {
        // 安全模式 gate 是**档位层**自己加的强制审批（发生在 evaluate 之前，所以没有 `d` 可交给
        // gateBase）；留痕直接构造，layer 用 L3-mode——它就是"档位规定要问人"的那一层。
        const modeGate = (verdict: GateVerdict): GateMeta => ({ layer: "L3-mode", mode: s.autonomy.mode, verdict });
        if (!s.askGate) return denied(name, s.autonomy.mode, "安全模式 gate 非交互（fail-closed）", modeGate("unattended"));
        const gateR = await s.askGate.request(name, args, { reason: "安全模式 gate：写工具强制审批", risk: "none", signal: ctx.signal });
        // 与下面那条审批分支同一个出口：三种结局（拒绝/超时/无人值守）各自说清，并**带上 verdict**。
        // 少了 verdict，`lessons.ts` 的 isAskDeniedResult 判不出"工具没执行"，这次超时就会被
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
        const r = await s.askGate.request(name, args, {
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
        const sand = await runInSandbox(mapped, { cwd: ctx.workspace, network });
        // 上面那条注释说的是「经 run_shell 的那条出口」；这一条不经，故同一只归因函数在这里补
        // （verify 不走这条路，所以不会与它那句「测试脚本未被执行」叠两层）。
        return withGate(annotateExecCause(sand, { timedOut: sand.timedOut === true, exitCode: sand.exitCode ?? null }));
      }
      let result = await original.run(args, ctx);
      if (name !== "run_shell" && result.ok && s.actionFusion) {
        result = await s.actionFusion(result, args.path, ctx);
      }
      // 判定留痕进 tool_result（loop 透传并由 autoOf 派生 auto，零新事件类型）
      return withGate(result);
    },
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
        const r = await s.askGate.request(name, args, {
          reason: withSkillAllowNote(name, d.reason),
          risk: d.risk,
          riskReasons: d.riskReasons,
          // 审查待确认第 4 条（任务 4.3）：门侧早已支持 ctx.signal（D12），但调用侧没传 =>
          // run 取消后审批卡驻留到 60s 超时才收，会话/worker 在中间一直挂着。接上运行信号：
          // 取消即按拒绝收束（pending 同步出表，notifyOutcome 记 user）。gatedTool 与
          // gatedMcpTool 两处同形，一并接线。
          signal: ctx.signal,
        });
        if (r.outcome !== "approved") return deniedByAsk(name, aMode, r.reason,
          { ...gateBase(d, aMode), verdict: r.reason === "unattended" ? "unattended" : r.reason === "timeout" ? "timeout" : "rejected" });
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

/** M2e：把插件面装进统一注册表——skill 工具 + 各 MCP 工具（scoped 名）；返回注入名清单（会话结束摘除）。 */
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
  for (const scoped of rt.mcpTools.keys()) {
    table[scoped] = gatedMcpTool(scoped, rt);
    injected.push(scoped);
  }
  return injected;
}

/** 运行时注入工具的**模型可见规格**（与 installPluginTools 的可执行面一一对应）：
 *  skill（有受信 skill 时）与 MCP scoped 工具。MCP 参数直接复用 server 的 inputSchema 原文，
 *  不翻译不裁剪——两套 schema 各写一份正是「模型看到的工具 ≠ 能执行的工具」的根因。 */
export interface PluginToolSource {
  skills(): readonly unknown[];
  mcpTools: Map<string, McpToolInfo & { plugin: string; server: string }>;
}

/** §9.3 的工具面：一次算出「模型可见规格 + 摘除说明 + 活闸谓词」三件，同源同刻。
 *  规格面与活闸必须一份谓词：两处各判一份就是「模型看到的工具 ≠ 能执行的工具」的镜像缺陷
 *  （这边是能看到却被拒）。纯算、不出声——告警由调用点在 run 起点喊一次，逐请求重算时不该反复刷屏。
 *  导出是为了让这条接线有判据：provider 那条分支要真 key 才走得到，接线本身不能因此永远没证据。 */
export function sessionToolFace(
  rt: { skillDenial(tool: string): string | null } | null,
  opts: { mode: PermissionMode; pluginTools?: readonly SessionPluginTool[]; automationTools?: boolean; omitTools?: readonly string[] },
): { tools: GlmToolSpec[]; note: string; skipped: string[]; removed: { name: string; by: string }[]; skillDenial: ((tool: string) => string | null) | undefined } {
  const skillDenial = rt ? (tool: string): string | null => rt.skillDenial(tool) : undefined;
  const face = sessionToolSpecs({
    mode: opts.mode,
    pluginTools: opts.pluginTools ?? [],
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
  for (const [scoped, info] of rt.mcpTools) {
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
