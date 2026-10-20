// 独立窗格窗口的事件归属（2026-10-19 独立评审追出的真缺陷）。
//
// 缺陷形状：弹出窗内联写着 `props.sessionId === null || sid === undefined || sid === props.sessionId`
// —— 第一个析取项为真时后面两项全是废话 ⇒ 一个**没有会话归属**的弹出窗把所有会话的事件都吸进来。
// 真实路径：⌘N 回首页时 paneTabs 不清，⧉ 传的是 undefined ⇒ 窗格无 sessionId。
// 用户于是在一个只有「变更」两个字、空态写着"本会话还没有文件改动"的窗格里，
// 读到了**另一个会话**的轮次、文件与验证状态。
//
// 判据落在**纯函数**上（popoutEventBelongsTo）：本仓无 jsdom，交互逻辑走「纯函数 + 接线见证」两面
// （见 render-structure.test.tsx 头注）。纯函数能真跑 ⇒ 这一条不是恒真的源码断言。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { popoutEventBelongsTo } from "../src/renderer/projections";
import type { AgentEvent } from "../../../src/events";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const ev = (o: Record<string, unknown>): AgentEvent => o as unknown as AgentEvent;

describe("弹出窗的事件归属（popoutEventBelongsTo）", () => {
  it("没有会话归属（sessionId=null）⇒ 一条都不收（旧实现这里会把所有会话都吸进来）", () => {
    expect(popoutEventBelongsTo(ev({ type: "user_message", content: "A", session_id: "sA" }), null)).toBe(false);
    expect(popoutEventBelongsTo(ev({ type: "user_message", content: "B", session_id: "sB" }), null)).toBe(false);
    // 反向对照：同一个事件在有归属的窗格里是收的 ⇒ 判据不是恒假
    expect(popoutEventBelongsTo(ev({ type: "user_message", content: "A", session_id: "sA" }), "sA")).toBe(true);
  });

  it("别的会话的事件不收（跨会话污染）", () => {
    expect(popoutEventBelongsTo(ev({ type: "tool_result", callId: "t1", ok: true, output: "x", session_id: "sB" }), "sA")).toBe(false);
  });

  it("没盖章 session_id 的事件不收（推送是广播的，没盖章就不属于任何会话）", () => {
    expect(popoutEventBelongsTo(ev({ type: "user_message", content: "无归属" }), "sA")).toBe(false);
  });

  it("session_titled（push-only 命名推送）不收", () => {
    expect(popoutEventBelongsTo(ev({ type: "session_titled", title: "新名", session_id: "sA" }), "sA")).toBe(false);
  });

  it("本会话的事件收（含 user/tool/delta 各类）", () => {
    expect(popoutEventBelongsTo(ev({ type: "user_message", content: "问", session_id: "sA" }), "sA")).toBe(true);
    expect(popoutEventBelongsTo(ev({ type: "tool_call", id: "t1", name: "read_file", args: {}, session_id: "sA" }), "sA")).toBe(true);
    expect(popoutEventBelongsTo(ev({ type: "assistant_delta", callId: "c1", text: "答", session_id: "sA" }), "sA")).toBe(true);
  });
});

describe("弹出窗接线：归属判据走纯函数 + 读盘期间的增量要合并", () => {
  const src = read("../src/renderer/components/PopoutApp.tsx");

  it("组件调用 popoutEventBelongsTo，不内联写归属判断", () => {
    expect(src).toContain("popoutEventBelongsTo(e, props.sessionId)");
    // 反面对照：旧的"null 就全都收"不许回来
    expect(src).not.toContain("props.sessionId === null || sid === undefined");
  });

  it("无 sessionId 时不注册事件订阅（没有归属就没有事件面）", () => {
    expect(src).toContain("if (props.sessionId === null) return;");
  });

  it("openSession 的回包用 mergeSessionSnapshot 合并，不直接 setEvents 覆盖", () => {
    expect(src).toContain("mergeSessionSnapshot(r.events, prev)");
    expect(src).not.toContain(".then((r) => { setEvents(r.events); })");
  });
});
