// 会话条 tokens 面板（M2-4）：usageAggregate(events) 投影成 ↑in ↓out。
// 价格勘定（任务书 Step 1）：ModelSpec（src/providers/registry.ts）= { id, provider, model,
// tier, ctxWindow }，ProviderCapability 亦无单价字段 ⇒ M2 无价格数据源，cost 显式 "–"
//（计划裁定：不为 cost 引新数据源，M4 BYOK 时随 provider 配置一并落）。

/** 元位数字：过 1000 显 k 一位小数（12400 → "12.4k"），未过原样。 */
export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function TokenPanel(props: { inputTokens: number; outputTokens: number }) {
  return (
    <span className="meta" title="cost 暂缺：M2 无价格数据源，M4 BYOK 落地">
      ↑{formatTokens(props.inputTokens)} ↓{formatTokens(props.outputTokens)} · cost –
    </span>
  );
}
