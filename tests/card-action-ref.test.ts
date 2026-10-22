// card_action 的来源引用（指针分叉）：祖先行的数字 sourceEventId 是**来源日志**里的行号，
// 落流必须同时带 eventRef，否则「这条卡片来自哪一行」在分叉会话里无从回溯。
// 本判卷钉三件事：合法引用随 card_action 落流；形状非法先于落流拒绝（不写脏记录）；旧调用不带字段。
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { handleCardAction, setCardActionDeps } from "../src/main/card-action-handlers";

const emitted: AgentEvent[] = [];
setCardActionDeps({
  session: () => ({ emit: async (e: AgentEvent) => { emitted.push(e); } }),
  activeOrchestrator: () => null,
  ensureSessionOrchestrator: async () => null,
  interactiveRunAbort: () => null,
} as unknown as Parameters<typeof setCardActionDeps>[0]);

const base = { cardId: "c1", sourceEventId: 7, cardType: "worker_card", action: "expand" };

describe("card_action 的来源引用", () => {
  it("合法 eventRef ⇒ 落流带 source_event_ref，数字 id 原样保留（它是来源日志的行号）", async () => {
    emitted.length = 0;
    const ref = { workspace: "/ws/a", sessionId: "parent-1", eventId: 7 };
    const r = await handleCardAction({ ...base, eventRef: ref });
    expect(r.ok).toBe(true);
    const first = emitted[0] as { type?: string; source_event_ref?: unknown; source_event_id?: number } | undefined;
    expect(first?.type).toBe("card_action");
    expect(first?.source_event_ref).toEqual(ref);
    expect(first?.source_event_id).toBe(7);
  });

  it("eventRef 形状非法（eventId=0 不是行号）⇒ 先于落流拒绝，一条记录都不写", async () => {
    emitted.length = 0;
    const r = await handleCardAction({ ...base, eventRef: { workspace: "/ws/a", sessionId: "parent-1", eventId: 0 } });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("形状非法");
    expect(emitted).toHaveLength(0);
  });

  it("旧调用不给 eventRef ⇒ 落流没有该字段（来源=当前会话自己的行）", async () => {
    emitted.length = 0;
    const r = await handleCardAction({ ...base });
    expect(r.ok).toBe(true);
    const first = emitted[0];
    expect(first).toBeDefined();
    expect(first !== undefined && "source_event_ref" in first).toBe(false);
  });
});
