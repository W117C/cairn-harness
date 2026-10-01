// 「本仓认得哪些工具名」的单一事实源（M7：把未知名从默认放行翻成 fail-closed）。
//
// 为什么要派生而不是抄一份：写向工具这个事实本仓已经有**三处**所有者
// （`SIDE_EFFECT_TOOLS` / `INJECTED_TOOLS` / worker 工具表），再手抄第四份就是本仓反复判死的
// 「第二个事实源」形态——`src/agent/write-face.ts:1-16` 正是这份台账的讣告。所以这张表**只做并集**，
// 一个名字都不新增：加工具的人只改自己那一张，本表自动跟上。
//
// 作用域边界（重要）：这张表只回答「**认得这个名字吗**」，**不回答「它危不危险」**。
// 写向判定仍是 `SIDE_EFFECT_TOOLS` 那一侧的事，两者刻意不合并——
// `shell_ro` 是现成的反例：它**不在**写向表里（autonomy.ts 的注释讲了为什么：靠执行期静态白名单，
// 计入写向会把只读 shell 一并摘掉），但它显然是个本仓认得的工具名。
import { TOOL_NAMES } from "../tools/base";
import { INJECTED_TOOLS } from "../agent/tool-surface";
import { WORKER_IMPACT_TOOL, WORKER_TOOL_TABLE, WRITE_WORKER_TOOL_TABLE } from "../agent/orchestrator-config";

/** MCP scoped 注册名的前缀（`mcp__plugin_<p>_<s>__<t>` 与 `mcp__<server>__<t>` 两种形态都算）。
 *  实现从 autonomy 搬到这里：那边要 import 本模块，本模块若再 import 那边就成了环。
 *  autonomy 侧改为从本文件 re-export，导出面与旧写法逐字一致（`isMcpScopedName` 仍从 src/permissions 可取）。 */
export const MCP_SCOPED_PREFIX = "mcp__";

/** 本仓认得的全部工具名：静态注册表 ∪ 运行期注入表 ∪ worker 两张工具表。
 *  worker 表必须进并集的原因不是「齐全」而是**只读 worker 的命**：worker 以 `read-only` + 非交互
 *  跑（`orchestrator.ts` 的 runLoop），漏一个名字 = 一次平常的 `ls` 收 `[permission denied]` 直接罢工。 */
export const KNOWN_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  ...TOOL_NAMES,
  ...INJECTED_TOOLS.map((t) => t.name),
  ...WORKER_TOOL_TABLE,
  ...WRITE_WORKER_TOOL_TABLE,
  WORKER_IMPACT_TOOL,
]);

/** 这个名字是不是本仓认得的工具？`mcp__` 前缀**恒为认得**——见下方注释。 */
export function isKnownToolName(name: string): boolean {
  return KNOWN_TOOL_NAMES.has(name) || isMcpScopedName(name);
}

/** MCP scoped 名（`mcp__` 前缀）算「认得」，因此**不适用**未知名规则：
 *  未知名规则答的是「从没听说过这个工具」；而 MCP scoped 名答的是另一个问题——
 *  「这个工具存在，且它的 server 主动报备过（可能还带了注解）」。
 *  套用未知名规则会**摧毁 readOnlyHint 白名单**：`isWriteCall` 那条更强、也更准的注解路径
 *  （只有 `annotated && readOnly === true` 才算读）会被架空，只读档的 MCP 白名单当场失效。
 *  这是计划书点名要「写进文档并配判卷」的那条决定，判卷在 tests/permissions-tool-registry.test.ts。
 */
export function isMcpScopedName(name: string): boolean {
  return name.startsWith(MCP_SCOPED_PREFIX);
}
