import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowDown, BarChart3, ChevronDown, ClipboardCopy, RefreshCw } from "lucide-react";
import type { UsageLedgerPayload } from "../../../../../../src/main/ipc-protocol";
import { sumUsageMetrics, usageCsv, usagePeriod, usageTokenLabel, type UsageDay, type UsageMetrics } from "./usage-dashboard-data";
import "./usage-dashboard.css";

export { usagePeriod, usageTokenLabel } from "./usage-dashboard-data";
type LedgerData = Extract<UsageLedgerPayload, { ok: true }>;
const count = (value: number) => value.toLocaleString("zh-CN");
const dateLabel = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8))}日`;
const tokenTotal = (row: UsageMetrics) => row.inputTokens + row.outputTokens;
const measured = (row: UsageMetrics) => row.inputMeasured + row.outputMeasured;

function TokenValue({ value, measurements }: { value: number; measurements: number }) {
  return <span title={measurements === 0 ? "没有有效用量字段" : `${count(value)} Token`}>{usageTokenLabel(value, measurements)}</span>;
}

function DailyTrend({ days }: { days: UsageDay[] }) {
  const maximum = Math.max(1, ...days.map(tokenTotal));
  const chartWidth = 660;
  const step = 600 / days.length;
  const ticks = [0, Math.round((days.length - 1) / 2), days.length - 1];
  return <>
    <svg className="ud-trend" viewBox={`0 0 ${chartWidth} 194`} role="img" aria-label={`最近 ${days.length} 天的每日用量`}>
      <title>每日输入与输出 Token。缓存读取单独展示，不重复计入总量；缺测字段不补成已测量的零。</title>
      {[0, 0.5, 1].map((fraction) => <g key={fraction}>
        <line x1="48" x2="648" y1={152 - fraction * 128} y2={152 - fraction * 128} className="ud-gridline" />
        <text x="39" y={156 - fraction * 128} textAnchor="end" className="ud-axis">{usageTokenLabel(Math.round(maximum * fraction), 1)}</text>
      </g>)}
      {days.map((day, index) => {
        const inputHeight = day.inputTokens / maximum * 128;
        const outputHeight = day.outputTokens / maximum * 128;
        return <g key={day.day}><title>{day.day}：输入 {usageTokenLabel(day.inputTokens, day.inputMeasured)}，输出 {usageTokenLabel(day.outputTokens, day.outputMeasured)}，{day.usageCount} 条用量记录</title>
          <rect className="ud-input-fill" x={49 + index * step} y={152 - inputHeight} width={Math.max(1, step - 3)} height={inputHeight} rx="1" />
          <rect className="ud-output-fill" x={49 + index * step} y={152 - inputHeight - outputHeight} width={Math.max(1, step - 3)} height={outputHeight} rx="1" />
        </g>;
      })}
      {ticks.map((index) => <text key={index} x={49 + index * step + step / 2} y="180" textAnchor={index === 0 ? "start" : index === days.length - 1 ? "end" : "middle"} className="ud-axis">{dateLabel(days[index]!.day)}</text>)}
    </svg>
    <details className="ud-data-details"><summary>查看每日数据</summary>
      <div className="ud-table-scroll"><table className="ud-table"><caption className="ud-sr-only">每日用量明细，缺字段显示为未记录</caption>
        <thead><tr><th scope="col">日期</th><th scope="col">输入</th><th scope="col">输出</th><th scope="col">用量记录</th></tr></thead>
        <tbody>{[...days].reverse().map((day) => <tr key={day.day}><th scope="row">{day.day}</th><td>{usageTokenLabel(day.inputTokens, day.inputMeasured)}</td><td>{usageTokenLabel(day.outputTokens, day.outputMeasured)}</td><td>{day.usageCount}</td></tr>)}</tbody>
      </table></div>
    </details>
  </>;
}

function ActivityHeatmap({ days }: { days: UsageDay[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const selectedDay = days.find((day) => day.day === selected) ?? days[days.length - 1]!;
  const maximum = Math.max(1, ...days.map((day) => day.usageCount + day.rounds));
  // 周一在首行；起始空格使日期在日历中的星期位置真实。
  const offset = (new Date(`${days[0]!.day}T12:00:00`).getDay() + 6) % 7;
  return <>
    <div className="ud-heatmap-layout">
      <div className="ud-weekdays" aria-hidden="true"><span>一</span><span>三</span><span>五</span><span>日</span></div>
      <div className="ud-heatmap" role="group" aria-label="每日活动，使用方向键浏览日期">
        {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} className="ud-heat-blank" aria-hidden="true" />)}
        {days.map((day, index) => {
          const active = day.sessions > 0;
          const intensity = active ? Math.max(1, Math.ceil((day.usageCount + day.rounds) / maximum * 4)) : 0;
          const label = `${day.day}，${count(day.sessions)} 个活跃会话，${count(day.usageCount)} 条用量记录，${usageTokenLabel(tokenTotal(day), measured(day))} Token`;
          return <button key={day.day} type="button" className="ud-heat-day" data-level={intensity}
            aria-label={label} title={label} aria-pressed={selectedDay.day === day.day} tabIndex={selectedDay.day === day.day ? 0 : -1}
            onFocus={() => setSelected(day.day)} onClick={() => setSelected(day.day)}
            onKeyDown={(event) => {
              const delta = event.key === "ArrowRight" ? 7 : event.key === "ArrowLeft" ? -7 : event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
              if (!delta) return;
              event.preventDefault();
              const target = Math.max(0, Math.min(days.length - 1, index + delta));
              const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button");
              buttons?.[target]?.focus();
            }} />;
        })}
      </div>
    </div>
    <div className="ud-heat-caption"><p aria-live="polite"><strong>{dateLabel(selectedDay.day)}</strong><span>{selectedDay.sessions} 个会话 · {selectedDay.usageCount} 条用量记录 · {usageTokenLabel(tokenTotal(selectedDay), measured(selectedDay))} Token</span></p>
      <div className="ud-heat-legend" aria-label="活动强度由少到多"><span>少</span>{[0, 1, 2, 3, 4].map((level) => <i key={level} data-level={level} />)}<span>多</span></div>
    </div>
  </>;
}

export function UsageDashboard({ data, refreshing, error, onRefresh }: { data: LedgerData; refreshing: boolean; error: string | null; onRefresh: () => void }) {
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [sort, setSort] = useState<"tokens" | "records">("tokens");
  const analytics = data.analytics;
  const period = useMemo(() => analytics ? usagePeriod(analytics, range) : null, [analytics, range]);
  const lifetime = analytics ? sumUsageMetrics(analytics.buckets) : null;
  const undated = analytics ? sumUsageMetrics(analytics.buckets.filter((row) => row.day === null)) : null;
  const unknownModel = analytics?.buckets.filter((row) => row.model === null).reduce((total, row) => total + row.usageCount, 0) ?? 0;
  const missingTokens = lifetime ? lifetime.usageCount * 2 - lifetime.inputMeasured - lifetime.outputMeasured : 0;
  const models = period ? [...period.models].sort((left, right) => sort === "tokens" ? tokenTotal(right) - tokenTotal(left) : right.usageCount - left.usageCount) : [];
  const periodTokens = period ? tokenTotal(period.totals) : 0;
  const inputPercent = periodTokens > 0 && period ? period.totals.inputTokens / periodTokens * 100 : 0;
  const hasWarnings = data.skipped > 0 || data.badLines > 0 || (analytics?.sessionsWithoutUsage ?? 0) > 0 || (undated?.usageCount ?? 0) > 0 || unknownModel > 0 || missingTokens > 0;
  return <div className="ss-page usage-dashboard">
    <header className="ud-header"><div><h1 className="ss-title">用量统计</h1></div>
      <div className="ud-header-actions">
        <button type="button" className="ud-refresh" disabled={period === null} onClick={() => { if (period === null) return; void navigator.clipboard.writeText(usageCsv(period)).then(() => { setCopyMsg("CSV 已复制"); setTimeout(() => { setCopyMsg(null); }, 1800); }).catch(() => { setCopyMsg("复制失败：剪贴板不可用"); }); }} aria-label="复制用量 CSV"><ClipboardCopy size={14} aria-hidden="true" />{copyMsg ?? "复制 CSV"}</button>
        <button type="button" className="ud-refresh" disabled={refreshing} onClick={onRefresh} aria-label={error ? "重试用量统计" : "刷新用量统计"}><RefreshCw size={14} aria-hidden="true" />{refreshing ? "统计中…" : error ? "重试" : "刷新"}</button>
      </div>
    </header>
    {error && <p className="ud-notice ud-error" role="alert"><AlertCircle size={15} aria-hidden="true" />刷新失败：{error}。当前仍显示上次结果。</p>}
    <dl className="ud-overview">
      <div><dt>累计 Token</dt><dd><TokenValue value={data.totals.inputTokens + data.totals.outputTokens} measurements={lifetime ? measured(lifetime) : data.totals.usageCount} /></dd>{missingTokens > 0 && <small>部分缺测</small>}</div>
      <div><dt>用量记录</dt><dd>{count(data.totals.usageCount)}</dd>{lifetime && lifetime.workerUsageCount > 0 && <small>子代理 {count(lifetime.workerUsageCount)}</small>}</div>
      <div><dt>累计会话</dt><dd>{count(data.sessions)}</dd>{data.workspaces > 1 && <small>{count(data.workspaces)} 个工作区</small>}</div>
      <div><dt>活跃天数</dt><dd>{analytics ? count(analytics.activity.filter((row) => row.day !== null).length) : "—"}</dd></div>
    </dl>
    {hasWarnings && <details className="ud-coverage"><summary><AlertCircle size={14} aria-hidden="true" />统计存在缺失，查看覆盖情况<ChevronDown className="ud-coverage-chevron" size={13} aria-hidden="true" /></summary><ul>
      {data.skipped > 0 && <li>{data.skipped} 个会话无法读取。</li>}
      {data.badLines > 0 && <li>{data.badLines} 行损坏记录未计入。</li>}
      {(analytics?.sessionsWithoutUsage ?? 0) > 0 && <li>{analytics!.sessionsWithoutUsage} 个会话没有上报用量；没有记录不代表消耗为零。</li>}
      {(undated?.usageCount ?? 0) > 0 && <li>{undated!.usageCount} 条用量记录未记录日期（{usageTokenLabel(tokenTotal(undated!), measured(undated!))} Token），仅计入累计指标。</li>}
      {unknownModel > 0 && <li>{unknownModel} 条用量记录未记录模型，保留为独立分组。</li>}
      {missingTokens > 0 && <li>{missingTokens} 个输入或输出字段缺测；数字仅为已上报部分，未记录显示为「—」。</li>}
    </ul></details>}
    {data.totals.usageCount === 0 && <div className="ud-empty"><BarChart3 size={26} aria-hidden="true" /><h2>尚无用量记录</h2><p>{data.sessions === 0 ? "开始一段对话后，模型上报的 Token 用量会显示在这里。" : "已找到会话，但模型尚未上报有效用量。对话活动仍可在下方查看。"}</p></div>}
    {!analytics || !period ? <p className="ud-notice">详细统计暂不可用。刷新后可重试读取日期与模型信息。</p> : <>
      <div className="ud-period-bar"><h2>使用概览</h2><div className="ud-range" role="group" aria-label="统计时间范围">{([7, 30, 90] as const).map((days) => <button key={days} type="button" aria-pressed={range === days} onClick={() => setRange(days)}>最近 {days} 天</button>)}</div></div>
      <section className="ud-section" aria-labelledby="ud-trend-title"><div className="ud-section-heading"><h3 id="ud-trend-title" title={`${dateLabel(period.days[0]!.day)} — ${dateLabel(period.days[period.days.length - 1]!.day)} · ${analytics.timeZone}`}>每日消耗</h3><div className="ud-chart-legend"><span><i className="ud-input-fill" />输入</span><span><i className="ud-output-fill" />输出</span></div></div>
        {period.totals.usageCount === 0 && <p className="ud-period-empty">这 {range} 天没有带日期的用量记录。</p>}
        <DailyTrend days={period.days} />
      </section>
      <div className="ud-detail-grid"><section className="ud-section ud-composition" aria-labelledby="ud-composition-title"><h3 id="ud-composition-title">输入与输出</h3>
        <div className="ud-composition-bar" role="img" aria-label={`输入 ${usageTokenLabel(period.totals.inputTokens, period.totals.inputMeasured)}，输出 ${usageTokenLabel(period.totals.outputTokens, period.totals.outputMeasured)}，总计仅含输入与输出`}><span style={{ width: `${inputPercent}%` }} /><span style={{ width: `${periodTokens > 0 ? 100 - inputPercent : 0}%` }} /></div>
        <dl className="ud-composition-values"><div><dt><i className="ud-input-fill" />输入</dt><dd><TokenValue value={period.totals.inputTokens} measurements={period.totals.inputMeasured} /></dd></div><div><dt><i className="ud-output-fill" />输出</dt><dd><TokenValue value={period.totals.outputTokens} measurements={period.totals.outputMeasured} /></dd></div></dl>
        <p className="ud-cache-note">缓存读取 <strong>{usageTokenLabel(period.totals.cacheReadTokens, period.totals.cacheReadMeasured)}</strong>{period.totals.cacheReadMeasured < period.totals.usageCount && <><br />部分记录未上报缓存。</>}</p>
      </section><section className="ud-section ud-activity" aria-labelledby="ud-activity-title"><div className="ud-section-heading"><h3 id="ud-activity-title">活动日历</h3><span>{period.days.filter((day) => day.sessions > 0).length} 天有活动</span></div><ActivityHeatmap key={range} days={period.days} /></section></div>
      <section className="ud-section" aria-labelledby="ud-models-title"><div className="ud-section-heading"><h3 id="ud-models-title">模型用量</h3><label className="ud-sort">排序<select value={sort} onChange={(event) => setSort(event.target.value as "tokens" | "records")}><option value="tokens">Token 总量</option><option value="records">用量记录</option></select><ArrowDown size={12} aria-hidden="true" /></label></div>
        {models.length === 0 ? <p className="ud-period-empty">这段时间没有可分组的模型用量。</p> : <div className="ud-table-scroll"><table className="ud-table ud-model-table"><caption className="ud-sr-only">最近 {range} 天各模型上报的用量，包含子代理；未记录模型保留为单独一组</caption><thead><tr><th scope="col">模型</th><th scope="col">输入</th><th scope="col">输出</th><th scope="col">总 Token</th><th scope="col">记录</th></tr></thead><tbody>{models.map((model) => <tr key={JSON.stringify(model.model)}><th scope="row"><span className="ud-model-name">{model.model ?? "未记录模型"}</span><span className="ud-model-track" aria-hidden="true"><i style={{ width: `${periodTokens > 0 ? tokenTotal(model) / periodTokens * 100 : 0}%` }} /></span></th><td>{usageTokenLabel(model.inputTokens, model.inputMeasured)}</td><td>{usageTokenLabel(model.outputTokens, model.outputMeasured)}</td><td className="ud-total-cell">{usageTokenLabel(tokenTotal(model), measured(model))}</td><td>{model.usageCount}</td></tr>)}</tbody></table></div>}
      </section>
    </>}
    <footer className="ud-footer">Token 为模型上报值，含子代理。{analytics && <span>更新于 {new Date(analytics.generatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>}</footer>
  </div>;
}

/** 设置页独立加载；刷新保留上次读数，卸载后的迟到响应不会回写。 */
export function UsageSection(): React.JSX.Element {
  const [data, setData] = useState<LedgerData | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setRefreshing(true);
    setError(null);
    try {
      const result = await window.agent.usageLedger();
      if (current !== generation.current) return;
      if (result.ok) setData(result);
      else setError(result.error.trim() || "未知原因");
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (current === generation.current) setError(message.trim() || "未知原因");
    } finally {
      if (current === generation.current) setRefreshing(false);
    }
  }, []);
  useEffect(() => { void load(); return () => { generation.current += 1; }; }, [load]);
  if (data) return <UsageDashboard data={data} refreshing={refreshing} error={error} onRefresh={() => { void load(); }} />;
  return <div className="ss-page usage-dashboard"><h1 className="ss-title">用量统计</h1>{error ? <div className="ud-initial-error" role="alert"><AlertCircle size={24} aria-hidden="true" /><h2>无法读取用量统计</h2><p>{error}</p><button type="button" className="ud-refresh" onClick={() => { void load(); }}>重试</button></div> : <div className="ud-loading" role="status" aria-label="正在统计用量"><p>正在读取会话用量…</p><div /><div /><div /></div>}</div>;
}
