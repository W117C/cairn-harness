// 普通提示条（角色 role="status"）：权限档回执、方案开关回执、复制引用回执等都走这里。
//
// 2026-11-03 业主（截图：一条「权限档已切到「完全允许」…」的条常驻在标题下）：
// 「这种弹窗都做到出现一下就消失」。错误条已于同批改成停留 6.5s（见 ErrorStrip.tsx），
// 提示条属于「看过就够」的回执，用更短的 4s，与 toast 的默认时长同档。
//
// 与错误条共用 useAutoDismiss 的时序契约（内容键变化才重新计时 / 悬停与聚焦暂停 / 回调走 ref）；
// 差异只在时长与视觉类名。关闭钮保留：想立刻收走的人不必等。
import { useAutoDismiss } from "./useAutoDismiss";

/** 提示条停留时长：4s（toast 默认档）。业主只给了「出现一下就消失」，这里定死并写进判卷
 *  （tests/notice-strip-dismiss.test.tsx）。 */
export const NOTICE_DISMISS_MS = 4000;

export function NoticeStrip(props: { message: string; onDismiss: () => void }): React.JSX.Element {
  const { containerProps } = useAutoDismiss(props.message, props.onDismiss, NOTICE_DISMISS_MS);
  return (
    <div className="notice-strip" role="status" {...containerProps}>
      <span className="msg">{props.message}</span>
      <button className="btn-ghost" aria-label="关闭提示" onClick={props.onDismiss}>×</button>
    </div>
  );
}
