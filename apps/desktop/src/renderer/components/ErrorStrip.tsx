// C-17 ErrorStrip（产品化形态）：danger 左条 + alert 图标 + 消息 + 关闭钮（用户主动关，或到点自己走）。
// role="alert"；App 持 lastError state（会话键控 Map），切会话各看各的。
//
// 停留即走，不常驻（2026-11-03 业主裁决，推翻本条早先的「只由用户关闭，不自动消失」）：
//   业主原话「这个需要优化，不要常驻，停留几秒就自己消失」（截图：一条 RunRequest.model 未登记 的红条）。
//   本轮实现：挂载 / 换消息起 AUTO_DISMISS_MS 倒计时，到点调 props.onDismiss()；
//   指针悬停（鼠标停在条上还在读）或键盘焦点进入条内（Tab 到了关闭钮）**暂停**倒计时，
//   离开 / 移焦后接着剩下的时间走——这条暂停是 a11y 底线，不因「简洁」删。
//   注意：真的在读屏（role="alert" 正在播报）时不会悬停，改口径见 PROGRESS 页的欠账。
//
// 两种载荷（2026-11-02 真机订正）：
//   · 一句话（多数错误）——照旧一行读完；
//   · 结构化（SurfaceError：原因 / 依据 / 下一步）——分行渲染，每段有话说清自己是哪一段。
//     此前这类错误是把三段用「——」拍成一行塞进来（真机截图：预览失败那一行），
//     读的人分不清结论、证据与待办 ⇒ 结构化载荷 + 分行渲染是同一件事的两头。
import { useAutoDismiss } from "./useAutoDismiss";
import { AlertTriangle, FileText, X } from "lucide-react";
import { isSurfaceError, type SurfaceError } from "../surface-error";
import { STR } from "../strings";

/** 自动消失的停留时长：6.5s。下界 6s＝足以读完一条两行结构错误；上界 8s＝再长就又在挡路。
 *  业主 2026-11-03 只给了「几秒」，这里定死一个数并写进判卷（tests/error-strip-dismiss.test.tsx）。 */
export const AUTO_DISMISS_MS = 6500;

/** 换消息要重新计时，但效应不能直接依赖 message：结构化载荷是每帧新建的对象字面量，
 *  依赖它会让计时器每帧归零、条永远不消失。取「读得出差别」的稳定键：字符串载荷取原文，
 *  结构化载荷取标题（标题变了就是另一件事；正文微调不算，条不刷新表）。 */
function countdownKey(message: string | SurfaceError): string {
  return typeof message === "string" ? message : message.title;
}

export function ErrorStrip(props: { message: string | SurfaceError; onDismiss: () => void; onViewLog?: () => void }) {
  const error = isSurfaceError(props.message) ? props.message : null;
  // 时序逻辑（内容键重置 / 悬停与聚焦暂停 / 回调走 ref）与提示条共用一份，见 useAutoDismiss.ts。
  const { containerProps } = useAutoDismiss(countdownKey(props.message), props.onDismiss, AUTO_DISMISS_MS);

  return (
    <div
      className={error === null ? "error-strip" : "error-strip is-structured"}
      role="alert"
      style={{ display: "flex" }}
      {...containerProps}
    >
      <span className="ico" aria-hidden="true">
        <AlertTriangle size={14} />
      </span>
      {error === null ? (
        <span className="msg">{props.message as string}</span>
      ) : (
        <span className="body">
          <span className="title">{error.title}</span>
          {error.body !== undefined && <span className="line">{error.body}</span>}
          {error.reasons !== undefined && error.reasons.length > 0 && (
            <span className="row">
              <span className="tag">{STR.errorStrip.why}</span>
              <ul className="reasons">
                {error.reasons.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            </span>
          )}
          {error.next !== undefined && (
            <span className="row">
              <span className="tag">{STR.errorStrip.next}</span>
              <span className="line">{error.next}</span>
            </span>
          )}
        </span>
      )}
      {props.onViewLog !== undefined && (
        <button className="btn-ghost error-log" title={STR.logViewer.openTip} onClick={props.onViewLog}>
          <FileText size={12} aria-hidden="true" /> {STR.logViewer.open}
        </button>
      )}
      <button className="x" onClick={props.onDismiss} aria-label={STR.logViewer.errorDismiss}>
        <X size={12} />
      </button>
    </div>
  );
}
