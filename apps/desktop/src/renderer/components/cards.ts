// 三卡共享纯函数（M2-5）：只做数据组形/校验，不碰 React 与 IPC——组件与测试共用同一份语义。
import type { ClarifyAnswerMap, ClarifyQuestion, PlanFileChange } from "../../../../../src/events";
import { parsePatch } from "../../../../../src/tools/patch-parse";

/**
 * 澄清表单值 ⇒ 可提交的 ClarifyAnswerMap（key = 问题原文）。
 * 校验语义：带 options 的问题必答——单选缺选（非 string/空串）、多选空数组都抛「必答」
 * （错误文案带问题原文，组件原样展示给用户）；自由项（无 options）可空，空则不进提交值
 * （空串对模型是噪音）。值原样透传不做二次整形：选中项本就是 label 原文。
 */
export function clarifyFormValues(
  questions: readonly ClarifyQuestion[],
  values: Readonly<Record<string, string | string[]>>,
): ClarifyAnswerMap {
  const out: ClarifyAnswerMap = {};
  for (const q of questions) {
    const raw = values[q.question];
    const hasOptions = Array.isArray(q.options) && q.options.length > 0;
    if (hasOptions) {
      if (q.multiSelect === true) {
        const picked = Array.isArray(raw) ? raw : [];
        if (picked.length === 0) throw new Error(`「${q.question}」必答`);
        out[q.question] = [...picked];
      } else {
        if (typeof raw !== "string" || raw === "") throw new Error(`「${q.question}」必答`);
        out[q.question] = raw;
      }
    } else if (typeof raw === "string" && raw.trim() !== "") {
      out[q.question] = raw;
    }
  }
  return out;
}

/** 方案卡的文件变更行：`action  path — summary`（action 与 path 间两空格，测试钉死的列面）。 */
export function planFileLines(files: readonly PlanFileChange[]): string[] {
  return files.map((f) => `${f.action}  ${f.path} — ${f.summary}`);
}

/** 批准卡该说的人话（第十一遍重设计；纯函数，SSR 判卷锚）。
 *  旧版把 `JSON.stringify(args)` 直接上屏——remember 卡显示 `{"trigger":"session_end_distill"}`、
 *  write_file 卡一整行转义 JSON：业主截屏批「太丑」的一半就是它。锚定口径：
 *  · title = 这是什么事（工具级人话）；body = 在动什么（命令/路径/patch，mono 面）；
 *  · subject = 一行补充（记忆层与类型 / 出网地址）；
 *  · 只有**兜底名单外的工具**才把 args 落 body（可诊断性保留，别把未知形状藏起来）。 */
export interface AskDigest {
  title: string;
  body?: string;
  subject?: string;
}

/** 统一 diff 的抬头（纯函数）：`3 个文件 · +12 −4 · a.ts、b.ts、c.ts`。解析不了返回 undefined
 *  （宁可不摆抬头，也不猜——补丁原文仍整段在卡上）。 */
export function patchHeadline(patch: string): string | undefined {
  let files;
  try {
    files = parsePatch(patch);
  } catch {
    return undefined;
  }
  if (files.length === 0) return undefined;
  let add = 0;
  let del = 0;
  for (const f of files) {
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.mark === "+") add += 1;
        else if (l.mark === "-") del += 1;
      }
    }
  }
  const names = files.slice(0, 3).map((f) => f.path).join("、");
  const more = files.length > 3 ? ` 等 ${String(files.length)} 个` : "";
  return `${String(files.length)} 个文件 · +${String(add)} −${String(del)} · ${names}${more}`;
}

export function describeAsk(ask: { tool?: string; args?: Record<string, unknown> }): AskDigest {
  const tool = ask.tool ?? "";
  const args = ask.args ?? {};
  const s = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
  if (tool === "run_shell") return { title: "运行命令", body: s(args.command) ?? JSON.stringify(args) };
  if (tool === "write_file") return { title: "写入文件", body: s(args.path) ?? JSON.stringify(args) };
  if (tool === "edit_file") return { title: "编辑文件", body: s(args.path) ?? JSON.stringify(args) };
  if (tool === "apply_patch") {
    const patch = s(args.patch);
    // 第 933 页：补丁正文在卡上是一个 132px 的滚动框——大补丁只看得到开头几行。
    // 先把「改了几个文件、增删多少行、动了谁」摆到副行，正文仍是补丁原文（可滚动）。
    const head = patch === undefined ? undefined : patchHeadline(patch);
    return { title: "应用补丁", ...(head !== undefined ? { subject: head } : {}), body: patch ?? JSON.stringify(args) };
  }
  if (tool === "web_fetch") return { title: "访问网络", subject: s(args.url) };
  if (tool === "web_search") {
    // 端点必须在卡上（2026-10-19 独立评审追出）：端点不在模型给的 args 里
    // （它来自工作区的 `.agent/config.json`）⇒ 卡上只有 `{"query":"…"}`，人不知道这次要把
    // 查询发到哪去 ⇒ 批准是**不知情**的。而一个克隆来的仓带一份 `.agent/config.json`
    // （`search.endpoint` + `allowLocalEndpoint:true`）就能把端点指向回环/内网/云元数据地址。
    const endpoint = s(args.endpoint);
    const local = s(args.allowLocalEndpoint);
    return {
      title: "搜索网络",
      ...(endpoint !== undefined ? { subject: endpoint } : {}),
      ...(local !== undefined ? { body: local } : {}),
    };
  }
  if (tool === "remember") {
    if (args.trigger === "session_end_distill") {
      return { title: "写入全局记忆", subject: "会话沉淀：把本场要点写进跨项目记忆（影响你的所有项目）" };
    }
    const layer = args.scope === "global" ? "全局记忆" : "项目记忆";
    const KIND: Record<string, string> = { architecture: "架构", decision: "决策", preference: "偏好", memory: "记忆" };
    const kind = KIND[String(args.kind)] ?? "记忆";
    const topic = s(args.topic) ?? s(args.type);
    return { title: `写入${layer}`, subject: topic !== undefined ? `${kind}「${topic}」` : kind };
  }
  if (tool.startsWith("automation_")) return { title: "变更定时任务", subject: s(args.name) };
  // 读族与渲染/诊断（第 932 页）：它们在沙箱降级或严格档下也会弹批准卡，此前一律落到
  // 「需要你批准 + 参数 JSON」——批的是「读哪个文件 / 查什么 / 渲染哪张图」看不出来。
  if (tool === "read_file") {
    const one = s(args.path);
    const many = Array.isArray(args.paths) ? args.paths.filter((x): x is string => typeof x === "string") : [];
    return { title: "读取文件", body: one ?? (many.length > 0 ? many.join("、") : JSON.stringify(args)) };
  }
  if (tool === "grep") return { title: "查找内容", body: s(args.pattern) ?? JSON.stringify(args) };
  if (tool === "glob") return { title: "找文件", body: s(args.pattern) ?? JSON.stringify(args) };
  if (tool === "lsp") {
    const what = s(args.symbol) ?? s(args.operation) ?? s(args.path);
    return { title: "查符号", ...(what !== undefined ? { subject: what } : {}), ...(s(args.path) !== undefined && s(args.symbol) !== undefined ? { body: s(args.path) } : {}) };
  }
  if (tool === "render_image") return { title: "渲染图", body: s(args.path) ?? JSON.stringify(args) };
  if (tool === "diagnose") {
    const face = s(args.face);
    return { title: "跑诊断", body: face === undefined ? "全部检查" : face === "lint" ? "只跑 lint" : "只跑 test" };
  }
  // 名单外（MCP scoped 工具、运行期注入的诊断/检索等）也得看见**批的是哪把工具**：
  // 卡片原来只给「需要你批准」+ 参数 JSON，工具名只藏在 aria-label 里 ⇒ 视觉上无从判断。
  return { title: "需要你批准", subject: s(tool), body: JSON.stringify(args) };
}
