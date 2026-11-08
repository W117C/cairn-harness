// 浏览器驾驶三件的**实现**（2026-11-06 业主①）：包着 BrowserHost 的 agent 面。
// 规格与注册缝在 core（src/agent/browser-agent.ts）；本文件只在桌面主进程加载，
// CLI/headless 天然不存在。三件全部只内省/受闸导航：导航过 BrowserHost 的 host 闸
// （与 will-navigate 同一把），snapshot/pick 只读已加载页面，无写向、无新增出网决策
// ——导航目标必须是窗格里已授权的站点，未授权拒并给可行动文案。
import type { BrowserWindow } from "electron";
import type { Tool, ToolResult } from "../../../../src/tools/base";
import { ToolError } from "../../../../src/tools/base";
import type { BrowserAgentTools } from "../../../../src/agent/browser-agent";
import type { BrowserHost } from "./browser-host";

const PICK_MAX = 10;
const NO_BROWSER_OWNER: ToolResult = { ok: false, output: "本次运行没有可用的发起窗口" };

export function makeBrowserAgentTools(host: BrowserHost, getOwner: () => BrowserWindow | null): BrowserAgentTools {
  const navigate: Tool = {
    name: "browser_navigate",
    async run(args): Promise<ToolResult> {
      const url = typeof args.url === "string" ? args.url.trim() : "";
      if (url === "") throw new ToolError("browser_navigate: url 参数必须是非空字符串");
      try { const u = new URL(url); if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("proto"); }
      catch { throw new ToolError(`browser_navigate: 只接受 http(s) URL，收到：${url.slice(0, 200)}`); }
      const owner = getOwner();
      if (owner === null) return NO_BROWSER_OWNER;
      const r = host.agentNavigate(url, owner);
      if (!r.ok) return { ok: false, output: `browser_navigate: ${r.error ?? "导航失败"}` };
      return { ok: true, output: "已导航（页面在侧栏浏览器加载；核对内容用 browser_snapshot）" };
    },
  };
  const snapshot: Tool = {
    name: "browser_snapshot",
    async run(): Promise<ToolResult> {
      const owner = getOwner();
      if (owner === null) return NO_BROWSER_OWNER;
      const r = await host.snapshot(owner);
      if (!r.ok) return { ok: false, output: `browser_snapshot: ${r.error ?? "读取失败"}` };
      const lines = [`URL: ${r.url ?? "?"}`, `标题: ${r.title ?? "?"}`, "", r.text ?? ""];
      return { ok: true, output: lines.join("\n") };
    },
  };
  const pick: Tool = {
    name: "browser_pick",
    async run(args): Promise<ToolResult> {
      const selector = typeof args.selector === "string" ? args.selector.trim() : "";
      if (selector === "") throw new ToolError("browser_pick: selector 参数必须是非空字符串");
      const maxRaw = typeof args.max === "number" && Number.isFinite(args.max) ? Math.floor(args.max) : 5;
      const max = Math.min(PICK_MAX, Math.max(1, maxRaw));
      const owner = getOwner();
      if (owner === null) return NO_BROWSER_OWNER;
      const r = await host.pickBySelector(selector, max, owner);
      if (!r.ok) return { ok: false, output: `browser_pick: ${r.error ?? "查询失败"}` };
      if ((r.matches ?? []).length === 0) {
        return { ok: true, output: `无匹配元素（选择器 ${selector}）——页面还在加载时先 browser_snapshot 核对再挑` };
        }
      const lines = (r.matches ?? []).map((m, i) => `${String(i + 1)}. <${m.tag}> ${m.text}`);
      return { ok: true, output: lines.join("\n") };
    },
  };
  return { navigate, snapshot, pick };
}
