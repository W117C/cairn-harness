// 用量环 + 明细浮层（2026-10-25）：从 Composer 抽出（Composer 已超 1200 行帽；App 规则要求
// 先拆再加）。行为、DOM 类名与文案出处保持不变：环心=上下文水位、未知分两种说清、明细与
// 「压缩历史…」入口原样；外点/Esc 关闭仍走 usePopoverDismiss。
import { useRef } from "react";
import { STR } from "../strings";
import { formatTokens } from "./format-tokens";
import { Popover, usePopoverDismiss } from "./Popover";

const USAGE_RING_R = 11.5;
const USAGE_RING_C = 2 * Math.PI * USAGE_RING_R;

export function UsageMeter(props: {
  usage: { inputTokens: number; outputTokens: number; usageCount: number; cacheReadTokens: number; lastInputTokens: number };
  steps: number;
  ctxWindow?: number;
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
  const ctxPct = props.ctxWindow !== undefined && props.ctxWindow > 0 && usage.lastInputTokens > 0
    ? Math.min(100, Math.round((usage.lastInputTokens / props.ctxWindow) * 100))
    : null;
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
        <b className="ur-num">{ctxPct !== null ? String(ctxPct) : STR.composer.dash}</b>
      </button>
      <Popover open={props.open} up role="menu" style={{ left: "auto", right: 0 }}>
        <div className="meter-detail">
          <div className="pop-label">{STR.composer.meterTitle}</div>
          <div className="mt-row"><span>{STR.composer.meterInput}</span><b>{formatTokens(usage.inputTokens)}</b></div>
          <div className="mt-row"><span>{STR.composer.meterOutput}</span><b>{formatTokens(usage.outputTokens)}</b></div>
          <div className="mt-row"><span>{STR.composer.meterCacheRead}</span><b>{usage.cacheReadTokens > 0 ? formatTokens(usage.cacheReadTokens) : STR.composer.dash}</b></div>
          <div className="mt-row"><span>{STR.composer.meterRounds}</span><b>{String(usage.usageCount)}</b></div>
          <div className="mt-row"><span>{STR.composer.meterSteps}</span><b>{String(props.steps)}</b></div>
          <div className="mt-row">
            <span>{STR.composer.meterCtx}</span>
            <b>
              {ctxPct !== null && props.ctxWindow !== undefined
                ? STR.composer.meterCtxDetail
                    .replace("{pct}", String(ctxPct))
                    .replace("{used}", formatTokens(usage.lastInputTokens))
                    .replace("{max}", formatTokens(props.ctxWindow))
                : ctxWindowDeclared ? STR.composer.meterCtxNoData : STR.composer.meterCtxUnknown}
            </b>
          </div>
          <div className="menu-note">{STR.composer.meterNote}</div>
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => { close(); props.onCompact(); }}>{STR.composer.meterCompact}</button>
        </div>
      </Popover>
    </div>
  );
}
