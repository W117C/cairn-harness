// 「停留即走」的共用计时件（2026-11-03 业主）：错误条与普通提示条都要求出现几秒后自己消失。
//
// 为什么抽出来而不是各写一份：这两条都踩过同一个坑——`onDismiss` 是每次 render 新建的闭包，
// 直接进 effect 依赖会让计时器每帧归零、条永远不走（看起来"实现了自动消失"，实际是常驻）。
// 唯一正确的形状是：内容键（key）变了才重置剩余时间，回调走 ref；悬停/聚焦暂停，离开接着走。
// 同一段时序逻辑只留这一份，错误条与提示条共用（判卷也共用同一组行为用例）。
import { useEffect, useRef, useState, type FocusEvent } from "react";

export interface AutoDismissHandlers {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocusCapture: () => void;
  onBlurCapture: (event: FocusEvent<HTMLElement>) => void;
}

/** @param key 内容键：变了 = 换了一条新消息，倒计时从头走；同内容新 props 对象不重置。
 *  @param ms 整段停留时长。 */
export function useAutoDismiss(key: string, onDismiss: () => void, ms: number): { paused: boolean; containerProps: AutoDismissHandlers } {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const remaining = useRef(ms);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    remaining.current = ms;
  }, [key, ms]);

  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => dismiss.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [paused, key, ms]);

  return {
    paused,
    containerProps: {
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onFocusCapture: () => setFocused(true),
      onBlurCapture: (event) => {
        if (event.relatedTarget === null || event.relatedTarget === undefined || !event.currentTarget.contains(event.relatedTarget as Node)) setFocused(false);
      },
    },
  };
}
