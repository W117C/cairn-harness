// 第 1001 页判卷：prompt 档钩子（模型判定型）。
// 钉的是"兑现"而不是"接上"：送给模型的必须是同一份 payload 契约、密钥形态必须出站前剥、
// 半份结论不许当完整结论、结果必须折进与 command/http/mcp_tool 同一套决策语义。
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HookEngine, type HookEngineOptions } from "../src/agent/plugins";
import { createHookModelCall } from "../src/agent/session-provider";
import { hookPayloadJson, hookShapeRejection } from "../src/agent/plugins/hooks";
import type { HookHandlerDef, LoadedHookDef } from "../src/agent/plugins/types";

let seq = 0;
function mk(event: LoadedHookDef["event"], handler: HookHandlerDef, over: Partial<LoadedHookDef> = {}): LoadedHookDef {
  seq++;
  return { plugin: "pm" + String(seq), pluginRoot: join(process.cwd(), "fixtures", "plugins", "project", "echo-suite"), event, handler, loaded: true, ...over };
}

interface ModelCall { system: string; user: string }

function harness(opts: Partial<HookEngineOptions> & {
  modelResponses?: Array<{ text: string } | { error: string } | { text: string; truncated: string }>;
} = {}) {
  const calls: ModelCall[] = [];
  const responses = opts.modelResponses ?? [{ text: "" }];
  let n = 0;
  const engine = new HookEngine({
    hooks: opts.hooks ?? [],
    workspace: opts.workspace ?? process.cwd(),
    pluginDataRoot: opts.pluginDataRoot ?? process.cwd(),
    mode: "auto",
    ...opts,
    modelCall: async (system, user) => {
      calls.push({ system, user });
      const r = responses[Math.min(n, responses.length - 1)];
      n++;
      if ("error" in r) throw new Error(r.error);
      return { ok: true, text: r.text, ...("truncated" in r ? { truncated: r.truncated } : {}) };
    },
  });
  return { engine, calls };
}

const HANDLER: HookHandlerDef = { type: "prompt", prompt: "判断这次改动是否安全，只回 JSON。" };

describe("prompt 档：真调用模型，并折进同一套决策语义", () => {
  it("模型回 JSON 决策体 ⇒ deny 变阻断，理由在案", async () => {
    const { engine } = harness({
      hooks: [mk("PreToolUse", HANDLER)],
      modelResponses: [{ text: '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"writes outside repo"}}' }],
    });
    const r = await engine.run("PreToolUse", { event: "PreToolUse", tool_name: "write_file", tool_args: { path: "/etc/hosts" } });
    expect(r.ran).toBe(1);
    expect(r.blocked).toBe(true);
    expect(r.blockReason).toContain("writes outside repo");
  });

  it("非 JSON 回文走上下文回注（与 command stdout 同一档待遇）", async () => {
    const { engine } = harness({
      hooks: [mk("PostToolUse", { type: "prompt", prompt: "总结这次编辑的影响。" })],
      modelResponses: [{ text: "改了 1 个文件，没有触及公开接口。" }],
    });
    const r = await engine.run("PostToolUse", { event: "PostToolUse", tool_name: "edit_file", tool_args: { path: "a.ts" }, tool_response: "ok" });
    expect(r.additionalContext).toContain("没有触及公开接口");
    expect(r.decision).toBeUndefined();
  });

  it("送给模型的 user 内容＝同一份 payload JSON（一份契约，四种传输）", async () => {
    const root = await mkdtemp(join(tmpdir(), "hook-prompt-"));
    const payload = { event: "PreToolUse" as const, tool_name: "edit_file", tool_args: { path: "a.ts" }, tool_use_id: "tu_7" };
    const { engine, calls } = harness({
      hooks: [mk("PreToolUse", HANDLER)],
      workspace: root,
      sessionId: "sess-3",
      modelResponses: [{ text: "ok" }],
    });
    await engine.run("PreToolUse", payload);
    expect(JSON.parse(calls[0].user)).toEqual(hookPayloadJson(payload, root, "sess-3"));
    expect(calls[0].system).toBe(HANDLER.type === "prompt" ? HANDLER.prompt : "");
  });

  it("作者提示里的 ${path} 按 payload 展开；取不到 ⇒ 不调用并点名", async () => {
    const ok = harness({
      hooks: [mk("PreToolUse", { type: "prompt", prompt: "检查 ${tool_input.path} 是否越界。" })],
      modelResponses: [{ text: "ok" }],
    });
    await ok.engine.run("PreToolUse", { event: "PreToolUse", tool_name: "edit_file", tool_args: { path: "src/a.ts" } });
    expect(ok.calls[0].system).toContain("src/a.ts");
    const missing = harness({
      hooks: [mk("PreToolUse", { type: "prompt", prompt: "检查 ${tool_input.nope} 是否越界。" })],
      modelResponses: [{ text: "ok" }],
    });
    const r = await missing.engine.run("PreToolUse", { event: "PreToolUse", tool_name: "edit_file", tool_args: { path: "src/a.ts" } });
    expect(missing.calls.length).toBe(0);
    expect(r.errors.join(" ")).toContain("tool_input.nope");
  });

  it("密钥形态出站前剥掉，并且说清剥了几处（不剥=把插件钩子当外泄通道，谎称剥了=更坏）", async () => {
    const secret = "sk-" + "A".repeat(24) + "Zzz";
    const { engine, calls } = harness({
      hooks: [mk("PostToolUse", { type: "prompt", prompt: "审阅这次输出。" })],
      workspace: process.cwd(),
      modelResponses: [{ text: "看起来没问题" }],
    });
    const r = await engine.run("PostToolUse", { event: "PostToolUse", tool_name: "read_file", tool_args: { path: "x" }, tool_response: "token=" + secret });
    expect(calls[0].user).not.toContain(secret);
    expect(r.errors.join(" ")).toContain("密钥");
  });

  it("模型只回了一半 ⇒ 出声，不当完整结论用", async () => {
    const { engine } = harness({
      hooks: [mk("PostToolUse", HANDLER)],
      modelResponses: [{ text: "这次改动影响了公开接口，具体是", truncated: "max_tokens" }],
    });
    const r = await engine.run("PostToolUse", { event: "PostToolUse", tool_name: "glob", tool_args: {}, tool_response: "x" });
    expect(r.errors.join(" ")).toContain("未写完");
  });

  it("模型调用异常 ⇒ 非阻塞错误，别的钩子照跑", async () => {
    const { engine } = harness({
      hooks: [
        mk("PostToolUse", HANDLER),
        mk("PostToolUse", { type: "command", command: "echo alive" }, { matcher: "glob" }),
      ],
      modelResponses: [{ error: "provider 5xx" }],
    });
    const r = await engine.run("PostToolUse", { event: "PostToolUse", tool_name: "glob", tool_args: {}, tool_response: "x" });
    expect(r.errors.join(" ")).toContain("provider 5xx");
    expect(r.additionalContext).toContain("alive");
    expect(r.blocked).toBe(false);
  });

  it("没注入模型调用面 ⇒ 在闸上如实拒，不占「跑了」的计数", async () => {
    const root = await mkdtemp(join(tmpdir(), "hook-prompt-bare-"));
    const engine = new HookEngine({
      hooks: [mk("PreToolUse", HANDLER)],
      workspace: root,
      pluginDataRoot: root,
      mode: "auto",
    });
    const r = await engine.run("PreToolUse", { event: "PreToolUse", tool_name: "glob", tool_args: {} });
    expect(r.skipped).toBe(1);
    expect(r.ran).toBe(0);
    expect(r.errors.join(" ")).toContain("模型");
  });

  it("prompt 档吃同一套事件超时帽（UserPromptSubmit 的短帽对模型调用同样有效）", async () => {
    const root = await mkdtemp(join(tmpdir(), "hook-prompt-timeout-"));
    let seenTimeoutMs = 0;
    const engine = new HookEngine({
      hooks: [mk("UserPromptSubmit", HANDLER)],
      workspace: root,
      pluginDataRoot: root,
      mode: "auto",
      modelCall: async (_system, _user, timeoutMs) => {
        seenTimeoutMs = timeoutMs;
        return { ok: true, text: "fine" };
      },
    });
    await engine.run("UserPromptSubmit", { event: "UserPromptSubmit", prompt: "hi" });
    expect(seenTimeoutMs).toBe(30_000); // HOOK_TIMEOUT_USER_PROMPT，不是缺省 600s
  });

  it("晚绑定之后建的 worker 视图（read 档）也拿得到模型面", async () => {
    // `forWorkerMode` 从 `{...opts}` 造新引擎：绑定如果只贴在旧实例的别的字段上，
    // read worker 里的 prompt 钩子就静默变成「没注入」——主会话判得动、降档视图判不动，是最难发现的那种半截。
    const root = await mkdtemp(join(tmpdir(), "hook-prompt-worker-"));
    const engine = new HookEngine({
      hooks: [mk("PostToolUse", HANDLER)],
      workspace: root,
      pluginDataRoot: root,
      mode: "auto",
    });
    const seen: string[] = [];
    engine.bindModelCall(async (system) => {
      seen.push(system);
      return { ok: true, text: "读档也能判" };
    });
    const r = await engine.forWorkerMode("read").run("PostToolUse", { event: "PostToolUse", tool_name: "glob", tool_args: {}, tool_response: "x" });
    expect(seen.length).toBe(1);
    expect(r.additionalContext).toContain("读档也能判");
    expect(r.skipped).toBe(0);
  });
});

describe("prompt 档的装载期形态", () => {
  const bad = (shape: unknown): HookHandlerDef => shape as unknown as HookHandlerDef;

  it("缺 prompt 字段 ⇒ 拒载并点名", () => {
    expect(hookShapeRejection(bad({ type: "prompt" }))).toContain("prompt");
    expect(hookShapeRejection(bad({ type: "prompt", prompt: "   " }))).toContain("prompt");
    expect(hookShapeRejection({ type: "prompt", prompt: "判断是否安全" })).toBeNull();
  });

  it("`agent` 档仍未兑现：装载期点名，不含糊", () => {
    const reason = hookShapeRejection({ type: "agent" });
    expect(reason).toContain("agent");
    expect(reason).toContain("未兑现");
  });

  it("payload 里有私钥块（critical）⇒ 整条钩子不出站，不是脱敏后照发", async () => {
    const { engine, calls } = harness({
      hooks: [mk("PostToolUse", { type: "prompt", prompt: "审阅这次输出。" })],
      modelResponses: [{ text: "ok" }],
    });
    const r = await engine.run("PostToolUse", {
      event: "PostToolUse", tool_name: "read_file", tool_args: { path: "id" },
      tool_response: "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
    });
    expect(calls.length).toBe(0); // 一个字节都没发给模型
    expect(r.errors.join(" ")).toContain("不出站");
  });
});

describe("createHookModelCall：真接缝（替身 transport，不碰网络与 key）", () => {
  interface FakeEvent { text?: string; truncated?: string; throwAt?: string }
  /** 造一条 SessionTransport：按给的事件序列吐，收口成一次调用。 */
  function fakeTransport(events: FakeEvent[]) {
    const seen: Array<{ system: string; user: string; model: string }> = [];
    const transport = async function* (messages: readonly unknown[], options: unknown): AsyncGenerator<unknown> {
      const msgs = messages as Array<{ content?: unknown }>;
      seen.push({
        system: String(msgs[0]?.content ?? ""),
        user: String(msgs[1]?.content ?? ""),
        model: String((options as { model?: string } | undefined)?.model ?? ""),
      });
      for (const e of events) {
        if (e.throwAt !== undefined) throw new Error(e.throwAt);
        if (e.truncated !== undefined) yield { type: "turn_truncated", stop_reason: e.truncated };
        else yield { type: "assistant_delta", text: e.text ?? "" };
      }
    };
    return { seen, transport };
  }

  // 口径搬家（第 1002 页）：`createHookModelCall` 从前自己收一个 model 名并塞进 options ——
  // 档位是装配层（provider-assembly）定死的东西，旁路再猜一遍就会猜成 legacy GLM 缺省。
  // 现在它只接 transport：给谁拨、拨到哪一档，全部由注入方决定。
  it("累加增量、原样递给 transport，并把 turn_truncated 如实带回", async () => {
    const fx = fakeTransport([{ text: "结论：" }, { text: "可以放行" }, { truncated: "max_tokens" }]);
    const call = createHookModelCall(fx.transport as never, undefined, "TEST");
    const res = await call("判一下", '{"tool_name":"glob"}', 5000);
    expect(res.ok).toBe(true);
    expect(res.text).toBe("结论：可以放行");
    expect(res.truncated).toBe("max_tokens");
    expect(fx.seen[0].system).toBe("判一下");
    expect(fx.seen[0].user).toBe('{"tool_name":"glob"}');
  });

  it("模型只回了空白 ⇒ 是失败，不是「模型没意见」", async () => {
    const call = createHookModelCall(fakeTransport([{ text: "   " }]).transport as never, undefined, "TEST");
    const res = await call("判一下", "{}", 5000);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("空判断");
  });

  it("transport 抛 ⇒ ok:false 且原因带标签（不吞异常）", async () => {
    const call = createHookModelCall(fakeTransport([{ throwAt: "connect refused" }]).transport as never, undefined, "TEST");
    const res = await call("判一下", "{}", 5000);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("TEST");
    expect(res.error).toContain("connect refused");
  });

  it("超时到点 ⇒ 这一条以超时失败收（不是永远悬着）", async () => {
    // 替身：吐半句后挂住，并且**honour abort 信号**（真 provider 也是这一契约；
    // 不 honour 的替身测的是"transport 自己会不会停"，那不是这一格要钉的事）。
    const hanging = async function* (
      _messages: readonly unknown[],
      _options: unknown,
      _tools: unknown,
      call: unknown,
    ): AsyncGenerator<unknown> {
      yield { type: "assistant_delta", text: "半句" };
      const signal = (call as { signal?: AbortSignal } | undefined)?.signal;
      await new Promise<void>((_resolve, reject) => {
        if (signal === undefined) return;
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };
    const call = createHookModelCall(hanging as never, undefined, "TEST");
    const res = await call("判一下", "{}", 60);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("超时");
  });
});
