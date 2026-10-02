/** 主会话**系统提示词面**：这一份文本对四档、以及"按档取面"的那一步。
 *
 * 为什么单独一个模块（M10 拆分，2026-10-01）：这段在此之前住在 `src/main/agent-runner.ts`
 * （那个文件 2,771 行）。它本身**零依赖**——一段常量文本 + 一个纯函数，唯一的引入是
 * `applyModeLineEdits`（`./prompt-surface`，那才是"按档改共用文本"的唯一做法）。
 * 而它却是全文**观察最密**的一段：8 条变异锚点钉在这份文本的字面量上（纪律 3/4/6、编排段的
 * 四个半句、read-only 那一行）、3 个判卷文件覆盖、两道门（`prompt-cost` / `prompt-surface-check`）
 * 从外面读它。把它挪出 2,771 行的文件之后，这两道门不必再为了取一段常量而 import 整个 runner。
 *
 * **搬迁纪律（踩过才写的）**：变异锚点用**源文本字面量**定位，所以这一搬迁**必须逐字**——
 * 改一个空格就会让锚点失针（第 290 页记着 `d1371dd` 把实现搬走导致 4 条锚点失针那笔账）。
 * 本次搬迁同时把 8 条锚点的 `src:` 从 `src/main/agent-runner.ts` 改指到本文件。
 */
import { applyModeLineEdits } from "./prompt-surface";

import type { PermissionMode } from "../permissions";

/** 主会话系统提示词（模块级 = 可被单测锁住：提示词纪律此前从未有测，删掉任何一条都不会红）。
 *  每条纪律都对应一个真实返工面，不是套话：3) 补丁优先（整份重抄会漏抄，write_file 现已会报
 *  +A −R 行并提示），4) 先红后绿（「证明代码真的能跑」的正面），6) 明确「新增用例 ≠ 改判卷文件」
 *  以免与 4) 互斥成模型两难。字节也计入工具面成本（每轮重送的静态段）。 */
export const BASE_SYSTEM = [
  "你是 M0 桌面编程 agent：在指定工作区内读代码、改代码、跑测试、交付结果。",
  "纪律：",
  "1) 任务有歧义先调用 clarify 提问（1–4 问），不要猜；",
  "2) 写/改文件前先 propose_plan 提交方案并等批准（未批准的写操作会被权限层拒绝）；",
  "3) 改已有文件用 edit_file 打补丁，write_file 只用于新建文件（整份重抄既费 output 又容易漏抄未改的行）；",
  "4) 修 bug 先写一条能复现它的测试并跑到红，再改代码到绿；没有红过的复现就不要宣称已修复；",
  "5) 修改完成后调用 verify 跑测试；verify 通过后用一句话收尾；",
  "6) 只改任务需要的文件；既有测试与判卷文件不得改写（第 4 条是**新增**用例，不是改判卷面）。",
  // 编排段刻意**不编号**：纪律 1–6 的编号连续性由 base-system-discipline 钉着（断号会让模型以为
  // 后面的约束可省），而这条是"何时用子代理"的条件段，不是每条任务都走的动作序列。
  // 成本如实记：+115 字符 / +269 字节，每轮重送（静态段），W3 的预算裁决就在这 269 字节上。
  "编排（派子代理时）：能各自独立验收才拆，单一改动别拆；任务书必须自包含——目标 / 涉及文件 / 验收口径，worker 看不到本会话历史；派完先调 wait_for_agents 收队，未拿到回执不得转述 worker 的结论。",
  "机制边界（撞墙时读报错原因调整策略，不要原样重试）：",
  "- 子代理深度恒 1、spawn 有并发上限；worker 改的是它自己那块 worktree，靠合并控制塔按 diff 落地——**本 CLI 没有 git 面板**，别让用户去点批准，也别自己 commit；",
  "- deny 规则与 critical 风险的强制审批不可绕过；会话成本超限会拒绝新 spawn；长时间无进展会被暂停；",
  "- 权限被拒 → 换合规路径或先提交方案；测试失败 → 按失败信息修复后重跑 verify。",
].join("\n");

/** read-only 档的工具面只有 8 把（现读：clarify glob grep lsp propose_plan read_file refine_goal verify），
 *  而纪律 3 与「编排」段是按**能写文件、能派子代理**那张面写的 ⇒ 对它是不可达承诺
 *  （第 174 页那道门登记的 3 条存量豁免就落在这两行上，任务 #16 把它们清掉）。
 *  这里**只改那一档需要改的行**：其余行与 `BASE_SYSTEM` 是同一份源文本（不是抄两份，规则 205），
 *  而纪律编号 1–6 在两档都保持连续（断号会让模型以为后面的约束可省，`base-system-discipline` 钉着）。 */
const READ_ONLY_LINE_REPLACEMENTS: readonly { prefix: string; text: string }[] = [
  { prefix: "3) ", text: "3) 本档不装配写文件与跑命令的工具：要把改动落到盘上，就在收尾时写清「哪个文件、哪几行、改成什么」，由用户在可写档执行，不要声称已改；" },
];
/** 整行删掉的条件段：它存在的前提是「本档能派子代理」，read-only 不满足那个前提。 */
const READ_ONLY_LINE_DROPS: readonly string[] = ["编排（派子代理时）"];

/** 生产装配点用的系统提示词：按档取面。非 read-only 逐字返回 `BASE_SYSTEM`（等价性由判卷钉，不是注释）。 */
export function systemPromptFor(mode: PermissionMode | undefined): string {
  if (mode !== "read-only") return BASE_SYSTEM;
  return applyModeLineEdits(String(BASE_SYSTEM), { replacements: READ_ONLY_LINE_REPLACEMENTS, drops: READ_ONLY_LINE_DROPS }).text;
}
