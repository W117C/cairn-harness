// M1e settings 存储单测：写后重载一致 / 非法值回退默认 / 原子写残留清理。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SettingsStore, validateSettings } from "../src/main/settings";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "m1e-settings-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("settings 存储（M1e 布局持久化）", () => {
  it("写入后重新加载（新实例读盘）得到相同布局", async () => {
    const file = join(dir, "settings.json");
    const a = new SettingsStore(file);
    const next = await a.set({ layout: { open: { approvals: false, token: false, git: true }, activePanel: "git", width: 45 }, mode: "auto" });
    expect(next.layout.open.git).toBe(true);
    expect(next.layout.width).toBe(45);
    expect(next.mode).toBe("auto");
    const b = new SettingsStore(file); // 重启 = 新实例
    const reloaded = await b.get();
    expect(reloaded.layout.open.git).toBe(true);
    expect(reloaded.layout.activePanel).toBe("git");
    expect(reloaded.layout.width).toBe(45);
    expect(reloaded.mode).toBe("auto");
  });

  it("非法布局值回退默认（宽度越界 / open 非布尔 / 面板名未知 / JSON 损坏）", async () => {
    const file = join(dir, "bad.json");
    await writeFile(
      file,
      JSON.stringify({ layout: { width: 999, open: { git: "yes", bogus: true }, activePanel: "nope" }, mode: "chaos", theme: "blue" }),
      "utf8",
    );
    const s = await new SettingsStore(file).get();
    expect(s.layout.width).toBe(DEFAULT_SETTINGS.layout.width);
    expect(s.layout.open.git).toBe(false);
    expect(s.layout.open).toEqual(DEFAULT_SETTINGS.layout.open);
    expect(s.layout.activePanel).toBeNull();
    expect(s.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(s.theme).toBe(DEFAULT_SETTINGS.theme);

    await writeFile(file, "{ 不是 JSON", "utf8");
    const s2 = await new SettingsStore(file).get();
    expect(s2).toEqual(DEFAULT_SETTINGS);
  });

  it("validateSettings：缺省输入给全部默认；currentSession 字符串保留", () => {
    expect(validateSettings(null)).toEqual(DEFAULT_SETTINGS);
    const v = validateSettings({ currentSession: "会话 1" });
    expect(v.currentSession).toBe("会话 1");
    expect(validateSettings({ currentSession: 42 }).currentSession).toBeNull();
  });

  it("set 深合并 layout（只改一个字段不动其他）；写盘无 .tmp 残留", async () => {
    const file = join(dir, "s2.json");
    const a = new SettingsStore(file);
    await a.set({ layout: { open: { approvals: true, token: false, git: false }, activePanel: "approvals" } });
    await a.set({ layout: { width: 55 } });
    const s = await a.get();
    expect(s.layout.open.approvals).toBe(true);
    expect(s.layout.activePanel).toBe("approvals");
    expect(s.layout.width).toBe(55);
    const raw = await readFile(file, "utf8");
    expect(raw.includes("\".tmp\"")).toBe(false);
  });
});
