// vm 切片判据的共用绑料（三处消费：renderer-history-live / renderer-panels-real-data，
// 以及只喂 renderEvent 的 renderer-run-control）。export 的每一个名字都是一个
// 「被切片模块 import 进来的真实现」——准入判据与工具摘要政策各一份。
//
// 为什么只有一份：这些测试把 app.js / history-window.js 的**源码片段**跑在 vm 里，
// 而 history-window.js 从 projections 导入了子流准入判据（entersMainConversation）。
// vm 跑的是脚本不是模块 ⇒ 那条 import 必须剥掉、绑定必须从 context 给。
// 若每份测试各写一遍剥法，改一行 import 形制就要三处同步；漏掉的那处不会报错，
// 只会**静默把判据换成自己的副本**——正是本仓反复栽的「一份政策两份实现」。
import { entersMainConversation, PANEL_DIRTY_TYPES, toolArgsSummary } from "../src/renderer/projections";

/** history-window.js 里那条必须剥掉的 import（逐字）。 */
export const CHILD_IMPORT = `import { entersMainConversation } from './projections';`;

/** 分组器段（windowRange 之前）剥成可在 vm 里 eval 的脚本。找不到标记就 throw——不许静默降级。 */
export function groupedScript(historyWindowSource: string): string {
  const cut = historyWindowSource.indexOf("export function windowRange");
  if (cut < 0) throw new Error("history-window.js 里找不到 windowRange —— 切片标记改名了，同步本文件");
  const head = historyWindowSource.slice(0, cut);
  if (!head.includes(CHILD_IMPORT)) throw new Error("history-window.js 的准入 import 改形了——同步本文件的剥法");
  return head.replaceAll("export function ", "function ").replace(CHILD_IMPORT, "");
}

export { entersMainConversation, PANEL_DIRTY_TYPES, toolArgsSummary };
