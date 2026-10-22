// 重启恢复上次会话的判据（2026-10-21）：跨工作区必须恢复，且同名 id 不许串项目。
//
// 桌面宿主的会话 id 是分钟级时间戳（`sessions.ts` 的 createSession），两个项目在同一分钟各建
// 一条就会得到**同一个 id**。只存 id 再按 id 找第一条，会把 A 的转录当 B 的恢复，后续 run 也
// 落进 A。所以 key 必须带 workspace，恢复时 id + workspace **两个都对上**才算命中。
import { describe, expect, it } from "vitest";
import {
  decideLastSessionRestore, parseLastSession, serializeLastSession,
} from "../src/renderer/last-session";

const s = (id: string, workspace: string) => ({ id, workspace });

describe("上次会话恢复判据", () => {
  it("跨工作区：id + workspace 对上 ⇒ 恢复", () => {
    expect(decideLastSessionRestore({
      last: { id: "same-id", workspace: "/tmp/b" },
      sessions: [s("same-id", "/tmp/a"), s("same-id", "/tmp/b")],
      activeId: null,
    })).toEqual({ kind: "restore", id: "same-id", workspace: "/tmp/b" });
  });

  it("同名 id 但 workspace 指向已移除/暂不可见的项目 ⇒ 保留 key，不退回同名会话", () => {
    // 项目可能是外置盘没挂上、或本次扫描失败；删 key 会让它永久失去恢复机会。
    expect(decideLastSessionRestore({
      last: { id: "same-id", workspace: "/tmp/gone" },
      sessions: [s("same-id", "/tmp/a")],
      activeId: null,
    })).toEqual({ kind: "keep" });
  });

  it("旧 key 只有 id、清单里同名 id 多于一条 ⇒ 保留 key（歧义时不猜、也不销毁）", () => {
    expect(decideLastSessionRestore({
      last: { id: "same-id", workspace: null },
      sessions: [s("same-id", "/tmp/a"), s("same-id", "/tmp/b")],
      activeId: null,
    })).toEqual({ kind: "keep" });
  });

  it("旧 key 只有 id、清单里恰好一条 ⇒ 恢复（向后兼容）", () => {
    expect(decideLastSessionRestore({
      last: { id: "old", workspace: null },
      sessions: [s("old", "/tmp/a")],
      activeId: null,
    })).toEqual({ kind: "restore", id: "old", workspace: "/tmp/a" });
  });

  it("已经打开了会话 ⇒ 跳过，且不清 key", () => {
    expect(decideLastSessionRestore({
      last: { id: "old", workspace: "/tmp/a" },
      sessions: [s("old", "/tmp/a")],
      activeId: "old",
    })).toEqual({ kind: "skip" });
  });

  it("上次会话不在本次清单 ⇒ 保留 key 等下次；没有记录 ⇒ clear（幂等）", () => {
    expect(decideLastSessionRestore({ last: { id: "gone", workspace: "/tmp/a" }, sessions: [], activeId: null }))
      .toEqual({ kind: "keep" });
    expect(decideLastSessionRestore({ last: null, sessions: [], activeId: null })).toEqual({ kind: "clear" });
  });
});

describe("lastSession key 编解码", () => {
  it("新格式带 workspace，roundtrip 不丢字段", () => {
    const raw = serializeLastSession({ id: "s1", workspace: "/tmp/a" });
    expect(parseLastSession(raw)).toEqual({ id: "s1", workspace: "/tmp/a" });
  });

  it("旧格式（裸 id 字符串）读成 workspace:null", () => {
    expect(parseLastSession("s1")).toEqual({ id: "s1", workspace: null });
  });

  it("坏 JSON / 缺 id ⇒ null（不把垃圾当会话）", () => {
    expect(parseLastSession("{")).toBeNull();
    expect(parseLastSession(JSON.stringify({ workspace: "/tmp/a" }))).toBeNull();
    expect(parseLastSession(null)).toBeNull();
  });
});
