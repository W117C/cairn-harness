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

// 「缺省开」的断言必须走**读盘路径**：只测 DEFAULT_SETTINGS 对象等于测自己刚改的那一行字，
// 测不到老用户实际拿到什么（磁盘上的 JSON 没有这个键）。缺省开的项（autoMemory / promptCache /
// autoVerify）读法必须是 `typeof … === "boolean" ? … : d.<键>`；写成 `=== true` 就会
// 让「缺省开」对每一台已写过 settings 文件的机器静默变成「关」——最难发现的那类不一致。
describe("promptCache 缺省开（用户裁决 2026-09-19）：只从磁盘部分键路径验", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dsh-settings-pc-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  const readBack = async (raw: Record<string, unknown> | null): Promise<Awaited<ReturnType<SettingsStore["get"]>>> => {
    const file = join(dir, "settings.json");
    await writeFile(file, raw === null ? "{ 不是 JSON" : JSON.stringify(raw), "utf8");
    return new SettingsStore(file).get();
  };

  it("老 JSON（完全没有该键）读回来必须是 true", async () => {
    const s = await readBack({ mode: "auto", theme: "dark", autoMemory: false });
    expect(s.promptCache).toBe(true);
    expect(s.autoMemory, "显式关掉的项不受影响").toBe(false);
  });

  it("显式 false 必须仍是 false（关档保命路径），空对象与坏 JSON 回缺省", async () => {
    expect((await readBack({ promptCache: false })).promptCache).toBe(false);
    expect((await readBack({ promptCache: true })).promptCache).toBe(true);
    expect((await readBack({})).promptCache).toBe(true);
    expect((await readBack(null)).promptCache, "JSON 损坏回退整份缺省").toBe(true);
  });

  it("缺省值本身也是开（两处必须同向：DEFAULT_SETTINGS 与读盘回退）", () => {
    expect(DEFAULT_SETTINGS.promptCache).toBe(true);
  });
});

/* 能力 5 收束闸（用户裁决 2026-09-23）：`agent-plan.md` §483 写的是「桌面产品 lint/test 两者默认开」，
   而这两拍长期 false（09-19 设计稿 D7 记为"调度智能的燃料默认不在线"）。裁的是**只翻 autoVerify**，
   actionFusion 留关等对照数。同一族读盘回退的规则（上一条 describe）在这里同样适用——
   真机 settings.json 是在旧默认下写出来的，键缺失必须读到 true。 */
describe("autoVerify 缺省开：走读盘路径，不走 DEFAULT_SETTINGS 自证", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dsh-settings-av-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  const readBack = async (raw: Record<string, unknown> | null) => {
    const file = join(dir, "settings.json");
    await writeFile(file, raw === null ? "{ 不是 JSON" : JSON.stringify(raw), "utf8");
    return new SettingsStore(file).get();
  };

  it("旧机器（JSON 里压根没这个键）读回来必须是 true", async () => {
    const s = await readBack({ mode: "default", theme: "dark", promptCache: false });
    expect(s.autoVerify).toBe(true);
    expect(s.promptCache, "显式关掉的另一项不受影响").toBe(false);
  });

  it("显式 false 必须仍是 false，空对象与坏 JSON 回缺省", async () => {
    expect((await readBack({ autoVerify: false })).autoVerify).toBe(false);
    expect((await readBack({ autoVerify: true })).autoVerify).toBe(true);
    expect((await readBack({})).autoVerify).toBe(true);
    expect((await readBack(null)).autoVerify, "JSON 损坏回退整份缺省").toBe(true);
  });

  it("DEFAULT_SETTINGS 与读盘回退同向（翻一处忘另一处 = 老用户永远拿不到新默认）", () => {
    expect(DEFAULT_SETTINGS.autoVerify).toBe(true);
  });

  it("同族里仍缺省关的那几项不许被顺手改成开", async () => {
    const s = await readBack({});
    expect(s.actionFusion).toBe(false);
    expect(s.evidenceReceipts).toBe(false);
    expect(s.autoVerifyRepair).toBe(false);
  });
});

/* 跨文件波及面（用户裁决 2026-09-27）：`routingBandit` / `maxBudgetUsd` / `impactAnalysis` 三个
   「省钱 / 少返工」开关里**只翻这一个**——它不改花钱行为，另两个都改，而仓里还没有外部基准
   读数可依。同一族读盘回退的规则在这里同样适用：真机 settings.json 是在旧默认下写出来的，
   键缺失必须读到 true。 */
describe("impactAnalysis 缺省开：走读盘路径，不走 DEFAULT_SETTINGS 自证", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dsh-settings-impact-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  const readBack = async (raw: Record<string, unknown> | null) => {
    const file = join(dir, "settings.json");
    await writeFile(file, raw === null ? "{ 不是 JSON" : JSON.stringify(raw), "utf8");
    return new SettingsStore(file).get();
  };

  it("旧机器（JSON 里压根没这个键）读回来必须是 true", async () => {
    const s = await readBack({ mode: "default", model: "glm-standard" });
    expect(s.impactAnalysis).toBe(true);
  });

  it("显式 false 必须仍是 false，空对象与坏 JSON 回缺省", async () => {
    expect((await readBack({ impactAnalysis: false })).impactAnalysis).toBe(false);
    expect((await readBack({ impactAnalysis: true })).impactAnalysis).toBe(true);
    expect((await readBack({})).impactAnalysis).toBe(true);
    expect((await readBack(null)).impactAnalysis, "JSON 损坏回退整份缺省").toBe(true);
  });

  it("DEFAULT_SETTINGS 与读盘回退同向（翻一处忘另一处 = 老用户永远拿不到新默认）", () => {
    expect(DEFAULT_SETTINGS.impactAnalysis).toBe(true);
  });

  it("只翻这一个：另外两个改花钱行为的仍缺省关（裁决边界，模糊了就等于四件都翻了）", async () => {
    const s = await readBack({});
    expect(s.routingBandit).toBe(false);
    expect(s.maxBudgetUsd).toBe(0);
  });
});

/* 并发丢更新：set 是「取合并基 → 写盘 → 更新缓存」，三步之间没有串行化，于是同窗口里的两笔
   都拿**同一份旧缓存**当基，后落地的那笔把对方刚写的字段原样盖回去。渲染层是这台并发机的燃料：
   persistGitLayout 包在 renderSide 外层（app.js:3396），每帧重绘都发一次 layout 写，而设置页
   点「深色」发的是 theme 写——两者同窗口落地即互吞。panels-check B3b 三条 theme 红的复现面。 */
describe("settings 并发写不得互相吞字段", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dsh-settings-race-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  const readDisk = async (file: string) =>
    JSON.parse(await readFile(file, "utf8")) as { theme?: string; layout?: { open?: { git?: boolean } } };

  it("layout 与 theme 两笔并发 ⇒ 盘上两个字段都必须在", async () => {
    const file = join(dir, "settings.json");
    const s = new SettingsStore(file);
    await Promise.all([
      s.set({ layout: { open: { git: true }, activePanel: "git" } }),
      s.set({ theme: "dark" }),
    ]);
    const disk = await readDisk(file);
    expect(disk.theme, "theme 被另一笔并发写按旧缓存盖回").toBe("dark");
    expect(disk.layout?.open?.git, "layout.open.git 被另一笔并发写按旧缓存盖回").toBe(true);
  });

  it("写序守恒：后发的那笔不得把前一笔已落盘的字段带回默认值", async () => {
    const file = join(dir, "settings.json");
    const s = new SettingsStore(file);
    await s.set({ theme: "dark" });
    // 前一笔已落盘；这一笔只碰 layout，合并基必须是 dark 而不是缓存里的旧值
    await Promise.all([s.set({ layout: { width: 41 } }), s.set({ mode: "auto" })]);
    const disk = await readDisk(file);
    const full = await new SettingsStore(file).get();
    expect(disk.theme).toBe("dark");
    expect(full.mode).toBe("auto");
    expect(full.layout.width).toBe(41);
  });
});
