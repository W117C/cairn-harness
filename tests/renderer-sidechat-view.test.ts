// 辅助对话（sidechat，§10.8）面板的纯渲染半边：main 把快照算好了（旁路会话清单 + 各自最近消息 +
// 由主会话 origin 反向投影的已提升记录），这一片只把它组成形状。判的三件事：
//   ① 三态分开说（还没读 / 读过且没有 / 读失败），失败不写成「没有」；
//   ② 有界性（会话数与每会话消息数、单条文本长度）折得看得见，不静默少列；
//   ③ 「提升」的对象由快照里最新一条 assistant 决定，没有答案时按钮是禁用的而不是隐藏后没解释。
// 全片零 DOM：切片丢进 vm 跑，自由变量按名字注入（app.js 的切片测共例）。
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');

const START = '/* 辅助对话（§10.8）：只读旁路问答';
const END = 'function viewHTML(key) {';
const at = source.indexOf(START);
const after = source.indexOf(START, at + 1);
expect(at, '起点标记必须唯一，否则切片悄悄撑大').toBeGreaterThanOrEqual(0);
expect(after, '起点标记出现两次 ⇒ 切片会吞进别人的代码').toBe(-1);
const end = source.indexOf(END, at);
expect(end, '终点标记（viewHTML）要在起点之后').toBeGreaterThan(at);
const slice = source.slice(at, end);

function view(sidechatSnap: unknown, sidechatNote = '') {
  const ctx: any = {
    sidechatSnap,
    sidechatNote,
    esc: (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    __out: '',
  };
  runInNewContext(slice + "\n__out = sidechatViewHTML();", ctx);
  return ctx.__out as string;
}

const msg = (eventId: number, role: 'user' | 'assistant', text = '内容' + String(eventId)) =>
  ({ eventId, role, text });
const session = (id: string, messages: unknown[], lines = messages.length) =>
  ({ id, parentId: 'main-1', lines, mtimeMs: 0, messages, usage: { inputTokens: 1200, outputTokens: 340, usageCount: 2, compactionCount: 0 } });

/* 旁路有自己的上下文 ⇒ 自己的钱（§10.8）；快照三项全零时整段不写，不拿一串 0 冒充「量过」。 */
it('旁路成本随行头可见；一次用量也没有时整段不写', () => {
  const paid = view({
    parentSessionId: 'main-1',
    sessions: [session('付过费的', [msg(1, 'assistant')])],
    promoted: [],
  });
  expect(paid).toContain('用量 2 次 · 进出 1200/340 tok');
  const fresh = view({
    parentSessionId: 'main-1',
    sessions: [{ ...session('刚建的', []), usage: { inputTokens: 0, outputTokens: 0, usageCount: 0, compactionCount: 0 } }],
    promoted: [],
  });
  expect(fresh, '没跑过一次就不该出现成本字样').not.toContain('用量');
  expect(fresh).toContain('旁路 own loop');
});
it('三态各说各的话：还没读 ≠ 读过且没有 ≠ 读失败', () => {
  expect(view(null)).toContain('读取中');
  const none = view({ parentSessionId: 'main-1', sessions: [], promoted: [] });
  expect(none).toContain('还没有旁路会话');
  expect(none, '空态也要给出口，不然用户不知道从哪开始').toContain('新建旁路会话');
  const err = view({ error: 'sessions 目录不可读' });
  expect(err).toContain('旁路快照读取失败：sessions 目录不可读');
  expect(err).not.toContain('还没有旁路会话');
});

it('一行一条问答，带行号出处与提升锚点（最新一条 assistant）', () => {
  const html = view({
    parentSessionId: 'main-1',
    sessions: [session('调研 loop', [msg(1, 'user'), msg(2, 'assistant'), msg(5, 'assistant')])],
    promoted: [],
  });
  expect(html).toContain('data-sc="调研 loop"');
  expect(html).toContain('旁路 own loop');
  expect(html).toContain('用量 2 次');
  expect(html).toContain('data-sc-ev="1"');       // 每条消息自带事件号（徽标与提升都按它对齐）
  expect(html, '提升默认对象 = 最近一条答案（§10.8）').toContain('data-sc-act="promote" data-sc-ev="5"');
  expect(html).toContain('>问</span>');
  expect(html).toContain('>答</span>');
});

it('没有答案时「提升」是禁用的并说明原因，而不是静默少一个按钮', () => {
  const html = view({
    parentSessionId: 'main-1',
    sessions: [session('只问了', [msg(1, 'user')])],
    promoted: [],
  });
  expect(html).toContain('data-sc-act="promote" disabled');
  expect(html).toContain('title="还没有可提升的答案"');
  expect(html).not.toContain('data-sc-act="promote" data-sc-ev');
});

it('已提升徽标来自 origin 反向投影，命中哪条就标哪条', () => {
  const html = view({
    parentSessionId: 'main-1',
    sessions: [session('两个答案', [msg(2, 'assistant'), msg(3, 'assistant')])],
    promoted: [{ eventId: 41, sessionId: '调研', sourceEventIds: [2] }],
  });
  const marked = html.match(/data-sc-ev="2"[^]*?<\/div>/)?.[0] ?? '';
  expect(marked, '第一条带徽标、第二条不带（按事件号对齐，不看文本）').toContain('已提升');
  expect((html.match(/sc-badge/g) || []).length, '只有被投影命中的那一条带徽标').toBe(1);
  expect(html).toContain('已提升消息 1');
});

it('有界性折得看得见：会话数、每会话消息数、单条文本长度三处都报"另有/截断"', () => {
  const many = Array.from({ length: 10 }, (_, i) => msg(i + 1, i % 2 ? 'assistant' : 'user', '行' + String(i + 1)));
  const html = view({
    parentSessionId: 'main-1',
    sessions: Array.from({ length: 9 }, (_, i) => session('旁路 ' + String(i + 1), many)),
    promoted: [],
  });
  expect(html).toContain('旁路会话 9');
  expect(html).toContain('另有 1 个旁路会话未列出');
  expect(html).toContain('另有 4 条未列出（快照只带最近 6 条）');
  expect(html).not.toContain('data-sc="旁路 9"');
  expect(html).toContain('data-sc="旁路 8"');
  const long = view({
    parentSessionId: 'main-1',
    sessions: [session('长文', [msg(1, 'assistant', 'x'.repeat(300))])],
    promoted: [],
  });
  expect(long).toContain('x'.repeat(220) + '…');
  expect(long).not.toContain('x'.repeat(221));
});

it('旁路动作的回执上屏（含 fail-closed 那句原因），且转义', () => {
  const html = view({ parentSessionId: null, sessions: [], promoted: [] },
    '问失败：无 M0_API_KEY：sidechat 真实模型不可用（fail-closed，可注入脚本模型）');
  expect(html).toContain('问失败：无 M0_API_KEY');
  expect(html, '回执只有一条通道：note 行').toContain('<p class="sc-note">');
  expect(view({ parentSessionId: null, sessions: [], promoted: [] }, '<script>alert(1)</script>'))
    .toContain('&lt;script&gt;');
  expect(view({ parentSessionId: '<b>', sessions: [], promoted: [] })).toContain('父会话 &lt;b&gt;');
});

it('未选主会话时明说「未选」，不拿空串冒充会话名', () => {
  const html = view({ parentSessionId: null, sessions: [], promoted: [] });
  expect(html).toContain('父会话 未选');
});
