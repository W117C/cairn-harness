// 架构环对账的登记表（债）。单独一支是因为 CLI 本体有顶层 await——判卷直接 import 它会把整把尺跑一遍
// （`gates.ts` 那一格的老教训：判据与被判的东西不能同处一个可执行文件）。
//
// 登记纪律：每条都要写「为什么今天是债」＋页号出处；**只准调低**；登记了而盘上已经不是圈 ⇒
// `classifyCycles` 报 stale 红（登记表自己烂掉＝假存量）。还圈的顺序按 2026-10-03 技术审查 A6：
// 二选一断圈（`worker-shell-tools → session-provider → memory/inject → memory/lessons → write-face → 回起点`
// 里挑一条改成运行期惰性取用），断完之后**回来把这一条删掉**。
import type { CycleDebt } from "./arch-cycles.js";

/** 已登记的运行期 import 环（成员规范化为字典序）。 */
export const RUNTIME_CYCLE_DEBT: readonly CycleDebt[] = [
  // 第 338 页（2026-10-04）现读登记。为什么是债而不是当场断：这一圈跨的是「会话装配 → 记忆注入 →
  // 教训读写 → worker 工具 → 写面对账」五支，任一条边改成惰性取用都要动产品路径的装配次序，
  // 而本仓当前有 137 份文件在别的会话手里在飞（多会话共享工作树）——**在别人正在改的接缝上拆环**
  // 会比环本身更容易出事。今天先由尺登记，还圈时回来删这一条。
  // 技术审查 2026-10-03 A6 用独立取料面（自写只读脚本＋Tarjan）量的也是**这一条、只这一条**；
  // 本尺换成吃地图自己的 `fileSymbols().imports` ＋ `resolveModuleSpecifier` 再数一次，成员逐字相同
  // ⇒ 两套取料面互相咬住（不是"数字好看"，是两个独立实现给出同一答案）。
  // 现状：跨圈符号全在函数体内被使用 ⇒ 今天不炸；**哪天有人在模块顶层用被圈住的符号就是 ESM TDZ**，
  // 而那要跑到那一行才炸、判卷恰好可能不经过 ⇒ 这一格只能靠结构闸，不能靠行为证人。
  ["src/agent/session-provider.ts", "src/agent/memory/inject.ts", "src/agent/memory/lessons.ts", "src/agent/worker-shell-tools.ts", "src/agent/write-face.ts"],
];
