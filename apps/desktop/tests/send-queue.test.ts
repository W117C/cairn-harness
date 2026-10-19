// v2.17 运行中可沟通：发送队列的纯函数判卷。
// 队列语义只有三条且都在这里钉住——FIFO 出队、把某条提到队首（「打断并发送」用）、按位移除。
// 组件与 App 只消费这三个出口，不各算一份。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { askBelongsToSession, composerLockReason, composerLocked, continueAfterRun, drainQueue, dropQueued, fromSessionQueueEntries, promoteQueued, shouldHealStaleRun, takeQueued, toSessionQueueEntries, type QueuedSend } from "../src/renderer/send-queue";

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

describe("composerLockReason（占位文案与快捷键回执的唯一锁因，2026-10-18）", () => {
  it("优先级：门 > 队列读回 > 新建；未锁 = null", () => {
    expect(composerLockReason({ creating: false, gateActive: false })).toBeNull();
    expect(composerLockReason({ creating: true, gateActive: false })).toBe("creating");
    expect(composerLockReason({ queueLoading: true, creating: false, gateActive: false })).toBe("queue");
    expect(composerLockReason({ creating: false, gateActive: true })).toBe("gate");
    // 门未决时同时碰上队列读回：占位必须说「等你的决定」，不能被队列/创建盖掉。
    expect(composerLockReason({ queueLoading: true, creating: true, gateActive: true })).toBe("gate");
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

describe("shouldHealStaleRun（「打断/停止」陈旧旗自愈，第十三遍）", () => {
  it("真打断了一场 run（cancelOk=true）：不摘——正常收束链自会续派队列", () => {
    expect(shouldHealStaleRun({ cancelOk: true, genAtClick: 3, genNow: 3, flagPresent: true })).toBe(false);
  });

  it("main 无 controller + 旗在 + 无新派活：摘（旧代码 void 掉结果 = 点了像没点，业主实测）", () => {
    expect(shouldHealStaleRun({ cancelOk: false, genAtClick: 3, genNow: 3, flagPresent: true })).toBe(true);
  });

  it("同拍竞态：点击后收束链已先派出下一轮（代号已动）——那是真在跑，不摘", () => {
    expect(shouldHealStaleRun({ cancelOk: false, genAtClick: 3, genNow: 4, flagPresent: true })).toBe(false);
  });

  it("旗已不在（收束链自行摘掉）：无事可做，不摘", () => {
    expect(shouldHealStaleRun({ cancelOk: false, genAtClick: 3, genNow: 3, flagPresent: false })).toBe(false);
  });
});

describe("打断接线哨兵（源码级，第十三遍）", () => {
  const appSrc = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
  const queueSrc = readFileSync(new URL("../src/renderer/send-queue.ts", import.meta.url), "utf8");

  it("runCancel 直呼只剩 cancelRunHeal 内一处：void 掉结果的旧静默点全收编", () => {
    expect(queueSrc).toContain("shouldHealStaleRun");
    expect(appSrc.match(/agent\.runCancel/g)?.length).toBe(1);
    expect(appSrc).toContain("window.agent.runCancel(sid).then");
    expect(appSrc).not.toContain("void window.agent.runCancel(sid);");
    expect(appSrc).not.toContain("void window.agent.runCancel(activeId);");
  });

  it("三处入口全走 cancelRunHeal：打断并发送 / 停止钮 / Esc 智慧停止（hotkeysRef 两联）", () => {
    expect(appSrc.match(/cancelRunHeal/g)?.length).toBe(6);
    expect(appSrc).toContain("cancelRunHeal(sid)");
    expect(appSrc).toContain("cancelRunHeal(activeId)");
    expect(appSrc).toContain("cancelRun: cancelRunHeal");
  });

  it("真派活代号：runOn 的 drain 回调每发一轮 +1（自愈竞态守卫的唯一供数口）", () => {
    // 2026-10-18：代际号先落到局部 myGen（finally / stopped 写入按它守卫），再写回表。
    expect(appSrc).toContain("const myGen = (runGen.current.get(sid) ?? 0) + 1;");
    expect(appSrc).toContain("runGen.current.set(sid, myGen);");
  });
});
