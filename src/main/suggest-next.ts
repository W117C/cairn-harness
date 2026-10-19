// 第二十四遍「Tab 想下一条」（业主 2026-10-15 22.02 反馈 + 2026-10-16 裁 A②：建议按**上下文内容**
// 生成、只在按 Tab 时出手）。旧「建议灰字」（自动常驻 + 规则凑字：继续 / 看一下失败原因…）整体下架。
//
// 本模块 = 单发器：一次无工具、不进会话流、不落 JSONL、不计量的模型小调用，把「用户下一句最可能说的
// 话」取回来。传输复用 toWorkerModel（与主会话/worker 同一条全协议适配面：OpenAI / Anthropic /
// Gemini / GLM / .agent/providers.json 自定义家各走自家适配器）——这里不碰任何 wire 形态，
// 只收 assistant 文本事件。失败一律分类 + 给下一步（fail-visible），绝不抛、绝不静默凑字。
import type { GlmMessage } from "../providers/glm";
import { toWorkerModel } from "../providers/registry";
import {
  assertProviderKeyConfigured,
  selectionProviderId,
  type MainModelSelection,
} from "./provider-runtime";

/** 单发默认超时：够一次小回答，又不至于让 Tab 按键把人晾住。 */
export const SUGGEST_TIMEOUT_MS = 20_000;
/** 建议落框的最长字符数（超出按句读点截断）——建议是「一句话」，不是一段话。 */
export const SUGGEST_MAX_CHARS = 80;

/** 系统提示词。要点：写给**用户**的下一句（第一人称对 agent 说话）、一句话、直接给内容本身。
 *  「无法建议」是留给模型的诚实出口——上下文看不出下一步时不硬编，由 sanitize 归到 empty。 */
export const SUGGEST_SYSTEM_PROMPT =
  "你在为一个编程 agent 的聊天界面做输入补全。根据对话摘录，替【用户】写出他接下来最可能要说的一句话" +
  "（对 agent 的下一句指令，或对 agent 提问的回答）。要求：一句话、不超过 30 个字、第一人称、" +
  "直接输出那句话本身（不要引号、不要前缀、不要解释、不要换行）；用对话的主要语言回答。" +
  "如果摘录不足以推断接下来要说什么，只回答：无法建议";

export interface SuggestNextInput {
  selection: MainModelSelection;
  /** 对话摘录（renderer 自最近消息拼好；已做条数与长度收敛）。 */
  excerpt: string;
  /** 测试注入点（各适配器 fetchImpl；缺省全局 fetch）。 */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type SuggestNextReason = "demo" | "no-key" | "empty" | "timeout" | "error";

export type SuggestNextResult =
  | { ok: true; text: string }
  | { ok: false; reason: SuggestNextReason; message: string; hint: string };

/** 原始模型输出 → 可落框的建议（null = 没想出东西）。规则全部确定性、可判卷：
 *  剥配对包裹引号（中英引号/反引号/书名号）→ 取首行 → 行内空白折叠 → 明确拒答归 null →
 *  按句读点截到 80 字（无句读点硬截 + 省略号）。 */
export function sanitizeSuggestion(raw: string): string | null {
  let s = raw.trim();
  if (s === "") return null;
  const WRAPS: readonly (readonly [string, string])[] = [['"', '"'], ["'", "'"], ["`", "`"], ["「", "」"], ["『", "』"]];
  let stripped = true;
  while (stripped && s.length >= 2) {
    stripped = false;
    for (const [open, close] of WRAPS) {
      if (s.startsWith(open) && s.endsWith(close) && s.length > open.length + close.length) {
        s = s.slice(open.length, s.length - close.length).trim();
        stripped = true;
        break;
      }
    }
  }
  // 取首行（模型偶发多行）→ 行内空白折叠（不动中文标点）。
  s = (s.split("\n")[0] ?? "").replace(/\s+/g, " ").trim();
  if (s === "") return null;
  // 明确拒答出口：模型回「无法建议」（含标点变体）。
  if (/^无法建议[。！!]?$/.test(s)) return null;
  if (s.length > SUGGEST_MAX_CHARS) {
    const cut = s.slice(0, SUGGEST_MAX_CHARS);
    // 尽量截在句读点整句上（80 字内最后一个句读点）；没有句读点就硬截 + 省略号。
    const lastStop = Math.max(
      cut.lastIndexOf("。"), cut.lastIndexOf("！"), cut.lastIndexOf("？"),
      cut.lastIndexOf("!"), cut.lastIndexOf("?"), cut.lastIndexOf("；"), cut.lastIndexOf(";"),
      cut.lastIndexOf("，"), cut.lastIndexOf(","), cut.lastIndexOf("、"),
    );
    s = lastStop > 0 ? cut.slice(0, lastStop + 1) : `${cut.trimEnd()}…`;
  }
  return s === "" ? null : s;
}

const fail = (reason: SuggestNextReason, message: string, hint: string): SuggestNextResult =>
  ({ ok: false, reason, message, hint });

/** 单发取建议。绝不抛：demo / 缺 key / 超时 / 网络与上游错误各自分类带下一步文案。
 *  key 判定与适配器读 key 同源（process.env——byok 启动注入后的真实现场），不会出现
 *  「断言说有、适配器说没有」的两本账。 */
export async function suggestNextMessage(input: SuggestNextInput): Promise<SuggestNextResult> {
  const { selection } = input;
  if (selection.kind === "demo") {
    return fail("demo", "演示通道不拨号", "演示回放不产生真实调用——切一个真模型再按 Tab。");
  }
  try {
    assertProviderKeyConfigured(selectionProviderId(selection));
  } catch (error) {
    return fail(
      "no-key",
      error instanceof Error ? error.message : String(error),
      "当前模型没有可用的 key——去设置里配上，或切一个已配好的模型。",
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, input.timeoutMs ?? SUGGEST_TIMEOUT_MS);
  try {
    const model = toWorkerModel(selection.spec, input.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {});
    const messages: GlmMessage[] = [
      { role: "system", content: SUGGEST_SYSTEM_PROMPT },
      { role: "user", content: input.excerpt },
    ];
    let streamed = "";
    let full: string | null = null;
    for await (const event of model(messages, [], { call: { signal: controller.signal } })) {
      if (event.type === "assistant_delta") streamed += event.text;
      else if (event.type === "assistant_message") full = event.content;
    }
    const text = sanitizeSuggestion(full ?? streamed);
    if (text === null) return fail("empty", "模型没有给出可用的建议", "这次没想出合适的下一条——再按一次 Tab 试试。");
    return { ok: true, text };
  } catch (error) {
    if (controller.signal.aborted) {
      return fail("timeout", `超时 ${String(input.timeoutMs ?? SUGGEST_TIMEOUT_MS)}ms`, "想建议超时了——再按一次 Tab 重试。");
    }
    const brief = error instanceof Error ? error.message : String(error);
    return fail("error", brief, `想建议失败（${brief.slice(0, 60)}）——再按一次 Tab 重试。`);
  } finally {
    clearTimeout(timer);
  }
}
