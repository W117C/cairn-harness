// 对话流（M1e 任务 3）：react-virtuoso 虚拟化消息列表 —— 1 万条事件只挂载可视窗口（DOM ≤ 300 量级），
// 流式跟随与 MessageScroller 语义共存：在底部 = 新内容自动跟随（followOutput + 末项增长跟随），
// 用户上滚 = 释放跟随（自由阅读），浮出「回到底部」按钮。
import { useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { TimelineItem } from "./store";

export interface ConversationHandleProps {
  items: TimelineItem[];
  running: boolean;
  /** 末项增长跟随：最后一个流式项文本变化且用户在底部时滚到底。 */
  lastStreamText: string | undefined;
  renderItem: (it: TimelineItem) => React.ReactNode;
}

function itemKey(i: number, it: TimelineItem): string {
  if (it.kind === "ask") return "ask:" + it.a.askId;
  if (it.kind === "stream") return "stream:" + it.callId;
  return "e:" + String(i) + ":" + it.e.type;
}

export function Conversation({ items, running, lastStreamText, renderItem }: ConversationHandleProps): React.ReactNode {
  const ref = useRef<VirtuosoHandle | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const markBottom = (v: boolean): void => {
    atBottomRef.current = v;
    setAtBottom(v);
  };

  // 流式跟随（共存语义）：在底部时任何新内容（新增项或末项增长）都贴底；上滚后不抢滚动条。
  useEffect(() => {
    if (!atBottomRef.current) return;
    const sc = scrollerRef.current;
    if (sc) sc.scrollTop = sc.scrollHeight;
  }, [items.length, lastStreamText]);

  if (items.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">💬</EmptyMedia>
            <EmptyTitle>还没有会话</EmptyTitle>
            <EmptyDescription>在下方给 agent 派活，例如：修复 fixtures/todo-app 中失败的测试</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1" data-m1e-conversation="">
      <Virtuoso
        ref={ref}
        data={items}
        computeItemKey={itemKey}
        followOutput={(isAtBottom: boolean) => (isAtBottom ? ("auto" as const) : false)}
        atBottomStateChange={markBottom}
        initialTopMostItemIndex={Math.max(0, items.length - 1)}
        increaseViewportBy={{ top: 420, bottom: 640 }}
        className="h-full"
        scrollerRef={(el) => {
          scrollerRef.current = el instanceof HTMLDivElement ? el : null;
        }}
        itemContent={(index, it) => (
          <div data-m1e-item="" data-m1e-index={index} className="px-5 py-1">
            {renderItem(it)}
          </div>
        )}
      />
      <Button
        size="icon-sm"
        variant="secondary"
        className={
          "absolute bottom-4 left-1/2 -translate-x-1/2 shadow transition-opacity " +
          (atBottom ? "pointer-events-none opacity-0" : "opacity-100")
        }
        aria-label="滚动到底部"
        onClick={() => ref.current?.scrollToIndex({ index: items.length - 1, behavior: "smooth" })}
      >
        ↓
      </Button>
      {running && <span className="sr-only">agent 运行中</span>}
    </div>
  );
}
