// 插件来源/作用域的词表（第 928 页）：此前三份手抄本漂成了两套说法——
//   · 安装确认卡把 local 读作「本地目录」，而列表页与发现页读作「本地」；
//   · runtime（没有安装记录、手放进插件目录的那一类）只有列表认得，写「手动」；
//   · 作用域两边一个按 "user" 判、一个按 "project" 判，读起来像两条规则。
// 一份词表放组件层（三张卡都在这一层，派生层的 PluginRowView 只提供取值）。
import type { PluginRowView } from "../../derived/plugins";
import type { PluginInstallScope } from "../../../../../../src/main/plugin-source";

/** 来源：官方目录 / Git / 本地目录 / 手动（runtime = 没有安装记录、手放进目录的）。 */
export function sourceKindLabel(kind: PluginRowView["sourceKind"]): string {
  if (kind === "catalog") return "官方目录";
  if (kind === "git") return "Git";
  if (kind === "local") return "本地目录";
  return "手动";
}

/** 作用域：user = 全局（对所有项目生效），project = 当前项目。 */
export function scopeLabelOf(scope: PluginInstallScope): string {
  return scope === "user" ? "全局" : "当前项目";
}

/** 插件「组成」的六类（第 935 页）：发现页的能力计数与详情抽屉的组成行共用这一张表。
 *  此前详情抽屉直接摆英文键名（`agents N · hooks N`），而发现页早有中文（智能体 / 钩子）——
 *  同一套词两处两种写法，抽屉里还夹在「技能 / 命令」中间。 */
export type PluginCategory = "skills" | "commands" | "agents" | "hooks" | "mcp" | "lsp";

export const PLUGIN_CATEGORY_LABEL: Readonly<Record<PluginCategory, string>> = {
  skills: "技能",
  commands: "命令",
  agents: "智能体",
  hooks: "钩子",
  mcp: "MCP",
  lsp: "LSP",
};

export function categoryLabel(kind: PluginCategory): string {
  return PLUGIN_CATEGORY_LABEL[kind];
}
