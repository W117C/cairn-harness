// 靶场剧本「按轮切分」的**纯口径**自证（变异表锚点面：全部有界，突变必须红在具名断言上）。
//
// 立这一层的唯一理由：切轮之前靶场每个会话只有一次请求（BLOCKED 裁决 3 实测：三条冻结 case
// 的装配账 requests 全是 1），于是「逐轮装配增长 / 缓存命中 / 压缩触发 / 跨轮保持目标」
// 这一整类机制**在靶场里不存在**——不是量得准不准的问题，是根本没有样本。
// 端到端那部分（跑真 runLoop、真冻结 case）在 tests/gym-rounds-e2e.test.ts。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentEvent } from "../src/events";
import type { ModelOutput } from "../src/providers";
import { createRoundScriptedProvider, loadScriptOutputs, takeRound } from "../src/agent/gym/script";

const say = (content: string): ModelOutput => ({ type: "assistant_message", content }) as unknown as ModelOutput;
const call = (id: string, name: string): ModelOutput =>
  ({ type: "tool_call", id, name, args: {} }) as unknown as ModelOutput;

describe("takeRound 轮边界", () => {
  const script = [say("a1"), call("c1", "read_file"), say("a2"), call("c2", "write_file"), say("收工")];

  it("一轮 = 文本 + 它那一个 tool_call（tool_call 含在本轮内）", () => {
    expect(takeRound(script, 0).outputs).toEqual([script[0], script[1]]);
    expect(takeRound(script, 2).outputs).toEqual([script[2], script[3]]);
  });

  it("切到剧本跑完不丢条、不重复：逐轮串起来恰等于原剧本", () => {
    const rounds: ModelOutput[] = [];
    let cursor = 0;
    // 轮数上限 = 剧本条数：游标若在轮边界不前进，必须「跑满上限后带证据红」，
    // 而不是把测试进程吊死（hang = 信息黑洞，变异表拿不到具名判据）。
    let guard = 0;
    while (cursor < script.length && guard <= script.length) {
      guard++;
      const r = takeRound(script, cursor);
      expect(r.outputs.length).toBeGreaterThan(0);
      rounds.push(...r.outputs);
      cursor = r.next;
    }
    expect(guard, `轮数不得超过剧本条数（${String(script.length)} 条，实取 ${String(guard)} 轮 = 游标停滞）`).toBeLessThanOrEqual(script.length);
    expect(rounds).toEqual(script);
    expect(cursor).toBe(script.length);
  });

  it("尾部纯文本轮单独成一轮；越界返回空（loop 据此收束）", () => {
    expect(takeRound(script, 4).outputs).toEqual([script[4]]);
    expect(takeRound(script, 5)).toEqual({ outputs: [], next: 5 });
  });
});

describe("明卷按轮 provider", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "gym-script-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("每次 stream() 只给一轮，逐次调用吐完整条剧本", async () => {
    const p = join(dir, "s.jsonl");
    const lines = [
      { type: "assistant_message", content: "先看文件" },
      { type: "tool_call", id: "c1", name: "read_file", args: { path: "a" } },
      { type: "assistant_message", content: "改它" },
      { type: "tool_call", id: "c2", name: "write_file", args: { path: "a" } },
      { type: "assistant_message", content: "收工" },
    ] as AgentEvent[];
    await writeFile(p, lines.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");

    const provider = createRoundScriptedProvider(p);
    const perCall: number[] = [];
    const all: ModelOutput[] = [];
    for (let i = 0; i < 6; i++) {
      const got: ModelOutput[] = [];
      for await (const o of provider.stream([] as never)) got.push(o);
      perCall.push(got.length);
      all.push(...got);
    }
    expect(all).toHaveLength(5);
    expect(perCall).toEqual([2, 2, 1, 0, 0, 0]); // 剧本跑完即空，不多吐一条
  });

  it("剧本形状不合（非 assistant/tool_call）显式抛错，与探针同一条口径", async () => {
    const p = join(dir, "bad.jsonl");
    await writeFile(p, JSON.stringify({ type: "usage", inputTokens: 1, outputTokens: 1 }) + "\n", "utf8");
    await expect(loadScriptOutputs(p)).rejects.toThrow(/装配探针剧本/);
    const provider = createRoundScriptedProvider(p);
    await expect(async () => {
      for await (const _o of provider.stream([] as never)) void _o;
    }).rejects.toThrow(/装配探针剧本/);
  });
});
