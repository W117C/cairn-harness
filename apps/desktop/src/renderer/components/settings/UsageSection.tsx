import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowDown, BarChart3, ChevronDown, ClipboardCopy, RefreshCw } from "lucide-react";
import type { UsageLedgerPayload } from "../../../../../../src/main/ipc-protocol";
import { sumUsageMetrics, usageCsv, usagePeriod, usageTokenLabel, type UsageDay, type UsageMetrics } from "./usage-dashboard-data";
import { STR } from "../../strings";
import "./usage-dashboard.css";

export { usagePeriod, usageTokenLabel } from "./usage-dashboard-data";
type LedgerData = Extract<UsageLedgerPayload, { ok: true }>;
const count = (value: number) => value.toLocaleString("zh-CN");
const dateLabel = (day: string) => STR.usage.dateLabel.replace("{month}", String(Number(day.slice(5, 7)))).replace("{day}", String(Number(day.slice(8))));
const tokenTotal = (row: UsageMetrics) => row.inputTokens + row.outputTokens;
const measured = (row: UsageMetrics) => row.inputMeasured + row.outputMeasured;

function TokenValue({ value, measurements }: { value: number; measurements: number }) {
  return <span title={measurements === 0 ? STR.usage.noValidFields : count(value) + STR.usage.tokenSuffix}>{usageTokenLabel(value, measurements)}</span>;
}

function DailyTrend({ days }: { days: UsageDay[] }) {
  const maximum = Math.max(1, ...days.map(tokenTotal));
  const chartWidth = 660;
  const step = 600 / days.length;
  const ticks = useMemo(() => [0, Math.round((days.length - 1) / 2), days.length - 1], [days.length]);
  return <>
    <svg className="ud-trend" viewBox={`0 0 ${chartWidth} 194`} role="img" aria-label={STR.usage.trendAria.replace("{n}", String(days.length))}>
      <title>{STR.usage.trendTitle}</title>
      {[0, 0.5, 1].map((fraction) => <g key={fraction}>
        <line x1="48" x2="648" y1={152 - fraction * 128} y2={152 - fraction * 128} className="ud-gridline" />
        <text x="39" y={156 - fraction * 128} textAnchor="end" className="ud-axis">{usageTokenLabel(Math.round(maximum * fraction), 1)}</text>
      </g>)}
      {days.map((day, index) => {
        const inputHeight = day.inputTokens / maximum * 128;
        const outputHeight = day.outputTokens / maximum * 128;
        return <g key={day.day}><title>{STR.usage.dayTitle.replace("{day}", day.day).replace("{input}", usageTokenLabel(day.inputTokens, day.inputMeasured)).replace("{output}", usageTokenLabel(day.outputTokens, day.outputMeasured)).replace("{n}", String(day.usageCount))}</title>
          <rect className="ud-input-fill" x={49 + index * step} y={152 - inputHeight} width={Math.max(1, step - 3)} height={inputHeight} rx="1" />
          <rect className="ud-output-fill" x={49 + index * step} y={152 - inputHeight - outputHeight} width={Math.max(1, step - 3)} height={outputHeight} rx="1" />
        </g>;
      })}
      {ticks.map((index) => <text key={index} x={49 + index * step + step / 2} y="180" textAnchor={index === 0 ? "start" : index === days.length - 1 ? "end" : "middle"} className="ud-axis">{dateLabel(days[index]!.day)}</text>)}
    </svg>
    <details className="ud-data-details"><summary>{STR.usage.showDailyData}</summary>
      <div className="ud-table-scroll"><table className="ud-table"><caption className="ud-sr-only">{STR.usage.dailyCaption}</caption>
        <thead><tr><th scope="col">{STR.usage.colDate}</th><th scope="col">{STR.usage.colInput}</th><th scope="col">{STR.usage.colOutput}</th><th scope="col">{STR.usage.colUsage}</th></tr></thead>
        <tbody>{[...days].reverse().map((day) => <tr key={day.day}><th scope="row">{day.day}</th><td>{usageTokenLabel(day.inputTokens, day.inputMeasured)}</td><td>{usageTokenLabel(day.outputTokens, day.outputMeasured)}</td><td>{day.usageCount}</td></tr>)}</tbody>
      </table></div>
    </details>
  </>;
}

function ActivityHeatmap({ days }: { days: UsageDay[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  // 第 1142 页：热力图选中日与最大值按 days/selected 记忆；点击/window 变化不重扫全月。
  const selectedDay = useMemo(() => days.find((day) => day.day === selected) ?? days[days.length - 1]!, [days, selected]);
  const maximum = useMemo(() => Math.max(1, ...days.map((day) => day.usageCount + day.rounds)), [days]);
  // 周一在首行；起始空格使日期在日历中的星期位置真实。
  const offset = useMemo(() => (new Date(`${days[0]!.day}T12:00:00`).getDay() + 6) % 7, [days]);
  return <>
    <div className="ud-heatmap-layout">
      <div className="ud-weekdays" aria-hidden="true"><span>{STR.usage.weekdayMon}</span><span>{STR.usage.weekdayWed}</span><span>{STR.usage.weekdayFri}</span><span>{STR.usage.weekdaySun}</span></div>
      <div className="ud-heatmap" role="group" aria-label={STR.usage.heatmapAria}>
        {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} className="ud-heat-blank" aria-hidden="true" />)}
        {days.map((day, index) => {
          const active = day.sessions > 0;
          const intensity = active ? Math.max(1, Math.ceil((day.usageCount + day.rounds) / maximum * 4)) : 0;
          const label = STR.usage.heatDayLabel.replace("{day}", day.day).replace("{sessions}", count(day.sessions)).replace("{n}", count(day.usageCount)).replace("{tokens}", usageTokenLabel(tokenTotal(day), measured(day)));
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
    <div className="ud-heat-caption"><p aria-live="polite"><strong>{dateLabel(selectedDay.day)}</strong><span>{STR.usage.heatCaption.replace("{sessions}", String(selectedDay.sessions)).replace("{n}", String(selectedDay.usageCount)).replace("{tokens}", usageTokenLabel(tokenTotal(selectedDay), measured(selectedDay)))}</span></p>
      <div className="ud-heat-legend" aria-label={STR.usage.intensityAria}><span>{STR.usage.less}</span>{[0, 1, 2, 3, 4].map((level) => <i key={level} data-level={level} />)}<span>{STR.usage.more}</span></div>
    </div>
  </>;
}

export function UsageDashboard({ data, refreshing, error, onRefresh }: { data: LedgerData; refreshing: boolean; error: string | null; onRefresh: () => void }) {
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [sort, setSort] = useState<"tokens" | "records">("tokens");
  const analytics = data.analytics;
  const period = useMemo(() => analytics ? usagePeriod(analytics, range) : null, [analytics, range]);
  // 第 1125 页：analytics/period 不变时，汇总、无日期桶、未知模型与模型排序不随复制提示等局部状态重跑。
  const lifetime = useMemo(() => analytics ? sumUsageMetrics(analytics.buckets) : null, [analytics]);
  const undated = useMemo(() => analytics ? sumUsageMetrics(analytics.buckets.filter((row) => row.day === null)) : null, [analytics]);
  const unknownModel = useMemo(() => analytics?.buckets.filter((row) => row.model === null).reduce((total, row) => total + row.usageCount, 0) ?? 0, [analytics]);
  const missingTokens = lifetime ? lifetime.usageCount * 2 - lifetime.inputMeasured - lifetime.outputMeasured : 0;
  const models = useMemo(() => period ? [...period.models].sort((left, right) => sort === "tokens" ? tokenTotal(right) - tokenTotal(left) : right.usageCount - left.usageCount) : [], [period, sort]);
  const periodTokens = period ? tokenTotal(period.totals) : 0;
  const inputPercent = periodTokens > 0 && period ? period.totals.inputTokens / periodTokens * 100 : 0;
  const hasWarnings = data.skipped > 0 || data.badLines > 0 || (analytics?.sessionsWithoutUsage ?? 0) > 0 || (undated?.usageCount ?? 0) > 0 || unknownModel > 0 || missingTokens > 0;
  const lowSample = period === null || period.totals.usageCount < 2;
  return <div className="ss-page usage-dashboard">
    <header className="ud-header"><div><h1 className="ss-title">{STR.usage.title}</h1></div>
      <div className="ud-header-actions">
        <button type="button" className="ud-refresh" disabled={period === null} onClick={() => { if (period === null) return; void navigator.clipboard.writeText(usageCsv(period)).then(() => { setCopyMsg(STR.usage.csvCopied); setTimeout(() => { setCopyMsg(null); }, 1800); }).catch(() => { setCopyMsg(STR.usage.csvCopyFailed); }); }} aria-label={STR.usage.copyCsvAria}><ClipboardCopy size={14} aria-hidden="true" />{copyMsg ?? STR.usage.copyCsv}</button>
        <button type="button" className="ud-refresh" disabled={refreshing} onClick={onRefresh} aria-label={error ? STR.usage.retryAria : STR.usage.refreshAria}><RefreshCw size={14} aria-hidden="true" />{refreshing ? STR.usage.counting : error ? STR.usage.retry : STR.usage.refresh}</button>
      </div>
    </header>
    {error && <p className="ud-notice ud-error" role="alert"><AlertCircle size={15} aria-hidden="true" />{STR.usage.refreshFailedPrefix + error + STR.usage.refreshFailedSuffix}</p>}
    <dl className="ud-overview">
      <div><dt>{STR.usage.lifetimeTokens}</dt><dd><TokenValue value={data.totals.inputTokens + data.totals.outputTokens} measurements={lifetime ? measured(lifetime) : data.totals.usageCount} /></dd>{missingTokens > 0 && <small>{STR.usage.partiallyMissing}</small>}</div>
      <div><dt>{STR.usage.colUsage}</dt><dd>{count(data.totals.usageCount)}</dd>{lifetime && lifetime.workerUsageCount > 0 && <small>{STR.usage.workerSuffix.replace("{n}", count(lifetime.workerUsageCount))}</small>}</div>
      <div><dt>{STR.usage.lifetimeSessions}</dt><dd>{count(data.sessions)}</dd>{data.workspaces > 1 && <small>{STR.usage.workspaceCount.replace("{n}", count(data.workspaces))}</small>}</div>
      <div><dt>{STR.usage.activeDays}</dt><dd>{analytics ? count(analytics.activity.filter((row) => row.day !== null).length) : "—"}</dd></div>
    </dl>
    {hasWarnings && <details className="ud-coverage"><summary><AlertCircle size={14} aria-hidden="true" />{STR.usage.coverageSummary}<ChevronDown className="ud-coverage-chevron" size={13} aria-hidden="true" /></summary><ul>
      {data.skipped > 0 && <li>{STR.usage.skippedSessions.replace("{n}", String(data.skipped))}</li>}
      {data.badLines > 0 && <li>{STR.usage.badLines.replace("{n}", String(data.badLines))}</li>}
      {(analytics?.sessionsWithoutUsage ?? 0) > 0 && <li>{STR.usage.noUsageSessions.replace("{n}", String(analytics!.sessionsWithoutUsage))}</li>}
      {(undated?.usageCount ?? 0) > 0 && <li>{STR.usage.undatedRecords.replace("{n}", String(undated!.usageCount)).replace("{tokens}", usageTokenLabel(tokenTotal(undated!), measured(undated!)))}</li>}
      {unknownModel > 0 && <li>{STR.usage.unknownModelRecords.replace("{n}", String(unknownModel))}</li>}
      {missingTokens > 0 && <li>{STR.usage.missingFields.replace("{n}", String(missingTokens))}</li>}
    </ul></details>}
    {data.totals.usageCount === 0 && <div className="ud-empty"><BarChart3 size={26} aria-hidden="true" /><h2>{STR.usage.emptyTitle}</h2><p>{data.sessions === 0 ? STR.usage.emptyNoSessions : STR.usage.emptyWithSessions}</p></div>}
    {!analytics || !period ? <p className="ud-notice">{STR.usage.analyticsUnavailable}</p> : <>
      <div className="ud-period-bar"><h2>{STR.usage.overview}</h2><div className="ud-range" role="group" aria-label={STR.usage.rangeAria}>{([7, 30, 90] as const).map((days) => <button key={days} type="button" aria-pressed={range === days} onClick={() => setRange(days)}>{STR.usage.lastDays.replace("{n}", String(days))}</button>)}</div></div>
      <section className="ud-section" aria-labelledby="ud-trend-title"><div className="ud-section-heading"><h3 id="ud-trend-title" title={`${dateLabel(period.days[0]!.day)} — ${dateLabel(period.days[period.days.length - 1]!.day)} · ${analytics.timeZone}`}>{STR.usage.dailyBurn}</h3><div className="ud-chart-legend"><span><i className="ud-input-fill" />{STR.usage.colInput}</span><span><i className="ud-output-fill" />{STR.usage.colOutput}</span></div></div>
        {lowSample
          ? <p className="ud-period-empty" role="status">{STR.design.lowSample}</p>
          : <DailyTrend days={period.days} />}
      </section>
      <div className="ud-detail-grid"><section className="ud-section ud-composition" aria-labelledby="ud-composition-title"><h3 id="ud-composition-title">{STR.usage.inputOutput}</h3>
        <div className="ud-composition-bar" role="img" aria-label={STR.usage.compositionAria.replace("{input}", usageTokenLabel(period.totals.inputTokens, period.totals.inputMeasured)).replace("{output}", usageTokenLabel(period.totals.outputTokens, period.totals.outputMeasured))}><span style={{ width: `${inputPercent}%` }} /><span style={{ width: `${periodTokens > 0 ? 100 - inputPercent : 0}%` }} /></div>
        <dl className="ud-composition-values"><div><dt><i className="ud-input-fill" />{STR.usage.colInput}</dt><dd><TokenValue value={period.totals.inputTokens} measurements={period.totals.inputMeasured} /></dd></div><div><dt><i className="ud-output-fill" />{STR.usage.colOutput}</dt><dd><TokenValue value={period.totals.outputTokens} measurements={period.totals.outputMeasured} /></dd></div></dl>
        <p className="ud-cache-note">{STR.usage.cacheRead}<strong>{usageTokenLabel(period.totals.cacheReadTokens, period.totals.cacheReadMeasured)}</strong>{period.totals.cacheReadMeasured < period.totals.usageCount && <><br />{STR.usage.cacheUnreported}</>}</p>
      </section><section className="ud-section ud-activity" aria-labelledby="ud-activity-title"><div className="ud-section-heading"><h3 id="ud-activity-title">{STR.usage.activityCalendar}</h3><span>{STR.usage.activeDayCount.replace("{n}", String(period.days.filter((day) => day.sessions > 0).length))}</span></div><ActivityHeatmap key={range} days={period.days} /></section></div>
      <section className="ud-section" aria-labelledby="ud-models-title"><div className="ud-section-heading"><h3 id="ud-models-title">{STR.usage.modelUsage}</h3><label className="ud-sort">{STR.usage.sort}<select value={sort} onChange={(event) => setSort(event.target.value as "tokens" | "records")}><option value="tokens">{STR.usage.sortByTokens}</option><option value="records">{STR.usage.sortByRecords}</option></select><ArrowDown size={12} aria-hidden="true" /></label></div>
        {models.length === 0 ? <p className="ud-period-empty">{STR.usage.noModels}</p> : <div className="ud-table-scroll"><table className="ud-table ud-model-table"><caption className="ud-sr-only">{STR.usage.modelTableCaption.replace("{n}", String(range))}</caption><thead><tr><th scope="col">{STR.usage.colModel}</th><th scope="col">{STR.usage.colInput}</th><th scope="col">{STR.usage.colOutput}</th><th scope="col">{STR.usage.colTotalTokens}</th><th scope="col">{STR.usage.colRecords}</th></tr></thead><tbody>{models.map((model) => <tr key={JSON.stringify(model.model)}><th scope="row"><span className="ud-model-name">{model.model ?? STR.usage.unknownModel}</span><span className="ud-model-track" aria-hidden="true"><i style={{ width: `${periodTokens > 0 ? tokenTotal(model) / periodTokens * 100 : 0}%` }} /></span></th><td>{usageTokenLabel(model.inputTokens, model.inputMeasured)}</td><td>{usageTokenLabel(model.outputTokens, model.outputMeasured)}</td><td className="ud-total-cell">{usageTokenLabel(tokenTotal(model), measured(model))}</td><td>{model.usageCount}</td></tr>)}</tbody></table></div>}
      </section>
    </>}
    <footer className="ud-footer">{STR.usage.footerNote}{analytics && <span>{STR.usage.updatedAt + new Date(analytics.generatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>}</footer>
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
      else setError(result.error.trim() || STR.common.unknownError);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (current === generation.current) setError(message.trim() || STR.common.unknownError);
    } finally {
      if (current === generation.current) setRefreshing(false);
    }
  }, []);
  useEffect(() => { void load(); return () => { generation.current += 1; }; }, [load]);
  if (data) return <UsageDashboard data={data} refreshing={refreshing} error={error} onRefresh={() => { void load(); }} />;
  return <div className="ss-page usage-dashboard"><h1 className="ss-title">{STR.usage.title}</h1>{error ? <div className="ud-initial-error" role="alert"><AlertCircle size={24} aria-hidden="true" /><h2>{STR.usage.loadFailedTitle}</h2><p>{error}</p><button type="button" className="ud-refresh" onClick={() => { void load(); }}>{STR.usage.retry}</button></div> : <div className="ud-loading" role="status" aria-label={STR.usage.countingAria}><p>{STR.usage.loadingSessions}</p><div /><div /><div /></div>}</div>;
}
