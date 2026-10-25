import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalHost, type TerminalPush } from '../src/main/terminal-host';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

function child() {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn(),
  });
  queueMicrotask(() => proc.emit('spawn'));
  return proc;
}
beforeEach(() => vi.mocked(spawn).mockReset());

describe.runIf(process.platform === 'darwin')('PTY 进程退出与管道排空', () => {
  it('exit 后 close 前仍可能有字节：先读完整中文，再发终端退出', async () => {
    const proc = child();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);
    const events: TerminalPush[] = [];
    const host = new TerminalHost(e => events.push(e));
    const started = await host.start(null);
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error('测试终端未启动');
    const bytes = Buffer.from('你好');
    proc.stdout.emit('data', bytes.subarray(0, 4));
    proc.emit('exit', 0);
    expect(host.write(started.id, 'after-exit')).toBe(false);
    expect(events.filter(e => e.kind === 'exit')).toHaveLength(0);
    proc.stdout.emit('data', bytes.subarray(4));
    proc.emit('close', 0);
    expect(events.filter(e => e.kind === 'data').map(e => e.data).join('')).toBe('你好');
    expect(events.at(-1)).toEqual({ kind: 'exit', id: started.id, code: 0 });
    expect(events.filter(e => e.kind === 'exit')).toHaveLength(1);
  });
  it('进程错误与随后的 close 只发一次退出', async () => {
    const proc = child();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);
    const events: TerminalPush[] = [];
    const host = new TerminalHost(e => events.push(e));
    const started = await host.start(null);
    if (!started.ok) throw new Error('测试终端未启动');
    proc.emit('error', new Error('ENOENT'));
    proc.emit('close', -2);
    expect(events.filter(e => e.kind === 'exit')).toEqual([{ kind: 'exit', id: started.id, code: null }]);
    expect(host.write(started.id, 'x')).toBe(false);
  });
});
