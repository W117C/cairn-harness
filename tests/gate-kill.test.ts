/** 门禁超时的终止阶梯（`scripts/lib/gate-kill.ts`）。
 *
 *  为什么用真子进程而不是注入假 signal：这条判据的全部内容就是「信号发给了谁、谁活着留下了什么」。
 *  假对象只能证明我们自己调了 `signal(-pid, "SIGKILL")`，证不出「被 SIGTERM 拦住的那个进程有没有
 *  机会走完自己的收尾」（关窗口、MCP close 链、写回账本）——那正是这次改动的动机：旧实现超时
 *  直接整组 SIGKILL，那些收尾一次都没机会跑。
 *  （注意：突变体不在这条判据的保护范围里，`execFileSync` 阻塞期间的信号被吞，见 lib/gate-kill 顶部。）
 *
 *  靶子一律「装好处理器之后写 ready 文件」，用例等到 ready 才动手：
 *  node 的 SIGTERM 处理器是注册时才接管，启动途中收到的信号走默认处置（直接死），
 *  不等这一格会把「没给机会」误读成「给了机会没接住」。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TERM_GRACE_MS, terminateGroup } from "../scripts/lib/gate-kill";
import { runCommand } from "../scripts/lib/gate-runner";

const scratch = process.env.PI_SCRATCH_DIR ?? tmpdir();
let ws = "";
let n = 0;
const spawned: ChildProcess[] = [];

/** 写一个独立 .js 靶子供 process.execPath 跑（临时目录在工作区外，.js 按 CJS 解析，配置走 argv[2] 的 JSON）。 */
async function script(body: string): Promise<string> {
  const p = join(ws, "s" + String(n++) + ".js");
  await writeFile(p, body);
  return p;
}

/** 起一个脱离会话的子进程：与 `gates.ts` 同形状（detached ⇒ 它是组长，负 pid 才是"整组"）。 */
function start(file: string, conf: unknown, pipeStdout = false): ChildProcess {
  const child = spawn(process.execPath, [file, JSON.stringify(conf ?? {})], {
    stdio: pipeStdout ? ["ignore", "pipe", "pipe"] : "ignore",
    detached: true,
  });
  spawned.push(child);
  return child;
}

const LIVE = "require('node:timers').setTimeout(() => {}, 60000);";
/** 装好 SIGTERM 处理器后才报 ready。 */
function readyLast(body: string): string {
  return "const fs = require('node:fs');" + body + "fs.writeFileSync(JSON.parse(process.argv[2]).ready, 'up');" + LIVE;
}

async function until(pred: () => boolean, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return pred();
}

function linesOf(file: string): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((l) => l !== "");
}

/** 进程是否还在（0 号信号只探测不伤）。 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

beforeEach(async () => {
  ws = await mkdtemp(join(scratch, "gate-kill-"));
  n = 0;
});

afterEach(async () => {
  // 兜底：还活着的整组收掉（组长已死时负 pid 仍然指向同一组）
  for (const c of spawned) {
    if (typeof c.pid === "number") {
      try {
        process.kill(-c.pid, "SIGKILL");
      } catch {
        /* 组已空 */
      }
    }
  }
  spawned.length = 0;
  await rm(ws, { recursive: true, force: true });
});

describe("门禁超时终止阶梯", () => {
  it("超时先给 SIGTERM：能自还原的子进程不会走到强杀（源文件有机会复原）", async () => {
    const marker = join(ws, "restored");
    const file = await script(
      readyLast("process.on('SIGTERM', () => { const fs2 = require('node:fs'); fs2.writeFileSync(JSON.parse(process.argv[2]).marker, 'restored'); process.exit(7); });"),
    );
    const child = start(file, { ready: join(ws, "r1"), marker });
    expect(await until(() => existsSync(join(ws, "r1")), 5_000)).toBe(true);
    const r = await terminateGroup(child, { graceMs: 5_000 });
    expect(r.escalated).toBe(false);
    // 关键读数：还原动作**真的发生了**（不是只看返回值）
    expect(readFileSync(marker, "utf8")).toBe("restored");
  });

  it("忽略 SIGTERM 的子进程：宽限到点升级到整组 SIGKILL，且确实先收到过 SIGTERM", async () => {
    const marker = join(ws, "sig");
    const file = await script(
      readyLast("process.on('SIGTERM', () => { require('node:fs').appendFileSync(JSON.parse(process.argv[2]).marker, 'term\\n'); });"),
    );
    const ready = join(ws, "r2");
    const child = start(file, { ready, marker });
    expect(await until(() => existsSync(ready), 5_000)).toBe(true);
    const t0 = Date.now();
    const r = await terminateGroup(child, { graceMs: 400 });
    expect(r.escalated).toBe(true);
    expect(linesOf(marker)).toContain("term"); // 一上来就 KILL 的话这一格是空的
    expect(Date.now() - t0).toBeGreaterThanOrEqual(350);
    expect(await until(() => !alive(child.pid ?? -1), 3_000)).toBe(true);
  });

  it("信号与强杀都按进程组：孙进程既收到过 SIGTERM，也随强杀一起没", async () => {
    const shared = join(ws, "sig");
    const gcReady = join(ws, "r3.gc");
    const ready = join(ws, "r3");
    const grand = await script(
      readyLast("process.on('SIGTERM', () => { require('node:fs').appendFileSync(JSON.parse(process.argv[2]).shared, 'grand\\n'); });"),
    );
    const file = await script(
      "const fs = require('node:fs');" +
        "const { spawn } = require('node:child_process');" +
        "const C = JSON.parse(process.argv[2]);" +
        "const gc = spawn(process.execPath, [C.grand, JSON.stringify({ ready: C.gcReady, shared: C.shared })]);" +
        "fs.writeFileSync(C.pidFile, String(gc.pid));" +
        "process.on('SIGTERM', () => fs.appendFileSync(C.shared, 'parent\\n'));" +
        "const t = setInterval(() => { if (fs.existsSync(C.gcReady)) { clearInterval(t); fs.writeFileSync(C.ready, 'up'); } }, 20);",
    );
    const pidFile = join(ws, "r3.gcpid");
    const child = start(file, { ready, shared, gcReady, pidFile, grand });
    expect(await until(() => existsSync(ready), 8_000)).toBe(true);
    const gcPid = Number(await readFile(pidFile, "utf8"));
    const r = await terminateGroup(child, { graceMs: 500 });
    expect(r.escalated).toBe(true);
    // 组内两支都被信号摸到过（只有负 pid 才成立）
    expect(linesOf(shared).sort()).toEqual(["grand", "parent"]);
    expect(await until(() => !alive(gcPid), 3_000)).toBe(true);
    expect(await until(() => !alive(child.pid ?? -1), 3_000)).toBe(true);
  });

  it("子进程在宽限内退出即落定：孙进程占着 stdout 也不悬挂（挂 exit 而非 close）", async () => {
    const ready = join(ws, "r4");
    const gcReady = join(ws, "r4.gc");
    const grand = await script(
      "const fs = require('node:fs');" +
        "process.on('SIGTERM', () => {});" + // 留着，继续占住继承来的 stdout 管道
        "fs.writeFileSync(JSON.parse(process.argv[2]).ready, 'up');" +
        LIVE,
    );
    const file = await script(
      "const fs = require('node:fs');" +
        "const { spawn } = require('node:child_process');" +
        "const C = JSON.parse(process.argv[2]);" +
        "spawn(process.execPath, [C.grand, JSON.stringify({ ready: C.gcReady })], { stdio: 'inherit' });" +
        "process.on('SIGTERM', () => process.exit(0));" +
        "const t = setInterval(() => { if (fs.existsSync(C.gcReady)) { clearInterval(t); fs.writeFileSync(C.ready, 'up'); } }, 20);",
    );
    const child = start(file, { ready, gcReady, grand }, true);
    child.stdout?.resume(); // 消费掉，避免无监听时缓冲
    expect(await until(() => existsSync(ready), 8_000)).toBe(true);
    const t0 = Date.now();
    const r = await terminateGroup(child, { graceMs: 12_000 });
    expect(r.escalated).toBe(false);
    expect(Date.now() - t0).toBeLessThan(3_000); // 12s 宽限远未到期就落定了
  });

  it("子进程已退出：立刻落定且不误报强杀", async () => {
    const file = await script("process.exit(0);");
    const child = start(file, {});
    expect(await until(() => child.signalCode !== null || child.exitCode !== null, 5_000)).toBe(true);
    const t0 = Date.now();
    const r = await terminateGroup(child, { graceMs: 8_000 });
    expect(r.escalated).toBe(false);
    expect(r.lastSignal).toBeUndefined(); // 一个信号都没发
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it("pid 取不到（spawn 失败形状）：不抛异常，宽限到点如实报升级", async () => {
    const live = await script("process.on('SIGTERM', () => {});" + LIVE);
    const real = start(live, { ready: join(ws, "r6") });
    const ghost = { pid: undefined, exitCode: null, signalCode: null, kill: () => false, once: () => undefined };
    const r = await terminateGroup(ghost, { graceMs: 200 });
    expect(r.escalated).toBe(true);
    expect(typeof r.note).toBe("string");
    expect(alive(real.pid ?? -1)).toBe(true); // 打不到组时不许误伤真进程（afterEach 负责收掉）
  });

  it("默认宽限给足收尾时间（关窗口、MCP close 链、写回账本都要真落地）", () => {
    expect(TERM_GRACE_MS).toBeGreaterThanOrEqual(5_000);
  });
});

/** 接缝：`gates.ts` 的超时支路**真的**走到上面那套阶梯。
 *
 *  判据抽到 lib 之后，"抽出去了但没人叫"是下一格的形状（本仓记过 17 次「两头断」）。
 *  lib/gate-runner 把「起进程 + 收输出 + 到点交给阶梯」收成一个可单测的函数，gates.ts 只剩组命令。
 */
describe("门禁跑命令的超时支路", () => {
  /** 跑一条我们自己的 -e 脚本（同 gates.ts：detached + 管道，超时由 spec 给）。 */
  async function run(body: string, ready: string, conf: Record<string, string>, spec: { timeoutMs: number; graceMs?: number }) {
    await writeFile(join(ws, "e.js"), body);
    return runCommand("probe", {
      cmd: process.execPath,
      args: [join(ws, "e.js"), JSON.stringify({ ...conf, ready })],
      timeoutMs: spec.timeoutMs,
      graceMs: spec.graceMs,
    });
  }

  it("子进程超时后自己退出：判红 124、输出写明阶梯走到了哪一步，且还原动作真发生", async () => {
    const marker = join(ws, "j1");
    const ready = join(ws, "j1.ready");
    const r = await run(
      readyLast("process.on('SIGTERM', () => { require('node:fs').writeFileSync(JSON.parse(process.argv[2]).marker, 'restored'); process.exit(7); });"),
      ready, { marker }, { timeoutMs: 1_500, graceMs: 6_000 },
    );
    expect(r.code).toBe(124);
    expect(r.output).toContain("超时");
    expect(r.output).toContain("SIGTERM");
    expect(readFileSync(marker, "utf8")).toBe("restored");
    expect(r.ms).toBeGreaterThanOrEqual(1_400);
  });

  it("超时后子进程以退出码 0 收场：仍是 124，不被自己的退出码翻绿（宽限带来的口子）", async () => {
    const ready = join(ws, "j0.ready");
    const r = await run(
      readyLast("process.on('SIGTERM', () => process.exit(0));"), // 把 SIGTERM 当"干完了"
      ready, {}, { timeoutMs: 1_500, graceMs: 6_000 },
    );
    expect(r.code).toBe(124);
    expect(r.output).toContain("超时");
  });

  it("子进程赖着不走：宽限到点整组强杀，输出如实写「已 SIGKILL」", async () => {
    const marker = join(ws, "j2");
    const ready = join(ws, "j2.ready");
    const t0 = Date.now();
    const r = await run(
      readyLast("process.on('SIGTERM', () => { require('node:fs').appendFileSync(JSON.parse(process.argv[2]).marker, 'term\\n'); });"),
      ready, { marker }, { timeoutMs: 1_200, graceMs: 400 },
    );
    expect(r.code).toBe(124);
    expect(r.output).toContain("SIGKILL");
    expect(linesOf(marker)).toContain("term");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1_550); // 宽限确实用满了，不是提前放弃
  });

  it("没超时的门：透传退出码、收全 stdout，信号一个都不发", async () => {
    const marker = join(ws, "j3");
    const r = await run(
      "const fs = require('node:fs');" +
        "process.on('SIGTERM', () => fs.writeFileSync(JSON.parse(process.argv[2]).marker, 'term'));" +
        "console.log('gate said hello');" +
        "process.exit(3);",
      join(ws, "j3.ready"), { marker }, { timeoutMs: 20_000 },
    );
    expect(r.code).toBe(3);
    expect(r.output).toContain("gate said hello");
    expect(r.output).not.toContain("超时");
    expect(existsSync(marker)).toBe(false);
  });
});
