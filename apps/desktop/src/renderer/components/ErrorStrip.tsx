// C-17 ErrorStrip（产品化形态）：danger 左条 + alert 图标 + 消息 + 关闭钮（只由用户关闭，不自动消失）。
// role="alert"；App 持 lastError state（会话键控 Map），切会话各看各的。
import { Ic } from "./icons";

export function ErrorStrip(props: { message: string; onDismiss: () => void }) {
  return (
    <div className="error-strip" role="alert" style={{ display: "flex" }}>
      <span className="ico" aria-hidden="true">
        <Ic.alert size={14} />
      </span>
      <span className="msg">{props.message}</span>
      <button className="x" onClick={props.onDismiss} aria-label="关闭错误提示">
        <Ic.x size={12} />
      </button>
    </div>
  );
}
