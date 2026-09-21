// Git/合并控制塔每一列上的「验证证据 + 花费」徽标（读端的最后一公里）。
// 投影算对了不等于看得见：W4b 落在一个 slice 里就红过一次——四态在事件流里，界面上只有一列 outcome。
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { workerEvidenceLabel, workerSpentLabel, commentReadsBack } from '../src/renderer/projections';

const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');

function gitHTML(merge: unknown[]) {
  const context: any = {
    panelData: { workspace: null, files: [], tree: [], terminal: [], merge },
    BRANCH_ICON: '<svg/>',
    esc: (s: unknown) => String(s),
    workerEvidenceLabel,
    workerSpentLabel,
    orphanWorktrees: null,   // git 页现在还会拼这一段；本文件不判它（见 renderer-orphan-worktrees）
    commentReadsBack,   // 真实现：这一列读不读得到由投影判，不在这里另给一个答案
    // 面板那一列 = 合并控制塔的列本身（457fe8d 撤了中间裁剪层），故渲染时还要读 diffHtml；
    // 本文件只判证据态与花费账，补丁正文由 tests/renderer-merge-review.test.ts 判。
    diffHtml: (t: unknown) => '<div class="diff">' + String(t) + '</div>',
    __out: "",
  };
  const a = source.indexOf('function gitViewHTML() {');
  const b = source.indexOf('/* git 分支数据', a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  runInNewContext(source.slice(a, b) + "\n__out = gitViewHTML();", context);
  return context.__out as string;
}

const col = (over: Record<string, unknown>) => ({
  agent_id: "wt-a1", task: "修排序", status: "done", outcome: "merged", verified: null, spentUsd: null,
  worktree: ".agents/wt-a1", base_commit: "abc", branch: "agent/*-wt-a1",
  diffs: [], report: null, comments: [], outcomeText: "", ...over,
});

it('每一列都带证据态与花费账，且证据态有机器可查的 data-ev', () => {
  const html = gitHTML([col({ verified: "verified", spentUsd: 0.0123 })]);
  expect(html).toContain('data-ev="verified"');
  expect(html).toContain('已验证');
  expect(html).toContain('$0.0123');
  expect(html).toContain('wt-a1');
  expect(html).toContain('merged');
});

it('四态各说各的话：没带标记 ≠ 没有验证拍 ≠ 已过期', () => {
  expect(gitHTML([col({})])).toContain('无回程标记');
  expect(gitHTML([col({ verified: "absent" })])).toContain('无验证拍');
  expect(gitHTML([col({ verified: "stale" })])).toContain('证据已过期');
  expect(gitHTML([col({ verified: "failed" })])).toContain('验证未过');
  // 价格不可知不许写成 $0.0000
  expect(gitHTML([col({ verified: "verified" })])).toContain('价格未知');
});

it('没有 write worker 时保持诚实空态，不编造列（也不谎称面板没接）', () => {
  const html = gitHTML([]);
  expect(html).toContain('本会话没有 write worker');
  expect(html).not.toContain('尚未接入');
  expect(html).not.toContain('merge-col');
});
