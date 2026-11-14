
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const app = readAppSurface();

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
