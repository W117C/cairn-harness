// 浏览器驾驶三件（2026-11-06 业主「完善工具层」①）：agent 直接开页/读页/选元素，
// 驾驶的是**用户看得见的侧栏浏览器**（BrowserHost 的活动视图），不是无头副面。
//  · 分工：本模块只放**规格与注册缝**（core 侧、纯数据）；实现住在桌面端
//    （apps/desktop/src/main/browser-agent-tools.ts，包着 BrowserHost）。
//  · 注入口径：桌面启动时 registerBrowserAgentTools(impls) 注册一次；installAppTools
//    读注册表决定装/不装——CLI/headless 无宿主 ⇒ 整族不注入，模型面一个字节不付。
//  · 权限面：browser_navigate 与 web_fetch 同族（模型发起外部页面加载），裁决实测对齐
//    （tests/permissions-tool-registry.test.ts GOLDEN）；snapshot/pick 是已加载页面的
//    本地内省（read-only 家族）。未授权站点在 BrowserHost.agentNavigate 处拒，不借工具越闸。
import type { Tool } from "../tools/base";
import type { SessionPluginTool } from "./session-provider";

/** 三件的名字。消费面：tests/tool-surface-parity.test.ts 的 INJECTED_TOOLS 声明行、
 *  tests/browser-agent-tools.test.ts 的规格名断言、apps/desktop 的 ToolError 文案前缀——
 *  名单本身仍是三处字面量（G-B 对账按源文本静态解析点号挂载形，循环/常量展开读不到），
 *  本表是给判卷与文档用的名字清单，不是运行期事实源。 */
export const BROWSER_AGENT_TOOL_NAMES = ["browser_navigate", "browser_snapshot", "browser_pick"] as const;

/** 规格面（三份走 pluginTools 注入面，与 MCP/skill 同形；桌面注册后才随 requestFace 注入）。
 *  不写成 GlmToolSpec：组装器 sessionToolSpecs 会把这份平面规格包成 wire 形态，
 *  直接塞 wire 规格会被当成「没有 name/description/parameters 的插件工具」而失去判据。 */
export const BROWSER_AGENT_SPECS: readonly SessionPluginTool[] = [
  {
    name: "browser_navigate",
    description:
      "在侧栏浏览器（用户看得见的那一格）导航到 http(s) URL：已授权站点直接加载；未授权站点拒绝并明说" +
      "（授权走窗格地址栏的手动首访，工具不借道越闸）。何时用：模型要亲自看一个网页的状态/内容/交互结果。" +
      "浏览器窗格没开时本工具会拒（先让用户开窗格）。",
    parameters: { type: "object", properties: { url: { type: "string", description: "目标 URL（http/https）" } }, required: ["url"] },
  },
  {
    name: "browser_snapshot",
    description:
      "读侧栏浏览器当前页：URL/标题/可见文本（帽 8000 字符）。只内省、不发请求。" +
      "何时用：browser_navigate 之后核对页面状态，或看用户正在看的页面内容。",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "browser_pick",
    description:
      "按 CSS 选择器在侧栏浏览器当前页查元素：返回每条的文本片段与定位（帽 10 条）。" +
      "何时用：要精确指认页面上的元素（按钮/输入框/卡片）供交互或任务书引用。",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS 选择器（如 button.primary、a[href*='docs']）" },
        max: { type: "number", description: "最多返回几条（1–10，缺省 5）" },
      },
      required: ["selector"],
    },
  },
];

export interface BrowserAgentTools {
  navigate: Tool;
  snapshot: Tool;
  pick: Tool;
}

let registered: BrowserAgentTools | null = null;

/** 桌面启动时注册一次；重复注册以最后一次为准（同进程单宿主）。 */
export function registerBrowserAgentTools(tools: BrowserAgentTools): void {
  registered = tools;
}

/** 判卷用：清空注册（注册面是进程级的，测试要能还原）。 */
export function unregisterBrowserAgentToolsForTest(): void {
  registered = null;
}

/** installAppTools 消费：注册了才有得装。 */
export function registeredBrowserAgentTools(): BrowserAgentTools | null {
  return registered;
}
