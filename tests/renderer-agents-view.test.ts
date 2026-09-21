// 子智能体（worker）抽屉页：每 worker 一列的状态、用量、工具计数、卡在哪一步。
// projectAgentPanel 早就写好了（M3a §10.2），但只有自测在调——产品里没有一屏看得见 worker，
// 「派了子智能体」与「子智能体在干什么」对用户是黑盒（§4.4.8 worker live 卡那一承诺的读端）。
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { agentStatusText, workerRowActions } from '../src/renderer/projections';

const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');

function agentsHTML(agents: unknown[]) {
  const context: any = {
    panelData: { workspace: null, files: [], tree: [], terminal: [], merge: [], agents },
    esc: (s: unknown) => String(s),
    agentStatusText,
    workerRowActions,
    __out: "",
  };
  const a = source.indexOf('/* 子智能体（worker）一列一行');
  const b = source.indexOf('function viewHTML(key) {', a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  runInNewContext(source.slice(a, b) + "\n__out = agentsViewHTML();", context);
  return context.__out as string;
}

const col = (over: Record<string, unknown>) => ({
  agent_id: "wt-1", mode: "write", task: "修排序", parent_event_id: 3, permission_mode: "default",
  max_turns: 8, status: "running", recent: [], usage: { inputTokens: 1200, outputTokens: 300 },
  toolStats: {}, pendingApproval: null, durationMs: null, ...over,
});

it('每列给足「在干什么」：状态中文化、token 合计、工具计数、任务与报告', () => {
  const html = agentsHTML([col({
    status: "done", durationMs: 4200, toolStats: { read_file: 3, edit_file: 2 },
    report: "已修复并通过 pnpm test", recent: ["read src/todo.ts", "edit src/todo.ts"],
  })]);
  expect(html).toContain('wt-1（已完成 · write）');
  expect(html).toContain('1500 tok');
  expect(html).toContain('read_file×3 · edit_file×2');
  expect(html).toContain('4.2s');
  expect(html).toContain('修排序');
  expect(html).toContain('已修复并通过 pnpm test');
  expect(html).toContain('edit src/todo.ts');
  expect(html).toContain('data-agent="wt-1"');
});

it('「等人」不与「运行中」混为一谈；未终态时长不写 0.0s', () => {
  const wait = agentsHTML([col({ status: "waiting_approval", pendingApproval: { id: "a1", tool: "run_shell", risk: "high" } })]);
  expect(wait).toContain('等人审批');
  expect(wait).toContain('待批：run_shell（high）');
  expect(wait).toContain('等人 1');
  expect(wait).not.toContain('运行中');
  expect(agentsHTML([col({})])).toContain('未终态');
  expect(agentsHTML([col({ toolStats: {} })])).toContain('尚无工具调用');
});

it('没派过子智能体时说没有，不编一列', () => {
  expect(agentsHTML([])).toContain('这条会话还没派过子智能体');
});

it('行内按钮只给还能做动作的列：在跑的给取消，被中断的给重派，跑完的什么都不给', () => {
  const run = agentsHTML([col({ status: 'running' })]);
  expect(run).toContain('data-agent-act="cancel"');
  expect(run).toContain('取消');
  expect(run).not.toContain('data-agent-act="respawn"');
  const interrupted = agentsHTML([col({ status: 'failed', reason: 'interrupted' })]);
  expect(interrupted).toContain('data-agent-act="respawn"');
  expect(interrupted).toContain('重派');
  expect(interrupted).not.toContain('data-agent-act="cancel"');
  // 跑完 / 自己拒的 / 到轮次上限失败的：一个按钮都不给（给了就是假出口）
  for (const done of [col({ status: 'done' }), col({ status: 'cancelled' }), col({ status: 'failed', reason: 'max_turns' })]) {
    expect(agentsHTML([done])).not.toContain('data-agent-act');
  }
});

it('卡死那一列给「继续」并留「取消」：出口一有按钮，但不替用户决定', () => {
  const stuck = agentsHTML([col({ status: 'waiting_input', reason: 'stuck' })]);
  expect(stuck).toContain('data-agent-act="resume"');
  expect(stuck).toContain('继续');
  expect(stuck).toContain('data-agent-act="cancel"');
  // 普通「等人回答」不是卡死：只给取消（给了继续 = 让主进程回一句「无卡死态」）
  expect(agentsHTML([col({ status: 'waiting_input' })])).not.toContain('data-agent-act="resume"');
});

// 接线判据：上面三条形测试各自造列，绕过了「事件流 → panelData」这一跳。
// 本仓最常见的缺陷形态就是投影算对了但没人把它接进渲染面（agentStatusBadge 曾零调用者即是），
// 所以这一条从真实事件跑到 HTML——projectPanelData 少返回 agents 立刻红。
it('真实事件流经 projectPanelData 也能长出这一行（投影→面板的接线有判据）', async () => {
  const { projectPanelData } = await import('../src/renderer/projections');
  const events = [
    { type: 'agent_spawned', agent_id: 'wt-9', parent_event_id: 2, mode: 'write', task: '修分页', max_turns: 6, permission_mode: 'default', ts: 1000 },
    { type: 'tool_call', id: 'c1', name: 'edit_file', args: {}, agent_id: 'wt-9' },
    { type: 'usage', id: 'c2', agent_id: 'wt-9', inputTokens: 800, outputTokens: 200 },
    { type: 'agent_status', agent_id: 'wt-9', status: 'done', ts: 3000 },
    { type: 'agent_result', id: 'c3', agent_id: 'wt-9', status: 'done', summary: '分页已修复', usage: { inputTokens: 800, outputTokens: 200 }, tool_stats: {}, artifacts: {} },
  ] as unknown as Parameters<typeof projectPanelData>[0];
  const data = projectPanelData(events, null);
  const html = agentsHTML(data.agents);
  expect(html).toContain('wt-9（已完成 · write）');
  expect(html).toContain('修分页');
  expect(html).toContain('1000 tok');
  expect(html).toContain('edit_file×1');
  expect(html).toContain('2.0s');
  expect(html).toContain('分页已修复');
});
