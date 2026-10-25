// C-17 ErrorStrip（产品化形态）：danger 左条 + alert 图标 + 消息 + 关闭钮（只由用户关闭，不自动消失）。
// role="alert"；App 持 lastError state（会话键控 Map），切会话各看各的。
import { AlertTriangle, FileText, X } from "lucide-react";
import { STR } from "../strings";

export function ErrorStrip(props: { message: string; onDismiss: () => void; onViewLog?: () => void }) {
  return (
    <div className="error-strip" role="alert" style={{ display: "flex" }}>
      <span className="ico" aria-hidden="true">
        <AlertTriangle size={14} />
      </span>
      <span className="msg">{props.message}</span>
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
