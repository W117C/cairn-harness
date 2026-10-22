/** 第 9 点·插话在转录里的轮次语义（2026-10-23）。
 *
 *  缺陷形状（实测）：`projectStream` 把**每一条** `user_message` 都当新一轮开头（`rounds += 1`）。
 *  插话也走 `user_message` ⇒ 同一轮被劈成两轮：轮号从 1 跳到 2、上一轮气泡被提前落定、
 *  按轮跳转（`userTextOfRound`）全错位，而转录上看起来像"用户又开了一个任务"。
 *
 *  本组钉三件事：① 插话**不推**轮号；② 插话**仍显示**（用户说过的话不许消失）；
 *  ③ 真新轮照旧推（这一条挡的是"把判据写成恒不推"）。
 */
import { describe, expect, it } from "vitest";
import { projectStream } from "../src/renderer/derived/stream";
import type { AgentEvent } from "../../../src/events";

const ev = (xs: unknown[]): AgentEvent[] => xs as AgentEvent[];
const steer = (text: string, step = 0) =>
  ({ type: "user_message", content: text, origin: { kind: "steering", step } });

describe("转录里的插话：显示，但不开新轮", () => {
  it("★ 插话不推轮号：同一轮里的一条插话，round 仍是 1", () => {
    const rows = projectStream(ev([
      { type: "user_message", content: "任务：改 a.ts" },
      { type: "assistant_delta", callId: "a1", text: "我来改" },
      steer("插话：先别改"),
    ]), true);
    const userRows = rows.filter((r) => r.kind === "user");
    expect(userRows).toHaveLength(2); // 显示：两条都在
    expect(Math.max(...rows.map((r) => r.round ?? 0)), "同一轮被劈成两轮").toBe(1);
  });

  it("★ 插话仍显示，且被标成插话（不是悄悄丢掉）", () => {
    const rows = projectStream(ev([
      { type: "user_message", content: "任务" },
      steer("插话：先别改"),
    ]), true);
    const s = rows.find((r) => r.kind === "user" && String(r.text).includes("插话"));
    expect(s, "用户说过的话在转录里消失 = 界面在说谎").toBeDefined();
    expect((s as { steering?: boolean }).steering).toBe(true);
  });

  it("★ 反面：真开新一轮时轮号照旧推进（不许把判据写成恒不推）", () => {
    const rows = projectStream(ev([
      { type: "user_message", content: "第一轮" },
      { type: "assistant_message", content: "完" },
      { type: "user_message", content: "第二轮" },
    ]), true);
    expect(Math.max(...rows.map((r) => r.round ?? 0))).toBe(2);
  });

  it("sidechat / goal 来源照旧推轮（只有 steering 是例外）", () => {
    const rows = projectStream(ev([
      { type: "user_message", content: "第一轮" },
      { type: "user_message", content: "提升过来的", origin: { kind: "sidechat", session_id: "s", source_event_ids: [1] } },
    ]), true);
    expect(Math.max(...rows.map((r) => r.round ?? 0))).toBe(2);
  });
});
