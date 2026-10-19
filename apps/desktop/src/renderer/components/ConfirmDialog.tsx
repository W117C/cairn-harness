// 统一二次确认卡（2026-10-17）：把散落的 window.confirm 收编到产品自绘的确认面。
// 为什么不用系统 dialog：原生 confirm 是 macOS 系统弹窗，样式/语气与 Claude 式界面不在一个世界，
// 且 Electron 里它会冻结渲染层（模态阻塞），与「浮层优先、Esc 关闭」的键盘语义也不一致。
// 形制复用既有归档/删除会话卡（.confirm-card + ModalSurface 焦点陷阱 + Esc）。
import { ModalSurface } from "./ModalSurface";

export interface ConfirmDialogProps {
  title: string;
  /** 后果说明（可多句；正文里可用 <br /> 分行）。 */
  note?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** 破坏性动作 = 红实底；普通动作用主按钮形态。 */
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps): React.JSX.Element {
  return (
    <ModalSurface className="confirm-scrim" label={props.title} onClose={props.onClose}>
      <div className="confirm-card">
        <div className="cc-title">{props.title}</div>
        {props.note !== undefined && <div className="cc-note">{props.note}</div>}
        <div className="cc-actions">
          <button className="mini-btn" onClick={props.onClose}>{props.cancelLabel ?? "取消"}</button>
          <button
            className={`mini-btn ${props.danger === true ? "danger" : "primary"}`}
            onClick={props.onConfirm}
          >{props.confirmLabel}</button>
        </div>
      </div>
    </ModalSurface>
  );
}
