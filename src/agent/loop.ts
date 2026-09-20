import type { AgentEvent, EventLog, SkillInvocationMeta } from "../events";
import { denyReason, gate, type PermissionMode, type ToolResultWithAudit } from "../permissions";
import type { HookEngine } from "./plugins/hooks";
import { projectContext } from "./context";
import type { LegacyNextProvider, ModelOutput, Provider } from "../providers";
import { streamFromNextSource } from "../providers";
import { failureDigest, repeatDigestNote, type VerifyHook, type VerifyOutcome } from "./verify";
import { DEFAULT_STUCK_CONFIG, detectStuck, stuckActionOf, stuckObservationOf, type StuckTurn } from "./stuck";
import { TOOLS, type ClarifyChannel, type PlanChannel, type ToolContext, type ToolName } from "../tools";

export interface LoopOptions {
  /** 新形态：stream(messages, tools) → AsyncIterable<Event>（§3.3 统一接口）；
   *  兼容旧形态：{ next() }（冻结脚本注入的 scripted provider），两种都走同一条事件管线。 */
  provider: Provider | LegacyNextProvider;
  events: EventLog;
  /** 工作区：工具的路径根、run_shell 的 cwd。 */
  workspace: string;
  /** 权限档，默认 default。 */
  mode?: PermissionMode;
  /** M0 全程脚本驱动，固定 false（ask 按 deny fail-closed）。 */
  interactive?: boolean;
  /** 防失控护栏。 */
  maxSteps?: number;
  /** 任务描述：作为首条 user_message 落入事件流。 */
  userMessage?: string;
  /** §9.3 用户侧 skill 触发（可选）：这条 user_message 的正文来自哪个 skill、给了什么参数。
   *  缺省 = 该字段不进事件（既有事件字节不变）。 */
  userMessageSkill?: SkillInvocationMeta;
  /** 澄清门通道：接了 clarify 工具才挂得起；缺省 fail-closed。 */
  clarify?: ClarifyChannel;
  /** 方案门通道：接了 propose_plan 工具才挂得起；缺省 fail-closed。 */
  plan?: PlanChannel;
  /** 验证门钩子：接了才支持 verify 反射循环（成功即停 / 上限耗尽即停）。 */
  verify?: VerifyHook;
  /** 能力 5（收束闸）：本轮写过盘但模型自始至终没自调 verify 时，harness 在收束前补一拍验证，
   *  把「说了」和「验了」分开——红字落 verify_result{auto:true} 进事件流（证据拍，不改写模型上下文）。
   *  **缺省 false**：一拍 = 真跑一遍 lint/test（有成本，且 action-fusion 的「验证执行次数」记账
   *  断言把它算成额外执行）。开闸前的两件事现在只剩一件：
   *  ① 注入通道**已落**——红由 context.ts 的 autoVerifyNote 在**下一轮**回流给模型（零额外模型调用）；
   *     「同轮自动返修」仍需多要一轮，属未裁的成本问题。
   *  ② 准确率 vs `$/成功任务` 的实测口径仍未裁（见 BLOCKED「能力 5 收束闸」立案）。
   *  硬上限（开启时）：每 run 至多一拍、模型自调过即让位、无可验面或探测炸则整段跳过。 */
  autoVerify?: boolean;
  /** M7 影响面钩子：注入后 write_file/edit_file 成功落盘会回注跨文件波及。
   *  缺省 undefined = 零行为（与 ToolContext.impact 同源，透传不加工）。 */
  impact?: ToolContext["impact"];
  /** M2e 插件 hook 引擎：未接线 = 零行为（无插件会话事件流字节不变）。 */
  hooks?: HookEngine;
  /** M2f 工具表白名单（硬闸）：给出时不在表内的工具一律拒绝执行——不是提示词自觉，是工具表摘除。
   *  缺省 undefined = 全表可见（既有路径字节不变）。 */
  allowedTools?: readonly ToolName[];
  /** §9.3 的 `disallowed-tools`（skill/command 激活期摘工具）：每次调用前现问一次
   *  「这个工具此刻被摘了吗」，返回摘除它的调用名（null = 没被摘）。
   *  与 allowedTools 的区别是**时机**：那张表在 run 开始前定死，而 skill 是 run 中途被模型
   *  点起来的——静态白名单盖不住「后半程才该摘」的那一半。缺省 undefined = 零行为。 */
  skillDenial?: (tool: string) => string | null;
  /** M3a worker 工具表覆盖（编排内核注入独立工具面，如只读 shell_ro）；缺省 undefined = 全局 TOOLS
   *  （既有路径字节不变）。先于 allowedTools 硬闸之后的执行面查表。 */
  tools?: Record<string, import("../tools").Tool>;
  /** M3a 取消信号（编排器 AbortController 树）：中止于轮界（工具执行中不打断，轮末收束）。
   *  缺省 undefined = 无取消（既有路径字节不变）。 */
  signal?: AbortSignal;
  /** worker 归因（§4.4）：只进 hook 的 stdin JSON（agent_id 字段），主会话缺省 = 该字段缺席。 */
  agentId?: string;
  /** 换路压力：同一调用连续重复时，在那条 tool_result 尾部追加一行提示（见 loop 内注释）。
   *  **缺省 false = 零行为**——三条既有路径各自的原因：
   *  - worker（编排器跑 runLoop）：那边已有更强的看门（detectStuck → waiting_input 等人），
   *    再叠一层提示是双重指挥；且追加文本会改掉 `stuckObservationOf` 比较的观察串，
   *    把「×4 相同」打散成「×3 相同 + 1 条带尾注」⇒ 看门永不触发（m3c 集成测实测到）。
   *  - 靶场（gym）：用量是按字节推的，注入文本会扰动跨 case 基线（测的是模型不是提示措辞）。
   *  - sidechat：只读问答，重复便宜。
   *  所以只有人直用的主会话（agent-runner）显式开。 */
  stuckNudge?: boolean;
}

// agent loop：事件流 → 模型 → 工具 → 事件流。
// 每轮向 provider 要一轮事件流（stream(messages, tools)），逐事件落日志：拉取与工具执行交错
//（for-await 语义：消费一条、执行一条、再拉下一条），与旧 next() 逐条拉取的日志逐字节同序。
// assistant_delta / assistant_message / usage 直接落事件流；
// tool_call 落事件流 → 过权限门 → 执行 → tool_result 落事件流，轮内继续；
// 一轮无 tool_call（纯文本）即任务结束。
// verify 是系统门不是普通工具：调 verify_hook 跑 lint/test，
//   通过 → 立即停止（不再调用模型）；失败 → 错误输出注入同轮继续修；
//   连续失败达上限（缺省 3）→ verify_result(failed) 后停止（不再调用模型）。
/** 取消与失败的边界：AbortError（Error 与 DOMException 两种形态）是取消，不是出错。 */
function isAbortLike(err: unknown): boolean {
  return typeof err === "object" && err !== null &&
    (err as { name?: unknown }).name === "AbortError";
}

export async function runLoop(opts: LoopOptions): Promise<void> {
  const { workspace, userMessage, userMessageSkill } = opts;
  const seen: AgentEvent[] = [];
  // Persist first: failed writes must not become model-visible history.
  const events: EventLog = {
    async append(event) {
      await opts.events.append(event);
      seen.push(event);
    },
  };
  const mode = opts.mode ?? "default";
  const interactive = opts.interactive ?? false;
  const maxSteps = opts.maxSteps ?? 50;
  const maxVerify = opts.verify?.maxAttempts ?? 3;
  let verifyAttempts = 0;
  // 上一拍注入给模型的失败摘要：逐字相同即「这一拍没带来新信息」，改注一行提示而非重发整段。
  let lastVerifyDigest: string | null = null;
  // 能力 5：本 run 是否真的落过盘（决定要不要补自动验证），以及自动拍是否已用过。
  let wroteThisRun = false;
  // 换路压力（能力 4/9）：同一调用连败/连抄同一结果时，在那条 tool_result 尾部追加一行提示。
  // 复用 worker 看门那颗纯函数（stuck.ts）与它的阈值，不另造检测器。差别在动作：编排器命中
  // 是把 worker 挂成 waiting_input 等人，交互主循环里暂停会把「一次重复」的代价抬成「整轮等人」，
  // 比它省下的更贵——所以这里只提示，不动终止语义、不新增事件、不多要一轮。每个 rule+action
  // 只提示一次：第 5、6 次再叠同一句话本身就是新的 token 开销，而忽略提示的模型不会被复读说服。
  const stuckTurns: StuckTurn[] = [];
  const nudgedActions = new Set<string>();
  /** 跑一拍 verify 系统门。两种形态：
   *  - manual（模型自调）：有配对的 tool_call ⇒ 失败原文注入同轮继续修，返回 "continue"。
   *  - auto（harness 收束前补拍）：**没有**配对的 tool_call，也就没有合法的**同轮**注入通道
   *    （裸 tool_result 会让 provider 侧 tool 消息失去前置 tool_calls 而 400；合成 tool_call
   *    又违反 action-fusion 明写的「no extra tool calls」不变量）⇒ 只落 verify_result 证据，
   *    红在时间线上可见，不冒充模型行为、也不偷偷多要一轮。返回恒为 "stop"。
   *    跨轮通道在投影侧：context.ts 的 autoVerifyNote 把这条红投成下一轮可见的 user 消息。 */
  const verifyBeat = async (callId: string, auto: boolean): Promise<"stop" | "continue"> => {
    verifyAttempts++;
    const attempt = verifyAttempts;
    // verify 是系统门：钩子自身抛错（.agent/config.json 损坏、沙箱 exec 异常）应当记为
    // 「一次验证失败」，而不是把整轮任务炸掉。工具执行早有同族 try/catch，这里补齐同一口径；
    // 异常原因进 tool_result（fail-visible），不让模型只看到「无详细输出」。
    let outcome: VerifyOutcome;
    let hookError: string | null = null;
    try {
      outcome = await (opts.verify as VerifyHook).run();
    } catch (err) {
      hookError = err instanceof Error ? err.message : String(err);
      outcome = { ok: false, results: [] };
    }
    await events.append({
      type: "verify_result",
      callId,
      ok: outcome.ok,
      attempt,
      maxAttempts: maxVerify,
      results: outcome.results,
      ...(auto ? { auto: true } : {}),
    });
    if (outcome.ok) return "stop"; // 验证通过 → 立即停止，不再调用模型
    // 自动拍：**同轮**不外注（没有合法通道），但红不是到此为止——下一轮的投影会把它
    // 回流成一条 user 消息（context.ts 的 autoVerifyNote），所以不必为此多要一轮模型。
    if (auto) return "stop";
    if (attempt >= maxVerify) {
      // 上限耗尽 → verify_result(failed) 已落，停止且不再调用模型
      await events.append({
        type: "tool_result",
        callId,
        ok: false,
        output: `[verify] 连续失败 ${String(attempt)}/${String(maxVerify)} 次，已达上限，停止`,
      });
      return "stop";
    }
    // 失败 → 错误输出注入同轮继续修（自动拍加 [harness] 前缀：这条不是模型自己调的）
    const digest = hookError !== null
      ? "[verify] 钩子异常（记为一次验证失败）：" + hookError
      : (auto ? "[harness 自动验证] " : "") + failureDigest(outcome);
    const repeat = digest === lastVerifyDigest;
    lastVerifyDigest = digest;
    await events.append({
      type: "tool_result",
      callId,
      ok: false,
      output: repeat ? repeatDigestNote(outcome, attempt) : digest,
    });
    return "continue";
  };

  // 新旧形态统一收敛成流式事件源（legacy next() 源遇 tool_call 断轮，日志同序）
  const provider = opts.provider;
  // C12（审查 P2）：取消信号随轮传入 provider——在途 fetch 随 abort 收束，不再只等静默窗。
  const rawStream: (messages: Parameters<Provider["stream"]>[0]) => AsyncIterable<ModelOutput> =
    "stream" in provider
      ? (messages) => provider.stream(messages, undefined, opts.signal ? { signal: opts.signal } : undefined)
      : streamFromNextSource(provider);
  // P0 错误即事件：模型流抛错（断网 / 额度 / 鉴权 / 响应解析）此前只向上冒泡，
  // 事件流与 UI 一律看不见失败。这里在边界落一条 error 后把原错误继续上抛——
  // 调用方语义逐字不变。取消不是失败（终态由编排器分类为 cancelled），不落。
  let currentStep = 0;
  const streamFn = async function* (
    messages: Parameters<Provider["stream"]>[0],
  ): AsyncGenerator<ModelOutput> {
    try {
      yield* rawStream(messages);
    } catch (err) {
      if (!isAbortLike(err) && !opts.signal?.aborted) {
        await events.append({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
          step: currentStep,
        });
      }
      throw err;
    }
  };

  if (userMessage !== undefined) {
    await events.append({
      type: "user_message", content: userMessage,
      ...(userMessageSkill ? { skill: userMessageSkill } : {}),
    });
  }

  for (let step = 0; step < maxSteps; step++) {
    if (opts.signal?.aborted) return; // M3a：取消信号于轮界收束（终态由编排器分类：cancelled）
    currentStep = step;
    let sawToolCall = false;
    for await (const output of streamFn(projectContext(seen))) {
      await events.append(output);
      if (output.type !== "tool_call") continue; // assistant_message / delta / usage：继续

      sawToolCall = true;

      // M2f 工具表摘除（sidechat 只读白名单 / worker 工具面）：不在表内的工具根本不进入执行面——
      // 与提示词无关的硬闸，工具调用被拒且给出明确原因（fail-closed）。
      // ⚠️ 排在 verify 反射循环**之前**：那句「系统门优先于权限门与 TOOLS」说的是绕过 ask/approval，
      //    不含绕过白名单。今天没人同时给 allowedTools 与 verify 钩子（worker 侧 orchestrator.ts:1473
      //    不传 verify）⇒ 洞未暴露；一旦按 spec §6 W4a 给 worker 接上收束闸，「表里没有 verify 却能
      //    执行 verify」就是权限旁路。次序由 tests/loop.test.ts「allowedTools 硬闸与 verify 系统门的次序」钉住。
      if (opts.allowedTools && !opts.allowedTools.includes(output.name as ToolName)) {
        await events.append({
          type: "tool_result",
          callId: output.id,
          ok: false,
          output: `[tool table] ${output.name} 不在本会话工具表（只读白名单摘除）`,
        });
        continue;
      }

      // §9.3 disallowed-tools：激活期摘工具（同一类硬闸，区别只在**时机**——run 中途才生效）。
      // 同样排在 verify 反射循环之前：被摘掉的工具不能因为「它是系统门」就绕过白名单。
      const sk = opts.skillDenial?.(output.name);
      if (sk !== undefined && sk !== null) {
        await events.append({
          type: "tool_result",
          callId: output.id,
          ok: false,
          output: `[skill] ${output.name} 已被 ${sk} 的 disallowed-tools 摘除（本 turn 内不可用）`,
        });
        continue;
      }

      // ---- verify 反射循环（系统门：优先于权限门与 TOOLS，但不越过上面的工具表硬闸）----
      if (output.name === "verify") {
        if (!opts.verify) {
          await events.append({
            type: "tool_result",
            callId: output.id,
            ok: false,
            output: "verify: 未接线验证门（fail-closed）",
          });
          continue;
        }
        const beat = await verifyBeat(output.id, false);
        if (beat === "stop") return; // 通过或达上限 → 收束，不再调用模型
        continue; // 失败已回注，同轮继续修
      }

      // M2e：PreToolUse hook 先于权限门（CC 语义）；deny/exit2 阻断该次工具调用，
      // allow/ask 继续走原有权限管线（hook 无特权，§9.8 让步序）。
      if (opts.hooks) {
        try {
          const pre = await opts.hooks.run("PreToolUse", {
            event: "PreToolUse",
            tool_name: output.name,
            tool_args: output.args,
            tool_use_id: output.id,
            agent_id: opts.agentId,
          });
          if (pre.blocked) {
            await events.append({
              type: "tool_result",
              callId: output.id,
              ok: false,
              output: "[hook blocked] " + (pre.blockReason ?? "PreToolUse hook 阻断"),
            });
            continue;
          }
        } catch (err) {
          // hook 引擎自身故障不得炸 loop（与 prune/地图同族的静默降级面）
          console.warn("[hooks] PreToolUse 引擎失败:", err instanceof Error ? err.message : String(err));
        }
      }

      // 权限门：先过门再动手（verify 已在上面分支处理，此处 name 不含 verify）
      const name = output.name as Exclude<ToolName, "verify">;
      const decision = gate(mode, name, interactive);
      if (decision !== "allow") {
        const reason = decision === "deny" ? denyReason(name) : null;
        await events.append({
          type: "tool_result",
          callId: output.id,
          ok: false,
          output: `[permission denied] ${output.name} 在 ${mode} 档（${interactive ? "交互" : "非交互"}）下被门拒绝（${decision}${reason ? `：${reason}` : ""}）`,
        });
        continue;
      }

      const tool = (opts.tools ?? TOOLS)[name];
      let result;
      if (!tool) {
        result = { ok: false, output: `unknown tool: ${output.name}` };
      } else {
        const ctx = {
          workspace,
          emit: (e: Parameters<EventLog["append"]>[0]) => events.append(e),
          callId: output.id,
          clarify: opts.clarify,
          plan: opts.plan,
          ...(opts.signal ? { signal: opts.signal } : {}), // C12：取消信号透传进长驻工具
          ...(opts.impact ? { impact: opts.impact } : {}), // M7：影响面钩子透传进写工具
        };
        try {
          result = await tool.run(output.args, ctx);
        } catch (err) {
          result = { ok: false, output: err instanceof Error ? err.message : String(err) };
        }
      }
      // M1c：gatedTool 自动放行时在结果上附带审计元数据（结构扩展），透传进 tool_result 事件
      const audit = (result as ToolResultWithAudit).auto;
      // 换路压力记账（只读，不改事件序）：动作换了 ⇒ 上一轮的重复段结束，解除提示帽
      let repeatNote = "";
      if (opts.stuckNudge === true) {
        const action = stuckActionOf(output.name, output.args);
        const lastTurn = stuckTurns.length > 0 ? stuckTurns[stuckTurns.length - 1] : undefined;
        if (lastTurn !== undefined && lastTurn.action !== action) nudgedActions.delete(lastTurn.action);
        stuckTurns.push({ action, observation: stuckObservationOf(result.output), ok: result.ok });
        if (stuckTurns.length > DEFAULT_STUCK_CONFIG.windowSize) stuckTurns.shift();
        const verdict = detectStuck(stuckTurns);
        if (verdict.stuck && !nudgedActions.has(action)) {
          nudgedActions.add(action);
          repeatNote = verdict.rule === "same_action_error_x3"
            ? `\n[repeat] 同一个 ${output.name} 调用已连续 ${String(verdict.repeats)} 次失败——原样重试不会改变结果：换一个探针（改命令 / 换路径 / 直接 read 那个文件）或说明卡点。`
            : `\n[repeat] 同一个 ${output.name} 调用已连续 ${String(verdict.repeats)} 次拿到逐字相同的结果——再问一次不会有新信息：换一个探针或说明为何仍需重复。`;
        }
      }
      // M2e：PostToolUse（成功）/ PostToolUseFailure（失败）——additionalContext 回注 tool_result 尾部
      let postContext = "";
      if (opts.hooks) {
        try {
          const post = await opts.hooks.run(result.ok ? "PostToolUse" : "PostToolUseFailure", {
            event: result.ok ? "PostToolUse" : "PostToolUseFailure",
            tool_name: output.name,
            tool_args: output.args,
            tool_response: result.output,
            tool_use_id: output.id,
            agent_id: opts.agentId,
          });
          if (post.additionalContext !== "") postContext = "\n[hook] " + post.additionalContext;
        } catch (err) {
          console.warn("[hooks] PostToolUse 引擎失败:", err instanceof Error ? err.message : String(err));
        }
      }
      await events.append({
        type: "tool_result",
        callId: output.id,
        ok: result.ok,
        output: result.output + postContext + repeatNote,
        ...(audit ? { auto: audit } : {}),
      });
      if (result.ok && (name === "write_file" || name === "edit_file")) wroteThisRun = true;
    }
    if (!sawToolCall) {
      // ---- 能力 5 收束闸：写过盘却从未自调 verify ⇒ harness 补一拍验证，别把「说了」当「验了」----
      // 旧行为：只有模型自己调 verify 才会验证（提示词写着「修改完成后调用 verify」，纯靠自觉），
      // 「顶尖 Agent 能证明代码真的能跑」这条在自动路径上是空的。
      // 边界：① 每 run 至多一拍（verifyAttempts>0 即让位给模型自调路）；② 仓库没有 verify 面
      // （无 config verify 字段且 package.json 无 lint/test）⇒ 整段跳过，零行为零额外调用；
      // ③ 探测本身失败（config 存在但 JSON 坏）⇒ 同样跳过并告警——**绝不让探针炸掉 run**
      // （verify 门自身的异常早有同族 try/catch，这里同口径）；④ 缺省不开（autoVerify !== true 零行为）。
      if (opts.verify && opts.autoVerify === true && wroteThisRun && verifyAttempts === 0) {
        let hasSurface = true;
        try {
          hasSurface = (await opts.verify.surface?.()) !== false;
        } catch (err) {
          hasSurface = false;
          console.warn("[verify] 可验面探测失败，跳过自动验证拍:", err instanceof Error ? err.message : String(err));
        }
        if (hasSurface) await verifyBeat("harness-auto-verify", true);
      }
      return; // 模型认为任务结束（纯文本轮 / 事件源耗尽）
    }
  }
  throw new Error(`agent loop 超过 maxSteps=${String(maxSteps)}，强制中止`);
}
