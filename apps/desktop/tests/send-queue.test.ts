// v2.17 运行中可沟通：发送队列的纯函数判卷。
// 队列语义只有三条且都在这里钉住——FIFO 出队、把某条提到队首（「打断并发送」用）、按位移除。
// 组件与 App 只消费这三个出口，不各算一份。
import { describe, expect, it } from "vitest";
import { askBelongsToSession, composerLocked, continueAfterRun, drainQueue, dropQueued, fromSessionQueueEntries, promoteQueued, takeQueued, toSessionQueueEntries, type QueuedSend } from "../src/renderer/send-queue";

const item = (id: number): QueuedSend => ({ id, text: `消息${String(id)}`, attachments: [] });

describe("发送队列纯函数", () => {
  it("takeQueued：取队首、其余原序；空队列给 null", () => {
    const { head, rest } = takeQueued([item(1), item(2), item(3)]);
    expect(head?.id).toBe(1);
    expect(rest.map((i) => i.id)).toEqual([2, 3]);
    expect(takeQueued([]).head).toBeNull();
    expect(takeQueued([]).rest).toEqual([]);
  });

  it("promoteQueued：把指定项提到队首，其余相对次序不变", () => {
    expect(promoteQueued([item(1), item(2), item(3)], 2).map((i) => i.id)).toEqual([3, 1, 2]);
  });

  it("dropQueued：删除指定项，其余次序不变", () => {
    expect(dropQueued([item(1), item(2), item(3)], 1).map((i) => i.id)).toEqual([1, 3]);
  });

  it("promoteQueued / dropQueued：越界原样返回（不抛、不吞）", () => {
    expect(promoteQueued([item(1)], 5).map((i) => i.id)).toEqual([1]);
    expect(promoteQueued([item(1)], -1).map((i) => i.id)).toEqual([1]);
    expect(dropQueued([item(1)], 5).map((i) => i.id)).toEqual([1]);
    expect(dropQueued([item(1)], -1).map((i) => i.id)).toEqual([1]);
  });
});

describe("composerLocked（整卡禁用口径，v2.17）", () => {
  it("仅新建往返中与活动会话的门槛锁输入——运行本身不在输入里", () => {
    expect(composerLocked({ creating: false, gateActive: false })).toBe(false);
    expect(composerLocked({ creating: true, gateActive: false })).toBe(true);
    expect(composerLocked({ creating: false, gateActive: true })).toBe(true);
    expect(composerLocked({ creating: true, gateActive: true })).toBe(true);
  });
});

describe("askBelongsToSession（审批卡归属，v2.18）", () => {
  it("归属已知：只认本会话那张卡，别人的卡不上屏（此前是渲染最后到达的那张）", () => {
    expect(askBelongsToSession({ sessionId: "甲" }, "甲")).toBe(true);
    expect(askBelongsToSession({ sessionId: "乙" }, "甲")).toBe(false);
  });

  it("归属未知（老载荷／headless）：照旧显示——不静默吞卡，也不猜成当前会话", () => {
    expect(askBelongsToSession({ sessionId: undefined }, "甲")).toBe(true);
    expect(askBelongsToSession({}, "甲")).toBe(true);
    expect(askBelongsToSession({ sessionId: undefined }, null)).toBe(true);
  });

  it("没有卡 ⇒ false；但「有活动会话却配空字符串 id」不算本会话（空串是未知，不是通配）", () => {
    expect(askBelongsToSession(null, "甲")).toBe(false);
    expect(askBelongsToSession(null, null)).toBe(false);
    expect(askBelongsToSession({ sessionId: "" }, "甲")).toBe(true);
  });
});

describe("drainQueue（收束后自动派下一条）", () => {
  it("一次一条、按 FIFO 顺序派到队空", async () => {
    const seen: string[] = [];
    const pending = [item(2), item(3)];
    await drainQueue(
      { text: "消息1", attachments: [] },
      async (msg) => { seen.push(msg.text); await Promise.resolve(); return true; },
      () => pending.shift() ?? null,
    );
    expect(seen).toEqual(["消息1", "消息2", "消息3"]);
  });

  it("run 报 false（本轮失败）即停：剩余队列留在表里，不吞不掉", async () => {
    const seen: string[] = [];
    const pending = [item(2)];
    await drainQueue(
      { text: "消息1", attachments: [] },
      async (msg) => { seen.push(msg.text); return false; },
      () => pending.shift() ?? null,
    );
    expect(seen).toEqual(["消息1"]);
    expect(pending.map((i) => i.id)).toEqual([2]);
  });
});

describe("continueAfterRun（一轮收束后是否续派）", () => {
  it("用户打断是正常收束：aborted=true 不丢后续队列", () => {
    expect(continueAfterRun({ ok: false, aborted: true })).toBe(true);
  });

  it("真实失败停表：只有 ok=false 且非用户打断才不续派", () => {
    expect(continueAfterRun({ ok: false })).toBe(false);
    expect(continueAfterRun({ ok: true })).toBe(true);
  });
});

describe("发送队列持久化载荷", () => {
  it("落盘只保留 text/attachments；读回时重建新的渲染 id", () => {
    const live: QueuedSend[] = [
      { id: 7, text: "重启后继续", attachments: [] },
      { id: 9, text: "带引用", attachments: [{ path: "src/a.ts", kind: "file", explicit: true }] },
    ];
    const entries = toSessionQueueEntries(live);
    expect(entries).toEqual([
      { text: "重启后继续", attachments: [] },
      { text: "带引用", attachments: [{ path: "src/a.ts", kind: "file", explicit: true }] },
    ]);
    let next = 0;
    expect(fromSessionQueueEntries(entries, () => ++next)).toEqual([
      { id: 1, text: "重启后继续", attachments: [] },
      { id: 2, text: "带引用", attachments: [{ path: "src/a.ts", kind: "file", explicit: true }] },
    ]);
  });
});
