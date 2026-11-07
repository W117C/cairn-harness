// worker 模型的取消信号必须真的进到适配器。
//
// 旧实现只在生成前后检查 `opts.signal.aborted`，而 `model(msgs, tools)` 的两参签名把这层
// 信息整个丢掉 ⇒ cancelAgent 只能拦住「还没开始」的调用，正在等上游 SSE 的那一轮仍占着
// 连接与 token。判据直接钉住第三参的 `call.signal`（与 RegistryWorkerModel 同形）。
import { describe, expect, it } from "vitest";
import { createWorkerProvider } from "../src/agent/orchestrator";
import type { WorkerModel } from "../src/agent/worker-model";

describe("worker 模型调用携带 AbortSignal", () => {
  it("有 signal ⇒ 第三参 call.signal 原样透传", async () => {
    const seen: unknown[] = [];
    const model: WorkerModel = async function* (_messages, _tools, options) {
      seen.push(options);
    };
    const controller = new AbortController();
    const provider = createWorkerProvider({
      readEvents: () => [],
      system: [],
      model,
      signal: controller.signal,
    });
    for await (const _ of provider.stream([], [])) { /* 空剧本 */ }
    expect(seen).toHaveLength(1);
    expect((seen[0] as { call?: { signal?: AbortSignal } }).call?.signal).toBe(controller.signal);
  });

  it("没有 signal ⇒ 第三参缺席（旧的两参调用面不因本修多出一个空对象）", async () => {
    const seen: unknown[] = [];
    const model: WorkerModel = async function* (_messages, _tools, options) {
      seen.push(options);
    };
    const provider = createWorkerProvider({ readEvents: () => [], system: [], model });
    for await (const _ of provider.stream([], [])) { /* 空剧本 */ }
    expect(seen).toEqual([undefined]);
  });
});
