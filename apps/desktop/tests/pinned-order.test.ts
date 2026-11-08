// 置顶会话手工顺序判卷（2026-10-31，R3）：参考库 DraggableSessionList 的 pinnedOrder。
import { describe, expect, it } from "vitest";
import { applyPinnedOrder, moveInOrder, orderKeyOf, parsePinnedOrder, PINNED_ORDER_KEY } from "../src/renderer/state/pinned-order";

const s = (id: string, pinned = true, workspace = "/ws"): { id: string; workspace: string; pinned: boolean } => ({ id, workspace, pinned });

describe("parsePinnedOrder：坏档 fail-open 到空表", () => {
  it("空/null/非数组/非法 JSON 都回空；非字符串与空串过滤；重复去重保序", () => {
    expect(PINNED_ORDER_KEY).toBe("cairn.sidebar.pinnedOrder");
    expect(parsePinnedOrder(null)).toEqual([]);
    expect(parsePinnedOrder("")).toEqual([]);
    expect(parsePinnedOrder("{}")).toEqual([]);
    expect(parsePinnedOrder("not json")).toEqual([]);
    expect(parsePinnedOrder('["a",1,"","a","b"]')).toEqual(["a", "b"]);
  });
});

describe("applyPinnedOrder：只排置顶段", () => {
  it("置顶按 order 排；不在表里的置顶保持原相对序排后；非置顶原样", () => {
    const list = [s("a"), s("b"), s("c"), s("x", false), s("y", false)];
    const order = [orderKeyOf(s("c")), orderKeyOf(s("a"))];
    expect(applyPinnedOrder(list, order).map((r) => r.id)).toEqual(["c", "a", "b", "x", "y"]);
  });

  it("空 order 原样返回；跨工作区靠 key 区分", () => {
    const a = s("same", true, "/one");
    const b = s("same", true, "/two");
    expect(applyPinnedOrder([a, b], []).map((r) => r.workspace)).toEqual(["/one", "/two"]);
    expect(applyPinnedOrder([a, b], [orderKeyOf(b), orderKeyOf(a)]).map((r) => r.workspace)).toEqual(["/two", "/one"]);
  });
});

describe("moveInOrder：拖到目标前/后", () => {
  it("before / after；未知目标补表尾；自身移动不变", () => {
    const order = ["a", "b", "c"];
    expect(moveInOrder(order, "a", "c", "before")).toEqual(["b", "a", "c"]);
    expect(moveInOrder(order, "a", "c", "after")).toEqual(["b", "c", "a"]);
    expect(moveInOrder(order, "x", "b", "before")).toEqual(["a", "x", "b", "c"]);
    expect(moveInOrder(order, "a", "a", "after")).toEqual(["a", "b", "c"]);
  });
});
