// 已授权站点可撤销（2026-10-18）：记住的站点授权只增不减，用户没有任何入口回收。
// 浏览器 ⋮ 菜单显示数量、可一键清空；清空后 item 变禁用。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/PaneDock.tsx", import.meta.url)), "utf8");

describe("已授权站点逐个撤销", () => {
  it("菜单列出每个站点；移除单个会重写 sidecar；全部清空走 removeItem", () => {
    expect(src).toContain("已授权站点（{String(allowedHosts.length)}）");
    expect(src).toContain("移除 {host}");
    expect(src).toContain("next.delete(host);");
    expect(src).toContain("window.localStorage.setItem(BROWSER_ALLOW_KEY, JSON.stringify([...next]));");
    expect(src).toContain("已移除 ${host} 的授权（下次访问会重新询问）");
    expect(src).toContain("忘记全部已授权站点");
    expect(src).toContain("已清除全部已授权站点（下次访问会重新询问）");
    expect(src).toContain("disabled={allowedHosts.length === 0}");
  });

  it("记住该域 / 挂载时同步列表", () => {
    expect(src).toContain("setAllowedHosts([...next]);");
    expect(src).toContain("setAllowedHosts([...hosts]);");
  });
});
