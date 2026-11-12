// 设置层 roadmap（2026-11-10）：schema 版本字段 + 未知键「警告不丢」。
// 版本：写盘必带 version；读到更高版本 = 文件出自更新的应用 ⇒ fail-visible（不猜字段含义），
// 但字段校验照旧宽容回退（老应用读新文件不炸，该说得清）。
// 未知键：校验器不认识 ⇒ 内存形状没有它，但盘上**原样保留**（任何一笔无关 set() 不得洗掉），
// 且 loadWarnings() 出声——「警告不丢」两半各自有钉。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, SettingsStore } from "../src/main/settings";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

const makeStore = async (initial: Record<string, unknown>): Promise<{ dir: string; path: string; store: SettingsStore }> => {
  const dir = await mkdtemp(join(tmpdir(), "settings-schema-"));
  dirs.push(dir);
  const path = join(dir, "settings.json");
  await writeFile(path, JSON.stringify(initial, null, 2), "utf8");
  return { dir, path, store: new SettingsStore(path) };
};

describe("设置 schema 版本与未知键", () => {
  it("写盘带 version 字段（迁移的地基）", async () => {
    const { path, store } = await makeStore({});
    await store.get();
    await store.set({ textSize: "lg" });
    const disk = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    expect(disk.version).toBe(SETTINGS_SCHEMA_VERSION);
  });

  it("读到更高版本 ⇒ future-version 出声，字段校验照旧回退（不炸、不猜）", async () => {
    const { store } = await makeStore({ version: SETTINGS_SCHEMA_VERSION + 1, theme: "light" });
    await store.get();
    const issue = store.loadIssue();
    expect(issue?.kind).toBe("future-version");
    expect(issue?.message).toContain("新版本");
    expect(store.loadWarnings().futureVersion).toBe(SETTINGS_SCHEMA_VERSION + 1);
    // 字段校验照旧：合法值照读（宽容面不变，警告面补齐）
    expect((await store.get()).theme).toBe("light");
  });

  it("未知键警告不丢：无关 set() 不得洗掉盘上未知键，loadWarnings 点名", async () => {
    const { path, store } = await makeStore({ futureField: { a: 1 }, theme: "dark" });
    await store.get();
    expect(store.loadWarnings().unknownKeys).toEqual(["futureField"]);
    await store.set({ textSize: "sm" }); // 一笔与 futureField 无关的写
    const disk = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    expect(disk.futureField).toEqual({ a: 1 }); // 「不丢」那一半
    // 写盘后警告清空是设计：盘上形状刚被本应用重写（未知键保留但已出过声），重读会再报。
    expect(store.loadWarnings().unknownKeys).toEqual([]);
    await store.reload();
    expect(store.loadWarnings().unknownKeys).toEqual(["futureField"]); // 「警告」那一半：保留 ≠ 认识
  });

  it("已知键被校验器回退时，盘上落校验后的值（坏值不留盘）", async () => {
    const { path, store } = await makeStore({ textSize: "not-a-size" });
    await store.get();
    await store.set({ keepAwake: false });
    const disk = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    expect(disk.textSize).toBe(DEFAULT_SETTINGS.textSize);
    expect(disk.keepAwake).toBe(false);
  });

  it("新档案（无文件）读出空警告、不误报", async () => {
    const dir = await mkdtemp(join(tmpdir(), "settings-schema-"));
    dirs.push(dir);
    const store = new SettingsStore(join(dir, "absent.json"));
    await store.get();
    expect(store.loadIssue()).toBeNull();
    expect(store.loadWarnings()).toEqual({ unknownKeys: [], futureVersion: null });
  });
});
