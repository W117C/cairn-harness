// M2d remember 工具（§8.1.4 定稿）：.agent/ 与全局 memory 的模型写入唯一入口。
// 签名 remember({ scope, kind, type?, topic?, content, op?, old_content? })：
//   scope ∈ project|global 只认顶层参数（mem0 三次 metadata 越权修复 #4490/#6277/#6655 的同构防线）；
//   kind ∈ architecture|decision|preference|memory：前三者映射 .agent/ 根三文件（仅项目层），
//   memory 必带 type + topic、写 memory/<topic>.md；
//   操作集：append（日志型 DECISIONS/notes）/ replace（状态型，old_content 精确命中否则报错重试）；
//   空变更显式报错；「调用失败」与「无内容可沉淀」错误码分型（MemoryError.code）。
// 权限门在 main 层包装（gatedRemember）：本工具只做参数校验与落盘（与 write_file 同构）。
// 模型没有删除操作：本工具签名/操作集不含 delete（§8.1.7，删除仅用户经记忆面板）。
import type { Tool, ToolContext, ToolResult } from "./base.js";
import {
  MemoryError,
  MEMORY_TYPES,
  ROOT_FILES,
  appendDecisionEntry,
  appendRootFile,
  globalMemoryDir,
  projectMemoryDir,
  readTextOrNull,
  readTopicBody,
  replaceRootFile,
  rootFilePath,
  writeTopic,
  type MemoryType,
} from "../agent/memory/store.js";
import { redactSecrets } from "../agent/security/scan.js";

export type RememberKind = "architecture" | "decision" | "preference" | "memory";
export type RememberOp = "append" | "replace";
const KINDS: readonly RememberKind[] = ["architecture", "decision", "preference", "memory"];
const SCOPES: readonly string[] = ["project", "global"];

/** 工具描述（GLM 规格 + 审批卡共用）：密钥卫生与 skip 纪律明文（§8.1.8 第 6 条 / §8.1.3）。
 *  分层口径：**顶层只放纪律**，参数怎么用留给 parameters 的各条 description（scope/kind/op 此前两处各写一遍，
 *  每次请求白抄 ~300B）。纪律句一句不删——那是「少返工」的那一半。 */
export const REMEMBER_DESCRIPTION =
  "写入跨会话记忆（唯一写入口）。" +
  "何时用：用户明确说了「记住」；或出现了**下次会话仍然需要、且从代码或 git 历史推不出来**的事实（约定、偏好、当初为什么这么选）。" +
  "何时不用：只对本次任务有意义的进度、已完成的工作、能从代码读出的结构都不要写——写了下次没人读，还占常驻预算。" +
  "纪律：能从代码/git 历史推导的内容不要写入（skip）；DECISIONS 修订=新条目开头写「取代 <旧条引用>」（旧条保留，本工具无删除操作）；" +
  "禁止把密钥/API key/凭据/令牌写入记忆。";

function isMemoryType(v: unknown): v is MemoryType {
  return typeof v === "string" && (MEMORY_TYPES as readonly string[]).includes(v);
}

/** kind → 默认操作（§8.1.4：追加走 append（日志型），改写走 replace（状态型））。 */
function defaultOp(kind: RememberKind): RememberOp {
  return kind === "architecture" || kind === "preference" ? "replace" : "append";
}

/** §8.1.8 记忆安全第 6 条的后半（指针：agent-plan.md §8.1.8）：「§11.1 脱敏 pass 覆盖记忆写入路径」。
 *  落在这里而不是 main 层的 gated 包装：会话结束沉淀轮走的是**未加门的工具本体**
 *  （agent-runner 把 `rememberTool: remember` 直接交给 runSessionEndDistill），闸放包装层就绕过了它。
 *  命中即掩码写入；blocked（私钥块）沿用 scan.ts 既有契约——调用方拒绝而非仅脱敏。
 *  拒因只给规则名与处数，绝不回显凭据本体（回执要进事件流）。 */
function sanitizeForMemory(content: string): { text: string; masked: number } {
  const r = redactSecrets(content);
  if (r.blocked) {
    throw new MemoryError(
      "call_failed",
      "remember: 内容含高危凭据（" +
        (r.findings.some((f) => f.ruleId === "secret.private_key") ? "私钥块" : "命中拒绝档") +
        "，§11.1 脱敏 pass 的 blocked 档），一律不落盘；请去掉凭据、只写位置指针后重试",
    );
  }
  return { text: r.text, masked: r.findings.length };
}

export const remember: Tool = {
  name: "remember",
  async run(rawArgs: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    // ---- scope：只认顶层参数（metadata 里的 scope 一律无效）----
    const scope = rawArgs.scope;
    if (typeof scope !== "string" || !SCOPES.includes(scope)) {
      const smuggled =
        rawArgs.metadata !== null &&
        typeof rawArgs.metadata === "object" &&
        "scope" in (rawArgs.metadata as Record<string, unknown>);
      throw new MemoryError(
        "call_failed",
        "remember: scope 必须是顶层参数 project|global" +
          (smuggled ? "（检测到 metadata 内的 scope——一律无效，mem0 三次越权同构防线）" : "") +
          "，收到: " + JSON.stringify(scope ?? null),
      );
    }
    const kind = rawArgs.kind;
    if (typeof kind !== "string" || !KINDS.includes(kind as RememberKind)) {
      throw new MemoryError("call_failed", "remember: kind 必须是 architecture|decision|preference|memory，收到: " + JSON.stringify(kind ?? null));
    }
    const k = kind as RememberKind;
    if (scope === "global" && k !== "memory") {
      throw new MemoryError("call_failed", "remember: 全局层只有记忆笔记（kind=memory），architecture/decision/preference 是项目层 .agent/ 根三文件");
    }
    const op = rawArgs.op === undefined ? defaultOp(k) : rawArgs.op;
    if (op !== "append" && op !== "replace") {
      throw new MemoryError("call_failed", "remember: op 必须是 append|replace，收到: " + JSON.stringify(op));
    }
    if (k === "decision" && op === "replace") {
      throw new MemoryError("call_failed", "remember: DECISIONS 为追加式日志（修订=新条目开头写「取代 <旧条引用>」，旧条保留），不支持 replace");
    }
    // ---- content：缺失=调用失败；空白=无内容可沉淀（分型）----
    const content = rawArgs.content;
    if (typeof content !== "string") {
      throw new MemoryError("call_failed", "remember: content 参数必须是字符串");
    }
    if (content.trim().length === 0) {
      throw new MemoryError("empty_change", "remember: 无内容可沉淀（content 为空白，空变更显式报错）");
    }
    const nowISO = new Date().toISOString();
    // 闸后文本一次算好，四个写原语（writeTopic 的 append/replace、appendDecisionEntry、
    // appendRootFile、replaceRootFile）共用同一份——分头过闸必然漏一支。
    const safe = sanitizeForMemory(content);
    const note = safe.masked > 0 ? "（§11.1 脱敏 pass：已掩码 " + safe.masked + " 处凭据；凭据本体不入记忆，只写位置指针）" : "";
    if (k === "memory") {
      const type = rawArgs.type;
      if (!isMemoryType(type)) {
        throw new MemoryError("call_failed", "remember: kind=memory 必带 type: user|feedback|project|reference，收到: " + JSON.stringify(type ?? null));
      }
      const topic = rawArgs.topic;
      if (typeof topic !== "string" || topic.length === 0) {
        throw new MemoryError("call_failed", "remember: kind=memory 必带 topic（1-64 位字母/数字/连字符/下划线）");
      }
      const dir = scope === "project" ? projectMemoryDir(ctx.workspace) : globalMemoryDir();
      if (op === "replace") {
        const oldBody = await readTopicBody(dir, topic);
        if (oldBody === null) {
          throw new MemoryError("old_content_mismatch", "remember: topic 不存在，无法 replace（新建请用 append）: " + topic);
        }
        const oldContent = rawArgs.old_content;
        if (typeof oldContent !== "string") {
          throw new MemoryError("call_failed", "remember: op=replace 必带 old_content（精确命中原文，否则报错重试）");
        }
        if (oldContent !== oldBody) {
          throw new MemoryError("old_content_mismatch", "remember: old_content 与 " + topic + " 正文不精确匹配（replace 报错重试语义）");
        }
        if (oldContent === safe.text) {
          throw new MemoryError("empty_change", "remember: 空变更（old_content === 闸后 content），无内容可沉淀");
        }
        const res = await writeTopic(dir, topic, type, safe.text, nowISO);
        return { ok: true, output: "已写入 " + (scope === "project" ? ".agent/" : "全局层 ") + "memory/" + topic + ".md（replace，type=" + type + "，" + res.bytes + " 字节，modified 已落账）" + note };
      }
      const prev = await readTopicBody(dir, topic);
      const body = prev === null ? safe.text : prev.replace(/\n+$/, "") + "\n\n" + safe.text;
      const res = await writeTopic(dir, topic, type, body, nowISO);
      return { ok: true, output: "已写入 " + (scope === "project" ? ".agent/" : "全局层 ") + "memory/" + topic + ".md（append，type=" + type + "，" + res.bytes + " 字节，modified 已落账）" + note };
    }
    // ---- 根三文件（仅项目层）----
    const path = rootFilePath(ctx.workspace, k);
    if (op === "append") {
      if (k === "decision") await appendDecisionEntry(ctx.workspace, safe.text, nowISO);
      else await appendRootFile(ctx.workspace, k, safe.text);
      return { ok: true, output: "已写入 .agent/" + ROOT_FILES[k] + "（append）" + note };
    }
    const oldContent = rawArgs.old_content;
    if (typeof oldContent !== "string") {
      throw new MemoryError("call_failed", "remember: op=replace 必带 old_content（精确命中原文，否则报错重试）");
    }
    const cur = await readTextOrNull(path);
    if (cur === null || cur !== oldContent) {
      throw new MemoryError(
        "old_content_mismatch",
        "remember: old_content 与 .agent/" + ROOT_FILES[k] + " 当前内容不精确匹配（replace 报错重试语义）",
      );
    }
    if (oldContent === safe.text) {
      throw new MemoryError("empty_change", "remember: 空变更（old_content === 闸后 content），无内容可沉淀");
    }
    await replaceRootFile(ctx.workspace, k, safe.text);
    return { ok: true, output: "已写入 .agent/" + ROOT_FILES[k] + "（replace，全量改写）" + note };
  },
};
