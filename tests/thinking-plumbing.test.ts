// 任务 1 的判卷：`--thinking` 必须真的走到 transport 的 opts 里——不是"命令行收下了"。
//
// 为什么用假 transport 收 opts 而不是去打真端点：这里要钉的是**装配面**（档位从 provider
// 入口传到 transport），不是协议适配（`reasoning_effort` 怎么进 body 由 tests/reasoning-wire.test.ts
// 钉）。两层分开，任一层坏了都能单独指出来。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventLog } from "../src/events";
import { createSessionProvider } from "../src/agent/session-provider";
import type { GlmOptions } from "../src/providers/glm";
import type { ThinkingEffort } from "../src/providers/capabilities";

vi.mock("../src/agent/memory/inject", async () =>
  (await import("./helpers/memory-inject-mock")).memoryInjectMock({ project: null, global: null }));

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** 跑一轮真实 assemble，把 transport 收到的 options 原样带回来。 */
async function captured(thinking?: ThinkingEffort): Promise<GlmOptions | undefined> {
  const dir = await mkdtemp(join(tmpdir(), "thinking-plumbing-"));
  dirs.push(dir);
  const logPath = join(dir, "events.jsonl");
  const log = createEventLog(logPath);
  await log.append({ type: "user_message", content: "hi" });
  await log.close?.();
  let seen: GlmOptions | undefined;
  const provider = createSessionProvider(logPath, {
    map: false,
    workspace: dir,
    ...(thinking !== undefined ? { thinking } : {}),
    transport: async function* (_messages, options) {
      seen = options;
      yield { type: "assistant_message", content: "ok" };
    },
  });
  for await (const _ of provider.stream([])) { /* drain */ }
  return seen;
}

describe("thinking 档位从 provider 入口到 transport", () => {
  it("high 档：transport 收到 reasoningEffort=high", async () => {
    expect((await captured("high"))?.reasoningEffort).toBe("high");
  });

  it("low 档：transport 收到 reasoningEffort=low", async () => {
    expect((await captured("low"))?.reasoningEffort).toBe("low");
  });

  it("不传 thinking：transport 的 opts 里没有 reasoningEffort（缺省零行为）", async () => {
    const opts = await captured();
    expect(opts).toBeDefined();
    expect(opts !== undefined && "reasoningEffort" in opts).toBe(false);
  });
});
