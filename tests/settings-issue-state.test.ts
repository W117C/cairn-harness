// 判卷 · 设置首读失败真的上了 agent:state 应答（v26）：桌面横幅的数据面。
// 只看运行期行为：走真实 initSettingsStore → handleAgentState → 读 settingsIssue 字段。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSettings, handleAgentState, initSettingsStore, reloadSettings, setSettings } from "../src/main/agent-runner";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "settings-issue-state-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("设置首读失败上屏（StateResponse.settingsIssue，v26）", () => {
  it("坏 JSON ⇒ settingsIssue 带文件路径与原因（不是静默缺省）", async () => {
    const path = join(dir, "settings.json");
    await writeFile(path, "{ 不是 JSON", "utf8");
    initSettingsStore(path);
    const state = await handleAgentState(dir);
    expect(state.settingsIssue?.kind).toBe("invalid-json");
    expect(state.settingsIssue?.path).toBe(path);
    expect(state.settingsIssue?.message).toContain("JSON 解析失败");
  });

  it("缺文件 / 正常文件 ⇒ 字段缺席（缺席 ≠ 失败）", async () => {
    initSettingsStore(join(dir, "missing.json"));
    expect((await handleAgentState(dir)).settingsIssue).toBeUndefined();

    const good = join(dir, "good.json");
    await writeFile(good, JSON.stringify({ theme: "dark" }), "utf8");
    initSettingsStore(good);
    expect((await handleAgentState(dir)).settingsIssue).toBeUndefined();
  });

  it("修好并成功写盘后横幅数据消失（同一应答面）", async () => {
    const path = join(dir, "repair.json");
    await writeFile(path, "{ 不是 JSON", "utf8");
    initSettingsStore(path);
    expect((await handleAgentState(dir)).settingsIssue?.kind).toBe("invalid-json");
    await setSettings({ theme: "dark" });
    expect((await handleAgentState(dir)).settingsIssue).toBeUndefined();
  });
});

// 2026-10-30（v31）：外部修好 settings.json 后「重新读取」必须真的重读盘——
// 横幅的数据面（settingsIssue）与生效值（getSettings）都要在**不重启**的情况下翻面。
describe("设置重读入口（v31）", () => {
  it("外部修好文件 + reload ⇒ 横幅消失且新值生效（重读前仍按旧缓存 + 旧横幅）", async () => {
    const path = join(dir, "reload.json");
    await writeFile(path, "{ 不是 JSON", "utf8");
    initSettingsStore(path);
    expect((await handleAgentState(dir)).settingsIssue?.kind).toBe("invalid-json");
    expect((await getSettings()).mode).toBe("default");

    await writeFile(path, JSON.stringify({ mode: "read-only", theme: "dark" }), "utf8");
    // 对照：不点重新读取时，缓存与失败结论都不会自己翻面。
    expect((await handleAgentState(dir)).settingsIssue?.kind).toBe("invalid-json");
    expect((await getSettings()).mode).toBe("default");

    expect(await reloadSettings()).toEqual({ ok: true });
    expect((await handleAgentState(dir)).settingsIssue).toBeUndefined();
    const after = await getSettings();
    expect(after.mode).toBe("read-only");
    expect(after.theme).toBe("dark");
  });

  it("修好后又写坏 + reload ⇒ 横幅换新结论（不是只记第一次）", async () => {
    const path = join(dir, "reload-flip.json");
    await writeFile(path, JSON.stringify({ theme: "dark" }), "utf8");
    initSettingsStore(path);
    expect((await handleAgentState(dir)).settingsIssue).toBeUndefined();

    await writeFile(path, "{ 又坏了", "utf8");
    expect(await reloadSettings()).toEqual({ ok: true });
    expect((await handleAgentState(dir)).settingsIssue?.kind).toBe("invalid-json");

    await writeFile(path, JSON.stringify({ theme: "light" }), "utf8");
    expect(await reloadSettings()).toEqual({ ok: true });
    expect((await handleAgentState(dir)).settingsIssue).toBeUndefined();
    expect((await getSettings()).theme).toBe("light");
  });
});
