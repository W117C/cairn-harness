// 残留（孤儿）工作树从盘上到屏上：agent:state 的 worktree 字段此前零读者。
// 判的三件事：数出来就说名字与计数、数不出来就说数不出来、没数过就一句都不写
// ——刻意不写「没有残留工作树」，那会把「还没数」与「确实没有」混成同一句。
// 全段没有任何按钮：清理会连 agent/*- 分支一起 branch -D（不判是否已合并），该动作尚未裁决。
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');

function block(orphanWorktrees: unknown) {
  const ctx: any = {
    orphanWorktrees,
    esc: (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    __out: '',
  };
  const a = source.indexOf('function orphanBlockHTML() {');
  const b = source.indexOf('/* git 分支数据', a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  runInNewContext(source.slice(a, b) + "\n__out = orphanBlockHTML();", ctx);
  return ctx.__out as string;
}

it('没数过就一句都不写；数过且确实没有就明说没有（data-wt 带出处）', () => {
  expect(block(null)).toBe('');
  const none = block({ orphans: [] });
  expect(none).toContain('本机没有残留工作树');
  expect(none).toContain('data-wt="0"');
  expect(none, '「没有」那一支同样不许给清理入口').not.toContain('<button');
});

it('数出来就逐个点名，带计数与 data-wt，且一个按钮也不给', () => {
  const html = block({ orphans: ['a1', 'b2'] });
  expect(html).toContain('data-wt="2"');
  expect(html).toContain('残留工作树 2 个');
  expect(html).toContain('<code>a1</code>');
  expect(html).toContain('<code>b2</code>');
  expect(html).toContain('git worktree remove');
  expect(html, '清理 = branch -D 删未合并改动，未裁决 ⇒ 不许出现可点的东西').not.toContain('<button');
});

it('列表有界：第 9 个起折进「另有 N 个」，而不是悄悄少列', () => {
  const many = Array.from({ length: 11 }, (_, i) => 'wt-' + String(i));
  const html = block({ orphans: many });
  expect(html).toContain('残留工作树 11 个');
  expect(html).toContain('<code>wt-7</code>');
  expect(html).not.toContain('<code>wt-8</code>');
  expect(html).toContain('另有 3 个未列出');
});

it('数不出来就说数不出来，并给一条自查命令（不写成「没有」）', () => {
  const html = block({ error: 'main 侧扫描未成功，且没带原因' });
  expect(html).toContain('数不出来');
  expect(html).toContain('main 侧扫描未成功');
  expect(html).toContain('git worktree list');
  expect(html).not.toContain('残留工作树 0');
  expect(html, '数不出来那一支也不许顺手给个清理按钮').not.toContain('<button');
});

it('名字是盘上数据，照样转义（worktree 路径里带尖括号不该变成标记）', () => {
  expect(block({ orphans: ['<img onerror=alert(1)>'] })).toContain('&lt;img');
});

/* 接线半边：这两个函数各自正确不等于 git 页真调了它——空态与列表态两条路都要带上。 */
it('gitViewHTML 的两条返回路径都带上这一段', () => {
  const a = source.indexOf('function gitViewHTML() {');
  const body = source.slice(a, source.indexOf('function orphanBlockHTML()', a));
  const calls = [...body.matchAll(/orphanBlockHTML\(\)/g)].length;
  expect(calls, '空态或列表态少接一处 = 没有 write worker 时永远看不见残留工作树').toBe(2);
});
