// A3：worker 的 shell 面此前整支在 Seatbelt 之外。
//
// 事实链（逐条都可在下面这批断言里复核）：主会话那道沙箱门判的是 `name === "run_shell"`
// （src/main/agent-runner.ts），而 worker 发的命令叫 `shell_ro`/`shell_rw`，走的是
// src/agent/worker-tool-table.ts 里另一扇门 ⇒ 判不到。worker-tool-table.ts 修之前
// 「sandbox」零命中，worker-shell-tools.ts 直接调裸 run_shell。
//
// 修法是注入：src/agent 不许反向依赖 src/main（沙箱实现在 main 侧），所以宿主把出口
// 递下来。这批用例钉的是**接线本身**——摘掉注入即红，不是钉某个形状。
// 「即红」这句原本也盖住了宿主侧那一批，2026-09-29 实测**盖不住**：那条路走的是源文本，
// 把可用态整条路改死、守卫一字不动，7 条全绿。宿主侧现在改为直接调 `workerShellRunnerFor` 看决定。
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildWorkerToolTable } from "../src/agent/worker-tool-table";
import { makeShellRo, makeShellRw, shell_ro, shell_rw } from "../src/agent/worker-shell-tools";
import { newAutonomySession } from "../src/permissions";
import type { WorkerHandle } from "../src/agent/orchestrator-types";
import type { ToolContext } from "../src/tools/base";

let ws = "";
afterEach(async () => { if (ws) await rm(ws, { recursive: true, force: true }); });

/** 真造一个 AutonomySession：工具门要过 evaluate 全管线（planBlocked / risk / rules 都是真的），
 *  用假对象顶替会在 evaluate 里炸，而炸点与本组要验的接线无关。 */
function fakeW(mode: "read" | "write"): WorkerHandle {
  const session = newAutonomySession("auto", { rules: [], sandboxAvailable: true, planBlocked: () => false });
  return {
    mode,
    agentId: "a-fake",
    autonomy: session,
    toolAutonomy: newAutonomySession("auto", { rules: [], sandboxAvailable: true, planBlocked: () => false }),
    editAnchors: new Map(),
    snapshots: new Map(),
  } as unknown as WorkerHandle;
}

async function ctx(): Promise<ToolContext> {
  ws = await mkdtemp(join(tmpdir(), "a3-sandbox-"));
  return { workspace: ws };
}

describe("worker shell 走注入的执行出口", () => {
  it("注入的出口拿到 worker 发的原始命令，缺省出口是裸 run_shell", async () => {
    const seen: string[] = [];
    const c = await ctx();
    const injected = makeShellRw(async (command) => {
      seen.push(command);
      return { ok: true, output: "SENTINEL" };
    });
    // 静态闸在前：这条命令是只读 git 子命令，能过拦截层。
    const got = await injected.run({ command: "git status" }, c);
    expect(got.output).toBe("SENTINEL");
    expect(seen).toEqual(["git status"]);

    // 缺省那份走裸 run_shell：真跑一次，拿到的是真命令输出而不是哨兵。
    const bare = await shell_rw.run({ command: "echo bare-default" }, c);
    expect(bare.ok).toBe(true);
    expect(bare.output).toContain("bare-default");
  });

  it("shell_ro 的只读闸排在出口之前：写向命令根本到不了注入的出口", async () => {
    const seen: string[] = [];
    const c = await ctx();
    const injected = makeShellRo(async (command) => {
      seen.push(command);
      return { ok: true, output: "SENTINEL" };
    });
    const got = await injected.run({ command: "printf 'x' >> note.txt" }, c);
    expect(got.ok).toBe(false);
    expect(seen).toEqual([]); // 静态闸拦下 ⇒ 出口一次都没被调用
    // 缺省那份的同一性质（write-face.test.ts 也在钉这条，两处是同一个前提）
    const bare = await shell_ro.run({ command: "printf 'x' >> note.txt" }, c);
    expect(bare.ok).toBe(false);
  });

  it("工具表把注入的出口接到 shell_ro / shell_rw 上（read + write 两种 worker）", async () => {
    const c = await ctx();
    const seen: string[] = [];
    const shell = async (command: string) => {
      seen.push(command);
      return { ok: true, output: "SENTINEL" };
    };
    // read worker 只有 shell_ro
    const readTable = buildWorkerToolTable(fakeW("read"), {} as never, { shell });
    expect(Object.keys(readTable)).toContain("shell_ro");
    expect(Object.keys(readTable)).not.toContain("shell_rw");
    const ro = await readTable.shell_ro!.run({ command: "ls -la" }, c);
    expect(ro.output).toBe("SENTINEL");

    // write worker 只有 shell_rw，且它拿到的是同一只注入出口
    const writeTable = buildWorkerToolTable(fakeW("write"), {} as never, { shell });
    expect(Object.keys(writeTable)).toContain("shell_rw");
    expect(Object.keys(writeTable)).not.toContain("shell_ro");
    const rw = await writeTable.shell_rw!.run({ command: "git status" }, c);
    expect(rw.output).toBe("SENTINEL");
    expect(seen).toEqual(["ls -la", "git status"]);
  });

  it("不注入 = 落回裸 run_shell（没有沙箱的宿主上唯一能跑的口径，与主会话同一条降级线）", async () => {
    const c = await ctx();
    const table = buildWorkerToolTable(fakeW("write"), {} as never);
    const got = await table.shell_rw!.run({ command: "echo no-sandbox-host" }, c);
    expect(got.ok).toBe(true);
    expect(got.output).toContain("no-sandbox-host");
  });
});

// 接线是两层：上面那批证明「注入进去就会被用」，这一批证明「宿主真的注入了」。
// 少任何一层，worker 都照样在 Seatbelt 之外跑，而两批都会绿。
describe("宿主侧接线：沙箱可用时把沙箱出口递给 worker", () => {
  const RUNNER = "src/main/agent-runner.ts";

  it("唯一的编排器构造口按沙箱状态决定是否注入 worker 出口", async () => {
    const src = await readFile(RUNNER, "utf8");
    // 判据与主会话 run_shell 那道门同口径：null 或不可用 ⇒ 不注入（落回裸执行）。
    expect(src).toMatch(/function workerShellRunnerFor\(sandbox: SandboxStatus \| null\)/);
    expect(src).toMatch(/if \(sandbox === null \|\| !sandbox\.available\) return undefined;/);
    // 注入点挂在唯一的构造口上（不是某条旁路）。
    expect(src).toMatch(/\.\.\.\(workerShell \? \{ workerShell \} : \{\}\),/);
  });

  it("沙箱出口默认断网（worker 门里没有 networkProfileFor 的审批上下文）", async () => {
    const src = await readFile(RUNNER, "utf8");
    expect(src).toMatch(/runInSandbox\(mapped, \{ cwd: ctx\.workspace, network: "deny" \}\)/);
  });

  it("core 层不许反向依赖 src/main——所以出口只能是注入，不能是 worker-shell-tools 自己 import", async () => {
    const shellTools = await readFile("src/agent/worker-shell-tools.ts", "utf8");
    const table = await readFile("src/agent/worker-tool-table.ts", "utf8");
    expect(shellTools).not.toMatch(/from "\.\.\/main\//);
    expect(table).not.toMatch(/from "\.\.\/main\//);
  });
});

/* 上一批把「守卫原文在」当成了「守卫在生效」。实测那不成立（2026-09-29）：把**可用态**那条路改成
   `return undefined`、守卫 `if (sandbox === null || !sandbox.available) return undefined;` 一字不动，
   上面 7 条全绿——而那正是本文件开头点名的形状：worker 悄悄退回 Seatbelt 之外跑。
   源文本钉不住「那一条路通不通」，只有**把决定本身调出来看**才钉得住。 */
describe("宿主侧接线：装不装这个决定本身可判（L-3）", () => {
  it("沙箱可用 ⇒ 交出出口；不可用 / 没接线 ⇒ 交出 undefined（落回裸执行，与主会话同一条降级线）", async () => {
    const { workerShellRunnerFor } = await import("../src/main/agent-runner");
    expect(workerShellRunnerFor(null)).toBeUndefined();
    expect(workerShellRunnerFor({ available: false, reason: "Seatbelt 不可用" })).toBeUndefined();
    // 这一格才是有牙的那格：守卫原文照样在，只有这条路死了也只有它红
    expect(typeof workerShellRunnerFor({ available: true })).toBe("function");
  });
});
