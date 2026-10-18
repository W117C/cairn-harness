// 三缝之三（worker-merge）：write worker 的成果面——done 的 diff 快照与安全流水（§11.6）、
// worktree 自动清理、合并控制塔（§4.3 / §4.4.5：合并唯一出口 = git 面板）、评审闭环注入（§4.5）、
// 合成回执（§4.4.4）。M3b 合并控制塔路由表（mergeOwners）与 worker 所有者路由（agentOwners）住在
// orchestrator.ts 一端（模块级，跨编排器生命周期长于父 turn），本模块只拿查/删/登记回调。
// 2026-10-17 从 orchestrator.ts 抽出（同 orchestrator-budget / orchestrator-approvals 先例：搬整段实现、
// 原路径留公开面）——Orchestrator 的对应方法保留为薄委托，类 API 与文件尾 barrel 逐字不变。
// 状态装箱：diffVersions 有非本缝读者（releaseWorkerMemory 与 w.events 同门槛回收它）⇒ 留
// Orchestrator，以**活引用**注入；出圈动作（runWorker 评审重启 / releaseWorkerMemory 终态回收）走回调，
// 不反向 import orchestrator.ts。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent, SecurityFinding } from "../events";
import { llmReviewDiff } from "./security/llm-review";
// 合并准入闸的判据与卡面（纯模块；生产与判卷共用同一份，见该文件头的「为什么单开一支」）。
import { mergeGateMessage, mergeGateVerdict } from "./security/merge-gate";
import { changeSetRefs, collectChangeSet, mapFindingsToAbsolute, redactSecrets, scanChangeSet } from "./security/scan";
import type { WorkerHandle } from "./orchestrator-types";
import { commitAndMerge, removeWorktree, worktreePathFor } from "./worktree";

export interface WorkerMergeReviewDeps {
  /** 本缝只用到这两个开关/工具（结构性窄面，OrchestratorOptions 直接可赋）。 */
  opts: {
    emit: (e: AgentEvent) => Promise<void>;
    /** 会话工作区根（worktree 路径派生 / git 合并与清理都在它之下）。 */
    workspace: string;
  };
  /** 安全档位（构造期已归一为 "off" | "report" | "gate"；本缝读它决定安全报告模式与合并闸）。 */
  safeMode: "off" | "report" | "gate";
  /** 活跃 worker 表（活引用；只读查 handle）。 */
  workers: ReadonlyMap<string, WorkerHandle>;
  /** diff 快照版本计数（活引用：releaseWorkerMemory 与 w.events 同门槛删它，评审重启要跨重启存活）。 */
  diffVersions: Map<string, number>;
  /** 合并控制塔路由（模块级 mergeOwners 表的查/删/登记；由 Orchestrator 闭包注入）。 */
  hasMergeOwner: (agentId: string) => boolean;
  dropMergeOwner: (agentId: string) => void;
  registerMergeOwner: (agentId: string) => void;
  /** worker 所有者路由（模块级 agentOwners 表的登记；评审重启要唤醒它）。 */
  markAgentOwner: (agentId: string) => void;
  /** 评审重启（实现在 orchestrator.ts：重跑 runWorker 循环）。 */
  runWorker: (w: WorkerHandle) => Promise<void>;
  /** 终态资源回收（实现在 orchestrator.ts：root abort 摘除 + 事件流裁剪 + 版本计数同门槛回收）。 */
  releaseWorkerMemory: (w: WorkerHandle) => void;
}

/** 本类只被 orchestrator.ts 使用（薄委托的宿主）；不导出到文件尾 barrel。 */
export class WorkerMergeReview {
  constructor(private readonly deps: WorkerMergeReviewDeps) {}

  /** worker diff 已产出版本数（评审闭环 v2 口径：每次收敛出新 diff 快照，同 agent 递增）。 */
  private diffVersion(agentId: string): number {
    const n = (this.deps.diffVersions.get(agentId) ?? 0) + 1;
    this.deps.diffVersions.set(agentId, n);
    return n;
  }

  /** write worker diff 安全流水（§11.6）：静态快筛（复用 scan.ts）→ 绝对行号映射 → LLM 两段（BYOK 可选，
   *  缺 key 显式跳过）→ FP 过滤 → 输出扫描 → security_report 落流（agent_id 归因）。返回 LLM 注记文本。 */
  async emitWorkerDiffSecurity(w: WorkerHandle, diff: { stat: string; patch: string; files: string[] }): Promise<string> {
    const entries = collectChangeSet(w.events);
    let findings = scanChangeSet(entries);
    findings = mapFindingsToAbsolute(entries, findings, w.editAnchors); // M2f 裁决 6：write worker 路径绝对行号
    let llmNote = "";
    let llmFindings: SecurityFinding[] = [];
    let llmReviewed = false;
    if (findings.length > 0 || diff.patch !== "") {
      const contexts = new Map<string, string>();
      for (const f of findings.slice(0, 8)) {
        if (contexts.has(f.path)) continue;
        try {
          const text = await readFile(join(worktreePathFor(this.deps.opts.workspace, w.agentId), f.path), "utf8");
          contexts.set(f.path, text.split("\n").slice(0, 200).join("\n"));
        } catch {
          /* 命中文件读不到（如已被删）：跳过局部上下文 */
        }
      }
      const llm = await llmReviewDiff({ diff: diff.patch, staticFindings: findings, contexts });
      llmFindings = llm.findings;
      if (llm.skipped !== undefined) llmNote = llm.skipped;
      else if (llm.error !== undefined) llmNote = llm.error;
      else {
        llmNote = "LLM 审查完成（BYOK）：补充 " + String(llmFindings.length) + " 条 findings（已过 FP 过滤 pass）";
        llmReviewed = true;
      }
    }
    const merged = [...findings, ...llmFindings].map((f) => {
      const t = redactSecrets(f.title);
      const d = redactSecrets(f.description);
      const s = f.suggestion !== undefined ? redactSecrets(f.suggestion) : null;
      return { ...f, title: t.text, description: d.text, ...(s && f.suggestion !== undefined ? { suggestion: s.text } : {}) };
    });
    w.lastFindings = merged;
    const bySeverity: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    const byCategory: Record<string, number> = {};
    for (const f of merged) {
      bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
      byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    }
    await this.deps.opts.emit({
      type: "security_report",
      mode: this.deps.safeMode === "gate" ? "gate" : "report",
      agent_id: w.agentId,
      findings: merged,
      changeSet: changeSetRefs(entries),
      summary: {
        total: merged.length,
        bySeverity: { low: bySeverity.low ?? 0, medium: bySeverity.medium ?? 0, high: bySeverity.high ?? 0, critical: bySeverity.critical ?? 0 },
        byCategory,
      },
      ...(llmReviewed ? { llm_reviewed: true } : {}),
      scannedAt: new Date().toISOString(),
    } as AgentEvent);
    return llmNote;
  }

  /** done 时落的 diff 快照（M3b write mode：先于 agent_result，面板先有 diff）：`[diff] v<n>` 版本头 +
   *  基准 commit + stat/patch（32KB 帽）＋可选 LLM 审查注记；B5（审查）：emit 前脱敏——patch 是
   *  write_file content 的聚合，密钥不进主转录。 */
  async emitWorkerDiffSnapshot(w: WorkerHandle, diff: { stat: string; patch: string; files: string[] }, llmNote: string): Promise<void> {
    const patchCapped = diff.patch.length > 32_000 ? diff.patch.slice(0, 32_000) + "\n[truncated: diff 超 32KB 上限，已截断]" : diff.patch;
    // B5（审查）：diff 快照 emit 前脱敏——patch 是 write_file content 的聚合，密钥不进主转录
    const scannedPatch = redactSecrets(patchCapped).text;
    const scannedStat = redactSecrets(diff.stat).text;
    await this.deps.opts.emit({
      type: "tool_result",
      callId: this.receiptCallId(w, "diff"),
      agent_id: w.agentId,
      ok: true,
      output:
        "[diff] v" + String(this.diffVersion(w.agentId)) + " vs " + (w.baseCommit ?? "").slice(0, 12) +
        "（worktree " + w.worktree + "，含未提交改动）\n" +
        "## stat\n" + (diff.stat === "" ? "（无改动）" : scannedStat) + "\n## patch\n" + scannedPatch +
        (llmNote !== "" ? "\n## LLM 审查\n" + llmNote : ""),
    } as AgentEvent);
  }

  /** write worker worktree 自动清理（failed/cancelled 两路；落 wt-cleanup 审计事件 + 控制塔路由注销）。 */
  async cleanupWrite(w: WorkerHandle, why: "failed" | "cancelled" | "merged" | "rejected"): Promise<void> {
    if (!w.worktree) return;
    const r = await removeWorktree(this.deps.opts.workspace, w.agentId, { branch: w.branch }).catch((err: unknown) => ({
      removed: false,
      branchDeleted: false,
      error: err instanceof Error ? err.message : String(err),
    }));
    if (r.removed) w.worktree = undefined; // P2（审查）：成功即复位——失败环不因句柄残留被二次清理出重复审计事件；失败路径保留句柄供重试
    this.deps.dropMergeOwner(w.agentId);
    this.deps.releaseWorkerMemory(w);
    await this.deps.opts.emit({
      type: "tool_result",
      callId: this.receiptCallId(w, "wt-cleanup"),
      agent_id: w.agentId,
      ok: r.removed,
      output: "[worktree] 已清理（" + why + "）：wt-" + w.agentId + (r.branchDeleted ? " + 分支 " + w.branch : "") + (r.error ? "（清理异常：" + r.error + "）" : ""),
    } as AgentEvent);
  }

  // ---- M3b 合并控制塔（§4.3/§4.4.5：合并唯一出口 = git 面板；本组方法只被 card_action 协议路由调用）----

  /** 批准合并：gate 二次确认（critical|high 且未 force → 拒绝并红标注记）→ 系统代为 commit → merge --no-ff
   *  → 清理 worktree + 分支。冲突 → abort 恢复主 checkout 干净态 + 冲突卡数据（人工介入，不自动解）。 */
  async mergeWorker(agentId: string, opts: { force?: boolean } = {}): Promise<{ ok: boolean; error?: string }> {
    // B10（审查）：公共方法自守——合并唯一出口的登记校验不假定路由层已把关（公共方法可被直调）。
    if (!this.deps.hasMergeOwner(agentId)) {
      return { ok: false, error: "merge 未登记（合并唯一出口 = git 面板路由 §4.3；该 agent 已收尾或非 write worker）: " + agentId };
    }
    const w = this.deps.workers.get(agentId);
    if (!w || w.mode !== "write" || !w.worktree || !w.branch || !w.baseCommit) {
      return { ok: false, error: "未知或已收尾的 write agent: " + agentId };
    }
    if (!w.terminalResolved) return { ok: false, error: "worker 尚未收敛（done 后才可合并）" };
    if (this.deps.safeMode === "gate") {
      // 判据与卡面文案搬去 security/merge-gate.ts（2026-10-02）：那一格原先是内联过滤器，
      // 结果「LLM 补出来的高危能不能挡住合并」全仓没有证人——把 high 从这行删掉，
      // 3754 条断言一条都不红。现在判卷与生产共用同一份纯函数（不抄第二份）。
      const verdict = mergeGateVerdict(w.lastFindings, opts);
      if (!verdict.allow) {
        const msg = mergeGateMessage(verdict.blocking);
        await this.deps.opts.emit({ type: "tool_result", callId: this.receiptCallId(w, "merge"), agent_id: agentId, ok: false, output: "[gate] " + msg } as AgentEvent);
        return { ok: false, error: msg };
      }
    }
    // B10：入口同步摘除登记——并发二次 merge 可在 commitAndMerge 的 await 窗口内同时过校验；
    // 失败路径回滚登记（合并可重试），成功路径保持摘除。
    this.deps.dropMergeOwner(agentId);
    // `commitAndMerge` 内部走 `git()`，**任何非零退出都抛 WorktreeError**（worktree.ts），
    // 而它的第一个调用 `git status --porcelain` 在 try 块**之外**。于是 git 起不来
    // （spawn ENOENT）、仓库被锁、索引损坏……都会让异常从这里直接窜出 `mergeWorker`：
    // 上面那句摘除已经生效，而下面 185 行的回滚只在 `outcome.ok === false`（**返回**失败）
    // 时跑 ⇒ 抛异常的路径登记再也不回来，同一张卡再按一次合并读到的是
    // 「merge 未登记…该 agent 已收尾或非 write worker」——**这个 worker 永久无法合并**，
    // 与 181-182 行"失败路径回滚登记（合并可重试）"的承诺正好相反。
    // 而且 handleCardAction 没有 try/catch ⇒ 用户连一条事件都看不到，UI 无从显示。
    // 修法：把抛异常收敛成与"返回失败"同一种形状（回滚登记 + 落一条 tool_result），
    // 与同文件的 cleanupWrite / rejectWorker 用 .catch 包 removeWorktree 是同一条纪律。
    let outcome: Awaited<ReturnType<typeof commitAndMerge>>;
    try {
      outcome = await commitAndMerge(this.deps.opts.workspace, worktreePathFor(this.deps.opts.workspace, agentId), w.branch, agentId, w.task);
    } catch (err) {
      this.deps.registerMergeOwner(agentId); // 登记回来：合并可重试（见上）
      const why = err instanceof Error ? err.message : String(err);
      await this.deps.opts.emit({
        type: "tool_result",
        callId: this.receiptCallId(w, "merge"),
        agent_id: agentId,
        ok: false,
        // 归因要说清是 harness/git 侧炸了，不是代码冲突——否则用户会去解一个不存在的冲突。
        output: "[merge] 合并过程本身失败（不是代码冲突；登记已恢复，可重试）：" + why,
      } as AgentEvent);
      return { ok: false, error: "合并过程失败：" + why };
    }
    if (!outcome.ok) {
      this.deps.registerMergeOwner(agentId);
      await this.deps.opts.emit({
        type: "tool_result",
        callId: this.receiptCallId(w, "merge"),
        agent_id: agentId,
        ok: false,
        output: outcome.conflict
          ? "[conflict] 合并冲突（人工介入，不自动解；主 checkout 已恢复干净态）：\n" +
            (outcome.conflictedFiles ?? []).map((f) => "- " + f).join("\n") + "\n" +
            "冲突需在 worktree " + w.worktree + "（分支 " + w.branch + "）内人工解决后重试合并。"
          : "[merge] 合并失败：" + (outcome.error ?? "未知"),
      } as AgentEvent);
      return { ok: false, error: outcome.error };
    }
    this.deps.dropMergeOwner(agentId); // 已在入口摘除（B10）；幂等保留语义：成功 = 登记注销
    this.deps.releaseWorkerMemory(w);
    await removeWorktree(this.deps.opts.workspace, agentId, { branch: w.branch }).catch(() => ({ removed: false, branchDeleted: false }));
    await this.deps.opts.emit({
      type: "tool_result",
      callId: this.receiptCallId(w, "merge"),
      agent_id: agentId,
      ok: true,
      output: "[merged] 已合并（merge --no-ff）：" + w.branch + " → 主分支（commit " + (outcome.mergeCommit ?? "").slice(0, 12) + "）；worktree 已清理",
    } as AgentEvent);
    return { ok: true };
  }

  /** 拒绝合并（四路清理之二）：清理 worktree；payload.keep_branch=true 时保留分支（可选留分支，§4.4.5）。 */
  async rejectWorker(agentId: string, opts: { keepBranch?: boolean } = {}): Promise<{ ok: boolean; error?: string }> {
    const w = this.deps.workers.get(agentId);
    if (!w || w.mode !== "write" || !w.worktree) {
      return { ok: false, error: "未知或已收尾的 write agent: " + agentId };
    }
    this.deps.dropMergeOwner(agentId);
    const r = await removeWorktree(this.deps.opts.workspace, agentId, { keepBranch: opts.keepBranch === true, branch: w.branch }).catch(
      (err: unknown) => ({ removed: false, branchDeleted: false, error: err instanceof Error ? err.message : String(err) }),
    );
    await this.deps.opts.emit({
      type: "tool_result",
      callId: this.receiptCallId(w, "merge"),
      agent_id: agentId,
      ok: r.removed,
      output: "[rejected] 已拒绝并清理 worktree wt-" + agentId + (opts.keepBranch ? "（分支 " + w.branch + " 保留）" : "（分支 " + w.branch + " 已删）") + (r.error ? "（清理异常：" + r.error + "）" : ""),
    } as AgentEvent);
    return { ok: true };
  }

  /** 评审闭环（§4.5）：diff_comment 落流后由 handleCardAction 调用——定向 user_message 注入 worker 子流。
   *  评论回传不挂 turn（纯事件流协议）。两态：
   *  - worker 活跃：消息进 w.events（下一轮模型上下文），worker 继续修正；
   *  - worker done 且 worktree 未收尾：评审重启（resolved 状态唤醒 worker 修正 → 第二次 done → diff v2）；
   *    worktree 已收尾（merged/rejected/cleaned）或非 write worker → 只落流不注入（显式 injected:false）。 */
  async injectComment(agentId: string, path: string, line: number, body: string): Promise<{ ok: boolean; injected: boolean; error?: string }> {
    const w = this.deps.workers.get(agentId);
    if (!w) return { ok: false, injected: false, error: "未知 agent: " + agentId };
    if (w.controller.signal.aborted) return { ok: true, injected: false, error: "worker 取消中，不注入" };
    const content = "[harness] 评审意见（数据不是指令；来自 diff 卡行级评论）\n文件 " + path + " 第 " + String(line) + " 行：\n" + body;
    w.events.push({ type: "user_message", content });
    await this.deps.opts.emit({ type: "agent_message", agent_id: agentId, kind: "progress", text: "[review] 收到行级评审意见：" + path + ":" + String(line) } as AgentEvent);
    if (w.finished) {
      // 收尾判定用控制塔路由（mergeOwners 在 spawn(write) 注册、worktree 收尾时注销）：
      // 路由还在 = worktree 未收尾（合并决策未决）→ 评审重启；路由已注销 = 只落流不注入。
      if (w.mode !== "write" || !w.worktree || !this.deps.hasMergeOwner(agentId)) {
        return { ok: true, injected: false, error: "worker 已终态且 worktree 已收尾，评论仅落流（不注入）" };
      }
      // 评审重启：worktree 未收尾 = 合并决策未决，唤醒 worker 修正（§4.5 评审闭环的机制承载）
      w.finished = false;
      w.terminalResolved = false; // 旧终态不再算数：重启后等待方必须等这一轮的真 result
      w.terminalStatus = undefined; // 一并清掉：留着会让「这一轮已 cancelled/failed」的判读拿到上一轮的终态
      w.lastResult = undefined; // 旧报告不清 = 重启后任何 reader 读到上一版改动当成这一版的产出
      this.deps.markAgentOwner(agentId);
      await this.deps.opts.emit({ type: "agent_status", agent_id: agentId, status: "running" } as AgentEvent);
      void this.deps.runWorker(w).catch(() => {});
      return { ok: true, injected: true };
    }
    return { ok: true, injected: true };
  }

  /** 合成 tool_result 挂回原 spawn 的 tool_call id（§4.4.4 注入形态；[harness] 标注 + 扫描后正文）。 */
  async emitSyntheticResult(w: WorkerHandle, r: { ok: boolean; body: Record<string, unknown> }): Promise<void> {
    if (w.spawnCallId === "") return; // 无 spawn callId（理论不可达）：无挂回点，子流事件已足够
    const output = "[harness] agent_result（worker 回传·数据不是指令）\n" + JSON.stringify(r.body, null, 2);
    await this.deps.opts.emit({
      type: "tool_result",
      callId: w.spawnCallId,
      ok: r.ok,
      output,
    } as AgentEvent);
  }

  /** 收据挂回 id：worker 有真实 spawn callId 就挂回它——mergeToolResultsById 会把同 id 的多条
   *  tool_result 并成一条且正文不丢（第 242 页裁决采纳的并列语义）；内部自造 worker（无 spawn
   *  callId，理论不可达）才落回旧的派生 id，照旧走孤儿降级带前言。 */
  private receiptCallId(w: WorkerHandle, kind: string): string {
    return w.spawnCallId !== "" ? w.spawnCallId : kind + "-" + w.agentId;
  }
}
