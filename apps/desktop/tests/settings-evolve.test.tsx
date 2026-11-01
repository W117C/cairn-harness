// 进化分区判卷（Cairn Evolve · P5）：只读快照、冻结态、三态与导航接线。
// 不依赖真实 IPC：EvolvePanel 是纯展示组件；容器只做取数与重试。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EvolveReport } from "../../../src/main/ipc-protocol";
import { EvolvePanel, type EvolvePanelState } from "../src/renderer/components/settings/EvolvePanel";
import { SECTIONS } from "../src/renderer/components/settings-nav";

const report: EvolveReport = {
  v: 1,
  ts: Date.UTC(2026, 9, 27, 2, 0, 0),
  workspace: "/w",
  frozen: true,
  budget: {
    budget: { maxPlaybookEntries: 200, maxInjectedEntries: 6, maxInjectedChars: 2_000, maxExperiments: 20, maxCandidates: 200 },
    source: "default",
    detail: null,
  },
  episodes: {
    v: 1,
    total: 2,
    duplicates: 0,
    badLines: 0,
    byOutcome: { success: 1, failure: 0, unknown: 1 },
    byClass: { debug: 2 },
    byVerify: { green: 1, red: 0, none: 1 },
    unknownReasons: { judge: 2, verify: 1, user: 2 },
    cost: { mainTokens: 10, workerTokens: 0, requests: 1, pricedRuns: 0, unpricedRuns: 2 },
    lastTs: 1_000,
  },
  playbook: {
    total: 2,
    byStatus: { active: 1, candidate: 1 },
    byKind: { warning: 1, strategy: 1 },
    conflicts: 0,
    expired: 0,
    negative: 1,
    activatable: ["exp_0123456789abcdef"],
    badLines: 0,
    refusals: 0,
  },
  nudges: { episodes: 2, ids: 1, byId: { exp_0123456789abcdef: 2 } },
  activationCandidates: [{
    id: "exp_0123456789abcdef",
    kind: "warning",
    body: "候选正文：先复现再改",
    riskDiff: 0.7,
    trials: 20,
    evidence: 10,
  }],
  negativeCandidates: [{
    id: "exp_fedcba9876543210",
    kind: "strategy",
    body: "负证据正文：一直失败的做法",
    trials: 5,
    successes: 1,
  }],
  global: {
    frozen: false,
    total: 1,
    byStatus: { active: 1 },
    badLines: 0,
    refusals: 0,
    findings: [{
      id: "exp_glo123456789abcdef",
      reason: "negative",
      detail: "观测 0/5（成功率 0% ≤ 20%）——建议 dormant",
    }],
    entries: [{
      id: "exp_glo123456789abcdef",
      status: "active",
      kind: "strategy",
      body: "全局正文：跨项目适用",
      evidence: 3,
      workspaces: 3,
      trials: 5,
      successes: 0,
      evidenceTrials: 0,
      evidenceSuccesses: 0,
    }],
  },
  experiments: [{
    id: "ex1",
    status: "running",
    candidateRef: "exp_0123456789abcdef",
    analysisStatus: "passed",
    decision: "suggest-promote",
    nControl: 10,
    nTreatment: 10,
  }],
  candidates: { total: 1, byStatus: { passed: 1 } },
};

function html(state: EvolvePanelState, extra: {
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
} = {}): string {
  return renderToStaticMarkup(<EvolvePanel state={state} onRetry={() => undefined} {...extra} />);
}

describe("EvolvePanel", () => {
  it("ready：显示证据/经验/实验/候选/预算，冻结态显式", () => {
    const h = html({ status: "ready", report });
    expect(h).toContain("进化");
    expect(h).toContain("STOP 冻结中");
    expect(h).toContain("Episode");
    expect(h).toContain("2 条");
    expect(h).toContain("ex1");
    expect(h).toContain("suggest-promote");
    expect(h).toContain("passed");
    expect(h).toContain("无 holdout 不晋升");
    expect(h).toContain("缺省");
    expect(h).toContain("负证据");
    expect(h).toContain("可激活");
    expect(h).toContain("快环提醒");
    expect(h).toContain("2 场 · 1 条经验");
    expect(h).toContain("可激活经验");
    expect(h).toContain("候选正文：先复现再改");
    expect(h).toContain("负证据经验");
    expect(h).toContain("负证据正文：一直失败的做法");
    expect(h).toContain("观测 1/5");
    expect(h).toContain("全局经验");
    expect(h).toContain("全局正文：跨项目适用");
    expect(h).toContain("3 库 / 3 证据");
    expect(h).toContain("本库观测 0/5");
    expect(h).toContain("证据库观测 0/0");
    expect(h).toContain("负证据（本库+证据库）：观测 0/5");
    expect(h).not.toContain('aria-label="撤销全局经验');
    expect(h).not.toContain('aria-label="激活经验');
    expect(h).not.toContain('aria-label="转休眠');
  });

  it("可激活候选：给了 onActivate 且未冻结才有激活按钮", () => {
    const unfrozen = { ...report, frozen: false };
    const withAction = html({ status: "ready", report: unfrozen }, { onActivate: () => undefined });
    expect(withAction).toContain('aria-label="激活经验 exp_0123456789abcdef"');
    expect(withAction).toContain("激活");
    expect(html({ status: "ready", report: unfrozen })).not.toContain('aria-label="激活经验');
    expect(html({ status: "ready", report }, { onActivate: () => undefined })).not.toContain('aria-label="激活经验');

    const dormant = html({ status: "ready", report: unfrozen }, { onDormant: () => undefined });
    expect(dormant).toContain('aria-label="转休眠 exp_fedcba9876543210"');
    expect(html({ status: "ready", report }, { onDormant: () => undefined })).not.toContain('aria-label="转休眠');
  });

  it("全局经验：给了 onRevokeGlobal 且全局未冻结才有撤销；全局 STOP 显式且挡按钮", () => {
    const globalOpen = { ...report, global: { ...report.global, frozen: false } };
    const withAction = html({ status: "ready", report: globalOpen }, { onRevokeGlobal: () => undefined });
    // 夹具 report.frozen=true：workspace STOP 不挡全局撤销，只有 global.frozen 挡。
    expect(report.frozen).toBe(true);
    expect(withAction).toContain('aria-label="撤销全局经验 exp_glo123456789abcdef"');
    expect(html({ status: "ready", report: globalOpen })).not.toContain('aria-label="撤销全局经验');

    const globalFrozen = { ...globalOpen, global: { ...globalOpen.global, frozen: true } };
    const frozenHtml = html({ status: "ready", report: globalFrozen }, { onRevokeGlobal: () => undefined });
    expect(frozenHtml).toContain("全局 STOP 冻结中");
    expect(frozenHtml).not.toContain('aria-label="撤销全局经验');

    const busy = html(
      { status: "ready", report: globalOpen },
      { onRevokeGlobal: () => undefined, globalBusyId: "exp_glo123456789abcdef" },
    );
    expect(busy).toContain("撤销中…");

    const dormantGlobal = {
      ...globalOpen,
      global: {
        ...globalOpen.global,
        total: 2,
        byStatus: { active: 1, dormant: 1 },
        entries: [
          ...globalOpen.global.entries,
          {
            id: "exp_gloDormant", status: "dormant", kind: "warning",
            body: "全局休眠正文", evidence: 2, workspaces: 2, trials: 0, successes: 0,
            evidenceTrials: 0, evidenceSuccesses: 0,
          },
        ],
      },
    };
    const dormantHtml = html({ status: "ready", report: dormantGlobal }, { onRevokeGlobal: () => undefined });
    expect(dormantHtml).toContain("全局休眠正文");
    expect(dormantHtml).not.toContain('aria-label="撤销全局经验 exp_gloDormant');
  });

  it("全局冻结：给了 onSetGlobalFrozen 才有按钮；冻结态挡撤销、按钮变解冻", () => {
    const open = { ...report, global: { ...report.global, frozen: false, findings: [] } };
    const withAction = html({ status: "ready", report: open }, { onSetGlobalFrozen: () => undefined });
    expect(withAction).toContain('aria-label="冻结全局经验"');
    expect(html({ status: "ready", report: open })).not.toContain('aria-label="冻结全局经验');

    const frozen = { ...open, global: { ...open.global, frozen: true } };
    const frozenHtml = html({ status: "ready", report: frozen }, { onSetGlobalFrozen: () => undefined });
    expect(frozenHtml).toContain('aria-label="解除全局冻结"');
    expect(frozenHtml).toContain("全局 STOP 冻结中");
    expect(frozenHtml).not.toContain('aria-label="撤销全局经验');

    const busy = html(
      { status: "ready", report: open },
      { onSetGlobalFrozen: () => undefined, globalFrozenBusy: true },
    );
    expect(busy).toContain("写入中…");
  });

  it("全局恢复：dormant 条目给 onRestoreGlobal 才有按钮；冻结时隐藏；active 不出恢复", () => {
    const dormant = {
      id: "exp_gloDormant", status: "dormant", kind: "warning",
      body: "全局休眠正文", evidence: 2, workspaces: 2, trials: 0, successes: 0,
      evidenceTrials: 0, evidenceSuccesses: 0,
    };
    const dormantReport = {
      ...report,
      global: {
        ...report.global,
        frozen: false,
        total: 2,
        byStatus: { active: 1, dormant: 1 },
        findings: [],
        entries: [...report.global.entries, dormant],
      },
    };
    const h = html({ status: "ready", report: dormantReport }, { onRestoreGlobal: () => undefined });
    expect(h).toContain('aria-label="恢复全局经验 exp_gloDormant"');
    expect(h).not.toContain('aria-label="恢复全局经验 exp_glo123456789abcdef"');
    expect(html({ status: "ready", report: dormantReport })).not.toContain('aria-label="恢复全局经验');

    const frozen = { ...dormantReport, global: { ...dormantReport.global, frozen: true } };
    const frozenHtml = html({ status: "ready", report: frozen }, { onRestoreGlobal: () => undefined });
    expect(frozenHtml).not.toContain('aria-label="恢复全局经验');
    expect(frozenHtml).toContain("全局已冻结（STOP）");

    const busy = html(
      { status: "ready", report: dormantReport },
      { onRestoreGlobal: () => undefined, restoreBusyId: "exp_gloDormant" },
    );
    expect(busy).toContain("恢复中…");
  });

  it("治理：运行旗区展示冻结态；给了 onSetFrozen 才有按钮（冻结/解冻按状态变）", () => {
    const frozenNoAction = html({ status: "ready", report });
    expect(frozenNoAction).toContain("治理");
    expect(frozenNoAction).toContain("已冻结（STOP）");
    expect(frozenNoAction).not.toContain('aria-label="解除进化冻结"');
    const frozen = html({ status: "ready", report }, { onSetFrozen: () => undefined });
    expect(frozen).toContain('aria-label="解除进化冻结"');
    const notFrozen = html({ status: "ready", report: { ...report, frozen: false } }, { onSetFrozen: () => undefined });
    expect(notFrozen).toContain("未冻结");
    expect(notFrozen).toContain('aria-label="冻结进化"');
    const busy = html({ status: "ready", report }, { onSetFrozen: () => undefined, frozenBusy: true });
    expect(busy).toContain("写入中…");
  });

  it("loading 与 error 各自说清；error 带重试", () => {
    expect(html({ status: "loading" })).toContain("正在读取进化报告");
    const failed = html({ status: "error", error: "读不动 .agent/evolve" });
    expect(failed).toContain("读取失败");
    expect(failed).toContain("重试");
    expect(failed).toContain('role="alert"');
  });

  it("导航有「进化」，面板在，容器调 evolveReport", () => {
    expect(SECTIONS.some((section) => section.id === "evolve")).toBe(true);
    expect(SECTIONS.find((section) => section.id === "evolve")?.label).toBe("进化");
    const sectionSrc = readFileSync(fileURLToPath(new URL("../src/renderer/components/settings/EvolveSection.tsx", import.meta.url)), "utf8");
    expect(sectionSrc).toContain("window.agent.evolveReport()");
    expect(sectionSrc).toContain("window.agent.evolveSetFrozen(frozen)");
    expect(sectionSrc).toContain("window.agent.evolveActivate(id)");
    expect(sectionSrc).toContain("window.agent.evolveDormant(id)");
    expect(sectionSrc).toContain("window.agent.evolveGlobalRevoke(id)");
    expect(sectionSrc).toContain("window.agent.evolveGlobalActivate(id)");
    expect(sectionSrc).toContain("window.agent.evolveGlobalSetFrozen(frozen)");
    const panelSrc = readFileSync(fileURLToPath(new URL("../src/renderer/components/SettingsPanel.tsx", import.meta.url)), "utf8");
    expect(panelSrc).toContain('section === "evolve"');
    expect(panelSrc).toContain("<EvolveSection />");
    const panelFile = readFileSync(fileURLToPath(new URL("../src/renderer/components/settings/EvolvePanel.tsx", import.meta.url)), "utf8");
    expect(panelFile).toContain("冻结进化？");
    expect(panelFile).toContain("解除进化冻结？");
    expect(panelFile).toContain("撤销这条全局经验？");
    expect(panelFile).toContain("恢复这条全局经验？");
    expect(panelFile).toContain("冻结全局经验？");
    expect(panelFile).toContain("解除全局冻结？");
    expect(panelFile).toContain("不会写技能候选");
  });
});
