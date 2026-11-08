// 进化分区判卷（Cairn Evolve · P5）：只读快照、冻结态、三态与导航接线。
// 不依赖真实 IPC：EvolvePanel 是纯展示组件；容器只做取数与重试。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EvolveReport } from "../../../src/main/ipc-protocol";
import { EvolvePanel, type EvolvePanelState } from "../src/renderer/components/settings/EvolvePanel";
import { SECTIONS } from "../src/renderer/components/settings-nav";
import { STR } from "../src/renderer/strings";

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

  it("证据/经验：计数改成人读的行与小片；原始串只在「技术详情」折叠里（默认收起）", () => {
    const h = html({ status: "ready", report });
    // 一行一个短标签 + 一句白话（不是一串拼出来的计数）
    // 2026-11-02：界面不再出现 Episode/worker/playbook 等英文术语（原始串仍在技术详情）。
    expect(h).toContain("记录总数");
    expect(h).toContain("结果分布");
    expect(h).toContain("自校验");
    expect(h).toContain("未知面");
    expect(h).toContain("成本");
    expect(h).toContain("计价");
    expect(h).toContain("条目总数");
    expect(h).toContain("需要处理");
    expect(h).toContain("候选总数");
    expect(h).toContain("容量");
    // 让布局说话（2026-11-04）：行标签 + 计数小片已经自明，不再挂复述标签的小字与修饰徽章。
    for (const s of ["只读快照", "每次运行留一条记录", "每条记录自带的校验结果", "缺的是哪一环", "各花了多少 token", "不折成成功", "记录值"]) {
      expect(h, s).not.toContain(s);
    }
    // 计数小片：一格一个数
    expect(h).toContain('class="sp-chip"');
    expect(h).toContain('<span class="sp-chip-k">成功</span><span class="sp-chip-v">1</span>');
    expect(h).toContain('<span class="sp-chip-k">失败</span><span class="sp-chip-v">0</span>');
    expect(h).toContain('<span class="sp-chip-k">未分类</span><span class="sp-chip-v">1</span>');
    // 折叠：默认收起（<details> 不带 open），原始串原样在里面
    const tech = h.match(/<details class="sp-tech">[\s\S]*?<\/details>/);
    expect(tech).not.toBeNull();
    const block = tech?.[0] ?? "";
    expect(block).toContain("技术详情");
    expect(block).toContain("success 1 / failure 0 / unknown 1；verify green 1 / red 0 / none 1");
    expect(block).toContain("judge 未测 2；verify 未跑 1；user 未测 2");
    expect(block).toContain("主面 10 token；worker 0；可定价 0 / 不可定价 2");
    expect(block).toContain("状态：active×1、candidate×1；类型：strategy×1、warning×1；冲突 0；过期 0；负证据 1；可激活 1（exp_0123456789abcdef）；坏行 0；拒单 0");
    expect(block).toContain("状态：passed×1");
    expect(block).toContain("playbook 200；实验 20；候选 200");
    // 默认版面（折叠之外）不再出现原始串
    const outside = h.replace(block, "");
    expect(outside).not.toContain("success 1 / failure 0");
    expect(outside).not.toContain("judge 未测 2；");
    expect(outside).not.toContain("主面 10 token；");
    expect(outside).not.toContain("状态：active×1");
    expect(outside).not.toContain("状态：passed×1");
    expect(outside).not.toContain("playbook 200；实验 20；候选 200");
    // 折叠落在「证据」分区末尾：下一个分区之前
    expect(h.indexOf("技术详情")).toBeGreaterThan(-1);
    // 2026-11-02：分区名从「经验 playbook」改为「经验沉淀」（界面说人话；原始串仍在技术详情里）。
    expect(h.indexOf("技术详情")).toBeLessThan(h.indexOf("经验沉淀"));
    // 默认版面不许出现英文键（判分/自校验/用户反馈、状态与类型均已中文化）。
    expect(outside).not.toContain("judge 未测");
    expect(outside).not.toContain("candidate 2");
    expect(outside).not.toContain("lesson 4");
    // 分区线靠 .ss-content 包裹才生效（此前进化页少这一层 ⇒ 分区之间没有细线）
    expect(h).toContain("ss-content");
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
    // 2026-11-07 strings 整批收编：确认对话框文案进 STR.evolve（源文引 STR；值面钉在这里，六个确认 + 横幅）。
    expect(panelFile).toContain("STR.evolve.evolveFreezeTitle");
    expect(panelFile).toContain("STR.evolve.evolveUnfreezeTitle");
    expect(panelFile).toContain("STR.evolve.revokeConfirmTitle");
    expect(panelFile).toContain("STR.evolve.restoreConfirmTitle");
    expect(panelFile).toContain("STR.evolve.freezeGlobalTitle");
    expect(panelFile).toContain("STR.evolve.unfreezeGlobalTitle");
    expect(STR.evolve.evolveFreezeTitle).toBe("冻结进化？");
    expect(STR.evolve.evolveUnfreezeTitle).toBe("解除进化冻结？");
    expect(STR.evolve.revokeConfirmTitle).toBe("撤销这条全局经验？");
    expect(STR.evolve.restoreConfirmTitle).toBe("恢复这条全局经验？");
    expect(STR.evolve.freezeGlobalTitle).toBe("冻结全局经验？");
    expect(STR.evolve.unfreezeGlobalTitle).toBe("解除全局冻结？");
    expect(STR.evolve.frozenBanner).toContain("不会写技能候选");
  });
});
