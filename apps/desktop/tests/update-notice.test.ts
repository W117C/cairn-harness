// 启动检查更新的纯判据（2026-10-30 · 第 810 页）：
// 24h 节流、只有 available 才打扰；WorkbenchView 真接线（不是只写了 hook 没人调）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { UPDATE_CHECK_INTERVAL_MS, getAvailableUpdate, setAvailableUpdate, shouldCheckForUpdate, updateNoticeText } from "../src/renderer/state/update-notice";

const now = 1_800_000_000_000;
type Result = Parameters<typeof updateNoticeText>[0];

describe("shouldCheckForUpdate", () => {
  it("首次 / 非数 / 时钟倒退 ⇒ 查；23h 内不重复，满 24h 再查", () => {
    expect(shouldCheckForUpdate(null, now)).toBe(true);
    expect(shouldCheckForUpdate(Number.NaN, now)).toBe(true);
    expect(shouldCheckForUpdate(now + 60_000, now)).toBe(true);
    expect(shouldCheckForUpdate(now - 23 * 60 * 60 * 1000, now)).toBe(false);
    expect(shouldCheckForUpdate(now - UPDATE_CHECK_INTERVAL_MS, now)).toBe(true);
  });
});

describe("updateNoticeText", () => {
  it("只有 available 才出文案（版本号进句子）；其余状态静默", () => {
    expect(updateNoticeText({ state: "available", currentVersion: "0.1.0", version: "0.2.0", url: "https://example.com" } as Result)).toBe(
      "发现新版本 0.2.0——到「设置 → 关于与更新」查看",
    );
    for (const r of [
      { state: "unconfigured" },
      { state: "error", message: "boom" },
      { state: "up-to-date", currentVersion: "0.1.0", manifestVersion: "0.1.0" },
    ] as Result[]) {
      expect(updateNoticeText(r)).toBeNull();
    }
  });

  it("WorkbenchView 真调用 hook（不是死文件）", () => {
    const view = readFileSync(fileURLToPath(new URL("../src/renderer/panes/WorkbenchView.tsx", import.meta.url)), "utf8");
    expect(view).toContain("useUpdateNotice(setLastNotice)");
  });
});

describe("全局可用更新 store", () => {
  it("set 后 snapshot 可读，清空后回到 null（头像红点读同一份）", () => {
    setAvailableUpdate({ version: "0.2.0", url: "https://example.com" });
    expect(getAvailableUpdate()).toEqual({ version: "0.2.0", url: "https://example.com" });
    setAvailableUpdate(null);
    expect(getAvailableUpdate()).toBeNull();
  });

  it("Sidebar 使用同一个 store 并给出菜单说明（不是只写 notice）", () => {
    // 2026-11-03：头像菜单搬到全局轨底部（AccountMenu），更新红点跟着走。
    const account = readFileSync(fileURLToPath(new URL("../src/renderer/components/AccountMenu.tsx", import.meta.url)), "utf8");
    expect(account).toContain("useAvailableUpdate()");
    expect(account).toContain("STR.sidebar.updateMenuItem");
    expect(account).toContain('data-update={update !== null ? "true" : undefined}');
  });
});
