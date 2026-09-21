// 插件面板的两件产品面：快照清单（哪些插件 / 信任态 / 装了什么 / 错在哪）与授权动作。
// §9.8 的口径是「未信任不激活」——没有这个面板，用户看到的就是"插件装了没反应"，
// 而 plugin:decide 通道此前只有验收脚本在调（门 0 的可达性欠账之一）。
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

const snap = {
  plugins: [
    { name: "echo-suite", scope: "project", trust: "pending", root: "/ws/.agent/plugins/echo-suite",
      counts: { skills: 2, commands: 1, agents: 3, hooks: 4, mcp: 1, lsp: 2, lspActive: 1 }, errors: [], warnings: [] },
    { name: "hello-plugin", scope: "user", trust: "trusted", root: "/u/hello-plugin",
      counts: { skills: 1, commands: 1, agents: 0, hooks: 0, mcp: 0, lsp: 0, lspActive: 0 }, errors: [], warnings: [] },
  ],
  looseSkills: [{ name: "standalone-skill", invoke: "standalone", description: "散装 skill 样本", trust: "pending" }],
  mcpServers: [{ name: "echo-mcp" }],
  toolScopes: [],
  errors: [{ plugin: "broken-one", message: "manifest 解析失败：缺 name" }],
  warnings: [],
};

function readFace(cache: unknown) {
  const context: any = {
    pluginCache: cache,
    esc: (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  };
  runInNewContext(section('/* 插件面板：装了什么', 'function viewHTML(key) {'), context);
  return context.pluginsViewHTML() as string;
}

/** 动作面：整段真实代码（loadPlugin + decidePlugin），只注入 api / toast / renderSide。 */
function actionFace(opts: {
  decide: (name: string, trusted: boolean) => Promise<unknown>;
  getState?: () => Promise<unknown>;
}) {
  const toast = vi.fn();
  const renderSide = vi.fn();
  const getState = opts.getState ?? vi.fn(async () => ({ plugins: { ...snap, plugins: [] } }));
  const context: any = {
    api: { pluginDecide: opts.decide, getState },
    toast,
    renderSide,
    pluginCache: snap,
    esc: (s: unknown) => String(s),
  };
  runInNewContext(
    section('  /* 插件快照与信任决议（§9.8）', "  const sidePagesHost = $('.side-pages');"),
    context,
  );
  return { context, toast, renderSide, getState };
}

it('清单如实：信任态中文化、装了什么逐项计数、行上带插件名', () => {
  const html = readFace(snap);
  expect(html).toContain('插件（2）');
  expect(html).toContain('echo-suite（待决）');
  expect(html).toContain('hello-plugin（已信任）');
  expect(html).toContain('skill 2 · 命令 1 · 子智能体 3 · hook 4 · MCP 1 · LSP 1/2');
  expect(html).toContain('data-plugin="echo-suite"');
  expect(html).toContain('散装 skill（1）');
  expect(html).toContain('待决授权 2');
});

it('授权按钮必须可回滚：待决给两颗，已信任只剩「拒绝」，已拒绝只剩「信任」', () => {
  const acts = (trust: string) => {
    const one = { ...snap, plugins: [{ ...snap.plugins[0], trust }], looseSkills: [] };
    const html = readFace(one);
    return { trust: (html.match(/data-plug-act="trust"/g) || []).length, decline: (html.match(/data-plug-act="decline"/g) || []).length };
  };
  expect(acts('pending')).toEqual({ trust: 1, decline: 1 });
  expect(acts('trusted'), '已信任的还得能撤回，否则授权是一次性的').toEqual({ trust: 0, decline: 1 });
  expect(acts('declined')).toEqual({ trust: 1, decline: 0 });
});

it('加载错误必须上屏（插件没跑起来时，这是用户唯一的线索）', () => {
  expect(readFace(snap)).toContain('加载错误（1）');
  expect(readFace(snap)).toContain('manifest 解析失败：缺 name');
});

it('点「信任」：名字与 true 一起过桥，随后回读快照并重画', async () => {
  const decide = vi.fn(async () => ({ ok: true }));
  const f = actionFace({ decide });
  await f.context.decidePlugin('echo-suite', true);
  expect(decide).toHaveBeenCalledWith('echo-suite', true);
  expect(String(f.toast.mock.calls[0]?.[0])).toContain('已信任：echo-suite');
  expect(f.getState).toHaveBeenCalledTimes(1);
  expect(f.context.pluginCache.plugins, '清单以回读到的快照为准（不是本地改一行状态）').toEqual([]);
  expect(f.renderSide).toHaveBeenCalledTimes(1);
});

it('点「拒绝」不报「已信任」；回条 ok=false 也不报成功，且一律回读', async () => {
  const f1 = actionFace({ decide: async () => ({ ok: true }) });
  await f1.context.decidePlugin('echo-suite', false);
  const declined = String(f1.toast.mock.calls[0]?.[0]);
  expect(declined).toContain('已拒绝：echo-suite');
  expect(declined).not.toContain('已信任');

  const f2 = actionFace({ decide: async () => ({ ok: false }) });
  await f2.context.decidePlugin('ghost', true);
  const unconfirmed = String(f2.toast.mock.calls[0]?.[0]);
  expect(unconfirmed).toContain('决议未生效：ghost');
  expect(unconfirmed).not.toContain('已信任');
  expect(f2.getState).toHaveBeenCalledTimes(1);
});

it('没有名字的行不动桥', async () => {
  const decide = vi.fn(async () => ({ ok: true }));
  const f = actionFace({ decide });
  await f.context.decidePlugin('', true);
  await f.context.decidePlugin(undefined as unknown as string, false);
  expect(decide).not.toHaveBeenCalled();
  expect(f.toast).not.toHaveBeenCalled();
});
