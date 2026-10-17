// 项目内应用数据区 `.agent/` 的单一事实源。
//
// 结构债审查报告 #6-4：`join(workspace, ".agent", …)` 手写了约 20 处（cli / agent-runner / lsp /
// rules / memory / …）。散着写不会立刻坏，坏在**改名与搬家时逐处改**——少改一处就是「有些开关读了
// 一个目录、有些读了另一个」，而且这种分叉平时完全静默（两处都还能打开文件）。
//
// ⚠️ 名字为什么不叫 `appDataDir`（审查报告里那个名）：`src/permissions/rules.ts` 里
// `globalPermissionsPath(appDataDir?: string)` 的同名参数指的是**全局应用数据根**（`~/.local/share`
// 那一级，`DSH_APPDATA`），与「某个 workspace 下的 `.agent/`」是**两个概念**。同一个词指两件事正是
// 本仓反复点名的腐坏形状，所以这里取一个不会读岔的名字：`projectAgentPath`。
//
// 边界怎么划的：本模块只管**拼路径**，不管目录是否存在、也不管谁有权读它。
// 与它相邻但**不同**的三族，刻意不并进来：
//   · `PROJECT_SKILLS_DIR_SEGMENTS` / `CUSTOM_PROVIDERS_RELATIVE_PATH` 那类是**相对路径段**常量
//     （消费方自己拼根），语义不是「某个 workspace 下的绝对路径」；
//   · `src/tools/base.ts` 与 `src/agent/file-revert.ts` 里那几处是**守卫**（判断某段路径是不是
//     `.agent`），不是构造点——守卫与构造分开写是对的：合并会让「改名时两边一起改」变成「改名时
//     两边一起错」；
//   · `resolve(root, ".agent", …)` 那两处（lsp 的 lsp.json）：`resolve` 与 `join` 在**相对入参**
//     下语义不同（前者按 cwd 解析），收进这个 `join` 造的式子就等于悄悄改语义。
import { join } from "node:path";

/** `<workspace>/.agent[/segments…]`。
 *  入参须是**工作区根**；返回的是一段路径字符串，不保证目录存在（创建由调用方按需做）。
 *  单参调用就是「项目数据区本身」（原 `src/agent/memory/store.ts::projectAgentDir`，2026-10-17 提到这里
 *  ——它是同一个概念的两份名字，而只有那份在用）。 */
export function projectAgentPath(workspace: string, ...segments: string[]): string {
  return join(workspace, ".agent", ...segments);
}
