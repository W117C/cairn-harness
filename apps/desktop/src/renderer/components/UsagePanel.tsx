// 用量统计面板（批 131）：当前会话 / 全部会话双口径。
// 两种口径的数字都来自同一支纯投影（当前 = usageSummary(events)，全部 = 主进程 usageLedger），
// 面板只负责呈现与如实标注统计边界（读不了的文件 / 坏行）。
import type { UsageSummary } from "../projections";
import { STR } from "../strings";
import { formatTokens } from "./format-tokens";

export type UsageScope = "session" | "all";

import type { UsageAllState } from "../usage-state";
export type { UsageAllState } from "../usage-state";

export interface UsagePanelProps {
  scope: UsageScope;
  onScopeChange: (scope: UsageScope) => void;
  /** 当前会话口径；null = 没有活动会话。 */
  usage: UsageSummary | null;
  all: UsageAllState;
  /** 全部会话统计失败时的重试入口。 */
  onRetry: () => void;
}

function Rows(props: { rows: readonly (readonly [string, string])[] }): React.JSX.Element {
  return (
    <dl className="usage-grid">
      {props.rows.map(([label, value]) => (
        <div className="usage-row" key={label}>
          <dt>{label}</dt>
          <dd className="num">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Token 构成条（2026-10-21）：只画 **输入 + 输出** 两段。
 *  口径理由：`cacheReadTokens` 在不同 provider 里语义不同——Anthropic 的 input_tokens 不含缓存读取，
 *  OpenAI 的 prompt_tokens 却**包含** cached_tokens。把缓存并进分母会让同一个条在两类 provider 上
 *  一个不重不漏、一个重复计数；所以缓存只作独立读数附在下面，不参与构成百分比。
 *  颜色取 Claude Desktop v3.1623.0 的分类色序（--chart-1 / --chart-3，见 tokens.css）；
 *  零总量（输入+输出=0）不画空条：空条会被读成“用了一点”，而不是“没有读数”。 */
function Composition(props: { input: number; cache: number; output: number }): React.JSX.Element | null {
  const parts = [
    { key: "input", label: STR.footer.usageInput, value: props.input },
    { key: "output", label: STR.footer.usageOutput, value: props.output },
  ] as const;
  const total = props.input + props.output;
  if (!(total > 0)) return null;
  const pct = (n: number): number => Math.round((n / total) * 1000) / 10;
  // 非零但四舍五入到 0.0% 的段，写「<0.1%」而不是「0%」——后者会被读成「没有这项」。
  const pctLabel = (n: number): string => (n > 0 && pct(n) === 0 ? "<0.1" : String(pct(n)));
  const spoken = parts.map((p) => `${p.label} ${pctLabel(p.value)}%`).join("，");
  return (
    <div className="usage-comp">
      <div className="usage-comp-bar" role="img" aria-label={`${STR.footer.usageComposition}：${spoken}`}>
        {parts.map((p) => (
          p.value > 0
            ? <span key={p.key} className={`uc-seg uc-${p.key}`} style={{ width: `${String(pct(p.value))}%` }} />
            : null
        ))}
      </div>
      <ul className="usage-comp-legend" aria-hidden="true">
        {parts.map((p) => (
          <li key={p.key}>
            <i className={`uc-dot uc-${p.key}`} />
            <span>{p.label}</span>
            <span className="num">{pctLabel(p.value)}%</span>
          </li>
        ))}
      </ul>
      {props.cache > 0 && (
        <p className="usage-comp-note">
          {STR.footer.usageCacheShort} {formatTokens(props.cache)}（{STR.footer.usageCacheNote}）
        </p>
      )}
    </div>
  );
}

export function UsagePanel(props: UsagePanelProps): React.JSX.Element {
  const sessionRows = (): readonly (readonly [string, string])[] => {
    const u = props.usage;
    if (u === null) return [];
    return [
      [STR.footer.usageInput, formatTokens(u.inputTokens)],
      [STR.footer.usageOutput, formatTokens(u.outputTokens)],
      [STR.footer.usageCache, formatTokens(u.cacheReadTokens)],
      [STR.footer.usageSteps, String(u.toolSteps)],
      [STR.footer.usageRounds, String(u.rounds)],
      [STR.footer.usageCalls, String(u.usageCount)],
    ];
  };

  const allBody = (): React.JSX.Element => {
    if (props.all.status === "idle" || props.all.status === "loading") {
      return <p className="usage-empty" role="status">{STR.footer.usageAllLoading}</p>;
    }
    if (props.all.status === "error") {
      return (
        <div className="usage-fail" role="alert">
          <p className="usage-empty">
            {STR.footer.usageAllError}：{props.all.error.trim() === "" ? STR.common.unknownError : props.all.error}
          </p>
          <button className="mini-btn" title={STR.common.retry} onClick={props.onRetry}>{STR.common.retry}</button>
        </div>
      );
    }
    const data = props.all.data;
    if (data.sessions === 0) return <p className="usage-empty">{STR.footer.usageAllEmpty}</p>;
    const rows: (readonly [string, string])[] = [
      [STR.footer.usageInput, formatTokens(data.totals.inputTokens)],
      [STR.footer.usageOutput, formatTokens(data.totals.outputTokens)],
      [STR.footer.usageCache, formatTokens(data.totals.cacheReadTokens)],
      [STR.footer.usageSteps, String(data.totals.toolSteps)],
      [STR.footer.usageRounds, String(data.totals.rounds)],
      [STR.footer.usageCalls, String(data.totals.usageCount)],
      [STR.footer.usageSessions, String(data.sessions)],
      [STR.footer.usageWorkspaces, String(data.workspaces)],
      ...(data.skipped > 0 ? [[STR.footer.usageSkipped, String(data.skipped)] as const] : []),
      ...(data.badLines > 0 ? [[STR.footer.usageBadLines, String(data.badLines)] as const] : []),
    ];
    return (
      <>
        <Rows rows={rows} />
        <Composition
          input={data.totals.inputTokens}
          cache={data.totals.cacheReadTokens}
          output={data.totals.outputTokens}
        />
        <p className="usage-note">{STR.footer.usageAllNote}</p>
      </>
    );
  };

  return (
    <>
      <div className="pop-label">{STR.footer.usageTitle}</div>
      <div className="usage-scope" role="group" aria-label={STR.footer.usageScope}>
        <button
          type="button"
          aria-pressed={props.scope === "session"}
          title={STR.footer.usageScopeSession}
          onClick={() => { props.onScopeChange("session"); }}
        >
          {STR.footer.usageScopeSession}
        </button>
        <button
          type="button"
          aria-pressed={props.scope === "all"}
          title={STR.footer.usageScopeAll}
          onClick={() => { props.onScopeChange("all"); }}
        >
          {STR.footer.usageScopeAll}
        </button>
      </div>
      {props.scope === "session"
        ? (props.usage === null
          ? <p className="usage-empty">{STR.footer.usageEmpty}</p>
          : (
            <>
              <Rows rows={sessionRows()} />
              <Composition
                input={props.usage.inputTokens}
                cache={props.usage.cacheReadTokens}
                output={props.usage.outputTokens}
              />
            </>
          ))
        : allBody()}
    </>
  );
}
