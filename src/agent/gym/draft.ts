// 靶场草稿（待办 #47）：把一条**真会话**固化成 case 时，能自动得出的那一半。
//
// 为什么要有它：能力 10 说的「从失败轨迹中学习」在本仓只通了一半——失败会进记忆
// （`failureDigestFromEvents`），但**不会变成可复跑的尺子**：`fixtures/gym/cases/**` 全部手写，
// 而自有靶面已经饱和（8/8 绿）。这条路径补的是能力 6（会话记忆）与能力 10（评估）之间那唯一断裂的一跳。
//
// 纪律（决定这个文件里什么能写、什么不许写）：**草稿不是判据**。
//  - `repo/`（pristine 靶子）不在事件流里——会话跑在真工作区上，起点内容没被记录
//    （D7 的 `.agent/snapshots/` 只覆盖「非空文件被覆写」那一格，不是全量），所以**不许**由这里生成；
//  - `negative.json`（已知错误解，A2 反例控制）要的是"看着像修好了但尺子判失败"的人造解，自动生成＝编数；
//  - sha256 冻结登记必须人做——改判据＝作弊是本仓第一纪律。
// 因此本模块只产 task.md / 候选 expect / 一份缺件清单，且**验证未知时不产 expect.json**（不猜一个 false 冒充判据）。
import type { AgentEvent } from "../../events";

/** 只有这两个工具会真的改盘（run_shell 的改动无法从事件里归因到文件）。 */
export const DRAFT_WRITE_TOOLS: ReadonlySet<string> = new Set(["write_file", "edit_file"]);

export interface GymDraft {
  /** 首条 user_message 原文（题面）。没有则为空串，并由 missing 点名。 */
  task: string;
  /** 会话中后续的 user_message 条数：一条 case 只有一个题面，多出来的必须人决定并入哪句。 */
  extraUserMessages: number;
  /** **成功**写过的文件（去重排序）。注意这是"改过"，不等于"必改"。 */
  candidateChanges: string[];
  /** 主流程写工具调用里失败的次数（改坏过 ⇒ 这条会话可能压根不适合当 case）。 */
  failedWrites: number;
  /** worker 子流的写盘次数：有意排除在候选集之外（parent 的 case 不该含 worker 的改动）。 */
  workerWrites: number;
  /** 最后一次 verify 的结果；null = 这条会话压根没验过。 */
  verifyOk: boolean | null;
  verifyAttempts: number;
  toolCalls: number;
  hadError: boolean;
  /** 一份 case 还差什么才算齐——逐条说清是"人必须给"还是"这条会话本身不适合"。 */
  missing: string[];
}

export function draftFromEvents(events: readonly AgentEvent[]): GymDraft {
  const userTexts: string[] = [];
  const callPath = new Map<string, string>(); // tool_call.id → 该次写盘的目标路径（主流程）
  const written = new Set<string>();
  let failedWrites = 0, workerWrites = 0, toolCalls = 0, verifyAttempts = 0, hadError = false;
  let verifyOk: boolean | null = null;
  for (const e of events) {
    switch (e.type) {
      case "user_message":
        userTexts.push(e.content);
        break;
      case "tool_call": {
        toolCalls++;
        if (!DRAFT_WRITE_TOOLS.has(e.name)) break;
        if (e.agent_id !== undefined) { workerWrites++; break; } // 子流的写不算 parent 的改动
        const p = typeof e.args.path === "string" ? e.args.path : "";
        if (p) callPath.set(e.id, p);
        break;
      }
      case "tool_result": {
        // 结果侧也要挡子流：`callPath` 用的是 provider 给的 callId，而各家缺省 id 是
        // **流内序号**（openai `call-${index}`、gemini `gemini-call-${seq}`）⇒ parent 与 worker
        // 完全可以都有 `call-0`。只在 tool_call 面归因 = 只挡了一半取料面（AGENTS 记的同族缺陷）。
        if (e.agent_id !== undefined) break;
        const p = callPath.get(e.callId);
        if (p === undefined) break;
        if (e.ok) written.add(p);
        else failedWrites++;
        break;
      }
      case "verify_result":
        // 带 agent_id 的 verify 属于 worker 子流：把它算成 parent 的验证证据，正是
        // 「worker 验过了 → 看起来像父会话验过了」那三次下游被骗的同一格。
        if (e.agent_id !== undefined) break;
        verifyAttempts++;
        verifyOk = e.ok; // 取最后一次：case 问的是"这条链最终验过了吗"
        break;
      case "error":
        hadError = true;
        break;
      default:
        break;
    }
  }
  const task = userTexts.length > 0 ? userTexts[0] : "";
  const missing: string[] = [
    "repo/：pristine 靶子不在事件流里（会话跑在真工作区上；D7 快照只覆盖非空覆写那一格）⇒ 必须人给一份最小仓库",
    "negative.json：已知错误解要人写（自动生成＝编一个反例来证明尺子有效）",
    "expect.mustChangeFiles：这里给的是**改过**的文件，不是**必改**的文件 ⇒ 逐条人核，尤其要删掉跑偏那几笔",
  ];
  if (task === "") missing.push("task.md：会话里没有 user_message ⇒ 没有题面");
  if (userTexts.length > 1) missing.push(`题面之外还有 ${String(userTexts.length - 1)} 条 user_message：一条 case 只装一个题面，多出来的要人决定并入还是另开一条`);
  if (verifyOk === null) missing.push("没有 verify_result ⇒ mustPassVerify 无从判，本模块因此**不产 expect.json**（不拿 false 冒充判据）");
  if (written.size === 0) missing.push("主流程一次成功的写盘都没有 ⇒ 这不是一条改动类任务，不适合直接进靶场");
  if (failedWrites > 0) missing.push(`写盘失败 ${String(failedWrites)} 次 ⇒ 先确认这条轨迹值得当尺子，而不是把一次半途而废固化下来`);
  if (hadError) missing.push("会话里出现过 error 事件 ⇒ 先排除它是环境失败伪装的（那种该修环境，不该进 case）");
  if (workerWrites > 0) missing.push(`worker 子流另有 ${String(workerWrites)} 次写盘：已排除在候选集外（parent 的 case 不含 worker 的改动）`);
  return {
    task,
    extraUserMessages: Math.max(0, userTexts.length - 1),
    candidateChanges: [...written].sort(),
    failedWrites,
    workerWrites,
    verifyOk,
    verifyAttempts,
    toolCalls,
    hadError,
    missing,
  };
}

/** 草稿要落盘的文件名与内容。纯函数：IO 交给调用方（脚本），才测得到"验证未知时不产 expect.json"。 */
export function renderDraft(d: GymDraft, caseId: string): Record<string, string> {
  const files: Record<string, string> = {
    "task.md": d.task.trim() === "" ? "（缺题面：见 DRAFT.md）\n" : d.task.endsWith("\n") ? d.task : d.task + "\n",
    "DRAFT.md": [
      "# 靶场草稿 " + caseId + "（**不是判据，别登记进 frozen-sha256.json**）",
      "",
      "自动得出的部分：task.md、" + (d.verifyOk !== null ? "expect.candidate.json、" : "") + "本清单。",
      "还缺（人必须给，缺一就不能 promote）：",
      ...d.missing.map((m) => "- " + m),
      "",
      "候选必改集（= 会话里成功写过的文件，逐条核）：",
      ...(d.candidateChanges.length ? d.candidateChanges.map((f) => "- " + f) : ["- （无）"]),
      "",
      "统计：tool_call " + String(d.toolCalls) + " 次 · verify " + String(d.verifyAttempts) +
        " 次（最后一次 " + (d.verifyOk === null ? "无" : d.verifyOk ? "绿" : "红") + "）· " +
        "写失败 " + String(d.failedWrites) + " · worker 写 " + String(d.workerWrites),
      "",
    ].join("\n"),
  };
  if (d.verifyOk !== null) {
    // 名字里带 candidate：`loadCase` 只认 expect.json，草稿因此绝不会被当成判据跑起来
    files["expect.candidate.json"] = JSON.stringify(
      { mustPassVerify: d.verifyOk, mustChangeFiles: d.candidateChanges, mustNotChangeFiles: [] }, null, 2) + "\n";
  }
  return files;
}

/** 草稿默认落点：cases/ 之外（`fixtures/gym/drafts/<id>`）。promote 是人的动作，不由这里做。 */
export function draftDirFor(casesParent: string, caseId: string): string {
  return casesParent + "/drafts/" + caseId;
}

/** 人补件核对（待办 #47 的消费端）：草稿生成之后，「齐不齐」这件事此前只有 DRAFT.md 里那段人读的清单，
 *  没有任何机检面能回答「这条现在能不能 promote」——producer 有判卷、consumer 零观测，正是本仓反复踩的「两头断」。
 *  纯函数：入参是目录里**已有的相对路径清单**（IO 交给调用方），因此"空 repo/ 目录"这种形状能被单测钉住。
 *  注意它不判"对不对"：`expect.json` 与候选集是否被人核过、negative 是不是真反例，都在人的格子里。 */
export function promoteBlockers(relPaths: readonly string[]): string[] {
  const set = new Set(relPaths);
  const out: string[] = [];
  // 「有 repo/ 这个目录」不等于「有靶子」：清单里只会有文件，所以按前缀数文件。
  if (!relPaths.some((p) => p.startsWith("repo/"))) out.push("repo/：一条文件都没有 ⇒ pristine 靶子还没给");
  if (!set.has("task.md")) out.push("task.md：缺题面");
  if (!set.has("negative.json")) out.push("negative.json：A2 反例控制缺位 ⇒ 这条尺子没法证明它能判失败");
  if (!set.has("expect.json")) {
    out.push(set.has("expect.candidate.json")
      ? "expect.json：只有自动出的候选集，还没人把它核成判据"
      : "expect.json：既没有判据也没有候选集");
  }
  return out;
}
