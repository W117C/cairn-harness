// kernel-host 纵向装配判卷（headless，可进 CI）：createKernelHost 一个入口装配
// 会话目录 / 记忆家 / settings 存储 / 宿主依赖 / 工具注册 / UI 三通道，再跑一场 demo run。
// demo 通道不拨号不花钱（spec §3.2）：settings provider=demo + M3A_AGENTS_DEMO=1 ⇒
// 主模型走 fixtures/agents/main-demo.jsonl 剧本，spawn 的 worker 走同名剧本（read-worker/slow-worker）。
// M3 T1 起装配面升级为多工作区（workspaces + activeWorkspace）：会话→工作区归属、跨工作区
// 列举/建会话走 sessions.ts root 注入族、漂移检测（外部改动拒绝 run 不静默覆盖）。
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createKernelHost, type KernelHost } from "../src/main/kernel-host";
import { pathOf } from "../../../src/main/sessions";

const dir = mkdtempSync(join(tmpdir(), "m0-host-"));
const workspace = join(dir, "ws");
const wsA = join(dir, "ws-a");
const wsB = join(dir, "ws-b");
const userData = join(dir, "userData");
mkdirSync(workspace, { recursive: true });
mkdirSync(wsA, { recursive: true });
mkdirSync(wsB, { recursive: true });
// seed settings：provider=demo ⇒ 不拨号不花钱（spec §3.2 / agent-runner resolveRunModel）
mkdirSync(userData, { recursive: true });
writeFileSync(join(userData, "settings.json"), JSON.stringify({ provider: "demo", model: "" }));

// 剧本 env 的外部残留会劫持判卷（M3A_MAIN_SCRIPT 优先级最高；M0A_PROVIDER 强推真 provider 会拨号）——
// 进门前清场，出门后还原（本进程只跑 apps/desktop 自己的套件，还原是礼貌不是必须）。
const ambientKeys = ["M3A_MAIN_SCRIPT", "M0A_PROVIDER", "M0_MODEL", "M0B_WORKSPACE"] as const;
const ambientBackup = ambientKeys.map((k) => [k, process.env[k]] as const);
for (const k of ambientKeys) delete process.env[k];
process.env.M3A_AGENTS_DEMO = "1"; // 脚本化主模型：fixtures/agents/main-demo.jsonl，确定性

const outbox: (readonly [string, unknown])[] = [];
const host: KernelHost = createKernelHost({
  workspaces: [workspace],
  activeWorkspace: workspace,
  userDataDir: userData,
  outbox: (channel, payload) => {
    outbox.push([channel, payload]);
  },
});

afterAll(async () => {
  delete process.env.M3A_AGENTS_DEMO;
  for (const [k, v] of ambientBackup) {
    if (v !== undefined) process.env[k] = v;
  }
});

describe("kernel-host 纵向装配", () => {
  it(
    "run：demo 全链路落事件、会话 JSONL 落 <ws>/.agent/sessions",
    async () => {
      const created = await host.createSession();
      // 会话→工作区归属（M3 T1）：createSession 落 activeWorkspace，run 的工作区由归属表给出
      // （kernel-host 以 over.workspace/logPath 第一优先注入，env/settings 残留够不着）——
      // 判卷工作区钉在本临时目录，不随机器漂。
      const res = await host.run({ message: "跑一遍 demo", mode: "default", sessionId: created.id });
      expect(res.ok, JSON.stringify(res)).toBe(true);
      const events = outbox.filter(([ch]) => ch === "onEvent");
      expect(events.length).toBeGreaterThan(0);
      // worker 面（M1 账本 T3）：demo 剧本派两个 worker，事件流里应见 spawn 与至少一份终态回执。
      // 断言事件类型在场而非内容形状（worker 报告内容不钉死）。实测（2026-10-03）：
      // agent_spawned ×2；agent_result ×1——read-worker 在 run 窗口内收敛，slow-worker 仍
      // running（剧本末条不调 wait_for_agents，父 run 结束即止）⇒ 断言 ≥1，不钉 ×2。
      // agent_result 晚于 run 收束到达（剧本不 wait_for_agents），故 waitFor 收口。
      expect(outbox.some(([c, p]) => c === "onEvent" && (p as { type?: string }).type === "agent_spawned")).toBe(true);
      await vi.waitFor(
        () => expect(outbox.some(([c, p]) => c === "onEvent" && (p as { type?: string }).type === "agent_result")).toBe(true),
        { timeout: 10_000, interval: 200 },
      );
      expect(existsSync(join(workspace, ".agent", "sessions", `${created.id}.jsonl`))).toBe(true);
    },
    60_000,
  );

  it("decide：未知 askId fail-closed 返回 false", () => {
    expect(host.decide("no-such-ask", true)).toBe(false);
  });

  it("openSession：能读回刚落的会话", async () => {
    const sessions = await host.listSessions();
    expect(sessions.length).toBeGreaterThan(0);
    const opened = await host.openSession(sessions[0]!.id);
    expect(opened.events.length).toBeGreaterThan(0);
  });
});

describe("M3 多工作区运行面", () => {
  it(
    "多工作区：A/B 两工作区各建会话，run 各落各的根，listSessions 带 workspace 归组",
    async () => {
      // 二次装配覆盖进程级出口（见 kernel-host.ts 头注「最后一个赢」）：本用例在前序用例
      // 全部收束后运行，覆盖 setAppHooks 不影响前序断言。
      const multi = createKernelHost({
        workspaces: [wsA, wsB],
        activeWorkspace: wsA,
        userDataDir: userData,
        outbox: (channel, payload) => {
          outbox.push([channel, payload]);
        },
      });
      const a = await multi.createSession(wsA);
      // createSession 缺省名是时间戳（到分钟），同分钟两根各建 ⇒ id 同名（撞名规避只在各自根内）
      // ⇒ 归属表互相覆盖。重试一次拿撞名后缀「(2)」，让 a/b 的 id 必然可分辨。
      let b = await multi.createSession(wsB);
      if (b.id === a.id) b = await multi.createSession(wsB);
      // run 不带 workspace 产品位：工作区由归属表给出（M3 面的本质断言——各落各的根）
      const ra = await multi.run({ message: "demo", mode: "default", sessionId: a.id });
      expect(ra.ok, JSON.stringify(ra)).toBe(true);
      const rb = await multi.run({ message: "demo", mode: "default", sessionId: b.id });
      expect(rb.ok, JSON.stringify(rb)).toBe(true);
      expect(existsSync(join(wsA, ".agent", "sessions", `${a.id}.jsonl`))).toBe(true);
      expect(existsSync(join(wsB, ".agent", "sessions", `${b.id}.jsonl`))).toBe(true);
      const all = await multi.listSessions();
      // 归组断言用 (id, workspace) 对而非单 find：createSession 缺省名是时间戳（到分钟），
      // 同一分钟在两根各建一条 ⇒ id 相同（撞名检测只在各自根内）⇒ 单 find 恒命中先扫描的 wsA。
      // 语义锚不变：每条会话都带着自己根的 workspace 标记进清单。
      expect(all.some((s) => s.id === a.id && s.workspace === wsA)).toBe(true);
      expect(all.some((s) => s.id === b.id && s.workspace === wsB)).toBe(true);
    },
    60_000,
  );

  it(
    "漂移检测：会话文件被外部追加后，下一次 run 被拒且报外部修改",
    async () => {
      const driftHost = createKernelHost({
        workspaces: [wsA],
        activeWorkspace: wsA,
        userDataDir: userData,
        outbox: (channel, payload) => {
          outbox.push([channel, payload]);
        },
      });
      const s = await driftHost.createSession(wsA);
      await driftHost.run({ message: "demo", mode: "default", sessionId: s.id });
      appendFileSync(
        pathOf(join(wsA, ".agent", "sessions"), s.id),
        JSON.stringify({ type: "user_message", content: "CLI 插的" }) + "\n",
      );
      const res = await driftHost.run({ message: "demo", mode: "default", sessionId: s.id });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/外部修改/);
      // 恢复缝：「请刷新后重试」——openSession 重立基线后同一会话可继续 run（外部行不丢，并入基线）。
      // 刷新前先等事件面静默（文件 stat 与 outbox 长度 600ms 不再变化）：本端 worker 子流在父 run
      // 收束后仍会落盘（实测 ≥5s），且同进程其他 host 的同分钟同名会话尾随会抬高归因计数——
      // 静默后刷新，恢复判据才钉在「外部行并入基线」本身而非与尾随写的竞速。
      const sessionFile = pathOf(join(wsA, ".agent", "sessions"), s.id);
      const statQuiet = async (p: string) => {
        try {
          const st = await stat(p);
          return { size: st.size, mtimeMs: st.mtimeMs };
        } catch {
          return { size: -1, mtimeMs: -1 };
        }
      };
      for (let quiet = 0, i = 0; quiet < 1 && i < 20; i++) {
        const before = { len: outbox.length, ...(await statQuiet(sessionFile)) };
        await new Promise((r) => setTimeout(r, 600));
        const after = { len: outbox.length, ...(await statQuiet(sessionFile)) };
        quiet = before.len === after.len && before.size === after.size && before.mtimeMs === after.mtimeMs ? 1 : 0;
      }
      await driftHost.openSession(s.id);
      const retry = await driftHost.run({ message: "demo", mode: "default", sessionId: s.id });
      expect(retry.ok, JSON.stringify(retry)).toBe(true);
    },
    60_000,
  );
});
