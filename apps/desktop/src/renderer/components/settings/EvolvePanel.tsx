// 进化分区（Cairn Evolve · P5 可见面）：报告只读；唯一动作是人工治理的冻结开关
// （冻结写 STOP、解冻删 STOP——不注入、不晋升、不碰预算/候选）。
// 纯展示组件与容器分离：EvolvePanel 可静态判卷；EvolveSection 只负责取报告、重试与落冻结动作。
//
// 2026-11-01 真机（业主截图）：证据/经验分区此前把计数拼成一长串英文标签
// （"success 0 / failure 0 / unknown 834"），读不出「哪个数是多少」。
// 现在是「人能读的表」：一行一个短标签 + 一句白话 + 若干计数小片；
// 原始计数串原样收进分区末尾的「技术详情」折叠（默认收起，不占默认版面）。

import { useState } from "react";
import type { EvolveReport } from "../../../../../../src/main/ipc-protocol";
import { ConfirmDialog } from "../ConfirmDialog";
import { Badge, Banner, SettingsRow, SettingsSection } from "../settings-ui";
import { STR } from "../../strings";

/** 经验状态/类型的人话标签（2026-11-02）：数据面仍是 active/candidate/lesson/pitfall，
 *  界面只做呈现层映射；未登记的键原样显示，不编造。 */
const STATUS_LABEL: Record<string, string> = {
  active: STR.evolve.statusActive,
  candidate: STR.evolve.statusCandidate,
  retired: STR.evolve.statusRetired,
  rejected: STR.evolve.statusRejected,
};
const KIND_LABEL: Record<string, string> = {
  lesson: STR.evolve.kindLesson,
  pitfall: STR.evolve.kindPitfall,
};
const CANDIDATE_STATUS_LABEL: Record<string, string> = {
  candidate: STR.evolve.candCandidate,
  promoted: STR.evolve.candPromoted,
  rejected: STR.evolve.candRejected,
  passed: STR.evolve.candPassed,
};

export type EvolvePanelState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; report: EvolveReport };

function countEntries(map: Record<string, number>): [string, number][] {
  return Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function counts(map: Record<string, number>): string {
  const entries = countEntries(map);
  return entries.length === 0 ? STR.evolve.none : entries.map(([key, value]) => key + "×" + String(value)).join("、");
}

/** 计数小片：给人读的一格一个数（标签 + 值）；CJK 词不许折行（CSS 保 nowrap）。 */
function CountChips(props: { items: { key: string; value: number; unit?: string }[] }): React.JSX.Element {
  return (
    <span className="sp-chips">
      {props.items.map((item) => (
        <span className="sp-chip" key={item.key}>
          <span className="sp-chip-k">{item.key}</span>
          <span className="sp-chip-v">
            {String(item.value)}{item.unit === undefined ? "" : " " + item.unit}
          </span>
        </span>
      ))}
    </span>
  );
}

/** 技术详情（原生 details，默认收起）：原始计数串原样留着备查，默认版面不出现。 */
function TechDetails(props: { lines: { key: string; raw: string }[] }): React.JSX.Element {
  return (
    <details className="sp-tech">
      <summary>{STR.evolve.techDetails}</summary>
      <div className="sp-tech-body">
        {props.lines.map((line) => (
          <div className="sp-tech-line" key={line.key}>
            <span className="sp-tech-k">{line.key}</span>
            <code className="sp-tech-v">{line.raw}</code>
          </div>
        ))}
      </div>
    </details>
  );
}

function budgetSource(source: EvolveReport["budget"]["source"]): string {
  return source === "file" ? STR.evolve.budgetSourceFile : source === "invalid" ? STR.evolve.budgetSourceInvalid : STR.evolve.budgetSourceDefault;
}

function findingLabel(reason: string): string {
  if (reason === "expired") return STR.evolve.findingExpired;
  if (reason === "negative") return STR.evolve.findingNegative;
  if (reason === "conflict") return STR.evolve.findingConflict;
  return reason;
}

export function EvolvePanel(props: {
  state: EvolvePanelState;
  onRetry: () => void;
  /** 人工治理开关（冻结写 STOP / 解冻删 STOP）；缺席 = 不提供按钮。 */
  onSetFrozen?: (frozen: boolean) => void;
  frozenBusy?: boolean;
  /** 人工激活一条过门经验（写 playbook active）；缺席 = 不提供按钮。 */
  onActivate?: (id: string) => void;
  activateBusyId?: string | null;
  /** 人工把一条负证据经验转 dormant；缺席 = 不提供按钮。 */
  onDormant?: (id: string) => void;
  dormantBusyId?: string | null;
  /** 人工撤销一条全局经验（全局账 patch → dormant）；缺席 = 不提供按钮。 */
  onRevokeGlobal?: (id: string) => void;
  globalBusyId?: string | null;
  /** 人工恢复一条 dormant 全局经验（复核 ≥3 库证据）；缺席 = 不提供按钮。 */
  onRestoreGlobal?: (id: string) => void;
  restoreBusyId?: string | null;
  /** 人工冻结/解冻全局经验（写/删全局 STOP）；缺席 = 不提供按钮。 */
  onSetGlobalFrozen?: (frozen: boolean) => void;
  globalFrozenBusy?: boolean;
  /** 上一次激活动作的拒绝原因（保持报告在屏，不折成整页错误）。 */
  actionError?: string;
}): React.JSX.Element {
  const { state } = props;
  return (
    <div className="ss-page">
      {/* 头与内容列都跟其它设置分区同形（SettingsPage）：此前这里只有裸 h1，
          少了 .ss-content ⇒ settings-refinement.css 的「分区之间一条细线」从不生效。 */}
      <header className="ss-head"><h1 className="ss-title">{STR.evolve.title}</h1></header>
      <div className="ss-content">
        {state.status === "loading" && <p className="sp-note" role="status">{STR.evolve.loading}</p>}
        {state.status === "error" && (
          <div className="sp-note err" role="alert">
            <p>{STR.evolve.loadFailedPrefix}{state.error.trim() || STR.common.unknownError}</p>
            <button type="button" className="mini-btn" onClick={props.onRetry}>{STR.common.retry}</button>
          </div>
        )}
        {state.status === "ready" && (
          <EvolveReportBody
            report={state.report}
            {...(props.onSetFrozen !== undefined ? { onSetFrozen: props.onSetFrozen } : {})}
            {...(props.frozenBusy === true ? { frozenBusy: true } : {})}
            {...(props.onActivate !== undefined ? { onActivate: props.onActivate } : {})}
            {...(props.activateBusyId !== undefined ? { activateBusyId: props.activateBusyId } : {})}
            {...(props.onDormant !== undefined ? { onDormant: props.onDormant } : {})}
            {...(props.dormantBusyId !== undefined ? { dormantBusyId: props.dormantBusyId } : {})}
            {...(props.onRevokeGlobal !== undefined ? { onRevokeGlobal: props.onRevokeGlobal } : {})}
            {...(props.globalBusyId !== undefined ? { globalBusyId: props.globalBusyId } : {})}
            {...(props.onRestoreGlobal !== undefined ? { onRestoreGlobal: props.onRestoreGlobal } : {})}
            {...(props.restoreBusyId !== undefined ? { restoreBusyId: props.restoreBusyId } : {})}
            {...(props.onSetGlobalFrozen !== undefined ? { onSetGlobalFrozen: props.onSetGlobalFrozen } : {})}
            {...(props.globalFrozenBusy === true ? { globalFrozenBusy: true } : {})}
            {...(props.actionError !== undefined ? { actionError: props.actionError } : {})}
          />
        )}
      </div>
    </div>
  );
}

function EvolveReportBody(props: {
  report: EvolveReport;
  onSetFrozen?: (frozen: boolean) => void;
  frozenBusy?: boolean;
  onActivate?: (id: string) => void;
  activateBusyId?: string | null;
  onDormant?: (id: string) => void;
  dormantBusyId?: string | null;
  onRevokeGlobal?: (id: string) => void;
  globalBusyId?: string | null;
  onRestoreGlobal?: (id: string) => void;
  restoreBusyId?: string | null;
  onSetGlobalFrozen?: (frozen: boolean) => void;
  globalFrozenBusy?: boolean;
  actionError?: string;
}): React.JSX.Element {
  const report = props.report;
  const [confirmFreeze, setConfirmFreeze] = useState(false);
  const [activateTarget, setActivateTarget] = useState<string | null>(null);
  const [dormantTarget, setDormantTarget] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [confirmGlobalFreeze, setConfirmGlobalFreeze] = useState(false);
  const nextFrozen = !report.frozen;
  const episodes = report.episodes;
  const playbook = report.playbook;
  // 原始计数串（2026-11-01）：原样搬进「技术详情」折叠，正文只给人读的那版。
  const rawLines = [
    {
      key: "Episode",
      raw: `success ${String(episodes.byOutcome.success)} / failure ${String(episodes.byOutcome.failure)} / unknown ${String(episodes.byOutcome.unknown)}；verify green ${String(episodes.byVerify.green)} / red ${String(episodes.byVerify.red)} / none ${String(episodes.byVerify.none)}`,
    },
    {
      key: STR.evolve.rawUnknown,
      raw: [STR.evolve.rawJudgeUntested.replace("{n}", String(episodes.unknownReasons.judge)), STR.evolve.rawVerifyUnrun.replace("{n}", String(episodes.unknownReasons.verify)), STR.evolve.rawUserUntested.replace("{n}", String(episodes.unknownReasons.user))].join("；"),
    },
    {
      key: STR.evolve.rawCost,
      raw: STR.evolve.rawMainTokens.replace("{n}", String(episodes.cost.mainTokens)) + "；" + STR.evolve.rawWorkerTokens.replace("{n}", String(episodes.cost.workerTokens)) + "；" + STR.evolve.rawPriced.replace("{n}", String(episodes.cost.pricedRuns)) + " / " + STR.evolve.rawUnpriced.replace("{n}", String(episodes.cost.unpricedRuns)),
    },
    {
      key: "playbook",
      raw: [STR.evolve.rawStatusCounts.replace("{s}", counts(playbook.byStatus)), STR.evolve.rawKindCounts.replace("{k}", counts(playbook.byKind)), STR.evolve.rawConflict.replace("{n}", String(playbook.conflicts)), STR.evolve.rawExpired.replace("{n}", String(playbook.expired)), STR.evolve.rawNegative.replace("{n}", String(playbook.negative)), STR.evolve.rawActivatable.replace("{n}", String(playbook.activatable.length)) + (playbook.activatable.length === 0 ? "" : "（" + playbook.activatable.slice(0, 2).join("、") + (playbook.activatable.length > 2 ? STR.evolve.rawActivatableEllipsis : "") + "）"), STR.evolve.rawBadLines.replace("{n}", String(playbook.badLines)), STR.evolve.rawRefusals.replace("{n}", String(playbook.refusals))].join("；"),
    },
    {
      key: STR.evolve.rawCandidates,
      raw: STR.evolve.rawStatusCounts.replace("{s}", counts(report.candidates.byStatus)),
    },
    {
      key: STR.evolve.rawBudget,
      raw: ["playbook " + String(report.budget.budget.maxPlaybookEntries), STR.evolve.rawExperiments.replace("{n}", String(report.budget.budget.maxExperiments)), STR.evolve.rawCandidatesCount.replace("{n}", String(report.budget.budget.maxCandidates))].join("；"),
    },
  ];
  return (
    <>
      {report.frozen && (
        <Banner tone="warn">
          {STR.evolve.frozenBanner}
        </Banner>
      )}
      {props.actionError !== undefined && <p className="sp-note err" role="alert">{props.actionError}</p>}
      <SettingsSection title={STR.evolve.evidenceTitle}>
        <SettingsRow label={STR.evolve.recordTotal}>
          <Badge>{String(episodes.total)}{STR.evolve.entryUnit}</Badge>
        </SettingsRow>
        <SettingsRow label={STR.evolve.outcomeLabel}>
          <CountChips items={[
            { key: STR.evolve.chipSuccess, value: episodes.byOutcome.success },
            { key: STR.evolve.chipFailure, value: episodes.byOutcome.failure },
            { key: STR.evolve.chipUnclassified, value: episodes.byOutcome.unknown },
          ]} />
        </SettingsRow>
        <SettingsRow label={STR.evolve.verifyLabel}>
          <CountChips items={[
            { key: STR.evolve.chipGreen, value: episodes.byVerify.green },
            { key: STR.evolve.chipRed, value: episodes.byVerify.red },
            { key: STR.evolve.chipNone, value: episodes.byVerify.none },
          ]} />
        </SettingsRow>
        <SettingsRow label={STR.evolve.unknownLabel}>
          <CountChips items={[
            // 2026-11-02：界面说人话（判分/自校验/用户反馈），原始 judge/verify/user 仍留在技术详情。
            { key: STR.evolve.chipJudgeUntested, value: episodes.unknownReasons.judge },
            { key: STR.evolve.chipVerifyUnrun, value: episodes.unknownReasons.verify },
            { key: STR.evolve.chipUserUntested, value: episodes.unknownReasons.user },
          ]} />
        </SettingsRow>
        <SettingsRow label={STR.evolve.costLabel}>
          <CountChips items={[
            { key: STR.evolve.chipMain, value: episodes.cost.mainTokens, unit: "token" },
            { key: STR.evolve.chipWorker, value: episodes.cost.workerTokens, unit: "token" },
          ]} />
        </SettingsRow>
        <SettingsRow label={STR.evolve.pricingLabel}>
          <CountChips items={[
            { key: STR.evolve.chipPriced, value: episodes.cost.pricedRuns },
            { key: STR.evolve.chipUnpriced, value: episodes.cost.unpricedRuns },
          ]} />
        </SettingsRow>
        <TechDetails lines={rawLines} />
      </SettingsSection>

      <SettingsSection title={STR.evolve.playbookTitle} hint={STR.evolve.playbookHint}>
        <SettingsRow label={STR.evolve.entryTotal}>
          <Badge>{String(playbook.total)}{STR.evolve.entryUnit}</Badge>
        </SettingsRow>
        <SettingsRow label={STR.evolve.statusRow}>
          <CountChips items={countEntries(playbook.byStatus).map(([key, value]) => ({ key: STATUS_LABEL[key] ?? key, value }))} />
        </SettingsRow>
        <SettingsRow label={STR.evolve.kindRow}>
          <CountChips items={countEntries(playbook.byKind).map(([key, value]) => ({ key: KIND_LABEL[key] ?? key, value }))} />
        </SettingsRow>
        <SettingsRow label={STR.evolve.attentionLabel} desc={STR.evolve.attentionDesc}>
          <CountChips items={[
            { key: STR.evolve.chipConflict, value: playbook.conflicts },
            { key: STR.evolve.chipExpired, value: playbook.expired },
            { key: STR.evolve.chipNegative, value: playbook.negative },
            { key: STR.evolve.chipActivatable, value: playbook.activatable.length },
            { key: STR.evolve.chipBadLines, value: playbook.badLines },
            { key: STR.evolve.chipRefusals, value: playbook.refusals },
          ]} />
          <Badge tone={playbook.conflicts === 0 ? "ok" : "neutral"}>{playbook.conflicts === 0 ? STR.evolve.noConflict : STR.evolve.hasConflict}</Badge>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={STR.evolve.activatableTitle} hint={report.frozen ? STR.evolve.hintFrozen : STR.evolve.hintManual}>
        {report.activationCandidates.length === 0
          ? <p className="sp-note">{STR.evolve.noActivatable}</p>
          : report.activationCandidates.map((candidate) => (
            <SettingsRow
              key={candidate.id}
              label={candidate.body.length > 80 ? candidate.body.slice(0, 80) + "…" : candidate.body}
            >
              <Badge tone="ok">
                {STR.evolve.badgeActivatable
                  .replace("{kind}", KIND_LABEL[candidate.kind] ?? candidate.kind)
                  .replace("{risk}", candidate.riskDiff === null ? "—" : candidate.riskDiff.toFixed(2))
                  .replace("{trials}", String(candidate.trials))
                  .replace("{evidence}", String(candidate.evidence))}
              </Badge>
              {props.onActivate !== undefined && !report.frozen && (
                <button
                  type="button"
                  className="mini-btn"
                  disabled={props.activateBusyId === candidate.id}
                  aria-label={STR.evolve.activateAria.replace("{id}", candidate.id)}
                  onClick={() => { setActivateTarget(candidate.id); }}
                >{props.activateBusyId === candidate.id ? STR.evolve.writing : STR.evolve.activate}</button>
              )}
            </SettingsRow>
          ))}
      </SettingsSection>

      <SettingsSection title={STR.evolve.negativeTitle} hint={report.frozen ? STR.evolve.hintFrozen : STR.evolve.hintDormant}>
        {report.negativeCandidates.length === 0
          ? <p className="sp-note">{STR.evolve.noNegative}</p>
          : report.negativeCandidates.map((candidate) => (
            <SettingsRow
              key={candidate.id}
              label={candidate.body.length > 80 ? candidate.body.slice(0, 80) + "…" : candidate.body}
            >
              <Badge tone="neutral">
                {STR.evolve.badgeNegative.replace("{kind}", candidate.kind).replace("{s}", String(candidate.successes)).replace("{t}", String(candidate.trials))}
              </Badge>
              {props.onDormant !== undefined && !report.frozen && (
                <button
                  type="button"
                  className="mini-btn"
                  disabled={props.dormantBusyId === candidate.id}
                  aria-label={STR.evolve.dormantAria.replace("{id}", candidate.id)}
                  onClick={() => { setDormantTarget(candidate.id); }}
                >{props.dormantBusyId === candidate.id ? STR.evolve.writing : STR.evolve.dormant}</button>
              )}
            </SettingsRow>
          ))}
      </SettingsSection>

      <SettingsSection
        title={STR.evolve.globalTitle}
        hint={report.global.frozen ? STR.evolve.hintGlobalFrozen : STR.evolve.hintGlobal}
      >
        {report.global.total === 0
          ? <p className="sp-note">{STR.evolve.noGlobal}</p>
          : report.global.entries.map((entry) => {
            const finding = report.global.findings.find((item) => item.id === entry.id);
            const observation = STR.evolve.observation.replace("{s}", String(entry.successes)).replace("{t}", String(entry.trials))
              .replace("{es}", String(entry.evidenceSuccesses)).replace("{et}", String(entry.evidenceTrials));
            return (
              <SettingsRow
                key={entry.id}
                label={entry.body.length > 80 ? entry.body.slice(0, 80) + "…" : entry.body}
                desc={finding === undefined
                  ? observation
                  : observation + "；" + findingLabel(finding.reason) + "：" + finding.detail}
              >
                <Badge tone={entry.status === "active" && finding === undefined ? "ok" : "neutral"}>
                  {STR.evolve.badgeGlobal.replace("{kind}", entry.kind).replace("{status}", entry.status)
                    .replace("{w}", String(entry.workspaces)).replace("{e}", String(entry.evidence))}
                </Badge>
                {props.onRevokeGlobal !== undefined && entry.status === "active" && !report.global.frozen && (
                  <button
                    type="button"
                    className="mini-btn"
                    disabled={props.globalBusyId === entry.id}
                    aria-label={STR.evolve.revokeAria.replace("{id}", entry.id)}
                    onClick={() => { setRevokeTarget(entry.id); }}
                  >{props.globalBusyId === entry.id ? STR.evolve.revoking : STR.evolve.revoke}</button>
                )}
                {props.onRestoreGlobal !== undefined && entry.status === "dormant" && !report.global.frozen && (
                  <button
                    type="button"
                    className="mini-btn"
                    disabled={props.restoreBusyId === entry.id}
                    aria-label={STR.evolve.restoreAria.replace("{id}", entry.id)}
                    onClick={() => { setRestoreTarget(entry.id); }}
                  >{props.restoreBusyId === entry.id ? STR.evolve.restoring : STR.evolve.restore}</button>
                )}
              </SettingsRow>
            );
          })}
        {report.global.badLines > 0 && (
          <p className="sp-note err" role="alert">
            {STR.evolve.badLinesNote.replace("{n}", String(report.global.badLines))}
          </p>
        )}
        <SettingsRow
          label={report.global.frozen ? STR.evolve.globalFrozenLabel : STR.evolve.globalUnfrozenLabel}
          desc={report.global.frozen ? STR.evolve.globalFrozenDesc : STR.evolve.globalUnfrozenDesc}
        >
          {props.onSetGlobalFrozen !== undefined && (
            <button
              type="button"
              className="mini-btn"
              disabled={props.globalFrozenBusy === true}
              aria-label={report.global.frozen ? STR.evolve.unfreezeGlobalAria : STR.evolve.freezeGlobalAria}
              onClick={() => { setConfirmGlobalFreeze(true); }}
            >{props.globalFrozenBusy === true ? STR.evolve.writing : report.global.frozen ? STR.evolve.unfreeze : STR.evolve.freeze}</button>
          )}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={STR.evolve.nudgesTitle} hint={STR.evolve.hintEpisode}>
        <SettingsRow label={STR.evolve.nudgesLabel.replace("{e}", String(report.nudges.episodes)).replace("{n}", String(report.nudges.ids))}>
          <Badge tone={report.nudges.episodes === 0 ? "neutral" : "ok"}>
            {report.nudges.episodes === 0 ? STR.evolve.noHit : STR.evolve.hasHit}
          </Badge>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={STR.evolve.experimentsTitle} hint={STR.evolve.hintPassed}>
        {report.experiments.length === 0
          ? <p className="sp-note">{STR.evolve.noExperiments}</p>
          : report.experiments.map((experiment) => (
            <SettingsRow
              key={experiment.id}
              label={experiment.id}
              desc={STR.evolve.experimentDesc.replace("{ref}", experiment.candidateRef).replace("{c}", String(experiment.nControl)).replace("{t}", String(experiment.nTreatment))}
            >
              <Badge tone={experiment.analysisStatus === "passed" ? "ok" : "neutral"}>
                {experiment.analysisStatus ?? experiment.status}
                {experiment.decision === null ? "" : " · " + experiment.decision}
              </Badge>
            </SettingsRow>
          ))}
      </SettingsSection>

      <SettingsSection title={STR.evolve.candidatesTitle} hint={STR.evolve.hintNoHoldout}>
        <SettingsRow label={STR.evolve.candidatesTotal}>
          <CountChips items={[
            { key: STR.evolve.totalChip, value: report.candidates.total },
            ...countEntries(report.candidates.byStatus).map(([key, value]) => ({ key: CANDIDATE_STATUS_LABEL[key] ?? key, value })),
          ]} />
          <Badge tone="neutral">{STR.evolve.archiveChip}</Badge>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={STR.evolve.budgetTitle} hint={budgetSource(report.budget.source)}>
        <SettingsRow
          label={STR.evolve.injectLabel}
          desc={STR.evolve.injectDesc.replace("{n}", String(report.budget.budget.maxInjectedEntries)).replace("{m}", String(report.budget.budget.maxInjectedChars))}
        >
          <Badge tone="neutral">{STR.evolve.perAssembly}</Badge>
        </SettingsRow>
        <SettingsRow label={STR.evolve.capacityLabel}>
          <CountChips items={[
            { key: STR.evolve.capacityEntries, value: report.budget.budget.maxPlaybookEntries },
            { key: STR.evolve.chipExperiments, value: report.budget.budget.maxExperiments },
            { key: STR.evolve.rawCandidates, value: report.budget.budget.maxCandidates },
          ]} />
          <Badge tone="neutral">{STR.evolve.capChip}</Badge>
        </SettingsRow>
        {report.budget.detail !== null && <p className="sp-note">{report.budget.detail}</p>}
      </SettingsSection>

      <SettingsSection title={STR.evolve.governanceTitle} hint={STR.evolve.hintManualSwitch}>
        <SettingsRow
          label={report.frozen ? STR.evolve.frozenLabel : STR.evolve.unfrozenLabel}
          desc={report.frozen ? STR.evolve.frozenDesc : STR.evolve.unfrozenDesc}
        >
          {props.onSetFrozen !== undefined && (
            <button
              type="button"
              className="mini-btn"
              disabled={props.frozenBusy === true}
              aria-label={nextFrozen ? STR.evolve.freezeAria : STR.evolve.unfreezeEvolveAria}
              onClick={() => { setConfirmFreeze(true); }}
            >{props.frozenBusy === true ? STR.evolve.writing : nextFrozen ? STR.evolve.freeze : STR.evolve.unfreeze}</button>
          )}
        </SettingsRow>
      </SettingsSection>

      {dormantTarget !== null && props.onDormant !== undefined && (() => {
        const candidate = report.negativeCandidates.find((item) => item.id === dormantTarget);
        if (candidate === undefined) return null;
        return (
          <ConfirmDialog
            title={STR.evolve.dormantConfirmTitle}
            note={STR.evolve.dormantConfirmNote
              .replace("{s}", String(candidate.successes)).replace("{t}", String(candidate.trials))
              .replace("{body}", candidate.body)}
            confirmLabel={STR.evolve.dormant}
            onClose={() => { setDormantTarget(null); }}
            onConfirm={() => {
              const id = candidate.id;
              setDormantTarget(null);
              props.onDormant?.(id);
            }}
          />
        );
      })()}

      {activateTarget !== null && props.onActivate !== undefined && (() => {
        const candidate = report.activationCandidates.find((item) => item.id === activateTarget);
        if (candidate === undefined) return null;
        return (
          <ConfirmDialog
            title={STR.evolve.activateConfirmTitle}
            note={STR.evolve.activateConfirmNote
              .replace("{risk}", candidate.riskDiff === null ? "—" : candidate.riskDiff.toFixed(2))
              .replace("{trials}", String(candidate.trials))
              .replace("{evidence}", String(candidate.evidence))
              .replace("{body}", candidate.body)}
            confirmLabel={STR.evolve.activate}
            onClose={() => { setActivateTarget(null); }}
            onConfirm={() => {
              const id = candidate.id;
              setActivateTarget(null);
              props.onActivate?.(id);
            }}
          />
        );
      })()}

      {confirmGlobalFreeze && props.onSetGlobalFrozen !== undefined && (
        <ConfirmDialog
          title={report.global.frozen ? STR.evolve.unfreezeGlobalTitle : STR.evolve.freezeGlobalTitle}
          note={report.global.frozen
            ? STR.evolve.unfreezeGlobalNote
            : STR.evolve.freezeGlobalNote}
          confirmLabel={report.global.frozen ? STR.evolve.unfreezeConfirmLabel : STR.evolve.freeze}
          onClose={() => { setConfirmGlobalFreeze(false); }}
          onConfirm={() => {
            const next = !report.global.frozen;
            setConfirmGlobalFreeze(false);
            props.onSetGlobalFrozen?.(next);
          }}
        />
      )}

      {restoreTarget !== null && props.onRestoreGlobal !== undefined && (() => {
        const entry = report.global.entries.find((item) => item.id === restoreTarget);
        if (entry === undefined) return null;
        return (
          <ConfirmDialog
            title={STR.evolve.restoreConfirmTitle}
            note={STR.evolve.restoreConfirmNote.replace("{body}", entry.body)}
            confirmLabel={STR.evolve.restore}
            onClose={() => { setRestoreTarget(null); }}
            onConfirm={() => {
              const id = entry.id;
              setRestoreTarget(null);
              props.onRestoreGlobal?.(id);
            }}
          />
        );
      })()}

      {revokeTarget !== null && props.onRevokeGlobal !== undefined && (() => {
        const entry = report.global.entries.find((item) => item.id === revokeTarget);
        if (entry === undefined) return null;
        return (
          <ConfirmDialog
            title={STR.evolve.revokeConfirmTitle}
            note={STR.evolve.revokeConfirmNote.replace("{body}", entry.body)}
            confirmLabel={STR.evolve.revoke}
            onClose={() => { setRevokeTarget(null); }}
            onConfirm={() => {
              const id = entry.id;
              setRevokeTarget(null);
              props.onRevokeGlobal?.(id);
            }}
          />
        );
      })()}

      {confirmFreeze && props.onSetFrozen !== undefined && (
        <ConfirmDialog
          title={nextFrozen ? STR.evolve.evolveFreezeTitle : STR.evolve.evolveUnfreezeTitle}
          note={nextFrozen
            ? STR.evolve.evolveFreezeNote
            : STR.evolve.evolveUnfreezeNote}
          confirmLabel={nextFrozen ? STR.evolve.freeze : STR.evolve.unfreezeConfirmLabel}
          onClose={() => { setConfirmFreeze(false); }}
          onConfirm={() => { setConfirmFreeze(false); props.onSetFrozen?.(nextFrozen); }}
        />
      )}
    </>
  );
}
