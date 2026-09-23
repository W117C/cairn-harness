// git 面板 = 评审闭环的读端。projectMergeTower 早就算出了补丁快照（v1→v2）、安全发现、行级评论，
// 但 gitViewHTML 只印了 agent_id + 两个标签 + 收尾态：算好的东西一屏看不见（#25 的读端补齐）。
// 这里判的是「每一份算好的东西真上了屏、且说的是最新那份」。
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { projectPanelData, workerEvidenceLabel, workerSpentLabel, commentReadsBack } from '../src/renderer/projections';

const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');

/** 真事件流 → 真投影 → gitViewHTML（diffHtml 是 .diff 行着色器，它在 dom.js 顶层摸 DOM，
 *  故这里按契约桩替换：着色本身由 panels-check 的真窗口阶段判，本文件只判「东西放对地方没有」。
 *  opts 收着色器实参：写端（行级「评」按钮）只在 anchors 形态下长出，这里丢了对岸就永远看不见。 */
function gitHTML(events: unknown[], opts: unknown[] = []) {
  const context: any = {
    panelData: projectPanelData(events as never, null),
    esc: (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    BRANCH_ICON: '',
    workerEvidenceLabel,
    workerSpentLabel,
    commentReadsBack,   // 用真实现：判「这一列还读得到吗」的规则本身要跟着测
    orphanWorktrees: null,   // git 页另拼的残留工作树段（判据在 renderer-orphan-worktrees.test.ts）
    diffHtml: (t: unknown, o: unknown) => {
      opts.push(o);
      return '<div class="diff">' + String(t).split('\n').map((l: string) => '<div class="ln">' + l + '</div>').join('') + '</div>';
    },
  };
  const a = source.indexOf('function gitViewHTML() {');
  const b = source.indexOf('function branchesViewHTML', a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  runInNewContext(source.slice(a, b) + "\n__out = gitViewHTML();", context);
  return (context.__out ?? '') as string;
}

const spawn = { type: "agent_spawned", agent_id: "wt-7", parent_event_id: 1, mode: "write", task: "修排序", max_turns: 6, permission_mode: "default", worktree: ".agents/wt-7", base_commit: "abc1234" };
const patch = (body: string) => ({ type: "tool_result", callId: "diff-wt-7", ok: true, output: "## stat\n src/a.ts | 2 +-\n## patch\n" + body });
const report = {
  type: "security_report", agent_id: "wt-7", mode: "standard", llm_reviewed: false,
  findings: [
    { severity: "high", path: "src/a.ts", line: 12, title: "拼接 SQL", description: "d", ruleId: "r1" },
    { severity: "critical", path: "src/b.ts", line: 3, title: "密钥硬编码", description: "d", ruleId: "r2" },
  ],
  summary: { total: 2, bySeverity: { critical: 1, high: 1 } },
};
const comment = { type: "diff_comment", agent_id: "wt-7", path: "src/a.ts", line: 12, body: "这里改用参数绑定", ts: 1 };

it('补丁快照给的是最新那份（v1→v2 取末位，不是取首位）', () => {
  const html = gitHTML([spawn, patch("+const old = 1"), patch("+const newer = 2")]);
  expect(html).toContain('补丁 v2');
  expect(html).toContain('+const newer = 2');
  expect(html, '旧版正文不得出现在列里——那是「已被推翻」的那版').not.toContain('+const old = 1');
});
it('没有补丁快照时如实说没有，不给空壳', () => {
  const html = gitHTML([spawn]);
  expect(html).toContain('这一列还没有补丁快照');
});
it('安全报告：汇总数、逐项 path:line 与「模型未复核」都上屏', () => {
  const html = gitHTML([spawn, report]);
  expect(html).toContain('安全报告 2 项 · critical 1 · high 1');
  expect(html).toContain('仅规则扫描（模型未复核）');
  expect(html).toContain('<code>src/a.ts:12</code> 拼接 SQL');
  expect(html).toContain('sev-critical');
  const noReport = gitHTML([spawn]);
  expect(noReport).toContain('没有安全报告');
  const clean = gitHTML([spawn, { ...report, findings: [], summary: { total: 0, bySeverity: {} } }]);
  expect(clean).toContain('没有发现项');
});
it('行级评论投影上屏（评审闭环的回执看得见）', () => {
  const html = gitHTML([spawn, comment]);
  expect(html).toContain('<code>src/a.ts:12</code> 这里改用参数绑定');
  expect(gitHTML([spawn]), '没评论时不硬造一个空区块').not.toContain('mc-comments');
});
it('长列表有界：findings 超 8 条与评论超 20 条都点名「另有 N 条」', () => {
  const many = Array.from({ length: 11 }, (_, i) => ({ severity: "low", path: "p" + String(i) + ".ts", line: i + 1, title: "t" + String(i), description: "d", ruleId: "r" }));
  const fHtml = gitHTML([spawn, { ...report, findings: many, summary: { total: 11, bySeverity: {} } }]);
  expect(fHtml).toContain('另有 3 项未列出');
  expect(fHtml).not.toContain('p9.ts');
  const manyC = Array.from({ length: 24 }, (_, i) => ({ ...comment, body: "c" + String(i) }));
  const cHtml = gitHTML([spawn, ...manyC]);
  expect(cHtml).toContain('另有 4 条评论未列出');
  expect(cHtml).not.toContain('c23');
});
it('列头仍带四态证据与花费（本轮不得把已有信息换掉）', () => {
  const html = gitHTML([spawn, patch("+x"), { type: "agent_result", agent_id: "wt-7", status: "done", output: "done", artifacts: { verified: "verified", spent_usd: 0.0312 } }]);
  expect(html).toContain('data-ev="verified"');
  expect(html).toContain('$0.0312');
  expect(html).toContain('修排序');
  expect(html).toContain('agent/*-wt-7');
});
it('空态文案不再谎称「面板尚未接入」（投影一直通着，只是这一会话没有 write worker）', () => {
  const html = gitHTML([]);
  expect(html).not.toContain('尚未接入');
  expect(html).toContain('本会话没有 write worker');
});
it('补丁按 anchors 形态着色：行号与「评」按钮由此长出，且 hint 说清代价与不做的事', () => {
  const opts: unknown[] = [];
  const html = gitHTML([spawn, patch("+const x = 1")], opts);
  expect(opts, '不传 anchors ⇒ 写端入口整片消失，而读端看起来一切正常').toEqual([{ anchors: true, comment: true }]);
  expect(html).toContain('行尾「评」');
  expect(html).toContain('不改代码、不重新派活');
});
it('合并决策已定（merged / rejected / cleaned）⇒ 不给必然失败的评论入口，但说明为什么', () => {
  for (const out of ["[merged] abc123", "[rejected] 用户拒", "[worktree] removed"]) {
    const callId = out.startsWith("[worktree]") ? "wt-cleanup-wt-7" : "merge-wt-7";
    const opts: unknown[] = [];
    const html = gitHTML([spawn, patch("+const x = 1"), { type: "tool_result", callId, ok: true, output: out }], opts);
    expect(opts, '工作树已收尾：injectComment 必然 injected:false').toEqual([{ anchors: true, comment: false }]);
    expect(html, '不给入口 ≠ 什么都不说：要讲清评论会落到哪儿、想改该走哪条路').toContain('它读不到了');
    expect(html).toContain('按原任务重派一列');
    expect(html, '已收尾的列不该再长出「送给它」的暗示').not.toContain('行尾「评」');
  }
});
it('conflict / gate-confirm 的改动还在工作树里 ⇒ 评论入口必须留着', () => {
  for (const out of ["[conflict] 主分支前进", "[gate] 安全 gate 要求确认"]) {
    const opts: unknown[] = [];
    gitHTML([spawn, patch("+const x = 1"), { type: "tool_result", callId: "merge-wt-7", ok: true, output: out }], opts);
    expect(opts).toEqual([{ anchors: true, comment: true }]);
  }
});
