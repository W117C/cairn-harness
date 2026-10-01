// kernel-host 纵向装配判卷（headless，可进 CI）：createKernelHost 一个入口装配
// 会话目录 / 记忆家 / settings 存储 / 宿主依赖 / 工具注册 / UI 三通道，再跑一场 demo run。
// demo 通道不拨号不花钱（spec §3.2）：settings provider=demo + M3A_AGENTS_DEMO=1 ⇒
// 主模型走 fixtures/agents/main-demo.jsonl 剧本，spawn 的 worker 走同名剧本（read-worker/slow-worker）。
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createKernelHost, type KernelHost } from "../src/main/kernel-host";

const dir = mkdtempSync(join(tmpdir(), "m0-host-"));
const workspace = join(dir, "ws");
const userData = join(dir, "userData");
mkdirSync(workspace, { recursive: true });
// seed settings：provider=demo ⇒ 不拨号不花钱（spec §3.2 / agent-runner resolveRunModel）
mkdirSync(userData, { recursive: true });
writeFileSync(join(userData, "settings.json"), JSON.stringify({ provider: "demo", model: "" }));

// 剧本 env 的外部残留会劫持判卷（M3A_MAIN_SCRIPT 优先级最高；M0A_PROVIDER 强推真 provider 会拨号）——
// 进门前清场，出门后还原（本进程只跑 apps/desktop 自己的套件，还原是礼貌不是必须）。
const ambientKeys = ["M3A_MAIN_SCRIPT", "M0A_PROVIDER", "M0_MODEL"] as const;
const ambientBackup = ambientKeys.map((k) => [k, process.env[k]] as const);
for (const k of ambientKeys) delete process.env[k];
process.env.M3A_AGENTS_DEMO = "1"; // 脚本化主模型：fixtures/agents/main-demo.jsonl，确定性

const outbox: (readonly [string, unknown])[] = [];
const host: KernelHost = createKernelHost({
  workspace,
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
      // workspace 走 RunRequest 的产品位（IPC agent:run 只转发 sessionId/workspace）：
      // 判卷工作区钉在本临时目录，不随机器上的 M0B_WORKSPACE/settings 残留漂。
      const res = await host.run({ message: "跑一遍 demo", mode: "default", sessionId: created.id, workspace });
      expect(res.ok, JSON.stringify(res)).toBe(true);
      const events = outbox.filter(([ch]) => ch === "onEvent");
      expect(events.length).toBeGreaterThan(0);
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
