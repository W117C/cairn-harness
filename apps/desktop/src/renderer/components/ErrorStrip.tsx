// M3-4 失败反馈统一错误面（M2 T5 deferred 收口）：run !ok 与 clarify/plan 提交失败同面提示。
// 纯展示组件——App 持 lastError state（本条的单一事实源），点 × 清除（onDismiss）。
// 视觉只用既有变量：--risk 竖条（手法同 .card-approval 的 border-left）＋中性文字色，
// 样式见 styles.css 的 .error-strip（不新加色）。
export function ErrorStrip(props: { message: string; onDismiss: () => void }) {
  return (
    <div className="error-strip" role="alert">
      <span className="msg">{props.message}</span>
      <button className="btn-ghost" onClick={props.onDismiss} aria-label="关闭">×</button>
    </div>
  );
}
