// 产品真正走的那一路：PTY 里 `execvp($SHELL, [$SHELL, '-l'])`（见 `src/main/pty-bridge.ts`）。
//
// 为什么另立一条：`terminal-size.test.ts` 刻意用 `/bin/sh` ⇒ **登录 shell 那一路没有判卷**。
// 2026-10-21 那次「PTY 里命令只回显不执行」走的正是登录 shell（读用户自己的 `~/.zshrc`），
// 而判卷全绿 ⇒ **复发会静默**（用户看到的是坏窗格，仓里看到的是绿）。
//
// 这一条镜像产品的调用形状：真登录 shell ＋ **隔离 HOME**（不读用户自己的 rc ⇒ 可复跑、
// 不受个人 shell 配置影响）。它量的是「命令真的执行了」，不是「回显长得像输出」——
// 标记用八进制生成，回显冒充不了（与既有那条同一个手法）。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TerminalHost, type TerminalPush } from '../src/main/terminal-host';

const hosts: TerminalHost[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.killAll();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const waitFor = async (test: () => boolean) => {
  const start = Date.now();
  while (Date.now() - start < 6000) {
    if (test()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('真实 PTY 未返回预期结果');
};

/** 产品形状：登录 shell（`-l`）＋ 隔离 HOME。 */
async function loginShellTerminal() {
  const home = mkdtempSync(join(tmpdir(), 'cairn-term-home-'));
  dirs.push(home);
  const events: TerminalPush[] = [];
  const host = new TerminalHost(e => events.push(e));
  hosts.push(host);
  const shell = process.env.SHELL || '/bin/zsh';
  const result = await host.start(tmpdir(), { ...process.env, SHELL: shell, HOME: home, ENV: '/dev/null' });
  if (!result.ok) throw new Error(result.error);
  const output = () => events
    .filter((e): e is Extract<TerminalPush, { kind: 'data' }> => e.kind === 'data' && e.id === result.id)
    .map(e => e.data)
    .join('');
  return { host, id: result.id, events, output };
}

describe.runIf(process.platform === 'darwin')('登录 shell 那一路（产品真正 exec 的形状）', () => {
  it('命令**真的执行**（不是只有回显）：产品走 $SHELL -l，判卷先前只量 /bin/sh', async () => {
    const t = await loginShellTerminal();
    // 标记用八进制生成 ⇒ 终端自己的回显冒充不了它（回显出来的是转义序列，不是 MARK）。
    const prefix = Array.from('MARK:').map(c => '\\' + c.charCodeAt(0).toString(8).padStart(3, '0')).join('');
    t.host.write(t.id, `printf '${prefix}'\n`);
    await waitFor(() => t.output().includes('MARK:'));
    expect(t.output()).toContain('MARK:');
  });

  it('命令的**退出码**来自那个 shell（不是回显出来的文本）', async () => {
    const t = await loginShellTerminal();
    t.host.write(t.id, 'exit 7\n');
    await waitFor(() => t.events.some(e => e.kind === 'exit' && e.id === t.id));
    expect(t.events.find(e => e.kind === 'exit' && e.id === t.id)).toEqual({ kind: 'exit', id: t.id, code: 7 });
  });

  it('反向：把「命令真的执行」那一格抽掉（只看回显）⇒ 上面那条会红（证明它不是恒真）', async () => {
    const t = await loginShellTerminal();
    t.host.write(t.id, "printf 'ECHO_ONLY\\n'\n");
    await waitFor(() => t.output().includes('ECHO_ONLY'));
    // 回显里**没有**那个标记 ⇒ 「只回显」与「真执行」是分得开的两件事。
    const echoed = t.output();
    const marker = Array.from('ECHO_ONLY').map(c => '\\' + c.charCodeAt(0).toString(8).padStart(3, '0')).join('');
    expect(echoed).not.toContain(marker);
  });
});
