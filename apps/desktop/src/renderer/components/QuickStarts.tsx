// P2-1 空屏建议行（小块组件；独立成件是为了 SSR 判卷——建议行在场、文案出处、副标题条件）。
// 纪律：点击 = 把建议文本交给调用方（App 走 injectedText 填入输入框，**不自动发送**——C-24 语义）。
// 文本一律来自 STR / quick-starts 纯函数，本文件零裸中文。
export function QuickStarts(props: {
  /** 建议文本（buildQuickStarts 装配，3–4 条；空数组 = 数据未就绪，行不渲染内容）。 */
  items: readonly string[];
  /** 首启副标题（onboarded !== true 才由 App 传入；null = 不显示）。 */
  firstRunSub: string | null;
  /** 点击一条建议：填入输入框不发送（由 App 注入 injectedText）。 */
  onPick: (text: string) => void;
}): React.JSX.Element {
  return (
    <div className="empty-below">
      <div className="pills">
        {props.items.map((q) => (
          <button key={q} className="pill" onClick={() => { props.onPick(q); }}>{q}</button>
        ))}
      </div>
      {props.firstRunSub !== null && <div className="empty-sub">{props.firstRunSub}</div>}
    </div>
  );
}
