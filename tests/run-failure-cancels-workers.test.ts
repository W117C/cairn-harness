// #30：主 loop 异常收场时，detached worker 不许继续挂在会话日志上。
//
// 生产入口 handleAgentRun 里：主 provider 先真 spawn 一个慢 worker，下一轮请求再抛异常。
// 旧实现只把 goal_stopped 落流并 rethrow，finally 随即解 live/run lock；worker 仍在后台
// 写同一份 JSONL，下一场 run 能并发进来。本判卷同时量三件：异常原样上抛、worker 落
// cancelled 终态、失败后同一会话能开第二场且事件照常落流。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providerState = vi.hoisted(() => ({
  calls: 0,
  spawnIssued: false,
  failOnce: true,
}));

vi.mock("../src/main/provider-assembly", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/provider-assembly")>();
  return {
    ...actual,
    createProvider: () => ({
      async *stream() {
        providerState.calls++;
        if (!providerState.spawnIssued) {
          providerState.spawnIssued = true;
          yield {
            type: "tool_call",
            id: "spawn-1",
            name: "spawn_agent",
            args: { mode: "read", task: "slow research", model: "slow-worker.jsonl" },
          };
          return;
        }
        if (providerState.failOnce) {
          providerState.failOnce = false;
          throw new Error("main provider exploded");
        }
        yield { type: "assistant_message", content: "第二场跑完了。" };
      },
    }),
  };
});

import { replay, type AgentEvent } from "../src/events";
import { handleAgentRun, initSessionsDir, initSettingsStore } from "../src/main/agent-runner";
import { pathOf } from "../src/main/sessions";

let root = "";
let workspace = "";
let sessions = "";
let logPath = "";

beforeEach(async () => {
  providerState.calls = 0;
  providerState.spawnIssued = false;
  providerState.failOnce = true;
  root = await mkdtemp(join(tmpdir(), "run-failure-cancels-workers-"));
  workspace = join(root, "ws");
  sessions = join(root, "sessions");
  await mkdir(workspace, { recursive: true });
  await mkdir(sessions, { recursive: true });
  await writeFile(join(workspace, "README.md"), "fixture\n", "utf8");
  initSessionsDir(sessions);
  initSettingsStore(join(root, "settings.json"));
  logPath = pathOf(sessions, "s-failure");
  process.env.M3A_AGENTS_DEMO = "1";
  delete process.env.M3A_MAIN_SCRIPT;
});

afterEach(async () => {
  delete process.env.M3A_AGENTS_DEMO;
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

describe("runAgent 异常收场收队 detached worker", () => {
  it("reject 后 worker 全部 cancelled 落流，且同一会话的第二场能正常写", async () => {
    const first = await handleAgentRun(
      { message: "派慢 worker 然后抛错", mode: "auto", sessionId: "s-failure" },
      { workspace, logPath, unattended: true, trustedRepo: true },
    );
    expect(first.ok, JSON.stringify(first)).toBe(false);
    expect(first.error ?? "").toContain("main provider exploded");

    const events = await replay(logPath);
    const spawned = events.filter((e) => e.type === "agent_spawned");
    expect(spawned.length, "主 loop 没真派出 worker ⇒ 这条判卷量的是空表").toBe(1);
    const id = (spawned[0] as Extract<AgentEvent, { type: "agent_spawned" }>).agent_id;
    const statuses = events
      .filter((e): e is Extract<AgentEvent, { type: "agent_status" }> => e.type === "agent_status")
      .filter((e) => e.agent_id === id);
    expect(statuses.at(-1)?.status, "异常收场必须把 worker 收到 cancelled 终态").toBe("cancelled");
    expect(events.some((e) => e.type === "error" && e.message.includes("main provider exploded"))).toBe(true);
    expect(events.some((e) => e.type === "tool_result" &&
      String((e as { output?: string }).output ?? "").includes("cancelled"))).toBe(true);

    // live/run lock 必须在 waitAll 之后才释放：第二场能开，说明失败那场没把后台写租约漏下来。
    const second = await handleAgentRun(
      { message: "第二场", mode: "auto", sessionId: "s-failure" },
      { workspace, logPath, unattended: true, trustedRepo: true },
    );
    expect(second.ok, JSON.stringify(second)).toBe(true);
    const after = await replay(logPath);
    expect(after.filter((e) => e.type === "user_message" && e.content === "第二场")).toHaveLength(1);
    expect(after.filter((e) => e.type === "assistant_message" && e.content === "第二场跑完了。")).toHaveLength(1);
  }, 60_000);
});
