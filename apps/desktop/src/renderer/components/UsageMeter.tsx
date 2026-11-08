// 用量环 + 明细浮层（2026-10-25）：从 Composer 抽出（Composer 已超 1200 行帽；App 规则要求
// 先拆再加）。行为、DOM 类名与文案出处保持不变：环心=上下文水位、未知分两种说清、明细与
// 「压缩历史…」入口原样；外点/Esc 关闭仍走 usePopoverDismiss。
// 2026-11-04 业主截图形制重排：标题行（上下文容量 + 已用/窗口）→ 分段条 → 六桶图例（彩点 +
// 百分比）→ 缓存命中率 → 会话累计（输入/输出/缓存读/轮数/步数）→ 低水位警示 + 压缩入口。
// 分桶估算见 context-breakdown.ts（口径与 contextBudget 同源：总桶 = lastInputTokens）。
import { useRef } from "react";
import type { AgentEvent } from "../../../../../src/events";
import { STR } from "../strings";
import { formatTokens } from "./format-tokens";
import { Popover, usePopoverDismiss } from "./Popover";
import { contextBreakdown, type ContextShareKey } from "../context-breakdown";

/** 图例/分段的色键（CSS .ctx-seg-* / .ctx-dot-* 同名一套）。 */
const BUCKET_LABEL: Record<ContextShareKey, string> = {
  messages: STR.composer.ctxBucketMessages,
  tools: STR.composer.ctxBucketTools,
  skills: STR.composer.ctxBucketSkills,
  memory: STR.composer.ctxBucketMemory,
  system: STR.composer.ctxBucketSystem,
  other: STR.composer.ctxBucketOther,
};

const USAGE_RING_R = 11.5;
const USAGE_RING_C = 2 * Math.PI * USAGE_RING_R;

/** 上下文预算（纯函数，判卷面）：窗口 / 已用 / **余量** / 水位。
 *
 *  「已用」取**上一轮实际带进去的 token**（`lastInputTokens`）——那正是下一轮要带的上下文，
 *  也是 Codex 说的 context window 口径（不是本轮输入输出的累计总和）。
 *  窗口未知（模型没登记窗口）⇒ null（界面说「未知」，**不许拿 0 冒充**）。
 *  低水位阈值：余量 ≤ 窗口的 10%（Codex 的自动压缩点落在 90% 用量 ⇒ 余量 10%）。
 */
export interface ContextBudget {
  /** 模型窗口（token）。 */
  window: number;
  /** 当前上下文（token）。 */
  used: number;
  /** 余量（token）。 */
  remaining: number;
  /** 已用百分比（0–100）。 */
  pct: number;
  /** 余量是否已经偏低（≤ 窗口的 10%）。 */
  low: boolean;
}

export function contextBudget(ctxWindow: number | undefined, lastInputTokens: number): ContextBudget | null {
  if (ctxWindow === undefined || ctxWindow <= 0 || lastInputTokens <= 0) return null;
  const used = Math.min(lastInputTokens, ctxWindow);
  const remaining = Math.max(0, ctxWindow - used);
  const pct = Math.min(100, Math.round((used / ctxWindow) * 100));
  return { window: ctxWindow, used, remaining, pct, low: remaining <= ctxWindow * 0.1 };
}

export function UsageMeter(props: {
  usage: { inputTokens: number; outputTokens: number; usageCount: number; cacheReadTokens: number; lastInputTokens: number };
  steps: number;
  ctxWindow?: number;
  /** 上下文分解用事件流（surface_account / 消息侧字符的来源；WorkbenchView 直传）。 */
  events: readonly AgentEvent[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompact: () => void;
}): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const close = (): void => { props.onOpenChange(false); };
  usePopoverDismiss(props.open, close, wrapRef);
  const usage = props.usage;
  const totalTok = usage.inputTokens + usage.outputTokens;
  const cachePct = usage.cacheReadTokens > 0 && usage.inputTokens > 0
    ? Math.min(99, Math.round((usage.cacheReadTokens / (usage.cacheReadTokens + usage.inputTokens)) * 100))
    : null;
  // 上下文预算与六桶分解（同一总桶口径：lastInputTokens）。
  const budget = contextBudget(props.ctxWindow, usage.lastInputTokens);
  const breakdown = props.open ? contextBreakdown(props.events, usage.lastInputTokens) : null;
  const ctxPct = budget === null ? null : budget.pct;
  const ctxWindowDeclared = props.ctxWindow !== undefined && props.ctxWindow > 0;
  const ringFacts: string[] = [];
  if (totalTok > 0) ringFacts.push(STR.composer.ringTokens.replace("{n}", formatTokens(totalTok)));
  if (usage.usageCount > 0) ringFacts.push(STR.composer.ringRounds.replace("{n}", String(usage.usageCount)));
  if (props.steps > 0) ringFacts.push(STR.composer.ringSteps.replace("{n}", String(props.steps)));
  if (cachePct !== null) ringFacts.push(STR.composer.ringCache.replace("{n}", String(cachePct)));
  const ringTail = ringFacts.length > 0 ? ` · ${ringFacts.join(" · ")}` : "";
  const ringTitle = ctxPct !== null
    ? STR.composer.ringTitlePct.replace("{pct}", String(ctxPct)).replace("{tail}", ringTail)
    : ctxWindowDeclared
      ? STR.composer.ringTitleNoData.replace("{tail}", ringTail)
      : STR.composer.ringTitleUnknown.replace("{tail}", ringTail);
  const ringAria = ctxPct !== null
    ? STR.composer.ringAriaPct.replace("{pct}", String(ctxPct))
    : ctxWindowDeclared ? STR.composer.ringAriaNoData : STR.composer.ringAriaUnknown;

  return (
    <div className="usage-slot" ref={wrapRef}>
      <button
        className="usage-ring"
        data-level={budget !== null && budget.low ? "low" : "normal"}
        aria-label={ringAria}
        title={ringTitle}
        aria-expanded={props.open}
        onClick={() => { props.onOpenChange(!props.open); }}
      >
        <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
          <circle className="ur-track" cx="14" cy="14" r={USAGE_RING_R} />
          <circle
            className="ur-bar"
            cx="14" cy="14" r={USAGE_RING_R}
            style={{
              strokeDasharray: USAGE_RING_C,
              strokeDashoffset: USAGE_RING_C * (1 - (ctxPct ?? 0) / 100),
            }}
          />
        </svg>
        <b className="ur-num" {...(ctxPct !== null ? { "data-len": String(ctxPct).length } : {})}>
          {ctxPct !== null ? (
            <>
              {ctxPct}
              {/* 单位跟数字同格（2026-11-02 真机订正）：环心只有「1」时读不出它是百分比还是
                  步数，非悬停不可懂。单位用小一号字，环心仍是一枚 28px 的小环。 */}
              <span className="ur-unit">{STR.composer.pctUnit}</span>
            </>
          ) : STR.composer.dash}
        </b>
      </button>
      <Popover open={props.open} up role="menu" className="meter-pop" style={{ left: "auto", right: 0 }}>
        <div className="meter-detail">
          {/* ① 标题行：上下文容量 + 右对齐「{pct}%（{used} / {max}）」——截图同形。 */}
          <div className="ctx-cap-head">
            <span className="ctx-cap-title">{STR.composer.ctxCapacityTitle}</span>
            <span className="ctx-cap-value">
              {ctxPct !== null && props.ctxWindow !== undefined
                ? STR.composer.meterCtxDetail
                    .replace("{pct}", String(ctxPct))
                    .replace("{used}", formatTokens(usage.lastInputTokens))
                    .replace("{max}", formatTokens(props.ctxWindow))
                : ctxWindowDeclared ? STR.composer.meterCtxNoData : STR.composer.meterCtxUnknown}
            </span>
          </div>
          {/* ② 分段条：六桶按 pct 铺满（估算分解见 context-breakdown.ts）。 */}
          {breakdown !== null && (
            <div className="ctx-bar" role="img"
              aria-label={STR.composer.ctxCapacityTitle}
              // 估算口径进 tooltip：分段条与图例已经自明，常驻小字只是第二遍解释。
              title={STR.composer.ctxEstimateNote}>
              {breakdown.shares.filter((s) => s.pct > 0).map((s) => (
                <span key={s.key} className={`ctx-seg ctx-seg-${s.key}`} style={{ width: `${String(s.pct)}%` }} />
              ))}
            </div>
          )}
          {/* ③ 图例：彩点 + 桶名 + 百分比（1 位小数，截图同形）。 */}
          {breakdown !== null && (
            <ul className="ctx-legend">
              {breakdown.shares.filter((s) => s.pct > 0).map((s) => (
                <li key={s.key} className="ctx-legend-row">
                  <span className={`ctx-dot ctx-seg-${s.key}`} aria-hidden="true" />
                  <span className="ctx-legend-label">{BUCKET_LABEL[s.key]}</span>
                  <span className="ctx-legend-pct num">{s.pct.toFixed(1)}{STR.composer.pctUnit}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="menu-sep" />
          {/* ④ 缓存命中率（截图同位）：缓存读 ÷（缓存读 + 未命中输入）。 */}
          <div className="mt-row">
            <span>{STR.composer.ctxCacheHitRate}</span>
            <b>{cachePct !== null ? `${String(cachePct)}${STR.composer.pctUnit}` : STR.composer.dash}</b>
          </div>
          <div className="menu-sep" />
          {/* ⑤ 会话累计：原明细行原样保留（真实数据，不拿「今日余额」冒充——那格是 ZCode 的
              供应商配额面，Cairn 没有这份数据源，硬凑就是摆假仪表）。 */}
          <div className="ctx-section-title" title={STR.composer.meterNote}>{STR.composer.meterTitle}</div>
          <div className="mt-row"><span>{STR.composer.meterInput}</span><b>{formatTokens(usage.inputTokens)}</b></div>
          <div className="mt-row"><span>{STR.composer.meterOutput}</span><b>{formatTokens(usage.outputTokens)}</b></div>
          <div className="mt-row"><span>{STR.composer.meterCacheRead}</span><b>{usage.cacheReadTokens > 0 ? formatTokens(usage.cacheReadTokens) : STR.composer.dash}</b></div>
          <div className="mt-row"><span>{STR.composer.meterRounds}</span><b>{String(usage.usageCount)}</b></div>
          <div className="mt-row"><span>{STR.composer.meterSteps}</span><b>{String(props.steps)}</b></div>
          {budget !== null && budget.low && (
            <div className="meter-warn" role="status">
              {STR.composer.meterCtxLow.replace("{n}", formatTokens(budget.remaining))}
            </div>
          )}
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => { close(); props.onCompact(); }}>{STR.composer.meterCompact}</button>
        </div>
      </Popover>
    </div>
  );
}
