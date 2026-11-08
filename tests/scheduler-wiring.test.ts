// 调度器接线判卷（M4 路线图交付物）：serve 常驻入口真的调起 initScheduler＋startScheduler
// （调度器可收任务定义、automation_create 工具面被装上）、stop 真停（running true→false、可再启）。
// 反向证人钉生产接线：cli.ts 里 serveScheduler( 必须以非注释形态出现——注释掉入口那行这条就红。
// 来源：路线图 M4 任务书「调度器有生产调用者且有判卷钉住（摘掉调用 → 判卷红）」。
// 注：automation_create 的 run 走权限门（currentSession fail-closed），这里收任务走
// getScheduler().upsert（调度器自身入口）——工具面的「在场」单独断言，运行面归会话判卷。
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { getScheduler, serveScheduler, schedulerRunning } from "../src/main/agent-runner";
import { Scheduler } from "../src/main/scheduler";
import { TOOLS } from "../src/tools";

const CLI_SRC = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const DESKTOP_MAIN_SRC = fileURLToPath(new URL("../apps/desktop/src/main/index.ts", import.meta.url));

let ws = "";
let handle: { stop: () => void } | null = null;

afterEach(() => {
  handle?.stop();
  handle = null;
});

describe("调度器接线（M4：--serve 常驻入口）", () => {
  it("① serve 入口调起 initScheduler＋startScheduler：running 翻真、调度器可收任务定义并落盘", async () => {
    ws = await mkdtemp(join(tmpdir(), "scheduler-wiring-"));
    handle = await serveScheduler({ workspace: ws });
    expect(schedulerRunning(), "serveScheduler 返回后调度器必须在跑（否则入口没接线）").toBe(true);
    expect(
      (TOOLS as unknown as Record<string, unknown>).automation_create,
      "常驻进程的自动化工具面必须被装上（automation_create 在 TOOLS 里）",
    ).toBeTruthy();
    const up = await getScheduler()!.upsert(
      { name: "probe", prompt: "空转探针", schedule: { kind: "interval", everyMinutes: 5 } },
      { form: true },
    );
    expect(up.ok, `upsert 失败：${"errors" in up ? JSON.stringify((up as { errors?: string[] }).errors ?? []) : ""}`).toBe(true);
    expect(existsSync(join(ws, ".agent", "schedules", "automations.json")), "任务定义应落 <ws>/.agent/schedules/automations.json").toBe(true);
  });

  it("② stop 真停（running 翻假）且可再启（重启后 running 翻回真）", async () => {
    handle?.stop();
    expect(schedulerRunning(), "stop 之后调度器必须停（timer 已清）").toBe(false);
    handle = await serveScheduler({ workspace: ws });
    expect(schedulerRunning(), "重启后必须回真（停得下来也要启得回来）").toBe(true);
  });

  it("③ 反向证人：cli.ts 的 serveScheduler 接线必须以非注释形态存在（注释掉入口那行 = 常驻模式无门）", async () => {
    const src = await readFile(CLI_SRC, "utf8");
    const live = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(live).toMatch(/serveScheduler\(\{ workspace: opts\.workspace \}\)/);
  });

  it("④ 反向证人（桌面，v2.14）：apps/desktop main 以非注释形态调 serveScheduler（摘掉 = 桌面端快照恒空、CRUD fail-closed）", async () => {
    const src = await readFile(DESKTOP_MAIN_SRC, "utf8");
    const live = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    const options = live.match(/serveScheduler\(\{([\s\S]*?)\}\)\.then/)?.[1];
    expect(options, "桌面主进程必须常驻启动调度器").toBeDefined();
    expect(options).toMatch(/workspace:\s*canonicalWorkspacePath\(workspace\)/);
    expect(options).toMatch(/isAgentBusy:\s*\(\)\s*=>\s*host\.runningCount\(\)\s*>\s*0/);
    expect(options).toMatch(/isIdleWorkspaceAvailable:\s*\(target\)\s*=>\s*host\.hasWorkspace\(target\)/);
    // 停表同样必须在（起点接线而退出不停 = timer 泄漏）
    expect(live).toMatch(/will-quit[\s\S]{0,80}stopDesktopScheduler/);
  });

  it("⑤ 闲时任务状态机：已取消的任务不能再暂停，且拒绝句说得出原因", async () => {
    // 这句「当前状态不支持此操作」是用户可见的能力断言；promise-recall-inventory 的欠证人帽
    // 要求它必须被一条判卷真的点过（不是把原句抄进注释，而是走一次真实状态迁移）。
    const root = await mkdtemp(join(tmpdir(), "scheduler-idle-witness-"));
    const scheduler = new Scheduler({
      dataDir: root, sessionsDir: join(root, "sessions"), workspace: root,
      clock: () => Date.parse("2026-11-05T08:00:00Z"), jitterMs: () => 0,
      // 本地闲时队列只在给了 isAgentBusy 的宿主里启用；恒忙 = 永不分派，这条只验状态机。
      isAgentBusy: () => true,
      runSession: async () => ({ ok: true }),
    });
    expect(await scheduler.enqueueIdleTask({ name: "证人探针", prompt: "不执行", permissionTier: "workspace-write" })).toEqual({ ok: true });
    const task = (await scheduler.idleTaskSnapshot()).tasks[0]!;
    expect(await scheduler.updateIdleTask(task.id, "cancel")).toEqual({ ok: true });
    expect(await scheduler.updateIdleTask(task.id, "pause")).toEqual({ ok: false, error: "当前状态不支持此操作" });
    await rm(root, { recursive: true, force: true });
  });
});
