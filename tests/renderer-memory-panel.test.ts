// 记忆面板的两件产品面：读到的清单（getState().memory → 行 + 删除按钮的载荷）与点删除之后的动作。
// 后端（memorySnapshot / agent:memory-delete）早就在，此前渲染层既没有读的地方也没有删的地方。
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');

function section(start: string, end: string) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return source.slice(a, b);
}

const snapshot = {
  project: {
    path: '/ws/.agent/memory',
    index: '# 索引',
    topics: [{ topic: '构建与门禁', type: 'project', modified: '2026-09-21T02:00:00.000Z', bytes: 812 }],
    pendingExternalRefs: [],
  },
  global: {
    path: '/home/ze/.memory',
    index: null,
    topics: [
      { topic: '用户偏好', type: 'user', modified: '2026-09-20T02:00:00.000Z', bytes: 120 },
      { topic: '<img onerror=1>', type: 'feedback', modified: '2026-09-19T02:00:00.000Z', bytes: 40 },
    ],
    pendingExternalRefs: [],
  },
};

/** 读面：memLayerHTML + memoryViewHTML（memoryCache 是它读的那份快照，测试里直接喂）。 */
function readFace(cache: unknown) {
  const context: any = {
    memoryCache: cache,
    esc: (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    schedTime: (v: unknown) => 'T(' + String(v) + ')',
  };
  runInNewContext(section('function memLayerHTML', 'function viewHTML(key) {'), context);
  return context.memoryViewHTML() as string;
}

/** 动作面：deleteMemoryTopic（抽屉委托点击唯一的删除出口）。 */
function actionFace(deleteMemory: (...args: unknown[]) => Promise<unknown>) {
  const toast = vi.fn();
  const loadMemory = vi.fn(async () => {});
  const renderSide = vi.fn();
  const context: any = { api: { deleteMemory }, toast, loadMemory, renderSide, memoryCache: snapshot };
  runInNewContext(
    section('  /* §8.1.7：删除只此一路', "  const sidePagesHost = $('.side-pages');"),
    context,
  );
  return { context, toast, loadMemory, renderSide };
}

it('两层各列自己的 topic：名字 / 类型 / 字节 / 层路径，删除按钮带上 scope 与 topic', () => {
  const html = readFace(snapshot);
  expect(html).toContain('项目层（1）');
  expect(html).toContain('/ws/.agent/memory');
  expect(html).toContain('全局层（2）');
  expect(html).toContain('构建与门禁');
  expect(html).toContain('812 B');
  expect(html).toContain('T(2026-09-20T02:00:00.000Z)');
  // 载荷：删哪一条由行上的两个 data-* 决定（面板不留第二份「当前条目」状态）
  expect(html).toContain('data-scope="global" data-topic="用户偏好"');
  expect(html).toContain('data-mem-act="del"');
});

it('空态与缺层如实说；topic 名里的尖角不得变成标签', () => {
  expect(readFace(null)).toContain('读取中');
  expect(readFace({ unsupported: true })).toContain('当前壳的状态面未提供 memory 快照');
  expect(readFace({ error: '读盘炸了' })).toContain('读取失败：读盘炸了');
  const html = readFace({ project: { path: '/p', topics: [], pendingExternalRefs: [] }, global: undefined });
  expect(html).toContain('项目层（0）');
  expect(html).toContain('还没有记忆条目');
  expect(html).toContain('全局层：快照里没有这一层');
  const xss = readFace({ ...snapshot, global: { ...snapshot.global, topics: [{ topic: '<img onerror=1>', type: 'x', modified: 'm', bytes: 1 }] } });
  expect(xss).not.toContain('<img onerror');
  expect(xss).toContain('&lt;img');
});

it('点删除：按行上的 scope + topic 调桥，成功后清空缓存回读快照并重画', async () => {
  const del = vi.fn(async () => ({ ok: true }));
  const f = actionFace(del);
  await f.context.deleteMemoryTopic('project', '构建与门禁');
  expect(del).toHaveBeenCalledWith('project', '构建与门禁');
  expect(f.toast).toHaveBeenCalledWith('已删除记忆：构建与门禁');
  expect(f.loadMemory).toHaveBeenCalledWith(true);
  expect(f.renderSide).toHaveBeenCalledTimes(1);
  expect(f.context.memoryCache, '删完不得留着旧快照（那行还在屏幕上就是撒谎）').not.toBe(snapshot);
});

it('主进程拒绝 ⇒ 原话上 toast，并且照样回读（列表以盘上为准）', async () => {
  const del = vi.fn(async () => ({ ok: false, error: 'topic 不存在: 没了' }));
  const f = actionFace(del);
  await f.context.deleteMemoryTopic('global', '没了');
  expect(f.toast).toHaveBeenCalledWith('删除失败：topic 不存在: 没了');
  expect(String(f.toast.mock.calls[0]?.[0])).not.toContain('已删除');
  expect(f.loadMemory).toHaveBeenCalledWith(true);
});

it('行缺 scope 或 topic ⇒ 不动桥（不把 undefined 传进 IPC）', async () => {
  const del = vi.fn(async () => ({ ok: true }));
  const f = actionFace(del);
  await f.context.deleteMemoryTopic(undefined, 'x');
  await f.context.deleteMemoryTopic('project', '');
  expect(del).not.toHaveBeenCalled();
  expect(f.toast).not.toHaveBeenCalled();
});
