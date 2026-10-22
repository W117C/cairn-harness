import { isEnvVerifyCause } from "../events";
import type { AgentEvent, EventLog, SkillInvocationMeta, UserMessageAttachment, UserMessageOrigin, VerifyCommandResult } from "../events";
import { redactEventForLog, redactSecrets } from "../events";
import { autoOf, denyReason, gate, type PermissionMode, type ToolResultWithAudit } from "../permissions";
import type { HookEngine } from "./plugins/hooks";
import { projectContext } from "./context";
import { SubmissionLedger, submissionRequestId } from "./submission-ledger";
import type { LegacyNextProvider, ModelOutput, Provider } from "../providers";
import { streamFromNextSource } from "../providers";
import { failureDigest, repeatDigestNote, verifyOutcomeCause, type VerifyHook, type VerifyOutcome } from "./verify";
import { DEFAULT_STUCK_CONFIG, detectStuck, stuckActionOf, stuckObservationOf, type StuckTurn } from "./stuck";
// M10②：无进展阶梯接进运行循环（此前 `no-progress.ts` 全树零生产消费者，只在门里跑）。
// 取的全是纯判据：`no-progress.ts` 只做判断，出声与措辞在本文件（判据别抄第二份）。
import { detectAlternatingThrash, detectVerifyStagnation, noProgressLadder, verifySignature, type VerifyBeat } from "./no-progress";
import { mayHaveWrittenDisk } from "./write-face";
// 能力 12 交付断言：判据住在 `./delivery-guard`；loop 在收束时检查事件和工作区最终状态，
// 再决定是否出声（与 `no-progress` 一样，判据与动作分开维护）。
// 哨兵 callId 也从那里 import 并再导出（`context.ts` 要读它，而本文件反过来 import context
// ⇒ 常量放本文件会造出依赖圈）。**两条都写**：`export … from` 不进本地作用域，而下面要用它。
import { DELIVERY_GUARD_CALL_ID, EMPTY_RUN_DELIVERY, describePhantomDelivery, findEmptyRun, findPhantomDelivery } from "./delivery-guard";
export { DELIVERY_GUARD_CALL_ID };
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
  /** goal 模式的自动续跑轮（可选）：这条 user_message 不是人发的，origin 记下它是谁发的。
   *  与 skill 同一思路：零新增事件类型，缺省 = 字段不进事件 ⇒ 既有事件流逐字节不变。 */
  userMessageOrigin?: UserMessageOrigin;
  /** 本轮用户消息附带的引用（可选）：只记路径/类型，不进正文；缺省 = 字段不进事件。 */
  userMessageAttachments?: readonly UserMessageAttachment[];
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
  /** 能力 5 的最后一环：收束闸拍出**代码红**时，不直接收束，而是再要一轮模型去修，修完重验一次。
   *  注入通道早就在跑：`context.ts` 的 autoVerifyNote 把这条红投成下一轮可见的 user 消息
   *  （BLOCKED「能力 5 收束闸」裁决 1 的前提「模型看不到」已过期，本轮实测改判据钉住）。
   *  缺省 undefined/false = 零行为（今日逐字同形：拍完即 return）。开则上限是硬编码的：
   *  至多一次返修、至多两拍，且**第二拍只在模型真的又改过盘时**才跑——
   *  没改动就重验等于把同一份代码再跑一遍全量测试；改完不重验则是拿一个新的假绿换掉旧的。
   *  环境红（`isEnvVerifyCause`）不驱动返修：装不上工具链的机器上重跑一遍还是 127，
   *  那是把 P1-3 的归因白做。多一轮 = 花真钱 ⇒ 默认关，开与不开由实测读数裁。 */
  autoVerifyRepair?: boolean;
  /** 能力 12 的返修环：交付断言落红（幽灵交付 / 空转）时**再要一轮**去补做，而不是带着红收束。
   *  动机与 `autoVerifyRepair` 同一族：zeroshot 那句「写代码的 agent 不该由自己宣布能跑」
   *  的下半截是「该有人要求它回去补」。只落红不改行为，那一趟已经结束了——
   *  实测 6 趟里 5 趟交付了不存在的文件，落红只让审计面看见，用户拿到的仍然是一个不存在的路径。
   *  开则：至多**一轮**返修（与 autoVerifyRepair 的「至多一次、至多两拍」同形），
   *  红字由 context.ts 投成下一轮可见的 user 消息；那一轮若仍没落盘 ⇒ 收束（不无限要）。
   *  缺省 undefined/false = 零行为（逐字同今日：落红即收束）。 */
  deliveryRepair?: boolean;
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
  /** 执行面补表钩子（run 中途才出现的工具）：模型面是**逐请求**重算的（provider 的 requestFace），
   *  而 `TOOLS` 那张执行表是 run 起点快照 ⇒ 一场会话跑到一半才被批准的插件，它的 MCP 工具
   *  会出现在模型清单里、却在执行面查不到，落一句 `unknown tool: …`——这正是本仓反复判死的
   *  「模型看到的工具 ≠ 能执行的工具」。每次查表前先问一次这个钩子，缺省 undefined = 零行为
   *  （既有路径字节不变）。 */
  resolveTool?: (name: string) => import("../tools").Tool | undefined;
  /** M3a 取消信号（编排器 AbortController 树）：等待边界复查，已开始工具的真实结果仍落流。
   *  缺省 undefined = 无取消（既有路径字节不变）。 */
  signal?: AbortSignal;
  /** worker 归因（§4.4）：只进 hook 的 stdin JSON（agent_id 字段），主会话缺省 = 该字段缺席。 */
  agentId?: string;
  /** 识图通道：`read_image` 读到的图片在**下一轮**请求里附上（本轮 tool_result 已经发出去了）。
   *
   *  为什么是下一轮而不是本轮：provider 是会话型，本轮的消息在调 tool 之前就已经发出去；
   *  图片只能从下一轮的请求进模型面。这与 `verify` 自动补拍的红「下一轮回流成 user 消息」
   *  是同一条时序（context.ts 的 autoVerifyNote）。
   *
   *  为什么由调用方递一个收件盒而不是 loop 自己攒：loop 每轮从事件日志重建历史
   *  （projectContext），而图片刻意**不进事件日志**（base64 会让会话文件大一个量级，
   *  且事件流是重放契约）。所以图片只能活在进程内存里，收件盒由持有 provider 的调用方
   *  （agent-runner）提供——它同时握着 provider 与这个盒，能把它塞进下一次请求。
   *  缺省 undefined = 零行为（识图关着时，字节与路径都不变）。 */
  pendingImages?: {
    /** loop 侧：读到的图存进盒子。 */
    push: (images: readonly { type: "image"; dataUrl: string }[]) => void;
  };
  /** 换路压力：同一调用连续重复时，在那条 tool_result 尾部追加一行提示（见 loop 内注释）。
   *  **缺省 false = 零行为**——三条既有路径各自的原因：
   *  - worker（编排器跑 runLoop）：那边已有更强的看门（detectStuck → waiting_input 等人），
   *    再叠一层提示是双重指挥；且追加文本会改掉 `stuckObservationOf` 比较的观察串，
   *    把「×4 相同」打散成「×3 相同 + 1 条带尾注」⇒ 看门永不触发（m3c 集成测实测到）。
   *  - 靶场（gym）：用量是按字节推的，注入文本会扰动跨 case 基线（测的是模型不是提示措辞）。
   *  - sidechat：只读问答，重复便宜。
   *  所以只有人直用的主会话（agent-runner）显式开。 */
  stuckNudge?: boolean;
  /** 第 9 点·用户干预注入（steering）：**轮中**取一条用户插话。
   *
   *  与 `pendingImages` 同一形状（收件盒由调用方持有），但时序不同：图片只能等到**下一轮**请求
   *  （provider 在本轮调工具前就已经发出了消息），而插话**就是要在下一拍请求里出现**——
   *  两者都落在「轮界」这一拍，所以都从盒子取。
   *
   *  **安全边界（为什么是轮界而不是随时）**：这一拍之前所有在途工具都已结算、事件已落盘
   *  （`for await` 循环已退到轮末），所以插入一条新 user 消息不会把 tool_call/tool_result 对
   *  拆开、也不会与正在执行的工具抢写；取消信号也在同一个位置被复查。
   *
   *  **它不开新轮**：插话落成带 `origin:{kind:"steering",step}` 的 `user_message`，
   *  `eventsForCurrentRun()` 明确跳过它（否则整轮之前的承诺与证据会静默失效）。
   *  它也不额外买步：一次 `run` 的步数帽仍是那一个帽，插话不增加 `maxSteps` 的计数语义。
   *
   *  缺省 undefined = 零行为（既有路径字节与调用次数都不变）。 */
  steering?: {
    /** 有插话就取走（take 即清空：同一条不会被两拍各付一遍 token）。空/undefined = 没有。 */
    take: () => readonly string[] | undefined;
  };
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

/** 事件日志落盘前的凭据脱敏（§A4）。
 *
 *  事件日志是**可重放**的：一份 JSONL 存着每一条 tool_call 的 args 与每一条 tool_result 的
 *  output 原文。`run_shell` 的 `cat ~/.aws/credentials` 于是把凭据永久留在盘上——`sanitizedEnv`
 *  只挡 `process.env` 泄漏，挡不住工具**读出来的文件内容**。
 *  `redactSecrets` 本仓早就有了（记忆 / worker 报告 / 评审都过它），唯独这条落盘面漏着。
 *
 *  两处口径：结构不变（只换字符串叶子），非字符串值原样返回——事件形状是重放契约的一部分，
 *  不能因为脱敏顺手改掉。命中即掩码，与 remember 同一条契约（那里遇 `blocked` 抛错，
 *  这里不能：工具已经跑完、模型已经看过，抛错会吞掉一次真实结果）。
 *
 *  2026-10-19 补两条边界（都是实测出来的，不是预防性的）：
 *  ① **循环引用**：旧实现无 visited-set 也无深度帽，`{a:1, self:<自身>}` 直接
 *     `RangeError: Maximum call stack size exceeded`。而这个函数包在 `events.append`
 *     外面 ⇒ 异常从 `runLoop` 直接窜出去，**整轮任务死在那一次 emit 上**。
 *     工具是可能造出自引结构的（诊断/影响面那种带 parent 指针的图）。改用 WeakSet
 *     记来路，重逢时返回一个**显式占位**（不静默丢、也不炸）。
 *  ② **结构不变的适用域**：`Object.entries` 会把 `Map`/`Set`/`Date` 重建成 `{}`
 *     （实测 `{scannedAt: new Date()}` → `{"scannedAt":{}}`）。那已经**改了结构**，
 *     与上面"非字符串值原样返回"的承诺相反。所以非普通对象（无 `Object` 原型或不是
 *     Object/Array 构造器的实例）一律原样返回——它们本来也过不了 JSON 序列化，
 *     落盘面迟早会报，比在这里被静默拍平诚实。 */
/** verify 面落盘用：命令与输出各自过脱敏，其余字段（ok / exitCode / cause）不是文本，原样带走。
 *
 *  为什么 tool_call 那两处修了它还漏着：`verify_result.results[].output` 是**测试输出**——
 *  子流早就有同一个洞，worker-projection.ts:92 的 `verify_result: [["results"]]` 是它的对照
 *  （那里的注释自己写着「最容易把 env 整段打印出来的地方」），主会话这条落盘面却没接。
 *  一条 `pnpm test` 把 `.env` 整段打出来，密钥就永久留在可重放的 JSONL 里。
 *  `command` 同样过：verify 命令行本身就能带凭据（`AWS_SECRET=… pytest`），与 run_shell 的 args 同一族。 */
function redactVerifyResults(results: VerifyCommandResult[]): VerifyCommandResult[] {
  return results.map((r) => ({
    ...r,
    command: redactSecrets(r.command).text,
    output: redactSecrets(r.output).text,
  }));
}

/** harness 收束前补的那一拍用这个哨兵 callId（它**没有**配对的 tool_call，见 `verifyBeat` 上面那段）。
 *  导出是为了让下游（`scripts/loop-eval.ts` 的返修归因）不必再抄一遍这个字符串。 */
export const HARNESS_VERIFY_CALL_ID = "harness-auto-verify";

/** 交付断言那一拍的哨兵 callId：**没有**配对的 tool_call（它不是模型调的工具，
 *  是 harness 在收束那一刻落的证据）。单独一枚是为了让下游能把它与自动验证拍分开——
 *  两件事都叫「harness 补的那一拍」，混用一枚 id 就等于说它们是一回事。
 *  常量住在 `./delivery-guard`（纯叶子模块）：`context.ts` 也要读它，而 loop 反过来 import
 *  context ⇒ 放本文件会当场造出一个圈（`arch-cycle-check` 会红）。再导出见文件头那两条。 */

export async function runLoop(opts: LoopOptions): Promise<void> {
  const { workspace, userMessage, userMessageSkill, userMessageOrigin, userMessageAttachments } = opts;
  const seen: AgentEvent[] = [];
  // ADR 0005：每个 run 独立的账本（含 worker），终态失败粘滞；不承诺跨 run / 重启去重。
  const submissions = new SubmissionLedger<"continue" | "environment-red" | "stop">();
  // Persist first: failed writes must not become model-visible history.
  // 落盘与投影用同一份脱敏副本（`seen`）；工具执行面照原件执行。
  const events: EventLog = {
    async append(event) {
      // **原件**交给消费者（落盘/出站那一侧自己擦——见 redactEventForLog 的注释）：
      // 安全扫描面要看到真内容（脱敏后的串认不出密钥，那道闸就静默空转了）。
      // 上下文面（seen）仍是脱敏副本：模型读到的与盘上的一致，"live 与盘同式"不破。
      await opts.events.append(event);
      seen.push(redactEventForLog(event));
    },
  };
  const cancelUnstartedTool = async (callId: string): Promise<void> => {
    await events.append({ type: "tool_result", callId, ok: false, output: "[cancelled] 会话已取消，工具没有执行" });
  };
  const mode = opts.mode ?? "default";
  const interactive = opts.interactive ?? false;
  const maxSteps = opts.maxSteps ?? 50;
  const maxVerify = opts.verify?.maxAttempts ?? 3;
  let verifyAttempts = 0;
  /** 记在模型账上的拍数（也是 `verify_result.attempt` 的取值）——**只有它受 `maxVerify` 约束**。
   *  环境拍（工具链没装 / 超时 / 没有可验面 / 包管理器自己拒了 / 钩子抛错）对代码的证明力是零，
   *  拿它去消耗模型的修复额度，等于让 harness 侧的问题花用户的钱：红字还在教模型改本来正确的代码。 */
  let chargedAttempts = 0;
  /** 环境拍的独立上限：不占修复额度≠无限重试。耗尽即停，但停因说清楚是 harness 侧。 */
  let envVerifyBeats = 0;
  const MAX_ENV_VERIFY_BEATS = 2;
  // 上一拍注入给模型的失败摘要：逐字相同即「这一拍没带来新信息」，改注一行提示而非重发整段。
  let lastVerifyDigest: string | null = null;
  // 能力 5：本 run 是否真的落过盘（决定要不要补自动验证），以及自动拍是否已用过。
  let wroteThisRun = false;
  // 返修那一支的三个计数：自动拍已跑几拍、上一拍之后是否真的又改过盘、是否已批准再要一轮。
  // 上限写死在这里（1 次返修 / 2 拍），不开 autoVerifyRepair 时这三个变量一个都不参与判断。
  let autoBeats = 0;
  let wroteSinceAutoBeat = false;
  let repairPending = false;
  // 能力 12 交付断言的返修环：本 run 是否已为了补做而多要过一轮（至多一轮）。
  let deliveryRepairUsed = false;
  let deliveryGuardRecorded = false;
  // 换路压力（能力 4/9）：同一调用连败/连抄同一结果时，在那条 tool_result 尾部追加一行提示。
  // 复用 worker 看门那颗纯函数（stuck.ts）与它的阈值，不另造检测器。差别在动作：编排器命中
  // 是把 worker 挂成 waiting_input 等人，交互主循环里暂停会把「一次重复」的代价抬成「整轮等人」，
  // 比它省下的更贵——所以这里只提示，不动终止语义、不新增事件、不多要一轮。每个 rule+action
  // 只提示一次：第 5、6 次再叠同一句话本身就是新的 token 开销，而忽略提示的模型不会被复读说服。
  const stuckTurns: StuckTurn[] = [];
  const nudgedActions = new Set<string>();
  /** M10②：本 run 的验证拍（无进展判据 R1「同一条验证结论连红且中间无写」的唯一取料口）。
   *  **只留最近 8 拍**：判据要的是"当前还在不在原地打转"，更老的拍与结论无关，也不随轮数增长。
   *  与 `judgeNoProgressEvents` 同源：签名取自**刚落进事件流的那份（已脱敏）结果**，
   *  免得"循环这条路的判据"与"门／语料那条路的判据"各看一份数据（第十三族：同一谓词两份）。 */
  const verifyBeats: VerifyBeat[] = [];
  let wroteSinceVerifyBeat = false;
  const nudgedNoProgress = new Set<string>();
  /** 跑一拍 verify 系统门。两种形态：
   *  - manual（模型自调）：有配对的 tool_call ⇒ 失败原文注入同轮继续修，环境红另标以识别无进展重发。
   *  - auto（harness 收束前补拍）：**没有**配对的 tool_call，也就没有合法的**同轮**注入通道
   *    （裸 tool_result 会让 provider 侧 tool 消息失去前置 tool_calls 而 400；合成 tool_call
   *    又违反 action-fusion 明写的「no extra tool calls」不变量）⇒ 只落 verify_result 证据，
   *    红在时间线上可见，不冒充模型行为、也不偷偷多要一轮。返回恒为 "stop"。
   *    跨轮通道在投影侧：context.ts 的 autoVerifyNote 把这条红投成下一轮可见的 user 消息。 */
  const verifyBeat = async (callId: string, auto: boolean): Promise<"stop" | "continue" | "environment-red" | "auto-red"> => {
    verifyAttempts++;
    // verify 是系统门：钩子自身抛错（.agent/config.json 损坏、沙箱 exec 异常）应当记为
    // 「一次验证失败」，而不是把整轮任务炸掉。工具执行早有同族 try/catch，这里补齐同一口径；
    // 异常原因进 tool_result（fail-visible），不让模型只看到「无详细输出」。
    let outcome: VerifyOutcome;
    let hookError: string | null = null;
    try {
      outcome = await (opts.verify as VerifyHook).run(opts.signal);
    } catch (err) {
      hookError = err instanceof Error ? err.message : String(err);
      outcome = { ok: false, results: [] };
    }
    const cause = verifyOutcomeCause(outcome, hookError);
    const envBeat = isEnvVerifyCause(cause);
    /** `attempt` 读的是**记在模型账上的第几次**（judgment-layer §9.3 不变式 1 的原文判卷写法：
     *  连续两拍 timeout ⇒ 序列必须 `1,1` 而非 `1,2`，第三拍照样能跑）。绿拍与环境拍都不推进它，
     *  只报"你现在处在第几次"；纯代码红才 +1。`verifyAttempts` 另一本账，收束闸靠它判
     *  「本 run 跑过任意一拍没有」，与归因无关。 */
    if (!outcome.ok && !envBeat) chargedAttempts += 1;
    const attempt = outcome.ok || envBeat ? chargedAttempts + 1 : chargedAttempts;
    if (envBeat) envVerifyBeats++;
    // M10②：把这一拍记进无进展判据的窗口。签名取**刚落进事件流的那份（已脱敏）结果**——
    // 与 `judgeNoProgressEvents` 看的是同一份数据，不另算一份（同一谓词只留一份）。
    // `wroteSinceLast` 是判据的关键位：两次同签名红之间**有过成功的写**就算"在换路子试"，
    // 不算停滞（见 `detectVerifyStagnation` 的注释：那是 verify 上限该管的事）。
    const beatResults = redactVerifyResults(outcome.results);
    await events.append({
      type: "verify_result",
      callId,
      ok: outcome.ok,
      attempt,
      maxAttempts: maxVerify,
      results: beatResults,
      // 归因落进事件流（审计面）；下面三处出口据此决定"这一拍算谁的账"。
      ...(cause === undefined ? {} : { cause }),
      ...(auto ? { auto: true } : {}),
    });
    {
      const { signature, named } = verifySignature(beatResults);
      verifyBeats.push({
        index: verifyAttempts, attempt, maxAttempts: maxVerify, ok: outcome.ok,
        signature: outcome.ok ? "ok" : signature, named,
        wroteSinceLast: wroteSinceVerifyBeat, userSpokeSinceLast: false,
      });
      if (verifyBeats.length > 8) verifyBeats.shift();
      wroteSinceVerifyBeat = false;
    }
    if (outcome.ok) {
      // 成功的 verify 也必须留配对的 tool_result：旧实现只落 verify_result 就 return，
      // 下一轮投影会给模型注入「工具调用没有收到结果：上次运行中途结束」——与事实相反。
      await events.append({
        type: "tool_result",
        callId,
        ok: true,
        output: "[verify] 验证通过",
      });
      return "stop"; // 验证通过 → 立即停止，不再调用模型
    }
    // 自动拍：**同轮**不外注（没有合法通道），但红不是到此为止——下一轮的投影会把它
    // 回流成一条 user 消息（context.ts 的 autoVerifyNote）。缺省仍不收第二意见：直接收束。
    // 开了 autoVerifyRepair 时，调用方据 "auto-red" 再要一轮模型去修（环境红不算——那是机器的账）。
    if (auto) {
      // 自动拍同样要有配对结果（无论 stop 还是 auto-red）。
      await events.append({
        type: "tool_result",
        callId,
        ok: outcome.ok,
        output: outcome.ok ? "[verify] 自动验证通过" : "[verify] 自动验证未通过",
      });
      return outcome.ok || envBeat ? "stop" : "auto-red";
    }
    if (envBeat && envVerifyBeats >= MAX_ENV_VERIFY_BEATS) {
      // 环境类连拍到独立上限：停，但停因不是"你没修好"，是这台机器跑不了验证。
      await events.append({
        type: "tool_result",
        callId,
        ok: false,
        output: "[verify] 连续 " + String(envVerifyBeats) + " 拍因 harness 侧原因未能执行验证（cause="
          + String(cause) + "），停止。这**不是代码失败**：修复额度一次未耗，"
          + "换 runner / 装工具链或修 verify 配置后再验，别按这条红改代码。",
      });
      return "stop";
    }
    if (!envBeat && chargedAttempts >= maxVerify) {
      // 上限耗尽 → verify_result(failed) 已落，停止且不再调用模型
      await events.append({
        type: "tool_result",
        callId,
        ok: false,
        output: `[verify] 连续失败 ${String(chargedAttempts)}/${String(maxVerify)} 次，已达上限，停止`,
      });
      return "stop";
    }
    // 失败 → 错误输出注入同轮继续修（自动拍加 [harness] 前缀：这条不是模型自己调的）
    const digest = hookError !== null
      ? "[verify] 钩子异常（harness 侧原因，不占修复额度）：" + hookError
      : (auto ? "[harness 自动验证] " : "") + failureDigest(outcome);
    // 环境拍先说清"这不占你的额度"：否则模型读到一条红就去改本来正确的代码（语料里 3/3 是这一类）。
    const envPreface = envBeat
      ? "[verify] 这一拍因 harness 侧原因没跑成（cause=" + String(cause) + "）——不是代码失败，"
        + "修复额度未消耗。下面原文供参考：\n"
      : "";
    const redactedDigest = redactSecrets(digest).text;
    const repeat = redactedDigest === lastVerifyDigest;
    lastVerifyDigest = redactedDigest;
    // M10②：无进展阶梯——**`no-progress.ts` 的唯一生产消费者**（此前它全树零消费者，只在门里跑；
    // 判据写好了没人用，等于模型的"原地打转"没有任何观察者）。
    // 接**在这里**（verify 的手动拍）而不是通用工具块：verify 调用在本文件上面就被拦下并 `continue`，
    // 通用块对它**根本不执行** ⇒ 接在那儿对"只调 verify 的跑"是死路（我先接错一次，判卷当场抓住）。
    // 判据全是纯函数，本文件只负责出声与措辞（同一谓词不抄第二份）。
    // 只补**新信号**那一支（验证停滞 R1 / 往返抖动 R3）：`stuck` 那一支的模型可见措辞是上面通用块里的
    // `[repeat]`（有判卷逐字钉着），不许在这里出第二个同义出口。`silent` 时一个字都不加。
    const stagnation = detectVerifyStagnation(verifyBeats);
    const thrash = detectAlternatingThrash(stuckTurns);
    const np = noProgressLadder({ stuck: detectStuck(stuckTurns), stagnation, thrash });
    const npKey = np.rules.join("|");
    const freshSignal = np.rules.some((r) => r === "verify_stagnation" || r === "alternating_thrash");
    // 每个 rules 组合只出一次：复读同一句话本身就是新的 token 开销，而忽略提示的模型不会被复读说服。
    //
    // **措辞刻意不复述失败正文**：第 2 拍与上一拍逐字相同时，本函数上面已经改用 `repeatDigestNote`
    // 只注一行（`tests/verify.test.ts` 钉着"不重发正文"这条省 token 的语义）。若这里把 `np.evidence`
    // 整段带上，等于把刚省下的正文又塞回去——实测：那条判卷当场红。
    // 所以只报「卡在哪一件 + 第几次」：**指名不等于抄原文**，那一拍的原文本来就在模型手里。
    const which = stagnation.stagnant
      ? `同一条验证结论已连红 ${String(stagnation.repeats)} 次且中间没有任何写入`
      : `同一对动作往返 ${String(thrash.thrashing ? thrash.cycles : 0)} 个来回且观察也回到原值`;
    const noProgressNote = freshSignal && !nudgedNoProgress.has(npKey)
      ? `\n[no-progress] ${which}——同一条路再走一遍不会改变结论：换一个探针（改命令 / 换靶子 / 先 read 那个一直在报错的文件）或说明卡点。`
      : "";
    if (noProgressNote !== "") nudgedNoProgress.add(npKey);
    await events.append({
      type: "tool_result",
      callId,
      ok: false,
      // 同一拍验证的**第二份**原文在下面这行（failureDigest 把 results 整段拼进来）。
      // verify_result 与这份 tool_result 都走同一个落盘/投影脱敏 choke-point：
      // 不会让门里掩码、门口放行。`lastVerifyDigest` 的比对仍用同一脱敏副本，口径一致。
      output: redactSecrets(envPreface + (repeat ? repeatDigestNote(outcome, attempt) : digest) + noProgressNote).text,
    });
    return envBeat ? "environment-red" : "continue";
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
      for await (const output of rawStream(messages)) {
        // 已经收到的 usage 是实际用量，取消也要如实记账；其它迟到输出不再处理。
        if (opts.signal?.aborted && output.type !== "usage") return;
        yield output;
        // 消费方可能在执行工具或落日志时取消；不再拉取下一块，并关闭上游迭代器。
        if (opts.signal?.aborted) return;
      }
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
      ...(userMessageOrigin ? { origin: userMessageOrigin } : {}),
      ...(userMessageAttachments !== undefined && userMessageAttachments.length > 0
        ? { attachments: userMessageAttachments }
        : {}),
    });
  }

  /** 撞帽位（#69）：步数已尽而模型仍在调工具 ⇒ 让这一段也走一次收束闸，再落回循环外那条 throw。 */
  let capReached = false;
  for (let step = 0; step < maxSteps; step++) {
    // 三个出口都补落：r3/r4 实测那一趟停在 `plan_proposed`，循环内那次根本没跑到。
    // 被取消 / 验证通过或达上限 / 模型自然收束——这三条出去时承诺都还没对过账。
    if (opts.signal?.aborted) return; // M3a：取消信号于轮界收束（终态由编排器分类：cancelled）
    currentStep = step;
    // ---- 第 9 点：轮中插话的注入位（**只在轮界，绝不在 for-await 里**）----
    // 位置要求①：必须在 `currentStep = step` **之后**——`streamFn(projectContext(seen))` 是在
    // 下面那句被调用的，它当场快照历史；写在它之前注入才进得了**这一拍**请求。
    // 位置要求②：必须在 for-await 之外——上一拍的每个 tool_call 都已配上 tool_result 落盘、
    // 循环已退到轮末，因此插一条 user 消息不会把 tool 配对拆开、也不会与在途工具抢写。
    // 取料排在本轮第一次请求**之前**也是对的：那时盒子里是空的（没人能在本轮开始前插话），
    // 而 `take()` 一次取走 ⇒ 之后各拍都不会把同一条再付一遍 token。
    // 取消与取料的先后：**取消优先**，用户刚按了停止就不该再为一句插话落事件、更不该多花一次请求。
    // 这条保证由**多处 abort 复查共同给**（本轮顶那个、每步末那个、工具执行前后那几个），
    // 不是单靠某一行——所以判据钉的是**行为**（`steering-injection` 的「取消后迟到的那条插话」：
    // 盒子里的那条必须**没被取走**、也**没换来第 2 次请求**），而不是某个行号。
    // 别把这条注释读成「挪走紧邻那行 abort 就破功」：单挪那行，循环仍会在步末那道 abort 收束。
    if (opts.steering !== undefined) {
      const injections = opts.steering.take();
      if (injections !== undefined) {
        for (const text of injections) {
          if (text.trim() === "") continue; // 空插话不落事件：它不是指令，只是一次误触
          await events.append({
            type: "user_message",
            content: text,
            // 轮次序号是**展示/审计**用（判定不读它，见 `SteeringOrigin` 的注释）。
            origin: { kind: "steering", step },
          });
        }
      }
    }
    let sawToolCall = false;
    let onlyVerifyReplays = true;
    for await (const output of streamFn(projectContext(seen))) {
      if (output.type !== "tool_call") {
        await events.append(output);
        continue;
      }
      sawToolCall = true;
      // 重复 id 回用原提交，参数/工具名变化也不算新调用。历史只保留原调用与回执，
      // 不能只再 append 一条 tool_call 而不配结果，下一轮模型照常读取第一次的完整回执。
      const requestId = submissionRequestId(opts.agentId ?? "main", output.id);
      let isNewSubmission = false;
      const control = await submissions.submit(requestId, async () => {
        isNewSubmission = true;
        // 落盘的那一份与执行用的那一份必须分开：args 只在落盘面脱敏，执行面照原样拿
        // （模型自己写的凭据原样执行，不要在这里把它改成一个掩码路径）。
        await events.append(output); // append 内统一脱敏，落盘与投影同副本

        if (opts.signal?.aborted) {
          await cancelUnstartedTool(output.id);
          return "stop";
        }

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
            blockedBy: "tool-table",
          });
          return "continue";
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
            blockedBy: "skill-denial",
          });
          return "continue";
        }

        // ---- verify 反射循环（系统门：优先于权限门与 TOOLS，但不越过上面的工具表硬闸）----
        if (output.name === "verify") {
          if (!opts.verify) {
            await events.append({
              type: "tool_result",
              callId: output.id,
              ok: false,
              output: "verify: 未接线验证门（fail-closed）",
              blockedBy: "verify-unwired",
            });
            return "continue";
          }
          // verify 会执行仓库自带命令：审计/阻断型 PreToolUse 钩子也必须看得到它
          // （旧实现 verify 分支排在 hook 之前并 continue，`matcher:"*"` 的钩子整支失明）。
          if (opts.hooks) {
            try {
              const pre = await opts.hooks.run("PreToolUse", {
                event: "PreToolUse",
                tool_name: "verify",
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
                  blockedBy: "hook",
                });
                return "continue";
              }
            } catch (err) {
              console.warn("[hooks] PreToolUse(verify) 引擎失败:", err instanceof Error ? err.message : String(err));
            }
          }
          if (opts.signal?.aborted) {
            await cancelUnstartedTool(output.id);
            return "stop";
          }
          const beat = await verifyBeat(output.id, false);
          if (opts.hooks && !opts.signal?.aborted) {
            try {
              await opts.hooks.run("PostToolUse", {
                event: "PostToolUse",
                tool_name: "verify",
                tool_args: output.args,
                tool_response: beat === "stop" ? "[verify] 已收束" : "[verify] 未通过，继续修",
                tool_use_id: output.id,
                agent_id: opts.agentId,
              });
            } catch (err) {
              console.warn("[hooks] PostToolUse(verify) 引擎失败:", err instanceof Error ? err.message : String(err));
            }
          }
          if (beat === "stop") return "stop"; // 通过或达上限 → 收束，不再调用模型
          return beat === "environment-red" ? "environment-red" : "continue"; // 失败已回注，同轮继续修
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
                blockedBy: "hook",
              });
              return "continue";
            }
          } catch (err) {
            // hook 引擎自身故障不得炸 loop（与 prune/地图同族的静默降级面）
            console.warn("[hooks] PreToolUse 引擎失败:", err instanceof Error ? err.message : String(err));
          }
        }

        // 权限门：先过门再动手（verify 已在上面分支处理，此处 name 不含 verify）
        if (opts.signal?.aborted) {
          await cancelUnstartedTool(output.id);
          return "stop";
        }
        const name = output.name as Exclude<ToolName, "verify">;
        const decision = gate(mode, name, interactive);
        if (decision !== "allow") {
          const reason = decision === "deny" ? denyReason(name) : null;
          // 方案门**不是档位裁决**，所以这条拒绝不报档。`checkPermission` 在查
          // `SIDE_EFFECT_DECISION` 之前就先判 `planBlocks()`（permissions/index.ts:107），
          // 四档一律拒、且都与用户传了什么无关。而这一层的 mode 是冻结的 `auto`
          // （agent-runner.ts:1523），照实写出来就变成「在 auto 档」——传了 `--mode read-only`
          // 的用户撞到方案门也会看见它，于是以为自己的 flag 没生效，去 debug 错的方向。
          // 真正的档位裁决在 `gatedTool` 那一层（它读 `s.autonomy.mode`），那一层逐档正确。
          // 判据用 `reason` 而不是 `decision === "deny"`：非交互时 `ask` 被降级成 deny
          // （`gate()`）也是 deny，但那一档确实参与过裁决，得照实报。
          const where = reason === null ? `在 ${mode} 档（${interactive ? "交互" : "非交互"}）下` : "";
          await events.append({
            type: "tool_result",
            callId: output.id,
            ok: false,
            output: `[permission denied] ${output.name} ${where}被门拒绝（${decision}${reason ? `：${reason}` : ""}）`,
            blockedBy: "permission",
          });
          return "continue";
        }

        const tool = (opts.tools ?? TOOLS)[name] ?? opts.resolveTool?.(name);
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
            // 识图：图片内容块进待发盒（下一轮请求带上）。**只在这里存一次**——
            // 落盘的 tool_result 不带 base64，所以这条图不会跟着事件流重放，也不必去重。
            if (result.images !== undefined && result.images.length > 0) {
              opts.pendingImages?.push(result.images);
            }
          } catch (err) {
            result = { ok: false, output: err instanceof Error ? err.message : String(err) };
          }
        }
        // M1c：gatedTool 附带判定留痕（结构扩展），透传进 tool_result 事件；
        // auto 由 gate 派生（唯一 writer），历史语义不变：只有 rule / session_scope 两种自动放行才落 auto。
        const gateMeta = (result as ToolResultWithAudit).gate;
        const audit = autoOf(gateMeta);
        // D7 覆盖前快照：正文里那句给模型看（它得知道去哪儿找回原件），这个字段给界面与审计看。
        // 同一个事实只有一个 writer（写工具），这里只搬运不改写。
        const snapshotId = (result as { snapshotId?: string }).snapshotId;
        const change = (result as { change?: "created" | "modified" }).change;
        // 交付给用户的产物引用：与 snapshotId / change 同一条搬运纪律（唯一 writer 是工具，
        // 这里只透传不改写）。base64 不进事件流，所以这一格只有路径与用途。
        const artifact = (result as { artifact?: { kind: "image" | "html" | "svg" | "text"; path: string; note?: string } }).artifact;
        // 换路压力记账（只读，不改事件序）：动作换了 ⇒ 上一轮的重复段结束，解除提示帽
        let repeatNote = "";
        // **历史恒收，提示才受开关管**（2026-10-19 独立评审追出的 MEDIUM-LOW）：
        // 旧实现把"记这一拍"也关在 `stuckNudge` 里面 ⇒ 编排器的 worker 那条 runLoop 不开这个开关
        // （它自己在编排器里另有一套卡死看门狗）⇒ worker 的 `stuckTurns` **恒为空**
        // ⇒ `detectStuck` 与 `detectAlternatingThrash`（R3 往返抖动）在 worker 路径上**永远判不出**：
        // 同一串 A/B/A/B/A/B 的动作往返，主会话判 thrashing=true、worker 判 false（列表恒空）。
        // 这两件事是**两件事**：「有没有得判」（历史）与「判出来了要不要说给模型听」（提示）。
        // 历史是判据的输入，开关只该管后者。
        {
          const action = stuckActionOf(output.name, output.args);
          const lastTurn = stuckTurns.length > 0 ? stuckTurns[stuckTurns.length - 1] : undefined;
          if (lastTurn !== undefined && lastTurn.action !== action) nudgedActions.delete(lastTurn.action);
          stuckTurns.push({ action, observation: stuckObservationOf(result.output), ok: result.ok });
          if (stuckTurns.length > DEFAULT_STUCK_CONFIG.windowSize) stuckTurns.shift();
        }
        if (opts.stuckNudge === true) {
          const action = stuckActionOf(output.name, output.args);
          const verdict = detectStuck(stuckTurns);
          if (verdict.stuck && !nudgedActions.has(action)) {
            nudgedActions.add(action);
            // 每句只声称检测器真比过的那件事（第 313 页）。旧文案两处越界：
            //  ① 错误分支只看 action＋全失败就断言「原样重试不会改变结果」——三次连败而错误各不同时，
            //     这句话把"该再看一次"的那次重试劝掉了（flaky 测试/超时/竞态正是这一类）；
            //  ② 观察分支说「逐字相同」，而比的是 `stuckObservationOf` 截出来的前 200 字。
            repeatNote = verdict.rule === "same_action_error_x3"
              ? verdict.sameObservation
                ? `\n[repeat] 同一个 ${output.name} 调用已连续 ${String(verdict.repeats)} 次失败且错误相同（比对取前 200 字）——原样重试不会改变结果：换一个探针（改命令 / 换路径 / 直接 read 那个文件）或说明卡点。`
                : `\n[repeat] 同一个 ${output.name} 调用已连续 ${String(verdict.repeats)} 次失败，但每次错误不同——最新那条本身就是新信息：先读它，再决定换探针还是先修环境。`
              : `\n[repeat] 同一个 ${output.name} 调用已连续 ${String(verdict.repeats)} 次拿到相同结果（比对取前 200 字）——再问一次不会有新信息：换一个探针或说明为何仍需重复。`;
          }
        }
        // M2e：PostToolUse（成功）/ PostToolUseFailure（失败）——additionalContext 回注 tool_result 尾部
        let postContext = "";
        if (opts.hooks && !opts.signal?.aborted) {
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
          output: redactSecrets(result.output + postContext + repeatNote).text,
          // 执行面没有这把工具：上面 `if (!tool)` 只造了 `result`，落盘在这一格 ⇒ 原因也在这里补，
          // 而不是在分支里改 `result`（那是工具的返回体，不是闸的留痕）。
          ...(tool === undefined ? { blockedBy: "unknown-tool" } : {}),
          ...(gateMeta ? { gate: gateMeta } : {}),
          ...(audit ? { auto: audit } : {}),
          ...(snapshotId !== undefined ? { snapshotId } : {}),
          ...(change !== undefined ? { change } : {}),
          ...(artifact !== undefined ? { artifact } : {}),
          ...(result.changedPaths !== undefined ? { changedPaths: result.changedPaths } : {}),
          // 融合写盘的结构事实：ok:false 时下游仍须知道「盘已经改了」。
          ...(result.fusedWrite === true ? { fusedWrite: true } : {}),
          // 跑进程类工具的结局必须**结构地**活到落盘面：从前 `ok:false` ＋一句文案就是全部，
          // 于是"工具链没装（127）／被墙钟杀掉／模型代码真错了"三件事在事件流里长得一模一样，
          // 下游（额度、按档升级、沉淀、失败轨迹评估）只能回去匹配文案。缺席＝这一笔不是跑进程的工具。
          ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
          ...(result.timedOut !== undefined ? { timedOut: result.timedOut } : {}),
          // 编排侧「这一次压根没派发出 worker」的原因也得结构地活到落盘面：从前它只在 `output` 那一句里，
          // 于是「因钱不起」与「worker 跑挂了」在事件流上长得一模一样（`spawn_agent` 的拒绝返回体自带 `hold`）。
          ...(result.hold !== undefined ? { hold: result.hold } : {}),
        });
        // 动作融合把「写已落盘、随后的配置 lint 红了」编码成 ok:false + fusedWrite。
        // 落盘事实与检查结局是两件事：只看 ok 会把前者读丢 ⇒ 收束闸跳过 auto-verify。
        // 读**结构字段**而不是 output 字样——失败的 shell/diagnose 也能打印同一行字。
        const persistedWrite = result.ok || result.fusedWrite === true;
        if (persistedWrite && mayHaveWrittenDisk(name, output.args ?? {})) {
          wroteThisRun = true;
          wroteSinceAutoBeat = true; // 返修是否算「真去修了」只看这一位；没改盘就不配再验一遍
          wroteSinceVerifyBeat = true; // M10②：判据的另一位——两拍同签名红之间**有过成功的写**就算在换路子试
        }
        return "continue";
      });
      // 新提交（含新的 verify）⇒ 本轮有进展；非 verify 的重放走原有步数预算（撞帽仍要落 error 事件）。
      if (isNewSubmission || output.name !== "verify") onlyVerifyReplays = false;
      if (control === "stop") return;
    }
    if (opts.signal?.aborted) return;
    // 整轮只是重放已执行过的 verify = 无进展：重放的旧回执已经在本轮输入里，模型再问一次拿到的还是同一份。
    // 真红与环境红同判——只认环境红会让真红的重放绕过 maxVerify（verify 不再执行、拍数不涨），
    // 一路烧到 maxSteps 的付费请求。非 verify 的重放不走这条：它们仍有步数预算兜底，且撞帽要落 error。
    if (sawToolCall && onlyVerifyReplays) return;
    // #69：最后一步模型**仍在调工具**时，也让收束闸有机会留下证据——
    // 从前这一段只在模型自己不再调工具时才走到，于是撞帽的 run 一条 verify 证据都没有
    // （真模型面实测 5/43≈12% 整趟被帽砍掉）。这里只把"该收束了"这件事说给它听，
    // **不动**下面那一整段的判定与形状：撞帽路与收束路走同一份口径。
    if (step === maxSteps - 1 && sawToolCall) {
      capReached = true;
      sawToolCall = false;
    }
    if (!sawToolCall) {
      // ---- 能力 5 收束闸：写过盘却从未自调 verify ⇒ harness 补一拍验证，别把「说了」当「验了」----
      // 旧行为：只有模型自己调 verify 才会验证（提示词写着「修改完成后调用 verify」，纯靠自觉），
      // 「顶尖 Agent 能证明代码真的能跑」这条在自动路径上是空的。
      // 边界：① 每 run 至多一拍（verifyAttempts>0 即让位给模型自调路）；② 仓库没有 verify 面
      // （无 config verify 字段且 package.json 无 lint/test）⇒ 整段跳过，零行为零额外调用；
      // ③ 探测本身失败（config 存在但 JSON 坏）⇒ 同样跳过并告警——**绝不让探针炸掉 run**
      // （verify 门自身的异常早有同族 try/catch，这里同口径）；④ 缺省不开（autoVerify !== true 零行为）。
      // ⑤ 开了 autoVerifyRepair 才允许第二拍：条件是「第一拍是代码红」且「这一轮模型真的又改过盘」，
      //    且 autoBeats 上限 2 ——一次返修、一次重验，红就收束。不开时下面整个判断与今日逐字同形。
      const firstBeat = verifyAttempts === 0;
      const repairBeat = repairPending && wroteSinceAutoBeat && autoBeats < 2;
      if (opts.verify && opts.autoVerify === true && wroteThisRun && (firstBeat || repairBeat)) {
        let hasSurface = true;
        try {
          hasSurface = (await opts.verify.surface?.()) !== false;
        } catch (err) {
          hasSurface = false;
          console.warn("[verify] 可验面探测失败，跳过自动验证拍:", err instanceof Error ? err.message : String(err));
          // fail-closed 口径与 manual 对齐：探测失败是一次坏的 verify 证据，必须进事件流，
          // 否则审计面看不到「该验没验」。cause=hook-error 属环境拍，不烧模型修复额度。
          await events.append({
            type: "verify_result",
            callId: HARNESS_VERIFY_CALL_ID,
            ok: false,
            attempt: chargedAttempts + 1,
            maxAttempts: maxVerify,
            results: [{ command: "(verify surface)", ok: false, output: err instanceof Error ? err.message : String(err), cause: "hook-error", exitCode: null }],
            cause: "hook-error",
            auto: true,
          });
        }
        if (opts.signal?.aborted) return;
        if (hasSurface) {
          const beat = await verifyBeat(HARNESS_VERIFY_CALL_ID, true);
          autoBeats++;
          repairPending = false;
          wroteSinceAutoBeat = false;
          if (beat === "auto-red" && opts.autoVerifyRepair === true && autoBeats < 2) {
            repairPending = true;
            continue; // 再要一轮：红字由 context.ts 的 autoVerifyNote 投成 user 消息，模型看得见
          }
        }
      }
      // 交付断言在返修前必须先进事件流：context.ts 会把哨兵投成 user 消息，下一次请求才看得到原因。
      // 收尾层仍负责异常/中断时补记；它按当前 user_message 边界去重，不会把历史轮次当成本轮。
      const phantom = findPhantomDelivery(seen, workspace);
      const emptyRun = findEmptyRun(seen);
      const guardFired = phantom !== null || emptyRun !== null;
      if (guardFired) {
        // 检测与记录始终发生；返修开关只决定要不要再向模型要一轮。
        if (!deliveryGuardRecorded) {
          deliveryGuardRecorded = true;
          await events.append({
            type: "tool_result",
            callId: DELIVERY_GUARD_CALL_ID,
            ok: false,
            output: phantom !== null
              ? describePhantomDelivery(phantom)
              : EMPTY_RUN_DELIVERY,
          });
        }
        // 返修环（与 autoVerifyRepair 同形）：红已落流 ⇒ 再要一轮去补做。
        // 上限**一轮**：补不出来就收束，无限要下去只会把钱烧在不会写的那一趟上。
        if (opts.deliveryRepair === true && !deliveryRepairUsed) {
          deliveryRepairUsed = true;
          continue;
        }
      }
      if (!capReached) return; // 模型认为任务结束（纯文本轮 / 事件源耗尽）；撞帽则落回循环外那条 throw
      // 撞帽路：证据已在上面落流，这里**不吞掉失败**——继续往下走，由循环外那句抛。
    }
  }
  // 最后一轮的验证或收尾日志也可能等到取消；不能把用户取消改判成步数耗尽。
  if (opts.signal?.aborted) return;
  const capMessage = `agent loop 超过 maxSteps=${String(maxSteps)}，强制中止`;
  // 内核异常也要落事件：旧实现直接 throw，会话 JSONL 在最后一条普通事件处戛然而止，
  // 事后重开/审计完全看不到「为什么停了」（terminal 的 agent_status 是 push-only 不写盘）。
  await events.append({ type: "error", message: capMessage, step: maxSteps } as AgentEvent);
  throw new Error(capMessage);
}
