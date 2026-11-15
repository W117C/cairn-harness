// 同 id 跨工作区的会话级局部记忆：折叠 / 滚动 / 最近引用 / 交付展开都是「会话的现场」，
// 不能拿裸 id 当键——否则 A 的折叠集与滚动位置会在 B 的第一帧出现。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useConversationNavigation } from "../src/renderer/state/conversation-navigation";
import { runKey } from "../src/renderer/state/session-identity";
import type { ViewMode } from "../src/renderer/view-mode";
import { readAppSurface } from "./helpers/app-surface";

const ref = <T,>(current: T) => ({ current });
const noop = (): void => undefined;

function navigation(workspace: string | null) {
  const folded = ref(new Map<string, ReadonlySet<number>>());
  let actions: ReturnType<typeof useConversationNavigation> | null = null;
  function Probe(): null {
    actions = useConversationNavigation({
      viewRef: ref<ViewMode>("normal"), hasThinking: false, setViewMode: noop, setViewToast: noop,
      viewToastTimer: ref<number | null>(null), foldedBySession: folded, activeId: "same",
      activeWorkspace: workspace, setFoldedRounds: noop,
      outlineTurns: [{ round: 1, text: "" }, { round: 2, text: "" }],
      setFlashRound: noop, streamEl: null, flashRound: null, events: [],
      activeIdRef: ref("same"), activeWorkspaceRef: ref(workspace),
      stick: { stuck: true, atTop: true, scrollToBottom: noop, scrollToTop: noop, restoreTo: noop },
      setOutlineOpen: noop, setOutlineCurrent: noop, outlineOpen: false, streamRows: [],
      foldedRounds: new Set<number>(),
    });
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return { folded, actions: actions! };
}

describe("同 id 跨工作区的会话现场", () => {
  it("折叠记忆按工作区 + 会话 id 分桶", () => {
    const a = navigation("/a");
    const b = navigation("/b");
    a.actions.foldAllTurns();
    b.actions.foldAllTurns();
    expect([...a.folded.current.get(runKey("/a", "same"))!]).toEqual([1]);
    expect([...b.folded.current.get(runKey("/b", "same"))!]).toEqual([1]);
    expect(a.folded.current.get(runKey("/b", "same"))).toBeUndefined();
    expect(b.folded.current.get(runKey("/a", "same"))).toBeUndefined();
  });

  it("渲染层不再用裸 id 读写会话级局部记忆", () => {
    const app = readAppSurface();
    expect(app).not.toContain("foldedBySession.current.set(activeId ?? \"\"");
    expect(app).not.toContain("scrollMemory.current.get(activeId)");
    expect(app).not.toContain("recentRefsBySession.current.get(activeId)");
    expect(app).not.toContain("deliveryExpandedFor === activeId");
  });
});
