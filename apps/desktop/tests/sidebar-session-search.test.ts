// 侧栏会话搜索判卷（2026-10-18 接通）。
//
// 背景：filterSessions / matchSession / SESSION_FILTERS 从 P3-3 起就在 sessions-view.ts，
// 也有判卷，但**一直没有调用方**——侧栏顶的放大镜实际打开的是 ⌘K 命令面板（整屏模态）。
// 用户点「搜索」想收窄左侧列表，得到的却是盖住整个应用的弹窗，列表一屏没变。
// 本轮把它接进 Sidebar：列表上方一行搜索框，命中走 filterSessions，归档组也参与。
//
// 判据分两层：① 纯函数行为（filterSessions 本身，防回归）；② 接线（Sidebar 真的调用它）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { filterSessions, matchSession } from "../src/renderer/sessions-view";

const sidebarSrc = readFileSync(fileURLToPath(new URL("../src/renderer/components/Sidebar.tsx", import.meta.url)), "utf8");

const S = [
  { id: "s1", title: "修复登录页样式" },
  { id: "s2", title: "重构 api 层", pinned: true },
  { id: "s3", title: "旧的一次调试", archived: true },
  { id: "s4", title: "定时生成日报", origin: "scheduled" as const },
];

describe("filterSessions 行为（侧栏搜索的地基）", () => {
  it("空查询 = 全量返回（常态零成本、无行为变化）", () => {
    expect(filterSessions(S, { search: "", filter: "all" })).toHaveLength(4);
    expect(filterSessions(S, { search: "   ", filter: "all" })).toHaveLength(4);
  });

  it("按标题与 id 模糊匹配，大小写不敏感", () => {
    expect(filterSessions(S, { search: "登录", filter: "all" }).map((s) => s.id)).toEqual(["s1"]);
    expect(filterSessions(S, { search: "API", filter: "all" }).map((s) => s.id)).toEqual(["s2"]);
    expect(filterSessions(S, { search: "s3", filter: "all" }).map((s) => s.id)).toEqual(["s3"]);
  });

  it("无命中返回空数组（调用方据此显示「没有匹配」而不是空列表）", () => {
    expect(filterSessions(S, { search: "不存在的词", filter: "all" })).toEqual([]);
  });

  it("筛选档位与搜索可叠加", () => {
    expect(filterSessions(S, { search: "", filter: "archived" }).map((s) => s.id)).toEqual(["s3"]);
    expect(filterSessions(S, { search: "调试", filter: "archived" }).map((s) => s.id)).toEqual(["s3"]);
    expect(filterSessions(S, { search: "调试", filter: "pinned" })).toEqual([]);
  });

  it("matchSession 的 running 档只认在场的会话", () => {
    expect(matchSession(S[1], { search: "", filter: "running", running: new Set(["s2"]) })).toBe(true);
    expect(matchSession(S[0], { search: "", filter: "running", running: new Set(["s2"]) })).toBe(false);
    expect(matchSession(S[0], { search: "", filter: "running" })).toBe(false);
  });
});

describe("Sidebar 搜索接线", () => {
  it("真的调用 filterSessions（不再只是 re-export）", () => {
    expect(sidebarSrc).toContain("filterSessions(activeSessions");
    expect(sidebarSrc).toContain("filterSessions(archivedSessions");
  });

  it("放大镜改为聚焦侧栏搜索框（此前打开的是 ⌘K 整屏模态）", () => {
    expect(sidebarSrc).toContain("searchInputRef.current?.focus()");
    // 反向：那个按钮不再直接打开命令面板
    expect(sidebarSrc).not.toContain("aria-label={STR.sidebar.search} title={withKeys(STR.sidebar.searchTip, \"palette\")} onClick={props.onOpenPalette}");
  });

  it("无命中有明确文案（不闪回空列表——那会被读成「你什么都没有」）", () => {
    expect(sidebarSrc).toContain("STR.sidebar.noMatch.replace(\"{q}\", sessionQuery.trim())");
    expect(sidebarSrc).toContain("searchOpen &&");
  });

  it("Esc 两级语义：有字先清空，空着才失焦", () => {
    expect(sidebarSrc).toContain('if (e.key === "Escape")');
    expect(sidebarSrc).toContain('if (sessionQuery !== "") { setSessionQuery(""); return; }');
    expect(sidebarSrc).toContain("searchInputRef.current?.blur()");
  });

  it("⏎ 打开第一个命中（搜索的终点就是打开它）", () => {
    expect(sidebarSrc).toContain('if (e.key === "Enter")');
    expect(sidebarSrc).toContain("const first = visibleActive[0] ?? visibleArchived[0];");
    expect(sidebarSrc).toContain("props.onOpen(first.id)");
  });
});
