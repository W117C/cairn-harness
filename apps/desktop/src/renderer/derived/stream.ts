// 派生层·流面（纯投影）：事件流 → 对话行（user/assistant/tool/error）。
// I3 契约：只吃 AgentEvent[]，只吐值；不读时钟、不取随机、不做 IO、不留模块级可变态。
import type { AgentEvent } from "../../../../../src/main/ipc-protocol";
import { isMainSessionTerminalEvent, isWorkerSubflowEvent, userVisibleText } from "./session";

// v2 行面：ts 为事件真值时间戳（毫秒）的透传——新事件恒有值（core 落盘统一盖戳、live=盘），
// openSession 读旧日志时 undefined ⇒ 行上留空，不造假。
// v2.16 行面补钉：user 行带 round（主会话 1-based 轮号，core planTurnRevert 同口径——worker
// 事件不成轮）；assistant 行带 eventId（事件在会话 JSONL 里的 1-based 行号，赞/踩的锚）。
// v7 行面补钉：assistant 行也带 round（它所属的用户轮——「从这条回复分支」= fork 保留到该轮）。
export type StreamRow =
  | { kind: "user"; text: string; ts?: number; seq: number; round: number; attachments?: readonly { path: string; kind: "file" | "directory" }[]
      /** 第 9 点·轮中插话：这条是同一轮里补的话，不是新任务（见文件头轮界分流那段）。
       *  缺席 = 普通用户轮次（既有形状，字节不变）。 */
      steering?: true }
  | { kind: "assistant"; text: string; live?: boolean; thinking?: string; ts?: number; seq: number; eventId: number; round: number } // live=true = delta 流式中尚未被终稿取代的未结桶行；thinking = 同一 callId 下累计的思考正文
  | { kind: "tool"; tool: string; summary: string; path?: string; args?: string; output?: string; outputTruncated?: boolean; pending?: boolean; interrupted?: boolean; ok?: boolean; ts?: number; seq: number
      /** tool_result 收口的到达时间（P3-1 折叠行耗时 = then − ts；拿不到不显）。 */
      then?: number
      /** 产物引用（本次调用交付给用户的东西）。从前聊天里只有文字回执 ⇒ 用户看不到 agent
       *  刚渲染的图，也拿不到"刚写的那份 HTML"的直接入口，只能自己去仓库里翻。 */
      artifact?: { kind: "image" | "html" | "svg" | "text"; path: string; note?: string } }
  | { kind: "error"; text: string; ts?: number; seq: number };

type ToolRow = Extract<StreamRow, { kind: "tool" }>;

export const summarize = (args: Record<string, unknown>): string => {
  // url / query 进取值链（阶段 2 · brief §二.4 例：「抓取 api-docs.deepseek.com/news」——
  // web_fetch/web_search 的一句话摘要就是目标本身）。
  const first = args.command ?? args.path ?? args.file ?? args.url ?? args.query ?? "";
  return typeof first === "string" && first ? first : JSON.stringify(args).slice(0, 80);
};

/** 工具行展开区数据源（阶段 2 · brief §二.4）：原始参数的美化 JSON（2 格缩进）。
 *  超 1500 字截断加省略标记——折叠区不摆巨物；原始事件面不动，这里只是展示层的字符串。 */
const rawArgs = (args: Record<string, unknown>): string => {
  const s = JSON.stringify(args, null, 2);
  return s.length > 1500 ? `${s.slice(0, 1500)}…` : s;
};

export function projectStream(events: readonly AgentEvent[], running: boolean = true): StreamRow[] {
  const rows: StreamRow[] = [];
  // delta 分桶（语义钉死）：callId → 累计文本 ＋ 首 delta 的 seq/ts（live 行落在流式开始的位置，
  // 时间取首 delta——行的时间戳口径与其在流里的位置一致）。桶被 assistant_message 终稿取代后即清除。
  const buckets = new Map<string, { text: string; seq: number; ts?: number }>();
  // 思考正文桶：与正文**分开累计**（思考是模型自言自语，不并进 text，转录因此保持干净）。
  const thinkingBuckets = new Map<string, string>();
  // tool_call id → 行对象：tool_result 按 callId 收口（就地改写 pending/ok，行保持 call 侧 ts）；
  // 无匹配调用的 tool_result 忽略，不造假行。
  const toolRows = new Map<string, ToolRow>();
  const interruptTools = (): void => {
    for (const row of toolRows.values()) {
      if (row.pending !== true) continue;
      row.pending = false;
      row.interrupted = true;
    }
  };
  // 轮号（v2.16）：主会话 user_message 的 1-based 计数——与 core planTurnRevert 的轮口径同一份
  // （worker 子流事件不成轮，见 isWorkerSubflowEvent 过滤；worker 本也不产生 user_message）。
  let rounds = 0;
  // 落定未结桶（v7.1 修）：真实 provider 的**一轮只发 assistant_delta**（aggregate 的 assistant_message
  // 是 mock/demo 通道才有的东西，见 src/cli.ts 的刻意注释）——所以「桶什么时候算说完」不能只靠
  // assistant_message。轮界（下一条 user_message）与停转（running=false）都是落定点：以终稿形态
  // （live=false）吐行，操作条与光标据此归位。settled=true 的空文本桶：有思考正文落 thinking-only 行，真空的仍不产行。
  const flushBuckets = (settled: boolean): void => {
    for (const [callId, bucket] of buckets) {
      const thinking = thinkingBuckets.get(callId);
      if (settled && bucket.text === "") {
        // 只想过没说：思考正文不能跟着空桶一起丢（业主 2026-10-24：工具调用前的思考消失——
        // 旧口径把空文本桶整桶弃行，桶上挂着的思考正文随之蒸发）。有思考就落一条 thinking-only
        // 行（渲染层只画思考折叠行，不画空气泡）；真连思考都没有的空桶仍然不产行。
        if (thinking !== undefined && thinking !== "") {
          rows.push({
            kind: "assistant", text: "", live: false, ts: bucket.ts, seq: bucket.seq, eventId: bucket.seq + 1, round: rounds, thinking,
          });
        }
        continue;
      }
      rows.push({
        kind: "assistant", text: bucket.text, live: settled ? false : true, ts: bucket.ts, seq: bucket.seq, eventId: bucket.seq + 1, round: rounds,
        ...(thinking !== undefined ? { thinking } : {}),
      });
    }
    buckets.clear();
    thinkingBuckets.clear();
  };
  for (let seq = 0; seq < events.length; seq++) {
    const e = events[seq]!;
    // M3-4 裁定：worker 子流事件不进主流行（过滤判据见 isWorkerSubflowEvent）；seq 仍按事件
    // 全序编号，行序与流序一致，不因过滤错位。
    if (isWorkerSubflowEvent(e)) continue;
    switch (e.type) {
      case "user_message": {
        // 第 9 点·轮中插话（`origin.kind === "steering"`）**不是轮界**：它是同一轮里
        // 用户补的一句话，模型在**这一轮的下一拍**就看到了（见 `SteeringOrigin` 的注释）。
        // 若把它当新轮：轮号会 +1（同一轮被劈成两轮 ⇒ 轮次跳转、上一轮气泡提前落定全错位），
        // 而转录里那条插话还会被画成"用户又开了一个任务"。
        // 它**仍要显示**（用户说过的话不许在转录里消失）——只是挂在**当前轮**上。
        const steering = e.origin?.kind === "steering";
        if (!steering) {
          // 轮界：上一轮还没被终稿收走的桶在此落定（新消息开头 = 旧轮已说完）。
          flushBuckets(true);
          rounds += 1;
        }
        rows.push({
          kind: "user", text: userVisibleText(e), ts: e.ts, seq, round: rounds,
          ...(steering ? { steering: true } : {}),
          ...(e.attachments !== undefined && e.attachments.length > 0 ? { attachments: e.attachments } : {}),
        });
        break;
      }
      case "assistant_message":
        // 终稿到达：AssistantMessageEvent 无 callId，无法按桶匹配 ⇒ 全部未结桶被终稿行取代
        //（live=false），此后不再输出这些桶的 live 行。
        // 终稿到达：思考桶里的正文**挂到终稿行上再清**——这样输出结束后用户仍能看到那一轮想了什么
        //（清空后消失的话，"思考过程"只在流式那几秒可见，等于没展示）。
        const carriedThinking = [...thinkingBuckets.values()].join("") || undefined;
        buckets.clear();
        thinkingBuckets.clear();
        rows.push({
          kind: "assistant", text: e.content, live: false, ts: e.ts, seq, eventId: seq + 1, round: rounds,
          ...(carriedThinking !== undefined ? { thinking: carriedThinking } : {}),
        });
        break;
      case "assistant_delta": {
        const bucket = buckets.get(e.callId);
        if (bucket === undefined) buckets.set(e.callId, { text: e.text, seq, ts: e.ts });
        else bucket.text += e.text;
        break;
      }
      // 第十九遍（业主 21.51.47「输出完之后橙色竖线还闪一下才停」）：usage = 本次模型调用说完了的
      // 精确落定点（openai.ts 在流末 yield usage；案卷 21:51:38 实证：末 delta 与 usage 同秒，
      // 之后 10s 尾部记忆沉淀才收束——旧判据 running=false 让光标陪跑了整个尾巴）。
      // 工具轮里 usage 亦在 tool_result 之后、下一 call 之前到达 ⇒ 桶不跨调用，flush 语义干净；
      // 空文本桶（只想过没说）在此落定即按既有口径弃行。
      case "usage": {
        flushBuckets(true);
        break;
      }
      case "thinking_delta": {
        // 不进正文桶：走独立累计，渲染时挂在回答行前面单独一段。
        thinkingBuckets.set(e.callId, (thinkingBuckets.get(e.callId) ?? "") + e.text);
        // 思考阶段也要有 live 行承载 ThinkingLive（否则「先思考」无处落脚，二者只剩同时出现）。
        // 建 text="" 的桶，后续 assistant_delta 来到同一 callId 即累积正文——该行自动成为输出行。
        if (!buckets.has(e.callId)) buckets.set(e.callId, { text: "", seq, ts: e.ts });
        break;
      }
      // 勘误落地：ToolCallEvent 的工具名字段是 name（不是计划作者预期的 tool）；行面仍叫 tool。
      case "tool_call": {
        const row: ToolRow = { kind: "tool", tool: e.name, summary: summarize(e.args), args: rawArgs(e.args), pending: true, ts: e.ts, seq };
        // 行为数据不从展示用截断 JSON 反解；长编辑参数仍保留差异入口。
        if (typeof e.args.path === "string" && e.args.path !== "") row.path = e.args.path;
        toolRows.set(e.id, row);
        rows.push(row);
        break;
      }
      case "tool_result": {
        const row = toolRows.get(e.callId);
        if (row) {
          row.pending = false;
          delete row.interrupted;
          row.ok = e.ok;
          if (typeof e.output === "string") {
            row.output = e.output.slice(0, 10000);
            if (e.output.length > 10000) row.outputTruncated = true;
          }
          if (e.ts !== undefined) row.then = e.ts; // P3-1：耗时的落地端（ts→then 一段）
          // 只认**成功**的产物：失败的那一笔没有可看的东西（写盘被拒 / 渲染超时）。
          if (e.ok && e.artifact !== undefined) row.artifact = e.artifact;
        }
        break;
      }
      // M3-4 裁定：agent_spawned 是父流事实，保留为 tool 类行——summary=task 截断（与 summarize
      // 的 80 字符口径一致），tool 名取 core 的 spawn 工具名。行不带 pending：spawn 本身无收口对
      // （worker 的终态走 agent_status/agent_result 子流，本就不进主流）。
      case "agent_spawned":
        rows.push({ kind: "tool", tool: "spawn_agent", summary: e.task.slice(0, 80), ts: e.ts, seq });
        break;
      // RunErrorEvent 勘定（src/events/index.ts）：失败原因原文在 message（渲染侧负责转义）。
      case "error": rows.push({ kind: "error", text: e.message, ts: e.ts, seq }); break;
      case "agent_status":
        if (isMainSessionTerminalEvent(e)) interruptTools();
        break;
      default: break; // 其余事件类型不成行：clarify/plan 走卡片选择器（pendingClarifyOf/pendingPlanOf）
    }
  }
  // 尾部未结桶（按首 delta 的 seq 归位后与既有行并序——末尾 sort 统一收口）：
  // 运行中 ⇒ live=true 行（追字光标只该亮在正在流的那一段）；会话已停 ⇒ 同样是终稿（live=false），
  // 操作条与「思考完成」据此显形——真实 provider 不补发 assistant_message，停转就是落定信号。
  flushBuckets(!running);
  if (!running) interruptTools();
  return rows.sort((a, b) => a.seq - b.seq);
}
