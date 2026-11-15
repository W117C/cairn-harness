// run_shell 的判卷面执行层闸（2026-11-15，F1 的跨平台地板）。
//
// 词法闸认不出 `python3 -c` / `node -e` / 变量间接这些形状（见 shell-write-targets 的模块注释）；
// macOS 上由 Seatbelt literal 拒绝承重（tests/sandbox-frozen-deny.test.ts）。本文件判的是**无沙箱
// 宿主**（Linux/Windows/自检失败）也成立的那条地板：跑前按字节取基线，跑后逐字节复查，变了就复原
// 并把这次调用判失败。判据只看盘上字节与 tool_result，不看实现细节。
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { listBackgroundTasks, settleAllBackgroundTasks, task_stop } from "../src/tools/background-tasks";
import { run_shell } from "../src/tools/run_shell";
import type { ToolContext } from "../src/tools/base";
import { SNAPSHOT_ROOT } from "../src/tools/snapshot";
import { FROZEN_GUARD_TAG, FROZEN_GUARD_TAINT } from "../src/tools/frozen-guard";

const created: string[] = [];
let ws = "";
const JUDGE = "fixtures/mock/judge.ts";
const TABLE = "scripts/frozen-sha256.json";

beforeEach(async () => {
  ws = await realpath(await mkdtemp(join(tmpdir(), "dsh-frozen-guard-")));
  created.push(ws);
  await mkdir(join(ws, "fixtures", "mock"), { recursive: true });
  await mkdir(join(ws, "scripts"), { recursive: true });
  await writeFile(join(ws, JUDGE), "original", "utf8");
  await writeFile(join(ws, TABLE), JSON.stringify({ [JUDGE]: "0".repeat(64) }), "utf8");
});
afterAll(async () => {
  for (const dir of created) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

const ctx = (): ToolContext => ({ workspace: ws, callId: "frozen-guard" });
const run = async (command: string) => await run_shell.run({ command }, ctx());
const judge = (): Promise<string> => readFile(join(ws, JUDGE), "utf8");

describe("run_shell 判卷面执行层闸（无沙箱地板）", () => {
  it("① 解释器写冻结文件（词法认不出）⇒ 跑完逐字节复原、回执点名、本次判失败", async () => {
    const r = await run(`python3 -c "open('${JUDGE}','w').write('hacked')"`);
    expect(r.ok, "改动判卷面的调用不能读成成功").toBe(false);
    expect(r.output).toContain(FROZEN_GUARD_TAG);
    expect(r.output).toContain(JUDGE);
    expect(r.output).toContain(FROZEN_GUARD_TAINT);
    // 回执里那句「已按调用前内容逐字节复原」是对模型可见的能力断言：逐字点住它，别让文案漂走。
    expect(r.output).toContain("已按调用前内容逐字节复原");
    expect(await judge(), "盘上必须逐字节回到调用前").toBe("original");
    // 改动前的字节留档（审计面）——看得见才叫证据（留档目录带时间戳，按后缀找）。
    const dirs = (await readdir(join(ws, SNAPSHOT_ROOT))).filter((d) => d.endsWith("--frozen-guard"));
    expect(dirs.length, "必须留下一次守卫留档").toBe(1);
    expect(await readFile(join(ws, SNAPSHOT_ROOT, dirs[0]!, "fixtures", "mock", "judge.ts"), "utf8")).toBe("hacked");
  });

  it("② 删除冻结文件 ⇒ 复原出原件（不是留一个空洞）", async () => {
    const r = await run(`python3 -c "import os; os.remove('${JUDGE}')"`);
    expect(r.ok).toBe(false);
    expect(await judge()).toBe("original");
  });

  it("③ 用目录替换冻结文件 ⇒ 复原时先摘掉非普通文件，再原子写回", async () => {
    const r = await run(`python3 -c "import os; os.remove('${JUDGE}'); os.mkdir('${JUDGE}')"`);
    expect(r.ok).toBe(false);
    expect(await judge()).toBe("original");
  });

  it("④ 基线表自身被改 ⇒ 同样复原（改表＝改判据）", async () => {
    const original = await readFile(join(ws, TABLE), "utf8");
    const r = await run(`python3 -c "open('${TABLE}','w').write('{}')"`);
    expect(r.ok).toBe(false);
    expect(await readFile(join(ws, TABLE), "utf8")).toBe(original);
  });

  it("⑤ 配对：写非冻结文件照常成功、不出现守卫回执（闸不是恒红）", async () => {
    const r = await run("echo fine > plain.txt");
    expect(r.ok).toBe(true);
    expect(r.output).not.toContain(FROZEN_GUARD_TAG);
    expect(await readFile(join(ws, "plain.txt"), "utf8")).toBe("fine\n");
  });

  it("⑥ 软链别名：spawn 前按真实落点拒绝（词法闸与执行层闸互补的那一格）", async () => {
    await symlink(join(ws, JUDGE), join(ws, "alias.ts"));
    await expect(run("echo hacked > alias.ts")).rejects.toThrow(/判卷文件冻结/);
    expect(await judge()).toBe("original");
  });

  it("⑦ 后台命令：done 之前完成复查，守卫说明进该任务的输出环", async () => {
    const logPath = join(ws, "events.jsonl");
    const bgCtx: ToolContext = { workspace: ws, callId: "frozen-bg", sessionLogPath: logPath };
    const started = await run_shell.run(
      { command: `python3 -c "open('${JUDGE}','w').write('hacked')"`, background: true },
      bgCtx,
    );
    expect(started.ok).toBe(true);
    const id = (started.output.match(/后台任务已启动：(\S+)/) ?? [])[1];
    expect(id, "后台任务号必须能读出来").toBeTruthy();
    const deadline = Date.now() + 10_000;
    let status = listBackgroundTasks(logPath)[0];
    while ((status === undefined || !status.done) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      status = listBackgroundTasks(logPath)[0];
    }
    expect(status?.done, "后台任务必须在预算内收束").toBe(true);
    expect(status?.output).toContain(FROZEN_GUARD_TAG);
    expect(await judge()).toBe("original");
  }, 20_000);

  it("⑧ task_stop 收束：停止回执返回前已跑完复查，守卫说明就在回执里", async () => {
    const logPath = join(ws, "events-stop.jsonl");
    const bgCtx: ToolContext = { workspace: ws, callId: "frozen-bg-stop", sessionLogPath: logPath };
    const started = await run_shell.run(
      // 先改判卷面、再挂住：stop 时命令仍在跑，收束必须走 kill → 等退出 → 复查这条链。
      { command: `python3 -c "open('${JUDGE}','w').write('hacked')"; exec sleep 30`, background: true },
      bgCtx,
    );
    expect(started.ok).toBe(true);
    const id = (started.output.match(/后台任务已启动：(\S+)/) ?? [])[1];
    expect(id, "后台任务号必须能读出来").toBeTruthy();
    const deadline = Date.now() + 10_000;
    while ((await judge()) !== "hacked" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(await judge(), "命令必须先把判卷面改掉，否则这条判卷量不到收束链").toBe("hacked");
    const stopped = await task_stop.run({ task_id: id! }, bgCtx);
    // 停止回执当场就要带守卫结论：旧实现先报 done、复查在 close 后异步补进输出环，
    // 模型读到的「已停止」里没有那句污染说明（顺序反了 = 把一次越界读成一次普通停止）。
    expect(stopped.ok).toBe(true);
    expect(stopped.output).toContain(FROZEN_GUARD_TAG);
    expect(stopped.output).toContain(FROZEN_GUARD_TAINT);
    expect(await judge(), "停止返回时盘上必须已复原").toBe("original");
    expect(listBackgroundTasks(logPath)[0]?.done).toBe(true);
  }, 20_000);

  it("⑨ 退出收束：settleAllBackgroundTasks 返回时盘上已复原、任务已收束", async () => {
    const logPath = join(ws, "events-quit.jsonl");
    const bgCtx: ToolContext = { workspace: ws, callId: "frozen-bg-quit", sessionLogPath: logPath };
    const started = await run_shell.run(
      // 改完判卷面就挂住：退出收束必须先组杀、等退出、再复查，一步都不能跳。
      { command: `python3 -c "open('${JUDGE}','w').write('hacked')"; exec sleep 30`, background: true },
      bgCtx,
    );
    expect(started.ok).toBe(true);
    const deadline = Date.now() + 10_000;
    while ((await judge()) !== "hacked" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(await judge(), "命令必须先把判卷面改掉，否则这条判卷量不到退出收束").toBe("hacked");
    // 桌面会在 before-quit 等这一个；它返回之后才让进程退，`will-quit` 的同步组杀才不会抢在前面。
    await settleAllBackgroundTasks();
    expect(await judge(), "返回时盘上必须已复原").toBe("original");
    const status = listBackgroundTasks(logPath)[0];
    expect(status?.done, "返回时任务必须已收束").toBe(true);
    expect(status?.stopped).toBe(true);
    expect(status?.output).toContain(FROZEN_GUARD_TAG);
  }, 20_000);
});
