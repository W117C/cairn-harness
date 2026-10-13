import type { AgentEvent } from "../events";
import type { ModelOutput } from "../providers";
import type { GlmToolSpec } from "../providers/glm";
import type { Tool } from "../tools/base";
import type { PipelineChain, WorkerContext, WorkerHandle } from "./orchestrator-types";
import { redactSecrets } from "./security/scan";

/** M3c 插件角色工具面裁剪（执行表）：allowedTools 白名单 ∩ 默认表 − disallowedTools；裁空 → 报错 fail-visible。
 *  铁律不变：无论怎么裁，spawn_agent/run_shell/merge/commit 根本不在默认表内（深度闸/合并权闸无法被「白名单」放大）。 */
export function filterWorkerTable(w: Pick<WorkerHandle, "allowedTools" | "disallowedTools" | "agentId">, table: Record<string, Tool>): Record<string, Tool> {
  const allow = w.allowedTools;
  const deny = new Set(w.disallowedTools ?? []);
  if ((allow === undefined || allow.length === 0) && deny.size === 0) return table;
  const out: Record<string, Tool> = {};
  for (const [name, tool] of Object.entries(table)) {
    if (deny.has(name)) continue;
    if (allow !== undefined && allow.length > 0 && !allow.includes(name)) continue;
    out[name] = tool;
  }
  if (Object.keys(out).length === 0) {
    throw new Error("worker " + w.agentId + " 工具面裁剪为空（frontmatter.tools 与默认面无交集；fail-visible）");
  }
  return out;
}

/** M3c 插件角色工具面裁剪（模型规格面）：与执行表同一 allow/deny 口径（两面一致，防「规格可见执行不可用」）。 */
export function filterWorkerSpecs(w: Pick<WorkerHandle, "allowedTools" | "disallowedTools">, specs: GlmToolSpec[]): GlmToolSpec[] {
  const allow = w.allowedTools;
  const deny = new Set(w.disallowedTools ?? []);
  if ((allow === undefined || allow.length === 0) && deny.size === 0) return specs;
  return specs.filter((s) => !deny.has(s.function.name) && (allow === undefined || allow.length === 0 || allow.includes(s.function.name)));
}

/** pipeline 链状态表（sequencer 只读呈现 + 整链 tool_result 的正文）。 */
export function chainTable(chain: PipelineChain): string {
  return chain.state
    .map((s) => {
      const verdict = s.verdict !== undefined ? " verdict=" + s.verdict : "";
      const preview = s.reportPreview !== undefined ? "｜" + s.reportPreview.replace(/\n/g, " ").slice(0, 80) : "";
      return "#" + String(s.index + 1) + " " + s.role + " " + (s.agentId ?? "（未 spawn）") + " " + s.status + verdict + preview;
    })
    .join("\n");
}

/** 子流归因面 = **worker 的 loop 能发出的全部事件类型**。
 *  写成这张表而不是手写 `e.type === ...` 的串，是因为漏一型太便宜而代价太贵：漏了的类型
 *  会以父会话事件的形态落进主转录（§4.4.4 说父上下文唯一接收物是 agent_result）。
 *  实测漏过的三类正是**带正文的那些**——assistant_message / assistant_delta 会以
 *  `{"role":"assistant","content":"worker 内部正文"}` 进父投影（父会话以为那句话是自己说的），
 *  error 会以父会话的错误上卡。provider 侧那一半由 Record 的穷尽性代劳：
 *  给 ModelOutput 加一型而不进这张表 ⇒ 编译不过（同一形状已在 sidechat 的 switch 上验过一次）。 */
const MODEL_OUTPUT_ATTRIBUTION: Record<ModelOutput["type"], true> = {
  assistant_message: true,
  assistant_delta: true,
  // 思考正文同样归 worker 子流：漏了它，worker 的"自言自语"会以父会话正文的形态
  // 落进主转录（父会话以为那是自己想的话）—— 这正是这张表存在的理由。
  thinking_delta: true,
  tool_call: true,
  usage: true,
  turn_truncated: true,
  // 第 471 页：停止原因缺席的观测证据也由 provider 发出 ⇒ 同样必须挂 worker 归因，
  // 否则它会以父会话事件形态落进主转录（本表存在的理由，见上方注释）。
  turn_stop_missing: true,
};
/** loop 自己合成的那一半（不是 provider 发的）。`user_message` 不在列：worker 的 runLoop
 *  从不带 userMessage 调用（任务文本走 worker-prompt 注入），所以它不是子流会发的东西。 */
const LOOP_ATTRIBUTION: readonly AgentEvent["type"][] = ["tool_result", "verify_result", "error"];

/** 需要（且应当）带 agent_id 的类型全集。导出让判据与实现读同一份，别再抄第二张表。 */
export const WORKER_STREAM_TYPES: ReadonlySet<AgentEvent["type"]> = new Set<AgentEvent["type"]>([
  ...(Object.keys(MODEL_OUTPUT_ATTRIBUTION) as AgentEvent["type"][]),
  ...LOOP_ATTRIBUTION,
]);

/** 子流装饰：worker 发的事件一律挂 agent_id（`agent_*` 那些由编排器自己发，本来就带）。
 *  verify_result 是 2026-09-20 补进来的：W4a 让 worker 也跑自动验证之后，缺了归因就等于
 *  「worker 验过」冒充「父会话验过」——上下文红回流、父验证计量、假完成率三处都按这条判子流。 */
export function withAgentId(e: AgentEvent, agentId: string): AgentEvent {
  if (WORKER_STREAM_TYPES.has(e.type)) return { ...e, agent_id: agentId } as AgentEvent; // 单行：锚点按这一行匹配
  return e;
}

/** 落流前要脱敏的文本路径。一条路径 = 从事件出发逐层取字段；落在容器（对象/数组）上
 *  = 扫它下面的**全部字符串叶子**。表住在这里是因为它就是「哪些事件带外部文本」的唯一答案，
 *  由 `tests/stream-redaction.test.ts` 逐型对注册表裁决（未表态的新类型当场红）。
 *
 *  为什么不能只列三型（旧实现）：同一份流里最像人话的那几段没人扫——
 *  `assistant_delta` 与最终消息同源（擦了成品、留着分片，等于没擦）、
 *  `verify_result.results` 是测试输出（最容易把 env 整段打印出来的地方）、
 *  `agent_message.text` / `agent_result` 是 worker 写给自己的正文、
 *  `compaction.summary` 更前置：源事件擦过不等于摘要擦过（摘要是**新的一份副本**）。
 *  注释写着「密钥不进主转录 JSONL」，而这句话此前只在三条路上成立。 */
export const SCANNED_TEXT_PATHS: Partial<Record<AgentEvent["type"], readonly (readonly string[])[]>> = {
  assistant_message: [["content"]],
  assistant_delta: [["text"]],
  // 思考正文同样要扫：模型在"想"的时候一样可能把 key / env 整段复述出来
  // （它是**模型生成的文本**，与正文同源 —— 不扫就等于在最像人话的那段留了个口子）。
  thinking_delta: [["text"]],
  tool_call: [["args"]],          // write_file 的 contents 等（B5 审查补的那条）
  tool_result: [["output"]],
  verify_result: [["results"]],   // {command, output}[]
  error: [["message"]],
  agent_message: [["text"]],
  agent_result: [["summary"], ["artifacts"]],
  agent_spawned: [["task"]],      // 任务文本来自父模型，不是来自用户
  approval_requested: [["args_digest"]], // digest 是人读摘要（含内联命令），不是哈希
  compaction: [["summary"]],
  plan_proposed: [["plan"]],
  clarify_requested: [["questions"]],
  goal_stopped: [["reason"]],
  // v2.16：挂起理由与停止理由是同一个形状（自由文本、将来可能内联读数），同口径扫——
  // 「同族出口各扫一份」这条边界在这里保持一致，别因为今天那句文案是常量就放松。
  goal_paused: [["reason"]],
};

/** 在**产出处**就已脱敏的事件（本表不参与扫描，判据只判「别再漏一处」）。 */
export const SCANNED_UPSTREAM_TYPES: readonly AgentEvent["type"][] = [
  "security_report", // 报告构建处过 redactSecrets（scan.ts 的 findings 面 + orchestrator 的 title/description/suggestion）
];

/** 用户自己写进来的文本：**刻意不擦**。用户贴一把密钥让 agent 配环境是正常意图，
 *  把它 mask 掉等于毁掉这一轮任务；这类文本的保密责任在写盘权限与会话导出，不在投影层。
 *  这条边界要有名字，否则下一个人会「顺手」把它也扫了。 */
export const USER_AUTHORED_TEXT_TYPES: readonly AgentEvent["type"][] = [
  "user_message", "goal_set", "diff_comment", "card_action",
  "automation_triggered", "automation_skipped", "automation_completed",
];

/** 无正文的事件：字段全是枚举、id、计数或路径标识。 */
export const PROSE_FREE_TYPES: readonly AgentEvent["type"][] = [
  "usage", "session_meta", "plan_approved", "approval_resolved", "agent_status",
  "routing_decision", "impact_report", "turn_truncated",
  // v2.16：恢复只有 turn（计数），无自由文本——显式表态，别顺手改成扫描路径。
  "goal_resumed",
  // P0 装配账：字段是工具名（标识符，与 tool_call.name 同口径：那条也只扫 args）、计数、
  // 布尔与字节数。工具名来自插件/MCP 服务器，但它承载不了任何凭据——把它扫掉只会让
  // 「省了谁」这条读数失去分辨力。**这是一次显式表态，别顺手改成扫描路径**：
  // 改的话要同步 tests/stream-redaction.test.ts 的 SAMPLES。
  "surface_account",
  // 第 471 页：停止原因缺席的证据只装 callId / token 计数，没有任何自由文本。
  "turn_stop_missing",
];

function scanStringLeaves(v: unknown): unknown {
  if (typeof v === "string") return redactSecrets(v).text;
  if (Array.isArray(v)) return v.map(scanStringLeaves);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = scanStringLeaves(x);
    return out;
  }
  return v;
}

function scanOnePath(holder0: Record<string, unknown>, path: readonly string[]): void {
  let holder: Record<string, unknown> = holder0;
  for (let i = 0; i < path.length - 1; i++) {
    const next = holder[path[i] as string];
    if (!next || typeof next !== "object") return;
    holder = next as Record<string, unknown>;
  }
  const last = path[path.length - 1];
  if (last === undefined || holder[last] === undefined) return; // 缺席字段不无中生有
  holder[last] = scanStringLeaves(holder[last]);
}

/** 子流落流扫描：文本字段过 redactSecrets（密钥不进主转录 JSONL；worker 内存态保持原始事件）。
 *  取料面 = `SCANNED_TEXT_PATHS`；不改原对象（浅拷贝一层，路径末端才替换）。 */
export function scanStreamEvent(e: AgentEvent): AgentEvent {
  const paths = SCANNED_TEXT_PATHS[e.type];
  if (!paths) return e;
  const copy = { ...(e as unknown as Record<string, unknown>) };
  for (const p of paths) scanOnePath(copy, p);
  return copy as unknown as AgentEvent;
}

export function digestArgs(args: Record<string, unknown>): string {
  const s = JSON.stringify(args);
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}

export function parseStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

export function parseWorkerContext(v: unknown): WorkerContext {
  if (typeof v !== "object" || v === null) return {};
  const r = v as Record<string, unknown>;
  return {
    ...(parseStringList(r.files).length > 0 ? { files: parseStringList(r.files) } : {}),
    ...(parseStringList(r.decisions).length > 0 ? { decisions: parseStringList(r.decisions) } : {}),
    ...(parseStringList(r.constraints).length > 0 ? { constraints: parseStringList(r.constraints) } : {}),
  };
}
