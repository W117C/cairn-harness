import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { TerminalHost, type TerminalPush } from '../src/main/terminal-host';

const hosts: TerminalHost[] = [];
afterEach(() => { for (const host of hosts.splice(0)) host.killAll(); });
const waitFor = async (test: () => boolean) => {
  const start = Date.now();
  while (Date.now() - start < 6000) {
    if (test()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('真实 PTY 未返回预期结果');
};
async function terminal(owner?: Parameters<TerminalHost['start']>[2]) {
  const events: TerminalPush[] = [];
  const host = new TerminalHost(e => events.push(e));
  hosts.push(host);
  const result = await host.start(tmpdir(), { ...process.env, SHELL: '/bin/sh', ENV: '/dev/null' }, owner);
  if (!result.ok) throw new Error(result.error);
  const output = () => events.filter((e): e is Extract<TerminalPush, {kind:'data'}> => e.kind === 'data' && e.id === result.id).map(e => e.data).join('');
  const size = async (tag: string) => {
    // 标记用八进制生成，输入回显不可能冒充真实输出。
    const prefix = Array.from(`SIZE_${tag}:`).map(c => '\\' + c.charCodeAt(0).toString(8).padStart(3,'0')).join('');
    host.write(result.id, `printf '${prefix}'; stty size\n`);
    const pattern = new RegExp(`SIZE_${tag}:(\\d+) (\\d+)`);
    await waitFor(() => pattern.test(output()));
    const match = output().match(pattern)!;
    return { rows: Number(match[1]), cols: Number(match[2]) };
  };
  return { host, id: result.id, events, size };
}
describe.runIf(process.platform === 'darwin')('真实 PTY 的窗口尺寸与退出状态', () => {
  it('初始行列不是 0×0，登录 shell 从第一条命令就有有效尺寸', async () => {
    const t = await terminal();
    expect(await t.size('INITIAL')).toEqual({ rows: 24, cols: 80 });
  });
  it('缩窄再放大都更新内核尺寸，非法输入和已关闭 ID 不写入控制流', async () => {
    const t = await terminal();
    expect(t.host.resize(t.id, 61, 11)).toBe(true);
    expect(await t.size('NARROW')).toEqual({ rows: 11, cols: 61 });
    expect(t.host.resize(t.id, 103, 29)).toBe(true);
    expect(await t.size('WIDE')).toEqual({ rows: 29, cols: 103 });
    for (const [cols,rows] of [[0,10],[-1,10],[10,0],[1.5,10],[Infinity,10],[NaN,10],[65536,10]]) {
      expect(t.host.resize(t.id, cols, rows)).toBe(false);
    }
    expect(await t.size('UNCHANGED')).toEqual({ rows: 29, cols: 103 });
    t.host.kill(t.id);
    expect(t.host.resize(t.id, 80, 24)).toBe(false);
    expect(t.host.resize('unknown', 80, 24)).toBe(false);
  });
  it('退出码来自 shell，exit 7 不会显示成成功的 0', async () => {
    const t = await terminal();
    t.host.write(t.id, 'exit 7\n');
    await waitFor(() => t.events.some(e => e.kind === 'exit' && e.id === t.id));
    expect(t.events.find(e => e.kind === 'exit' && e.id === t.id)).toEqual({ kind: 'exit', id: t.id, code: 7 });
  });
  it('同一窗口只订阅一次关闭事件，关闭它不会杀掉另一个窗口的终端', async () => {
    let closed = false;
    const owner = Object.assign(new EventEmitter(), { isDestroyed: () => closed });
    const otherOwner = Object.assign(new EventEmitter(), { isDestroyed: () => false });
    const t = await terminal(owner);
    const env = { ...process.env, SHELL: '/bin/sh', ENV: '/dev/null' };
    const sibling = await t.host.start(tmpdir(), env, owner);
    const other = await t.host.start(tmpdir(), env, otherOwner);
    if (!sibling.ok || !other.ok) throw new Error('测试终端未启动');
    expect(owner.listenerCount('closed')).toBe(1);
    closed = true;
    owner.emit('closed');
    await waitFor(() => t.events.some(e => e.kind === 'exit' && e.id === t.id));
    expect(t.host.write(t.id, '')).toBe(false);
    expect(t.host.write(sibling.id, '')).toBe(false);
    expect(t.host.write(other.id, '')).toBe(true);
    expect((await t.host.start(tmpdir(), env, owner)).ok).toBe(false);
  });
  it.each(['window', 'application'])('初始化中 %s 关闭时取消启动，不产生失联会话', async (kind) => {
    let closed = false;
    const owner = Object.assign(new EventEmitter(), { isDestroyed: () => closed });
    const events: TerminalPush[] = [];
    const host = new TerminalHost(e => events.push(e));
    hosts.push(host);
    const pending = host.start(tmpdir(), { ...process.env, SHELL: '/bin/sh', ENV: '/dev/null' }, owner);
    if (kind === 'window') { closed = true; owner.emit('closed'); }
    else host.killAll();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('已取消的启动不能返回终端 id');
    expect(result.error).toContain('取消');
    expect(events).toEqual([]);
  });
});
