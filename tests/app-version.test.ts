// 应用版本注入判卷（2026-10-30 · 第 819 页）：
// `initUpdateContext` 此前零调用点 ⇒ getAppVersion() 恒 "0.0.1"，关于页与更新检查都读错版本。
// 桌面启动必须把 app.getVersion() 注入；这里测设置层出口 + 装配根真接线。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { getAppVersion, initUpdateContext } from "../src/main/settings-handlers";

const ORIGINAL = getAppVersion();
afterEach(() => { initUpdateContext({ currentVersion: ORIGINAL }); });

describe("应用版本注入", () => {
  it("initUpdateContext 后 getAppVersion 返回注入值，不再恒 0.0.1", () => {
    initUpdateContext({ currentVersion: "1.2.3" });
    expect(getAppVersion()).toBe("1.2.3");
  });

  it("桌面装配根在启动时用 app.getVersion() 注入（不是死 import）", () => {
    const src = readFileSync(fileURLToPath(new URL("../apps/desktop/src/main/index.ts", import.meta.url)), "utf8");
    expect(src).toContain("initUpdateContext({ currentVersion: app.getVersion() })");
  });
});
