// M2d 会话结束自动沉淀（§8.1.4 双轨触发②）：hook 提示模型按四类型检查本轮是否有值得沉淀项，
// 模型自行调 remember 或判无。写入即事件：remember 的 tool_call/tool_result 照常落事件流（审计），
// 沉淀指令只在 provider 调用时以 user 角色出现，不落 user_message 事件（不污染固定回注名单）。
// 合并审批：整个沉淀轮只发一次审批请求——批准 = 本轮全部 remember 写入放行，拒绝 = 全部不写
//（防审批疲劳，§10.4 scope 机制复用）。「调用失败」与「无内容可沉淀」显式分型（mem0 main.py:963-969）。
import { isEnvVerifyCause, replay, type AgentEvent } from "../../events";
import { projectContext } from "../context";
import type { Provider, ProviderMessage } from "../../providers";
import type { Tool, ToolContext } from "../../tools/base";
import type { GateMeta } from "../../permissions/autonomy";
import { LESSON_MEMORY_TYPE, distillLessons, sessionOf } from "./lessons";
import { projectMemoryDir, writeTopic } from "./store";
// 能力 10 的落盘那一跳（失败轨迹 → 靶场草稿）；纯取料在 gym/draft，本模块只负责在会话结束时递上 events 与证据。
import { writeDraftFromFailedSession } from "../gym/draft";

/** 沉淀指令（§6.5 雏形：四类型检查 + skip 纪律 + 唯一写入口）。 */
export const DISTILL_INSTRUCTION = [
  "[系统操作·会话结束沉淀检查] 本任务是跨会话记忆沉淀，不是用户对话；请按以下纪律检查本轮会话是否有值得写入长期记忆的内容：",
  "1. 四类型：user（用户角色/偏好）、feedback（用户纠正）、project（代码/git 推导不出的进行中事项）、reference（外部信息源位置）。",
  "2. skip 纪律：能从代码/git 历史推导的内容不入记忆；任务进度/计划不是记忆（那是事件流与 plan 卡）。",
  "3. 写入只经 remember 工具（scope=project 写项目层、scope=global 写用户全局；kind=memory 必带 type 与 topic）。",
  "4. 禁止把密钥/API key/凭据写入记忆。",
  "5. 没有值得沉淀的内容就只回答「无」三个字，不要调用工具。",
].join("\n");

/** 沉淀轮三类结局的判定留痕（层名单列 `X-distill`：这些判定不在 `evaluate` 里发生）。
 *  缺 `mode` 是刻意的（见 `GateMeta.mode` 注释）：这一轮不受档位机管辖，编一个档位会把它的量
 *  算进那一档的免批率。**三类不塌成一格**是这条表存在的全部理由——
 *  `denied` = 白名单挡下（没问过人），`rejected` = 问过人且人说不，`approved` = 问过人且人说行。
 *  前两者在 §7 的可标语料里是不同侧：借成一格就把最稀缺的正例读没了。 */
export type DistillGateKind = "whitelist" | "unapproved" | "approved";
export const DISTILL_GATE: Record<DistillGateKind, Pick<GateMeta, "layer" | "verdict">> = {
  whitelist: { layer: "X-distill", verdict: "denied" },
  unapproved: { layer: "X-distill", verdict: "rejected" },
  approved: { layer: "X-distill", verdict: "approved" },
};

export type DistillOutcome =
  | { kind: "disabled" } // 开关关闭：完全不触发（无 provider 调用、无审批、无写入）
  | { kind: "no_content" } // 模型判无（或会话为空）：合法终态，不是失败
  | { kind: "saved"; writes: number; asks: number }
  | { kind: "failed"; why: string }; // provider 异常等调用失败：显式分型，不静默

export interface DistillOptions {
  enabled: boolean;
  logPath: string;
  workspace: string;
  /** 沉淀轮 provider（与会话同源；脚本耗尽后产出为空 = 判无）。
   *  脚本化 provider 走这条；真 session provider 走下面的 `providerFor`（二选一，后者优先）。 */
  provider: Provider;
  /** 真 provider 的**惰性构造口**：拿到已算好的指令（末尾临时 user 消息）再建 provider。
   *
   *  为什么需要它（2026-09-30 实测的缺口）：真 session provider 以事件日志为唯一事实源，
   *  构造时就把 system / 工具面 / 历史全定了，`stream()` 收到的 messages 参数被整份忽略。
   *  于是旧写法 `[...projectContext(events), {role:"user", content: instruction}]` 里的指令
   *  **一个字都到不了模型**——实测那一轮请求是 `[system, user:"<原任务>", assistant:"…"]`。
   *  后果：模型把沉淀轮读成「用户又发了一遍原任务」，不知道四类型纪律、不知道只许调 remember；
   *  它照样答「无」，而那恰好是常见合法终态，所以这个洞长期没被发现。
   *
   *  指令的两个约束决定了它既不能只放内存、也不能进日志：
   *  · 只放内存 ⇒ 真 provider 发不出去（上面这条）；
   *  · 写进日志 ⇒ 下一轮 context 投影会把它当成用户的真实发言重放。
   *  所以单开一条「只在本次请求里存在」的通道（`ephemeralUserTurn`），并且放在**末尾**：
   *  前缀缓存按前缀匹配，追加在尾部不动前面任何一段——沉淀轮能拿到 98.8% 命中就是靠这个。 */
  providerFor?: (instruction: string) => Provider;
  signal?: AbortSignal;
  /** 未加门的 remember 工具（合并审批本身就是本轮的权限门）。 */
  rememberTool: Tool;
  emit: (e: AgentEvent) => Promise<void>;
  /** 合并审批口：整个沉淀轮只应请求一次；返回是否批准。缺省 = fail-closed 拒绝。 */
  mergedApproval?: () => Promise<boolean>;
}

/** 从事件流抽取失败轨迹摘要（纯函数、零副作用、有界输出）。
 *  能力 6/10 的缺口：distill 只是把整段事件回放给模型，模型注意力不会自动落在失败上——
 *  而失败（验证未过、工具报错）恰是「下次怎么不重犯」的最高价值素材。这里把失败聚成
 *  一行显式证据并并入沉淀指令，引导模型按 feedback 类型沉淀；成功轮返回空串（零注入）。 */
export function failureDigestFromEvents(events: AgentEvent[]): string {
  const callName = new Map<string, string>();
  const toolFails = new Map<string, number>();
  let verifyFails = 0;
  let verifyExhausted = 0;
  /** Env-caused beats: their callIds and cause mix. TWO surfaces must be blocked, not one:
   *  the `verify_result` itself AND the `tool_result(ok:false)` that loop injects for the same beat.
   *  Blocking only the first still leaves "verify x N (tool failure)" in the digest -- same debt,
   *  renamed. (An invariant held by N readers has to be enforced at all of them.) */
  const envVerifyCallIds = new Set<string>();
  const envCauses = new Map<string, number>();
  for (const e of events) {
    if (e.type === "tool_call") {
      callName.set(e.id, e.name);
    } else if (e.type === "tool_result" && !e.ok) {
      if (envVerifyCallIds.has(e.callId)) continue;
      const name = callName.get(e.callId) ?? "unknown";
      toolFails.set(name, (toolFails.get(name) ?? 0) + 1);
    } else if (e.type === "verify_result" && !e.ok) {
      if (isEnvVerifyCause(e.cause)) {
        const k = String(e.cause);
        envVerifyCallIds.add(e.callId);
        envCauses.set(k, (envCauses.get(k) ?? 0) + 1);
        continue;
      }
      verifyFails += 1;
      if (e.attempt >= e.maxAttempts) verifyExhausted += 1;
    }
  }
  const parts: string[] = [];
  const tf = [...toolFails.entries()];
  if (tf.length > 0) {
    parts.push(tf.map(([n, c]) => n + "\u00d7" + String(c)).join(", ") + "\uff08\u5de5\u5177\u5931\u8d25\uff09");
  }
  if (envCauses.size > 0) {
    const mix = [...envCauses.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => k + "\u00d7" + String(c)).join(", ");
    parts.push(
      "\u53e6\u6709 " + String(envVerifyCallIds.size) + " \u62cd\u9a8c\u8bc1\u56e0 harness \u4fa7\u539f\u56e0\u6ca1\u8dd1\u6210\uff08" + mix
        + "\uff09\u2014\u2014\u8fd9**\u4e0d\u662f\u6a21\u578b\u7684\u5931\u8d25**\uff0c\u4e0d\u8981\u5199\u8fdb\u300c\u8be5\u6a21\u578b\u4f1a\u5728\u6b64\u5904\u5931\u8d25\u300d\u7684\u7ecf\u9a8c\uff1b"
        + "\u503c\u5f97\u6c89\u6dc0\u7684\u662f\u300c\u8fd9\u5957\u73af\u5883\u7f3a\u4ec0\u4e48 runner / \u914d\u7f6e\u300d\u8fd9\u7c7b\u53ef\u590d\u7528\u7684\u524d\u7f6e\u6761\u4ef6",
    );
  }
  if (verifyFails > 0) {
    parts.push(
      String(verifyFails) + " \u6b21\u9a8c\u8bc1\u5931\u8d25" +
        (verifyExhausted > 0 ? "\uff0c\u5176\u4e2d " + String(verifyExhausted) + " \u6b21\u8fbe\u4e0a\u9650\u505c\u6b62" : ""),
    );
  }
  if (parts.length === 0) return "";
  return (
    "[\u5931\u8d25\u8f68\u8ff9\u00b7\u9ad8\u4ef7\u503c\u6c89\u6dc0\u7d20\u6750] \u672c\u8f6e\uff1a" +
      parts.join("\uff1b") +
      "\u3002\n\u8fd9\u4e9b\u662f\u300c\u4e0b\u6b21\u600e\u4e48\u4e0d\u91cd\u72af\u300d\u7684\u76f4\u63a5\u8bc1\u636e\u2014\u2014\u82e5\u5931\u8d25\u539f\u56e0\u5c5e\u4e8e\u4ee3\u7801/git \u63a8\u5bfc\u4e0d\u51fa\u7684\uff08\u73af\u5883\u53e3\u5f84\u3001\u9690\u853d\u4f9d\u8d56\u3001\u53cd\u590d\u8e29\u7684\u5751\uff09\uff0c\n\u8bf7\u6309\u7c7b\u578b feedback \u6c89\u6dc0\uff08remember\uff0ckind=memory\u3001type=feedback\u3001scope=project\uff09\uff1b\u80fd\u4ece\u4ee3\u7801/git \u63a8\u5bfc\u7684\u4e0d\u5165\u8bb0\u5fc6\u3002"
  );
}

/** M6 · 把失败轨迹写成**带证据指针**的教训条目（确定性、不经模型）。
 *
 *  与本文件上面那条 `failureDigestFromEvents` 的分工：digest 是喂给模型的**计数**摘要（凭据不足、
 *  结论自由）；这里是**落盘**的条目（每条指回哪条会话、哪个 callId），下一轮回注。
 *
 *  两处设计取舍照写不藏：
 *  · **不过合并审批**（业主已定）。写入内容是提炼出来的原文摘录 + 事件指针，不是模型自由文本；
 *    但它确实绕过了 remember 的审批面——若日后要求人工把关，把这里的 writeTopic 挪到
 *    `mergedApproval` 之后即可，形状不用改。
 *  · **失败不许连累沉淀结局**。`writeTopic` 在索引超上限时会抛 `index_overflow`，那是
 *    「记忆写满了」，不是「本轮该判 failed」——两类混起来会凭空吃掉一整轮沉淀。 */
export interface LessonWriteResult {
  written: string[];
  failed: { topic: string; why: string }[];
}

export async function writeLessons(opts: {
  events: AgentEvent[];
  logPath: string;
  workspace: string;
  emit: (e: AgentEvent) => Promise<void>;
  nowISO?: string;
}): Promise<LessonWriteResult> {
  const out: LessonWriteResult = { written: [], failed: [] };
  let lessons;
  try {
    lessons = distillLessons(opts.events, opts.logPath);
  } catch (err) {
    // 提炼是纯函数，抛错只可能是事件形状变了。整轮跳过但**留痕**——静默吞掉等于
    // 「教训功能悄悄不产出了」而没人知道。
    await opts.emit({ type: "tool_result", callId: "", ok: false, output: "[memory] 教训提炼失败: " + (err instanceof Error ? err.message : String(err)) });
    return out;
  }
  const dir = projectMemoryDir(opts.workspace);
  for (const l of lessons) {
    try {
      await writeTopic(dir, l.topic, LESSON_MEMORY_TYPE, l.body, opts.nowISO ?? new Date().toISOString());
      out.written.push(l.topic);
    } catch (err) {
      out.failed.push({ topic: l.topic, why: err instanceof Error ? err.message : String(err) });
      // fail-visible：落盘失败必须能在事件流里看到，否则「记忆没写进去」是无人知晓的静默失败。
      await opts.emit({
        type: "tool_result",
        callId: l.evidence[0]?.callId ?? "",
        ok: false,
        output: "[memory] 教训条目 " + l.topic + " 写入失败（其余条目照常继续）: " + (err instanceof Error ? err.message : String(err)),
      });
    }
  }
  return out;
}

export async function runSessionEndDistill(opts: DistillOptions): Promise<DistillOutcome> {
  if (!opts.enabled) return { kind: "disabled" };
  let events: Awaited<ReturnType<typeof replay>>;
  try {
    events = await replay(opts.logPath);
  } catch (err) {
    // 「读不到自己的转录」与「本轮确实无可沉淀」是两回事：旧写法把 replay 失败折成
    // events=[] 再落 no_content，正违反本文件头自立的那条规矩（显式分型，不静默）。
    // 也必须在调模型之前退出——读不到历史时烧一次沉淀调用没有意义。
    return { kind: "failed", why: "读会话日志失败: " + (err instanceof Error ? err.message : String(err)) };
  }
  if (events.length === 0) return { kind: "no_content" }; // 会话确实为空：合法终态，不是失败
  // 失败轨迹引导（能力 6/10）：把失败聚成显式证据并入指令——回放本身不含注意力引导，
  // 模型不会自动盯着失败看；无失败时 digest 为空串，指令逐字不变（零行为回归）。
  const digest = failureDigestFromEvents(events);
  /* M6 教训落盘：放在调 provider **之前**——此刻事件已在手，写入不依赖任何模型判断，
     正是「不许凭空总结」要的那一支。放在之后的话，一轮 provider 异常（failed 结局）就会
     把已经算好的证据一起带走。失败不改变下面的结局（见 writeLessons 的取舍注释）。 */
  await writeLessons({ events, logPath: opts.logPath, workspace: opts.workspace, emit: opts.emit });
  /* 能力 10 的另一半（2026-10-05 接通）：失败轨迹 ⇒ 靶场草稿。此前 `renderDraft` 只有手工 CLI
     （`scripts/gym-draft.ts`，缺省 dry run + 要 `--apply`）会调，判卷/bench 跑完一片红而
     `fixtures/gym/drafts/` 恒为 0 条。放在 `writeLessons` 同一格：同样**不经模型**的确定性落盘，
     且此刻 events / digest / workspace 都已在手。跳过原因静默（成功轮与「工作区没有靶场」是绝大多数，
     每轮都 emit 会把事件流淹掉），只有真写失败才出声；这一跳挂了也不改下面的结局（同 writeLessons 的取舍）。 */
  try {
    const drafted = await writeDraftFromFailedSession({
      events, caseId: sessionOf(opts.logPath), digest, workspace: opts.workspace,
    });
    if (drafted.skipped === "write-error") {
      await opts.emit({ type: "tool_result", callId: "", ok: false, output: "[gym] 失败轨迹草稿写入失败: " + drafted.why });
    }
  } catch (err) {
    await opts.emit({ type: "tool_result", callId: "", ok: false, output: "[gym] 失败轨迹草稿异常: " + (err instanceof Error ? err.message : String(err)) });
  }
  const instruction = digest.length > 0 ? digest + "\n\n" + DISTILL_INSTRUCTION : DISTILL_INSTRUCTION;
  /* 真 session provider 以事件日志为唯一事实源（`stream(_messages,_tools)` 明确忽略入参），
   * 所以「只在内存塞一条指令」是发不出去的——那正是本模块长期存在的缺口（见 DistillOptions
   * 上 `providerFor` 的注释）。`providerFor` 在场时按**已算好的指令**现建 provider：
   * 指令经 `ephemeralUserTurn` 进请求**末尾**（前缀缓存靠前面逐字不动才命中，
   * 且它不进日志——落日志会让下一轮 context 投影把它当用户发言重放）。 */
  const provider = opts.providerFor !== undefined ? opts.providerFor(instruction) : opts.provider;
  /* 保留给脚本化 provider 的旧路径：那份 messages 数组对真 provider 无效，但
   * 对直接 yield 预设输出的脚本 provider 仍是它读的东西（tests/distill.test.ts 走这条）。 */
  const messages: ProviderMessage[] = [...projectContext(events), { role: "user", content: instruction }];
  let asks = 0;
  let writes = 0;
  let sawRemember = false;
  let approval: boolean | null = null;
  const ctx: ToolContext = { workspace: opts.workspace, signal: opts.signal };
  try {
    opts.signal?.throwIfAborted();
    for await (const out of provider.stream(messages, [], { signal: opts.signal })) {
      opts.signal?.throwIfAborted();
      // 2026-10-07 用户实测：沉淀轮的**正文**原来原样进了主流 —— 模型按指令回一句「无」，
      // 于是每轮回答后面都多挂一条「无」，看起来像模型突然说了句莫名其妙的话。
      // 这一轮是**收尾记账**（指令经 ephemeralUserTurn 进请求，本身不进日志），不是答给用户的话：
      //   · usage 照旧 emit —— 花掉的 token 必须记账（token 面板 / 成本闸都读它）；
      //   · 正文不再 emit —— 它真正有内容的产物是 remember 调用（下面照旧 emit，走审批）。
      if (out.type === "usage") {
        await opts.emit(out as AgentEvent);
        continue;
      }
      if (out.type === "assistant_delta" || out.type === "assistant_message") {
        continue;
      }
      if (out.type !== "tool_call") continue;
      if (out.name !== "remember") {
        await opts.emit({ type: "tool_result", callId: out.id, ok: false, output: "[distill] 沉淀轮只允许 remember 工具，" + out.name + " 已拒绝", gate: DISTILL_GATE.whitelist });
        continue;
      }
      sawRemember = true;
      await opts.emit({ type: "tool_call", id: out.id, name: out.name, args: out.args });
      if (approval === null) {
        asks += 1;
        approval = opts.mergedApproval ? await opts.mergedApproval() : false;
      }
      opts.signal?.throwIfAborted();
      if (!approval) {
        await opts.emit({ type: "tool_result", callId: out.id, ok: false, output: "[permission denied] remember 会话结束自动沉淀未获批准（合并审批一次，本轮全部拒绝）", gate: DISTILL_GATE.unapproved });
        continue;
      }
      try {
        const r = await opts.rememberTool.run(out.args, ctx);
        if (r.ok) writes += 1;
        await opts.emit({ type: "tool_result", callId: out.id, ok: r.ok, output: r.output, gate: DISTILL_GATE.approved });
      } catch (err) {
        await opts.emit({ type: "tool_result", callId: out.id, ok: false, output: err instanceof Error ? err.message : String(err), gate: DISTILL_GATE.approved });
      }
    }
  } catch (err) {
    return { kind: "failed", why: err instanceof Error ? err.message : String(err) };
  }
  if (sawRemember && writes > 0) return { kind: "saved", writes, asks };
  return { kind: "no_content" };
}
