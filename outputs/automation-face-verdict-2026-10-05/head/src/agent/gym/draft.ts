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
import { isEnvVerifyCause, type AgentEvent, type VerifyCause } from "../../events";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
  /** 与 `verifyOk` **同一拍**的归因（最后一次父流 verify 的 cause；没验过则 null）。
   *  带着它而不是让消费方各扫一遍事件：`verifyOk` 的「取最后一次」规则只允许有一份。 */
  verifyCause: VerifyCause | null;
  verifyAttempts: number;
  toolCalls: number;
  /** **父流**里没有结果的工具调用笔数：会话中途被切断 / 结果没落盘都长这样。
   *  2026-09-23 在唯一一条真·持久化会话上量到的：3 个 tool_call、2 个 tool_result，
   *  末笔是 `run_shell`（`pnpm test`）且无结果——当时的清单对这一格一字未提。 */
  unansweredCalls: number;
  hadError: boolean;
  /** 一份 case 还差什么才算齐——逐条说清是"人必须给"还是"这条会话本身不适合"。 */
  missing: string[];
}

export function draftFromEvents(events: readonly AgentEvent[]): GymDraft {
  const userTexts: string[] = [];
  const callPath = new Map<string, string>(); // tool_call.id → 该次写盘的目标路径（主流程）
  // 半截轨迹的账：父流里每笔工具调用先 +1，配到结果再 -1。
  // **两侧都必须先看 agent_id**——各家缺省 callId 是流内序号，parent 与 worker 可以都有 `call-0`；
  // 只按 id 配对 = worker 的结果把 parent 的调用**假答**掉，这条「轨迹是半截的」便永远不报。
  const pending = new Map<string, number>();
  const written = new Set<string>();
  let failedWrites = 0, workerWrites = 0, toolCalls = 0, verifyAttempts = 0, hadError = false;
  let verifyOk: boolean | null = null, verifyCause: VerifyCause | null = null;
  for (const e of events) {
    switch (e.type) {
      case "user_message":
        userTexts.push(e.content);
        break;
      case "tool_call": {
        toolCalls++;
        // 记账在两个 break **之前**：半截与否与「是不是写盘工具」无关，一条只跑测试的会话同样会断在半路。
        if (e.agent_id === undefined) pending.set(e.id, (pending.get(e.id) ?? 0) + 1);
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
        const left = (pending.get(e.callId) ?? 0) - 1; // 父流的结果才销得到账
        if (left > 0) pending.set(e.callId, left);
        else pending.delete(e.callId); // 对不上任何调用的结果（日志只截到后半段）不留下负数
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
        verifyCause = e.cause ?? null; // 与 verifyOk 同一拍：归因也只能取最后一次，两处规则必须同一条
        break;
      case "error":
        hadError = true;
        break;
      default:
        break;
    }
  }
  const task = userTexts.length > 0 ? userTexts[0] : "";
  let unansweredCalls = 0;
  for (const n of pending.values()) unansweredCalls += n;
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
  if (unansweredCalls > 0) missing.push(`有 ${String(unansweredCalls)} 次工具调用在流里没有结果 ⇒ 这条轨迹是**半截的**` +
    "（会话中途被切断，或结果压根没落盘——两种都不是可冻结的 case，先弄清是哪一种）");
  if (hadError) missing.push("会话里出现过 error 事件 ⇒ 先排除它是环境失败伪装的（那种该修环境，不该进 case）");
  if (workerWrites > 0) missing.push(`worker 子流另有 ${String(workerWrites)} 次写盘：已排除在候选集外（parent 的 case 不含 worker 的改动）`);
  return {
    task,
    extraUserMessages: Math.max(0, userTexts.length - 1),
    candidateChanges: [...written].sort(),
    failedWrites,
    workerWrites,
    verifyOk,
    verifyCause,
    verifyAttempts,
    toolCalls,
    unansweredCalls,
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
        "写失败 " + String(d.failedWrites) + " · worker 写 " + String(d.workerWrites) +
        " · 无结果的工具调用 " + String(d.unansweredCalls),
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

/* ============================== 落盘那一跳（能力 10 的接线端） ==============================
 * 上面 `renderDraft` 是纯函数，而它在 HEAD 上的**唯一**调用方是手工 CLI `scripts/gym-draft.ts`
 * （缺省 dry run，要 `--apply` 才写盘，也不在 `package.json` 的脚本表里）⇒ 判卷/bench 每跑一片红，
 * `fixtures/gym/drafts/` 仍是 0 条（2026-10-05 现读：worktree 与主树两侧都无该目录，
 * `find` 全仓 0 份 `DRAFT.md`，`git log --all --diff-filter=A -- fixtures/gym/drafts` 空）。
 * 本函数把「一条已经跑完的失败会话」变成盘上的草稿，触发条件三条，每条都有理由：
 *  ① **失败 = 最后一次父流验证红，且不是环境红**（`verifyOk`/`verifyCause` 走本模块既有的「取最后一次」
 *    规则，环境红由 `src/events` 里唯一那只 `isEnvVerifyCause` 判）：这里不再另写一份「什么算失败」的表。
 *    环境红（runner 缺失/超时/被取消）该修环境，把它固化成 case 就是编尺子；验绿的轮次压根不是失败。
 *  ② 工作区得**自带靶场**（`fixtures/gym/index.json` 在场）：产品跑在别人的仓里不该往人家目录撒文件；
 *  ③ **已存在即不覆盖、不堆叠**：草稿是给人的收件箱，人可能已经往里补了 `repo/` 与 `negative.json`。
 * 本文件头那三条纪律在这里原样成立：写的还是 task.md / DRAFT.md / expect.candidate.json 那三份，
 * `loadCase` 只认 expect.json，所以自动落盘的草稿永远跑不进判据面，sha256 冻结仍是人的动作。 */

/** 没落盘的原因（`null` = 真落盘了）。每一格都要有名字：调用方与判卷都靠它分「不该写」与「写坏了」。 */
export type DraftSkipReason = "not-a-failure" | "no-session-id" | "no-gym-workspace" | "already-drafted" | "write-error";

export interface DraftWriteOutcome {
  /** 落点目录；未落盘为 null。 */
  dir: string | null;
  /** 实际写出的文件名；未落盘为空数组。 */
  files: string[];
  skipped: DraftSkipReason | null;
  /** `write-error` 时的原文——写失败要能被读出来，不能只留一个枚举值。 */
  why: string;
}

export async function writeDraftFromFailedSession(opts: {
  events: readonly AgentEvent[];
  /** 会话 id：事件里不带 session，唯一出处是日志文件名（由调用方按 `sessionOf` 那条规则取）。 */
  caseId: string;
  /** 失败证据**原文**（`failureDigestFromEvents` 的产出），写进 DRAFT.md 供人核对；空串视为上游没给出证据 ⇒ 不产。 */
  digest: string;
  /** 工作区根：只有它自带靶场才落盘（见上面第 ② 条）。 */
  workspace: string;
}): Promise<DraftWriteOutcome> {
  const none = (skipped: DraftSkipReason, why = ""): DraftWriteOutcome => ({ dir: null, files: [], skipped, why });
  const d = draftFromEvents(opts.events);
  // 「这条真的失败了吗」复用两处**既有**裁决，不在这里立第三份表：
  //  · `draftFromEvents` 的「取最后一次父流 verify」规则（验绿 = 这次没失败；压根没验过 = 拿不到判据，
  //    与本文件头「验证未知时不产 expect.json」是同一条纪律的另一半）；
  //  · `isEnvVerifyCause`（src/events 里唯一那只环境谓词）——环境红该修环境，把它固化成 case 就是编尺子。
  // `digest` 只当**证据原文**用（DRAFT.md 里那段），不再兼任触发条件：它对环境红也会出声，口径不同。
  const red = d.verifyOk === false && !(d.verifyCause !== null && isEnvVerifyCause(d.verifyCause));
  if (!red || opts.digest.trim() === "") return none("not-a-failure");
  if (opts.caseId === "") return none("no-session-id"); // 指不出「哪条会话」的草稿没有证据价值
  const gymRoot = join(opts.workspace, "fixtures", "gym");
  const index = await stat(join(gymRoot, "index.json")).catch(() => null);
  if (index === null || !index.isFile()) return none("no-gym-workspace");
  const dir = draftDirFor(gymRoot, opts.caseId); // 沿用既有落点规则：cases/ 之外、按会话 id 一目录
  if (await stat(dir).then((s) => s.isDirectory()).catch(() => false)) return none("already-drafted");
  const files = renderDraft(d, opts.caseId);
  // 「点名失败原因」= 把**同一份**证据原文钉进 DRAFT.md，而不是在这里再总结一遍——
  // 两处各写一遍迟早漂（本仓反复踩的那一格）。
  const draftMd = files["DRAFT.md"] + "\n## 为什么固化这条（失败证据原文，出自 `failureDigestFromEvents`）\n" + opts.digest.trim() + "\n";
  try {
    await mkdir(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) {
      await writeFile(join(dir, name), name === "DRAFT.md" ? draftMd : text, "utf8");
    }
  } catch (err) {
    // 半份草稿比没有草稿更坏：人对着缺件的收件箱会读成「上游没跑过」。清掉自己造的半成品，读数保持 0。
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    return none("write-error", err instanceof Error ? err.message : String(err));
  }
  return { dir, files: Object.keys(files), skipped: null, why: "" };
}
