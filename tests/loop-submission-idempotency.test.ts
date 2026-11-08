import { mkdtemp, readFile, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLoop, type LoopOptions } from "../src/agent/loop";
import { HookEngine } from "../src/agent/plugins/hooks";
import { createEventLog, replay, type AgentEvent } from "../src/events";
import type { ModelOutput, ProviderMessage } from "../src/providers";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture(outputs: ModelOutput[], options: (root: string) => Partial<LoopOptions>) {
  const root = await mkdtemp(join(tmpdir(), "cairn-submit-"));
  roots.push(root);
  const path = join(root, "events.jsonl");
  const requests: ProviderMessage[][] = [];
  await runLoop({
    workspace: root, mode: "auto", events: createEventLog(path),
    provider: { async *stream(messages) {
      requests.push(messages);
      if (requests.length === 1) yield* outputs;
    } },
    ...options(root),
  });
  return { root, events: await replay(path), requests };
}
const write = (path: string): ModelOutput => ({ type: "tool_call", id: "same-call", name: "write_file", args: { path } });
function hooks(root: string, after?: () => void): HookEngine {
  return new HookEngine({
    workspace: root, pluginDataRoot: root, mode: "auto",
    hooks: (["PreToolUse", "PostToolUse"] as const).map((event) => ({
      event, plugin: "submission-test", pluginRoot: root, loaded: true,
      handler: { type: "command", command: `hook-${event}` },
    })),
    async exec(_command, _argv, _shell, _env, _cwd, _timeout, stdin) {
      const input = JSON.parse(stdin) as { hook_event_name: string };
      await appendFile(join(root, "hooks"), input.hook_event_name + "\n");
      after?.();
      return { stdout: "", stderr: "", code: 0, killed: false };
    },
  });
}


describe("真实 loop 工具提交幂等", () => {
  it("重复 id（即使参数变了）只写一次，原调用/结果完整且下一轮没有悬空调用", async () => {
    const { root, events, requests } = await fixture([write("first"), write("second")], (root) => ({
      tools: { write_file: { name: "write_file", async run(args) {
        await appendFile(join(root, "effects"), String(args.path));
        return { ok: true, output: "FIRST_RECEIPT" };
      } } },
    }));
    expect(await readFile(join(root, "effects"), "utf8")).toBe("first");
    expect(events.filter((e) => e.type === "tool_call")).toHaveLength(1);
    expect(events.filter((e) => e.type === "tool_result")).toEqual([
      expect.objectContaining({ callId: "same-call", ok: true, output: "FIRST_RECEIPT" }),
    ]);
    expect(requests[1]?.filter((m) => m.role === "tool")).toEqual([
      { role: "tool", tool_call_id: "same-call", content: "FIRST_RECEIPT" },
    ]);
    expect(JSON.stringify(requests[1])).not.toContain("上次运行中途结束");
  });

  it("工具写盘后抛错也粘滞，重复提交不能再次写盘", async () => {
    const { root, events } = await fixture([write("first"), write("second")], (root) => ({
      tools: { write_file: { name: "write_file", async run() {
        await appendFile(join(root, "effects"), "written\n");
        throw new Error("FAIL_AFTER_WRITE");
      } } },
    }));
    expect(await readFile(join(root, "effects"), "utf8")).toBe("written\n");
    expect(events.filter((e) => e.type === "tool_result")).toEqual([
      expect.objectContaining({ callId: "same-call", ok: false, output: "FAIL_AFTER_WRITE" }),
    ]);
  });

  it("verify 系统门及其前后 hooks 都只执行一次，不重复计验证拍", async () => {
    const call: ModelOutput = { type: "tool_call", id: "same-verify", name: "verify", args: {} };
    const { root, events } = await fixture([call, call], (root) => ({
      verify: { async run() {
        await appendFile(join(root, "verify-runs"), "verify\n");
        return { ok: false, results: [{ command: "test", ok: false, output: "CODE_FAILURE" }] };
      } },
      hooks: hooks(root),
    }));
    expect(await readFile(join(root, "verify-runs"), "utf8")).toBe("verify\n");
    expect(await readFile(join(root, "hooks"), "utf8")).toBe("PreToolUse\nPostToolUse\n");
    expect(events.filter((e) => e.type === "verify_result")).toMatchObject([{ attempt: 1, ok: false }]);
    expect(events.filter((e) => e.type === "tool_result")).toHaveLength(1);
  });

  it("原提交被动态技能门拒绝后，重复 id 不能借门状态变化执行", async () => {
    let checks = 0;
    const { root, events } = await fixture([write("first"), write("second")], (root) => ({
      skillDenial: () => ++checks === 1 ? "/blocked" : null,
      tools: { write_file: { name: "write_file", async run() {
        await appendFile(join(root, "effects"), "unexpected");
        return { ok: true, output: "unexpected" };
      } } },
    }));
    await expect(readFile(join(root, "effects"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(events.filter((e) => e.type === "tool_result")).toEqual([
      expect.objectContaining({ callId: "same-call", ok: false, blockedBy: "skill-denial" }),
    ]);
  });

  it("不同 run 的账本独立，同一个 provider id 不会串到另一会话", async () => {
    const results: AgentEvent[][] = [];
    for (const marker of ["A", "B"]) {
      const { root, events } = await fixture([write(marker)], (root) => ({
        tools: { write_file: { name: "write_file", async run(args) {
          await appendFile(join(root, "effects"), String(args.path));
          return { ok: true, output: marker };
        } } },
      }));
      expect(await readFile(join(root, "effects"), "utf8")).toBe(marker);
      results.push(events);
    }
    expect(results.map((events) => events.find((e) => e.type === "tool_result")?.output)).toEqual(["A", "B"]);
  });

  it("同一个 run 的下一次 provider 请求重发 id，仍回用最初的回执", async () => {
    const root = await mkdtemp(join(tmpdir(), "cairn-submit-turns-"));
    roots.push(root);
    const path = join(root, "events.jsonl");
    const requests: ProviderMessage[][] = [];
    await runLoop({
      workspace: root, mode: "auto", events: createEventLog(path),
      provider: { async *stream(messages) {
        requests.push(messages);
        if (requests.length <= 2) yield write(String(requests.length));
      } },
      tools: { write_file: { name: "write_file", async run(args) {
        await appendFile(join(root, "effects"), String(args.path));
        return { ok: true, output: "ORIGINAL_RECEIPT" };
      } } },
    });
    expect(await readFile(join(root, "effects"), "utf8")).toBe("1");
    expect((await replay(path)).filter((e) => e.type === "tool_call")).toHaveLength(1);
    expect(requests).toHaveLength(3);
    expect(requests[2]?.filter((m) => m.role === "tool")).toEqual([
      { role: "tool", tool_call_id: "same-call", content: "ORIGINAL_RECEIPT" },
    ]);
  });

  it("verify 的前置 hook 等待期间取消，不执行验证或后置 hook", async () => {
    const controller = new AbortController();
    const { root, events } = await fixture([
      { type: "tool_call", id: "verify-cancel", name: "verify", args: {} },
    ], (root) => ({
      signal: controller.signal,
      verify: { async run() {
        await appendFile(join(root, "verify-runs"), "unexpected");
        return { ok: true, results: [] };
      } },
      hooks: hooks(root, () => controller.abort()),
    }));
    await expect(readFile(join(root, "verify-runs"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(root, "hooks"), "utf8")).toBe("PreToolUse\n");
    expect(events.filter((e) => e.type === "tool_result")).toMatchObject([
      { callId: "verify-cancel", ok: false, output: expect.stringContaining("cancelled") },
    ]);
    expect(events.some((e) => e.type === "verify_result")).toBe(false);
  });

  it("整轮只有环境 verify 红的重发时正常收束，不能伪造第二拍或撞 maxSteps", async () => {
    let requests = 0;
    const { root, events } = await fixture([], (root) => ({
      maxSteps: 3,
      provider: { async *stream() {
        requests++;
        yield { type: "tool_call", id: "environment-verify", name: "verify", args: {} };
      } },
      verify: { async run() {
        await appendFile(join(root, "verify-runs"), "verify\n");
        return { ok: false, results: [{ command: "pnpm test", ok: false, output: "unavailable", cause: "pkg-manager" }] };
      } },
    }));
    expect(await readFile(join(root, "verify-runs"), "utf8")).toBe("verify\n");
    expect(events.filter((e) => e.type === "verify_result")).toMatchObject([
      { callId: "environment-verify", ok: false, cause: "pkg-manager", attempt: 1, maxAttempts: 3 },
    ]);
    expect(events.filter((e) => e.type === "tool_call")).toHaveLength(1);
    expect(events.filter((e) => e.type === "tool_result")).toHaveLength(1);
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(requests).toBe(2);
  });

  it("整轮只有真红 verify 的重发时同样收束，不靠 maxSteps 兜底", async () => {
    // 真红的 control 是 "continue"；若只认环境红，verify 不再执行、拍数不涨，
    // 原 maxVerify 停止线失效 ⇒ 每轮多一次付费请求，直到 maxSteps。
    let requests = 0;
    const { root, events } = await fixture([], (root) => ({
      maxSteps: 5,
      provider: { async *stream() {
        requests++;
        yield { type: "tool_call", id: "code-verify", name: "verify", args: {} };
      } },
      verify: { async run() {
        await appendFile(join(root, "verify-runs"), "verify\n");
        return { ok: false, results: [{ command: "pnpm test", ok: false, output: "CODE_FAILURE" }] };
      } },
    }));
    expect(await readFile(join(root, "verify-runs"), "utf8")).toBe("verify\n");
    expect(events.filter((e) => e.type === "verify_result")).toHaveLength(1);
    expect(events.filter((e) => e.type === "tool_call")).toHaveLength(1);
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(requests).toBe(2);
  });

  it("环境 verify 重发后同一轮还有新工具和新验证，仍继续执行并保留真实拍数", async () => {
    let requests = 0, verifies = 0;
    const { root, events } = await fixture([], (root) => ({
      maxSteps: 3,
      provider: { async *stream() {
        requests++;
        yield { type: "tool_call", id: "environment-verify", name: "verify", args: {} };
        if (requests === 2) {
          yield { type: "tool_call", id: "repair", name: "write_file", args: {} };
          yield { type: "tool_call", id: "new-verify", name: "verify", args: {} };
        }
      } },
      tools: { write_file: { name: "write_file", async run() {
        await appendFile(join(root, "effects"), "fixed\n");
        return { ok: true, output: "fixed" };
      } } },
      verify: { async run() {
        await appendFile(join(root, "verify-runs"), "verify\n");
        return ++verifies === 1
          ? { ok: false, results: [{ command: "pnpm test", ok: false, output: "unavailable", cause: "pkg-manager" }] }
          : { ok: true, results: [{ command: "pnpm test", ok: true, output: "pass" }] };
      } },
    }));
    expect(await readFile(join(root, "effects"), "utf8")).toBe("fixed\n");
    expect(await readFile(join(root, "verify-runs"), "utf8")).toBe("verify\nverify\n");
    expect(events.filter((e) => e.type === "verify_result")).toMatchObject([
      { callId: "environment-verify", ok: false, cause: "pkg-manager", attempt: 1 },
      { callId: "new-verify", ok: true, attempt: 1 },
    ]);
    expect(events.filter((e) => e.type === "tool_call")).toHaveLength(3);
    expect(events.filter((e) => e.type === "tool_result")).toHaveLength(3);
    expect(requests).toBe(2);
  });
});
