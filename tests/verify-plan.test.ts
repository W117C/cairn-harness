// 任务自带判据（spec 2026-11-04 §3.2）：声明的优先级与校验。
//
// 两条判据各自配一条同形对照，避免恒真：
//  · 有声明 → `source:"task"`；无声明 → `source:"config"`（回旧行为，不是"也变 task"）。
//  · 合法声明原样通过；非法声明逐条被拒，且拒因点名是哪一格坏（不是一句"参数错误"）。
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveVerifyConfig, validateVerifyDeclaration } from "../src/agent/verify-plan";
import { runLoop } from "../src/agent/loop";
import { createVerifyHook } from "../src/agent/verify";
import type { AgentEvent, VerifyResultEvent } from "../src/events";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function repoWith(config: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "verify-plan-"));
  dirs.push(dir);
  await mkdir(join(dir, ".agent"), { recursive: true });
  await writeFile(join(dir, ".agent", "config.json"), JSON.stringify(config), "utf8");
  return dir;
}

describe("resolveVerifyConfig", () => {
  it("声明压过仓库配置", async () => {
    const dir = await repoWith({ verify: { test: ["echo config"] } });
    const r = await resolveVerifyConfig(dir, { commands: ["echo task"] });
    expect(r.source).toBe("task");
    expect(r.config.test).toEqual(["echo task"]);
  });

  it("无声明时逐字回旧行为", async () => {
    const dir = await repoWith({ verify: { test: ["echo config"] } });
    const r = await resolveVerifyConfig(dir);
    expect(r.source).toBe("config");
    expect(r.config.test).toEqual(["echo config"]);
  });
});

describe("validateVerifyDeclaration", () => {
  it("空白命令被拒", () => {
    const r = validateVerifyDeclaration({ commands: ["   "] });
    expect(r.ok).toBe(false);
  });

  it("空数组被拒", () => {
    const r = validateVerifyDeclaration({ commands: [] });
    expect(r.ok).toBe(false);
  });

  it("超时越界报错而不是夹取", () => {
    const r = validateVerifyDeclaration({ commands: ["echo x"], timeoutMs: 999 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("timeoutMs");
  });

  it("合法声明原样通过", () => {
    const r = validateVerifyDeclaration({ commands: ["echo x"], timeoutMs: 60_000 });
    expect(r).toEqual({ ok: true, value: { commands: ["echo x"], timeoutMs: 60_000 } });
  });
});

describe("verify_result 的来源标记", () => {
  it("钩子报了来源，事件流照抄；没报就不编", async () => {
    const stamp = async (source?: "task" | "config") => {
      const log: AgentEvent[] = [];
      await runLoop({
        workspace: "/tmp",
        events: { async append(e: AgentEvent) { log.push(e); } },
        tools: {},
        provider: {
          async *stream() {
            yield { type: "tool_call" as const, id: "v1", name: "verify", args: {} };
          },
        },
        verify: { async run() { return { ok: true, results: [], ...(source ? { source } : {}) }; } },
      });
      return log.filter((e): e is VerifyResultEvent => e.type === "verify_result");
    };
    expect((await stamp("task"))[0]?.source).toBe("task");
    expect((await stamp("config"))[0]?.source).toBe("config");
    expect((await stamp())[0]?.source).toBeUndefined();
  });
});

describe("钩子按声明执行", () => {
  it("声明是 task 时不读仓库配置，且来源照实报", async () => {
    const dir = await repoWith({ verify: { test: ["echo config"] } });
    const ran: string[] = [];
    const hook = createVerifyHook(dir, {
      resolved: { config: { test: ["echo task"] }, source: "task" },
      exec: async (cmd) => {
        ran.push(cmd);
        return { command: cmd, ok: true, output: "", exitCode: 0 };
      },
    });
    if (hook.surface === undefined) throw new Error("钩子没有 surface");
    expect(await hook.surface()).toBe(true);
    if (hook.run === undefined) throw new Error("钩子没有 run");
    const out = await hook.run();
    expect(ran).toEqual(["echo task"]);
    expect(out.source).toBe("task");
  });
});
