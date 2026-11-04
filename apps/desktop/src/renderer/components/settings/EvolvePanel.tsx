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

/** 经验状态/类型的人话标签（2026-11-02）：数据面仍是 active/candidate/lesson/pitfall，
 *  界面只做呈现层映射；未登记的键原样显示，不编造。 */
const STATUS_LABEL: Record<string, string> = {
  active: "已生效",
  candidate: "候选",
  retired: "已退役",
  rejected: "已拒绝",
};
const KIND_LABEL: Record<string, string> = {
  lesson: "经验教训",
  pitfall: "易错点",
};
const CANDIDATE_STATUS_LABEL: Record<string, string> = {
  candidate: "待评估",
  promoted: "已晋升",
  rejected: "已拒绝",
  passed: "已通过",
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
  return entries.length === 0 ? "无" : entries.map(([key, value]) => key + "×" + String(value)).join("、");
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
      <summary>技术详情</summary>
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
  return source === "file" ? "文件配置" : source === "invalid" ? "坏档，已回缺省" : "缺省";
}

function findingLabel(reason: string): string {
  if (reason === "expired") return "已过期";
  if (reason === "negative") return "负证据（本库+证据库）";
  if (reason === "conflict") return "同触发冲突";
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
      <header className="ss-head"><h1 className="ss-title">进化</h1></header>
      <div className="ss-content">
        {state.status === "loading" && <p className="sp-note" role="status">正在读取进化报告…</p>}
        {state.status === "error" && (
          <div className="sp-note err" role="alert">
            <p>读取失败：{state.error.trim() || "未知原因"}</p>
            <button type="button" className="mini-btn" onClick={props.onRetry}>重试</button>
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
      key: "未知面",
      raw: `judge 未测 ${String(episodes.unknownReasons.judge)}；verify 未跑 ${String(episodes.unknownReasons.verify)}；user 未测 ${String(episodes.unknownReasons.user)}`,
    },
    {
      key: "成本",
      raw: `主面 ${String(episodes.cost.mainTokens)} token；worker ${String(episodes.cost.workerTokens)}；可定价 ${String(episodes.cost.pricedRuns)} / 不可定价 ${String(episodes.cost.unpricedRuns)}`,
    },
    {
      key: "playbook",
      raw: `状态：${counts(playbook.byStatus)}；类型：${counts(playbook.byKind)}；冲突 ${String(playbook.conflicts)}；过期 ${String(playbook.expired)}；负证据 ${String(playbook.negative)}；可激活 ${String(playbook.activatable.length)}${playbook.activatable.length === 0 ? "" : "（" + playbook.activatable.slice(0, 2).join("、") + (playbook.activatable.length > 2 ? " 等" : "") + "）"}；坏行 ${String(playbook.badLines)}；拒单 ${String(playbook.refusals)}`,
    },
    {
      key: "候选",
      raw: `状态：${counts(report.candidates.byStatus)}`,
    },
    {
      key: "预算容量",
      raw: `playbook ${String(report.budget.budget.maxPlaybookEntries)}；实验 ${String(report.budget.budget.maxExperiments)}；候选 ${String(report.budget.budget.maxCandidates)}`,
    },
  ];
  return (
    <>
      {report.frozen && (
        <Banner tone="warn">
          STOP 冻结中：不会注入经验、不会晋升候选、不会写技能候选；可在「治理」里解除冻结。
        </Banner>
      )}
      {props.actionError !== undefined && <p className="sp-note err" role="alert">{props.actionError}</p>}
      <SettingsSection title="证据">
        <SettingsRow label="记录总数">
          <Badge>{String(episodes.total)} 条</Badge>
        </SettingsRow>
        <SettingsRow label="结果分布">
          <CountChips items={[
            { key: "成功", value: episodes.byOutcome.success },
            { key: "失败", value: episodes.byOutcome.failure },
            { key: "未分类", value: episodes.byOutcome.unknown },
          ]} />
        </SettingsRow>
        <SettingsRow label="自校验">
          <CountChips items={[
            { key: "绿", value: episodes.byVerify.green },
            { key: "红", value: episodes.byVerify.red },
            { key: "无", value: episodes.byVerify.none },
          ]} />
        </SettingsRow>
        <SettingsRow label="未知面">
          <CountChips items={[
            // 2026-11-02：界面说人话（判分/自校验/用户反馈），原始 judge/verify/user 仍留在技术详情。
            { key: "判分未测", value: episodes.unknownReasons.judge },
            { key: "自校验未跑", value: episodes.unknownReasons.verify },
            { key: "用户反馈未测", value: episodes.unknownReasons.user },
          ]} />
        </SettingsRow>
        <SettingsRow label="成本">
          <CountChips items={[
            { key: "主面", value: episodes.cost.mainTokens, unit: "token" },
            { key: "子代理", value: episodes.cost.workerTokens, unit: "token" },
          ]} />
        </SettingsRow>
        <SettingsRow label="计价">
          <CountChips items={[
            { key: "可定价", value: episodes.cost.pricedRuns },
            { key: "不可定价", value: episodes.cost.unpricedRuns },
          ]} />
        </SettingsRow>
        <TechDetails lines={rawLines} />
      </SettingsSection>

      <SettingsSection title="经验沉淀" hint="候选不注入">
        <SettingsRow label="条目总数">
          <Badge>{String(playbook.total)} 条</Badge>
        </SettingsRow>
        <SettingsRow label="状态">
          <CountChips items={countEntries(playbook.byStatus).map(([key, value]) => ({ key: STATUS_LABEL[key] ?? key, value }))} />
        </SettingsRow>
        <SettingsRow label="类型">
          <CountChips items={countEntries(playbook.byKind).map(([key, value]) => ({ key: KIND_LABEL[key] ?? key, value }))} />
        </SettingsRow>
        <SettingsRow label="需要处理" desc="冲突、过期、负证据与过门可激活的条目。">
          <CountChips items={[
            { key: "冲突", value: playbook.conflicts },
            { key: "过期", value: playbook.expired },
            { key: "负证据", value: playbook.negative },
            { key: "可激活", value: playbook.activatable.length },
            { key: "坏行", value: playbook.badLines },
            { key: "拒单", value: playbook.refusals },
          ]} />
          <Badge tone={playbook.conflicts === 0 ? "ok" : "neutral"}>{playbook.conflicts === 0 ? "无冲突" : "有冲突"}</Badge>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="可激活经验" hint={report.frozen ? "冻结中" : "人工确认后生效"}>
        {report.activationCandidates.length === 0
          ? <p className="sp-note">没有过门候选（需要对照组实验证据）。</p>
          : report.activationCandidates.map((candidate) => (
            <SettingsRow
              key={candidate.id}
              label={candidate.body.length > 80 ? candidate.body.slice(0, 80) + "…" : candidate.body}
            >
              <Badge tone="ok">
                {KIND_LABEL[candidate.kind] ?? candidate.kind} · 风险差 {candidate.riskDiff === null ? "—" : candidate.riskDiff.toFixed(2)}
                {" · "}{String(candidate.trials)} 场 · 证据 {String(candidate.evidence)}
              </Badge>
              {props.onActivate !== undefined && !report.frozen && (
                <button
                  type="button"
                  className="mini-btn"
                  disabled={props.activateBusyId === candidate.id}
                  aria-label={"激活经验 " + candidate.id}
                  onClick={() => { setActivateTarget(candidate.id); }}
                >{props.activateBusyId === candidate.id ? "写入中…" : "激活"}</button>
              )}
            </SettingsRow>
          ))}
      </SettingsSection>

      <SettingsSection title="负证据经验" hint={report.frozen ? "冻结中" : "人工确认后转 dormant"}>
        {report.negativeCandidates.length === 0
          ? <p className="sp-note">没有达到负证据门的 active 经验。</p>
          : report.negativeCandidates.map((candidate) => (
            <SettingsRow
              key={candidate.id}
              label={candidate.body.length > 80 ? candidate.body.slice(0, 80) + "…" : candidate.body}
            >
              <Badge tone="neutral">
                {candidate.kind} · 观测 {String(candidate.successes)}/{String(candidate.trials)}
              </Badge>
              {props.onDormant !== undefined && !report.frozen && (
                <button
                  type="button"
                  className="mini-btn"
                  disabled={props.dormantBusyId === candidate.id}
                  aria-label={"转休眠 " + candidate.id}
                  onClick={() => { setDormantTarget(candidate.id); }}
                >{props.dormantBusyId === candidate.id ? "写入中…" : "转休眠"}</button>
              )}
            </SettingsRow>
          ))}
      </SettingsSection>

      <SettingsSection
        title="全局经验"
        hint={report.global.frozen ? "全局 STOP 冻结中" : "owner 晋升 · 跨 workspace"}
      >
        {report.global.total === 0
          ? <p className="sp-note">没有全局经验。</p>
          : report.global.entries.map((entry) => {
            const finding = report.global.findings.find((item) => item.id === entry.id);
            const observation = "本库观测 " + String(entry.successes) + "/" + String(entry.trials)
              + "；证据库观测 " + String(entry.evidenceSuccesses) + "/" + String(entry.evidenceTrials);
            return (
              <SettingsRow
                key={entry.id}
                label={entry.body.length > 80 ? entry.body.slice(0, 80) + "…" : entry.body}
                desc={finding === undefined
                  ? observation
                  : observation + "；" + findingLabel(finding.reason) + "：" + finding.detail}
              >
                <Badge tone={entry.status === "active" && finding === undefined ? "ok" : "neutral"}>
                  {entry.kind} · {entry.status} · {String(entry.workspaces)} 库 / {String(entry.evidence)} 证据
                </Badge>
                {props.onRevokeGlobal !== undefined && entry.status === "active" && !report.global.frozen && (
                  <button
                    type="button"
                    className="mini-btn"
                    disabled={props.globalBusyId === entry.id}
                    aria-label={"撤销全局经验 " + entry.id}
                    onClick={() => { setRevokeTarget(entry.id); }}
                  >{props.globalBusyId === entry.id ? "撤销中…" : "撤销"}</button>
                )}
                {props.onRestoreGlobal !== undefined && entry.status === "dormant" && !report.global.frozen && (
                  <button
                    type="button"
                    className="mini-btn"
                    disabled={props.restoreBusyId === entry.id}
                    aria-label={"恢复全局经验 " + entry.id}
                    onClick={() => { setRestoreTarget(entry.id); }}
                  >{props.restoreBusyId === entry.id ? "恢复中…" : "恢复"}</button>
                )}
              </SettingsRow>
            );
          })}
        {report.global.badLines > 0 && (
          <p className="sp-note err" role="alert">
            全局账坏行 {String(report.global.badLines)} 条（已跳过；账本保留）
          </p>
        )}
        <SettingsRow
          label={report.global.frozen ? "全局已冻结（STOP）" : "全局未冻结"}
          desc={report.global.frozen
            ? "所有 workspace 的全局经验停止注入与撤销；解冻后恢复。"
            : "冻结会立即停止所有 workspace 的全局经验注入与撤销；随时可解冻。"}
        >
          {props.onSetGlobalFrozen !== undefined && (
            <button
              type="button"
              className="mini-btn"
              disabled={props.globalFrozenBusy === true}
              aria-label={report.global.frozen ? "解除全局冻结" : "冻结全局经验"}
              onClick={() => { setConfirmGlobalFreeze(true); }}
            >{props.globalFrozenBusy === true ? "写入中…" : report.global.frozen ? "解冻" : "冻结"}</button>
          )}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="快环提醒" hint="Episode 证据">
        <SettingsRow label={`${String(report.nudges.episodes)} 场 · ${String(report.nudges.ids)} 条经验`}>
          <Badge tone={report.nudges.episodes === 0 ? "neutral" : "ok"}>
            {report.nudges.episodes === 0 ? "无命中" : "有命中"}
          </Badge>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="实验" hint="passed 只建议晋升">
        {report.experiments.length === 0
          ? <p className="sp-note">还没有实验。</p>
          : report.experiments.map((experiment) => (
            <SettingsRow
              key={experiment.id}
              label={experiment.id}
              desc={`${experiment.candidateRef} · control ${String(experiment.nControl)} / treatment ${String(experiment.nTreatment)}`}
            >
              <Badge tone={experiment.analysisStatus === "passed" ? "ok" : "neutral"}>
                {experiment.analysisStatus ?? experiment.status}
                {experiment.decision === null ? "" : " · " + experiment.decision}
              </Badge>
            </SettingsRow>
          ))}
      </SettingsSection>

      <SettingsSection title="候选" hint="无 holdout 不晋升">
        <SettingsRow label="候选总数">
          <CountChips items={[
            { key: "合计", value: report.candidates.total },
            ...countEntries(report.candidates.byStatus).map(([key, value]) => ({ key: CANDIDATE_STATUS_LABEL[key] ?? key, value })),
          ]} />
          <Badge tone="neutral">档案</Badge>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="预算" hint={budgetSource(report.budget.source)}>
        <SettingsRow
          label="注入"
          desc={`最多 ${String(report.budget.budget.maxInjectedEntries)} 条 / ${String(report.budget.budget.maxInjectedChars)} 字符`}
        >
          <Badge tone="neutral">每次装配</Badge>
        </SettingsRow>
        <SettingsRow label="容量">
          <CountChips items={[
            { key: "经验容量", value: report.budget.budget.maxPlaybookEntries },
            { key: "实验", value: report.budget.budget.maxExperiments },
            { key: "候选", value: report.budget.budget.maxCandidates },
          ]} />
          <Badge tone="neutral">上限</Badge>
        </SettingsRow>
        {report.budget.detail !== null && <p className="sp-note">{report.budget.detail}</p>}
      </SettingsSection>

      <SettingsSection title="治理" hint="人工开关">
        <SettingsRow
          label={report.frozen ? "已冻结（STOP）" : "未冻结"}
          desc={report.frozen
            ? "不注入经验、不晋升候选、不写技能候选；解冻后恢复。"
            : "冻结会立即停止经验注入、候选晋升与技能候选写入；随时可解冻。"}
        >
          {props.onSetFrozen !== undefined && (
            <button
              type="button"
              className="mini-btn"
              disabled={props.frozenBusy === true}
              aria-label={nextFrozen ? "冻结进化" : "解除进化冻结"}
              onClick={() => { setConfirmFreeze(true); }}
            >{props.frozenBusy === true ? "写入中…" : nextFrozen ? "冻结" : "解冻"}</button>
          )}
        </SettingsRow>
      </SettingsSection>

      {dormantTarget !== null && props.onDormant !== undefined && (() => {
        const candidate = report.negativeCandidates.find((item) => item.id === dormantTarget);
        if (candidate === undefined) return null;
        return (
          <ConfirmDialog
            title="把这条经验转休眠？"
            note={"转 dormant 后基线注入与快环都不再用它；观测 "
              + String(candidate.successes) + "/" + String(candidate.trials)
              + " 场成功。需要时可经激活门重新回到 active。\n" + candidate.body}
            confirmLabel="转休眠"
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
            title="激活这条经验？"
            note={"激活后基线注入会使用它（对照组 riskDiff "
              + (candidate.riskDiff === null ? "—" : candidate.riskDiff.toFixed(2))
              + "，" + String(candidate.trials) + " 场，证据 " + String(candidate.evidence) + " 条）。\n"
              + candidate.body}
            confirmLabel="激活"
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
          title={report.global.frozen ? "解除全局冻结？" : "冻结全局经验？"}
          note={report.global.frozen
            ? "解除后所有 workspace 恢复全局经验注入与撤销。"
            : "冻结后所有 workspace 的全局经验停止注入，也不能撤销；局部经验与 workspace STOP 不受影响。随时可解冻。"}
          confirmLabel={report.global.frozen ? "解除冻结" : "冻结"}
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
            title="恢复这条全局经验？"
            note={"恢复前会复核 ≥3 个 workspace 的存储证据；失效会拒绝并保持 dormant。\n" + entry.body}
            confirmLabel="恢复"
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
            title="撤销这条全局经验？"
            note={"撤销后所有 workspace 都不再注入它；全局账保留 dormant 记录，需要时可重新评估。\n" + entry.body}
            confirmLabel="撤销"
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
          title={nextFrozen ? "冻结进化？" : "解除进化冻结？"}
          note={nextFrozen
            ? "冻结后不会注入经验、不会晋升候选、不会写技能候选；证据与报告只读保留。随时可解冻。"
            : "解除后恢复经验注入、候选晋升与技能候选写入。"}
          confirmLabel={nextFrozen ? "冻结" : "解除冻结"}
          onClose={() => { setConfirmFreeze(false); }}
          onConfirm={() => { setConfirmFreeze(false); props.onSetFrozen?.(nextFrozen); }}
        />
      )}
    </>
  );
}
