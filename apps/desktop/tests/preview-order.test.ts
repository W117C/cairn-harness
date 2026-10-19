// 预览失败不留空白窗格（2026-10-18）：
//   旧顺序 = 先开浏览器窗格再 previewStart；失败时窗格已开、页面空，用户要手动关。
//   新顺序 = 先 start；failed 直接错误条返回，有页面才开窗格。
// 真机两径都验过：无入口 → error-strip 有文案、无 pane；有 index.html → pane 打开且 URL 就绪。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const app = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");

describe("openPreview 顺序", () => {
  it("先 previewStart，失败在开窗格之前返回", () => {
    const start = app.indexOf("const openPreview = useCallback");
    const end = app.indexOf("// v6 导出", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const fn = app.slice(start, end);
    const startAt = fn.indexOf("window.agent.previewStart");
    const failedAt = fn.indexOf('snapshot.status === "failed"');
    const paneAt = fn.indexOf("setPaneTabs((tabs) => (tabs.includes(\"browser\")");
    expect(startAt).toBeGreaterThan(-1);
    expect(failedAt).toBeGreaterThan(startAt);
    expect(paneAt).toBeGreaterThan(failedAt);
    // 失败分支必须在开窗格之前 return
    const failedBlock = fn.slice(failedAt, paneAt);
    expect(failedBlock).toContain("return;");
  });
});
