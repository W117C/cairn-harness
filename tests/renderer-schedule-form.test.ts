// 新建定时任务的表单面（#62）：后端四件套早就齐了，界面上却只有列表 + 一句「后续接」，
// 用户看得见任务却设不了任务。这里锁三件事：
// ① 形状映射与 main 的规则**接得上**（同一份 payload 直接喂 validateAutomation，不各判一道）；
// ② 表单只开 main 的四种 kind，且缺省是最便宜的那一种（once：跑一次就结束）；
// ③ 回条不许吞：被拒要原样点名、成功后一律回读快照（不在本地插一行 = 第二份事实源）。
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { FORM_KINDS, validateAutomation } from '../src/main/automations';
import { SCHED_FORM_KINDS, SCHED_KIND_LABELS, SCHED_TIER_LABELS, schedFormPayload } from '../src/renderer/projections';

const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
const htmlSource = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');

function section(start: string, end: string) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return source.slice(a, b);
}

const blank = {
  name: '每晨跑一遍失败用例', kind: 'once', at: '2026-09-25T07:30', everyMinutes: '',
  time: '07:30', weekdays: '', prompt: '把 tests/ 里失败的用例修到全绿', permissionTier: 'read-only', catchUp: 'latest',
  timeZone: '', model: '',
};

it('种类清单与 main 的 FORM_KINDS 逐字同集（多一种少一种都是两份规则）', () => {
  expect([...SCHED_FORM_KINDS].sort()).toEqual([...FORM_KINDS].sort());
  expect(Object.keys(SCHED_KIND_LABELS).sort(), '加了 kind 忘了标签 = 下拉里露出裸英文').toEqual([...SCHED_FORM_KINDS].sort());
});

it('形状映射：每种 kind 只带自己那一项，不夹带别的 kind 的字段', () => {
  expect(schedFormPayload({ ...blank, kind: 'once' })).toEqual({
    name: '每晨跑一遍失败用例', prompt: blank.prompt, schedule: { kind: 'once', at: '2026-09-25T07:30' },
    permissionTier: 'read-only', catchUp: 'latest',
  });
  expect(schedFormPayload({ ...blank, kind: 'interval', everyMinutes: '30' }).schedule).toEqual({ kind: 'interval', everyMinutes: 30 });
  expect(schedFormPayload({ ...blank, kind: 'daily' }).schedule).toEqual({ kind: 'daily', time: '07:30' });
  expect(schedFormPayload({ ...blank, kind: 'weekly', weekdays: '1, 3, 5' }).schedule).toEqual({ kind: 'weekly', time: '07:30', weekdays: [1, 3, 5] });
});

it('留空不等于 0：数字/星期留空要留成缺字段让 main 拒，不能悄悄变成每 0 分钟或周日 0 点', () => {
  const iv = schedFormPayload({ ...blank, kind: 'interval', everyMinutes: '  ' });
  expect((iv.schedule as Record<string, unknown>).everyMinutes).toBeUndefined();
  expect(validateAutomation(iv, { form: true }).ok, '留空必须被 main 拒，而不是当 0 收下').toBe(false);
  const wk = schedFormPayload({ ...blank, kind: 'weekly', weekdays: '' });
  expect(validateAutomation(wk, { form: true }).ok).toBe(false);
});

it('四种 kind 的正常载荷都能过 main 的严格校验（两个表面真接得上，不是各写一遍）', () => {
  for (const kind of SCHED_FORM_KINDS) {
    const payload = schedFormPayload({
      ...blank, kind,
      everyMinutes: '30', weekdays: '1,3,5',
    });
    const r = validateAutomation(payload, { form: true });
    expect(r.ok, kind + ' 被 main 拒：' + JSON.stringify(r.ok === false ? r.errors : {})).toBe(true);
  }
});

it('表单不夹带 main 不认的顶层字段（未知字段一律拒，带上就整条回不了）', () => {
  const r = validateAutomation(schedFormPayload({ ...blank, kind: 'daily' }), { form: true });
  expect(r.ok).toBe(true);
  expect(Object.keys(schedFormPayload({ ...blank, kind: 'daily' })).sort())
    .toEqual(['catchUp', 'name', 'permissionTier', 'prompt', 'schedule']);
});

it('时区与模型：留空就不带上场（缺省归 main 判），填了才进载荷且 main 认', () => {
  const filled = schedFormPayload({ ...blank, kind: 'daily', timeZone: '  Asia/Tokyo  ', model: 'glm-4.7' });
  expect(filled.timeZone).toBe('Asia/Tokyo');
  expect(filled.model).toBe('glm-4.7');
  expect(validateAutomation(filled, { form: true }).ok).toBe(true);
  const bogus = validateAutomation(schedFormPayload({ ...blank, kind: 'daily', timeZone: 'Mars/Olympus' }), { form: true });
  expect(bogus.ok, '非法 IANA 由 main 拒（渲染层不自己判一遍）').toBe(false);
  expect(bogus.ok === false ? bogus.errors.join('；') : '').toContain('timeZone 非法');
});

/* ---- 表单渲染与提交（app.js 桥接段切面）---- */

function node(values: Record<string, string> = {}) {
  const listeners: Record<string, ((e: never) => void)[]> = {};
  const n: any = {
    disabled: false,
    hidden: true,
    innerHTML: '',
    dataset: {},
    addEventListener: (type: string, fn: (e: never) => void) => { (listeners[type] ??= []).push(fn); },
    fire: (type: string, e: unknown = { preventDefault() {}, target: {} }) => {
      for (const fn of listeners[type] ?? []) fn(e as never);
    },
    setAttribute: () => {},
    querySelector: (sel: string) => {
      if (sel === '.sched-form') return n;
      n.sub ??= {};
      return (n.sub[sel] ??= sel === '#schedErr' ? { hidden: true, textContent: '' } : { value: values[sel.slice(1)] ?? '' });
    },
  };
  return n;
}

function boot(upsert: (def: unknown, form?: boolean) => Promise<unknown>, values: Record<string, string> = {}) {
  const nodes: Record<string, ReturnType<typeof node>> = {};
  const toast = vi.fn();
  const registerPop = vi.fn();
  const loadSchedule = vi.fn(async () => {});
  const renderSide = vi.fn();
  const ctx = {
    $: (sel: string) => (nodes[sel] ??= node(values)),
    api: { scheduleUpsert: upsert },
    toast, registerPop, togglePop: vi.fn(), closeAllPops: vi.fn(), loadSchedule, renderSide,
    scheduleCache: { tasks: [], history: [] },
    esc: (s: unknown) => String(s),
    SCHED_FORM_KINDS,
    SCHED_KIND_LABELS,
    SCHED_TIER_LABELS,
    schedFormPayload,
  };
  runInNewContext(section("  const ctxSched = $('#ctxSched');", "  /* 目标态镜像：showHistory 全量筛"), ctx);
  return {
    ctx, toast, loadSchedule, renderSide,
    panel: () => nodes['#schedPanel'],
    body: () => nodes['#schedPanelBody'],
    render: () => (registerPop.mock.calls[0]?.[2] as () => void)(),
  };
}

const F = {
  schedName: '每晨跑一遍失败用例', schedKind: 'daily', schedAt: '2026-09-25T07:30', schedEvery: '',
  schedTime: '07:30', schedWeekdays: '', schedPrompt: '把 tests/ 里失败的用例修到全绿', schedTier: 'read-only', schedCatchUp: 'latest',
};

it('表单只开 main 的四种种类，缺省选中最便宜的 once（不是能循环的那几种）', () => {
  const b = boot(async () => ({ ok: true }));
  b.render();
  const html = b.body().innerHTML;
  for (const k of SCHED_FORM_KINDS) expect(html).toContain('<option value="' + k + '"');
  expect(html, 'hourly/monthly/custom 是数据模型里的，表单面不给').not.toMatch(/value="(hourly|monthly|custom)"/);
  expect(html).toContain('<option value="once" selected>');
  expect(html, '缺省种类落在 data-kind 上，界面才露对应那一项').toContain('data-kind="once"');
  for (const id of ['schedName', 'schedPrompt', 'schedTier', 'schedTimeZone', 'schedModel']) {
    expect(html, '§12.2.6 要求的表单字段少了 ' + id).toContain('id="' + id + '"');
  }
});

it('权限档位缺省只读：写档位的后果（无人值守）写在选项上，只读档不吓人', () => {
  const b = boot(async () => ({ ok: true }));
  b.render();
  const html = b.body().innerHTML;
  expect(html).toContain('<option value="read-only" selected>');
  const opt = (tier: string) => html.match(new RegExp('<option value="' + tier + '"[^>]*>([^<]*)<'))?.[1] ?? '';
  expect(Object.keys(SCHED_TIER_LABELS).sort()).toEqual(['danger-full-access', 'read-only', 'workspace-write']);
  expect(opt('read-only')).not.toContain('无人值守');
  expect(opt('workspace-write'), '选它就等于同意没人审批就跑').toContain('无人值守');
  expect(opt('danger-full-access')).toContain('无人值守');
});

it('提交带 form=true（四 kind 白名单由 main 判），种类切换只改显示不重渲染', async () => {
  const upsert = vi.fn(async (_def: unknown, _form?: boolean) => ({ ok: true }));
  const b = boot(upsert, F);
  b.render();
  b.panel().fire('change', { preventDefault() {}, target: { id: 'schedKind', value: 'weekly' } });
  expect(b.body().dataset.kind).toBe('weekly');
  b.panel().fire('submit');
  await vi.waitFor(() => expect(upsert).toHaveBeenCalled());
  expect(upsert.mock.calls[0]?.[1], 'form=false 等于绕开表单白名单').toBe(true);
  expect(upsert.mock.calls[0]?.[0]).toMatchObject({ name: F.schedName, schedule: { kind: 'daily', time: '07:30' } });
});

it('被拒不报成功：主进程的拒因原样上屏，且不动列表', async () => {
  const b = boot(async () => ({ ok: false, error: 'prompt 超过 4000 字符上限（当前 5001）' }), F);
  b.render();
  b.panel().fire('submit');
  await vi.waitFor(() => expect(b.body().querySelector('#schedErr').textContent).toContain('4000 字符上限'));
  const msg = String(b.toast.mock.calls[0]?.[0] ?? '');
  expect(msg).toContain('未创建');
  expect(msg).not.toContain('已创建');
  expect(b.loadSchedule, '没创建成功就不该回读列表当没事发生').not.toHaveBeenCalled();
});

it('创建成功后回读快照重画，本地不插一行', async () => {
  const b = boot(async () => ({ ok: true }), F);
  b.render();
  b.panel().fire('submit');
  await vi.waitFor(() => expect(b.renderSide).toHaveBeenCalled());
  expect(String(b.toast.mock.calls[0]?.[0])).toContain('已创建定时任务：每晨跑一遍失败用例');
  expect(b.ctx.scheduleCache, '列表的唯一事实源是回读到的快照').toBeNull();
  expect(b.loadSchedule).toHaveBeenCalledWith(true);
});

/* ---- 抽屉行上的时刻文字：读的是 main 真存的字段 ---- */

function renderFace(cache: unknown) {
  const context: any = {
    esc: (s: unknown) => String(s),
    skipReasonLabel: (r: string) => r,
    WEEKDAY_CN: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
    HISTORY_STATES: ['all', 'queued', 'running', 'succeeded', 'failed', 'skipped', 'cancelled'],
    HISTORY_STATE_LABELS: { all: '全部状态', queued: '排队中', running: '运行中', succeeded: '成功', failed: '失败', skipped: '跳过', cancelled: '已取消' },
  };
  // 该切片自己 `let scheduleCache`，所以喂数据要在求值之后赋值（顶层 let 会遮蔽 context 全局）
  runInNewContext(section('/* 定时任务面板的纯渲染部分', '/* 记忆面板：两层')
    + '\nscheduleCache = ' + JSON.stringify(cache) + ';', context);
  return context;
}

it('每天/每周把时刻与日子写在行上（曾读 sc.at ⇒ 「每天 」空尾巴）', () => {
  const c = renderFace({ tasks: [], history: [] });
  expect(c.schedKindText({ kind: 'daily', time: '07:30' })).toBe('每天 07:30');
  expect(c.schedKindText({ kind: 'weekly', weekdays: [1, 3, 5], time: '07:30' })).toBe('每周 周一、周三、周五 07:30');
  expect(c.schedKindText({ kind: 'interval', everyMinutes: 30 })).toBe('每 30 分钟');
  expect(c.schedKindText({ kind: 'hourly', minute: 5 })).toBe('每小时 第 5 分');
  expect(c.schedKindText({ kind: 'monthly', monthDay: 1, time: '09:00' })).toBe('每月 1 日 09:00');
  expect(c.schedKindText({ kind: 'custom', everyDays: 3, time: '09:00' })).toBe('每 3 天 09:00');
});

it('空态不再写「后续接」，并指向真的入口', () => {
  const c = renderFace({ tasks: [], history: [] });
  const empty = c.scheduleViewHTML();
  expect(empty).not.toContain('后续接');
  expect(empty).toContain('定时任务');
});

it('芯片与弹层在静态标记里成对（aria-controls 指得到那个 pop）', () => {
  expect(htmlSource).toMatch(/id="ctxSched"[^>]*aria-controls="schedPanel"/);
  expect(htmlSource).toContain('<div class="ctx-pop" id="schedPanel" hidden>');
  expect(htmlSource).toContain('id="schedPanelBody"');
});

/* ---- 列表动作的回条（曾一律吞掉：失败与成功长得一样）---- */

function actFace(r: unknown, values: Record<string, string>) {
  const toast = vi.fn();
  const api = {
    scheduleUpsert: vi.fn(async (_def: unknown, _form?: boolean) => r as unknown),
    scheduleRunNow: vi.fn(async (_id: string) => r as unknown),
    scheduleDelete: vi.fn(async (_id: string) => r as unknown),
  };
  const ctx: any = {
    api, toast,
    scheduleCache: { tasks: [{ id: 'T1', name: '甲', enabled: true, schedule: { kind: 'hourly', minute: 5 } }] },
    loadSchedule: vi.fn(async () => {}),
    renderSide: vi.fn(),
    e: { target: { closest: () => ({ dataset: values, closest: () => ({ dataset: { id: 'T1' } }) }) } },
  };
  runInNewContext('async function act(e) {' + section("      const btn = e.target.closest('[data-sched-act]');", '    });') + '}', ctx);
  return { ctx, api, toast };
}

it('停用/启用不被表单白名单二次审判（form=false），失败时点名而不是静默翻回原样', async () => {
  const f = actFace({ ok: false, error: '调度器未初始化（fail-closed）' }, { schedAct: 'toggle' });
  await f.ctx.act(f.ctx.e);
  expect(f.api.scheduleUpsert.mock.calls[0]?.[1], '已存在的任务可能不在四 kind 内（如 hourly），开关不该重判种类').toBe(false);
  expect(String(f.toast.mock.calls[0]?.[0])).toContain('未执行');
});

it('立即运行/删除：ok=false 不许报成功', async () => {
  for (const act of ['run', 'del']) {
    const f = actFace({ ok: false, error: '并发满' }, { schedAct: act });
    await f.ctx.act(f.ctx.e);
    const msg = String(f.toast.mock.calls.map(c => String(c[0])).join('|'));
    expect(msg, act + ' 失败仍报成功').toContain('未执行');
    expect(msg).not.toMatch(/已加入队列|已删除/);
  }
});
