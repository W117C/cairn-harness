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
import { createMockProvider } from "../src/providers/mock";
import { ROUND_END, type ScriptItem } from "../src/providers/round-marker";
import { createRoundScriptedProvider, loadScriptOutputs, takeRound } from "../src/agent/gym/script";

const say = (content: string): ModelOutput => ({ type: "assistant_message", content }) as unknown as ModelOutput;
const call = (id: string, name: string): ModelOutput =>
  ({ type: "tool_call", id, name, args: {} }) as unknown as ModelOutput;
const end = (): ScriptItem => ({ type: ROUND_END });

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

describe("带哨兵的剧本（round_end）：中间那个纯文本轮存在（2026-10-13 第 470 页）", () => {
  // 动因：修复臂（`autoVerifyRepair`）唯一的对象是「跑过 shell 之后模型收工」那一拍，
  // 而它在旧口径下只可能出现在剧本**末尾**（`takeRound` 到第一个 tool_call 就切）⇒
  // `--scripted=` 面写不出这个形状。哨兵让中间那个纯文本轮可写；切法必须与 mock 逐字一致。
  const marked: ScriptItem[] = [
    say("a1"), call("c1", "read_file"), end(),
    say("先提方案："), end(),
    say("按方案改"), call("c2", "write_file"), end(),
  ];

  it("带哨兵：中间那个纯文本轮单独成轮，哨兵绝不吐给 loop", () => {
    const r1 = takeRound(marked, 0);
    expect(r1.outputs).toEqual([marked[0], marked[1]]);
    const r2 = takeRound(marked, r1.next);
    expect(r2.outputs, "纯文本轮只有那一条文本——它就是「收工那一拍」").toEqual([marked[3]]);
    const r3 = takeRound(marked, r2.next);
    expect(r3.outputs).toEqual([marked[5], marked[6]]);
    expect(takeRound(marked, r3.next)).toEqual({ outputs: [], next: marked.length });
    const flat = [...r1.outputs, ...r2.outputs, ...r3.outputs];
    expect(flat.some((o) => (o as { type: string }).type === ROUND_END), "哨兵漏进了模型输出").toBe(false);
  });

  it("带哨兵时游标只前进不重复：逐轮串起来 = 原剧本去掉哨兵", () => {
    const got: ModelOutput[] = [];
    let cursor = 0;
    let guard = 0;
    while (cursor < marked.length && guard <= marked.length) {
      guard++;
      const r = takeRound(marked, cursor);
      got.push(...r.outputs);
      cursor = r.next;
    }
    expect(got).toEqual(marked.filter((x) => x.type !== ROUND_END));
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

  const markedLines = [
    { type: "assistant_message", content: "读它" },
    { type: "tool_call", id: "c1", name: "read_file", args: { path: "a" } },
    { type: "round_end" },
    { type: "assistant_message", content: "先提方案：" },
    { type: "round_end" },
    { type: "assistant_message", content: "按方案改" },
    { type: "tool_call", id: "c2", name: "write_file", args: { path: "a" } },
    { type: "round_end" },
  ] as AgentEvent[];

  it("带哨兵剧本：纯文本轮可为中间轮（第 470 页的复现靠它），哨兵不落进输出", async () => {
    const p = join(dir, "marked.jsonl");
    await writeFile(p, markedLines.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    const provider = createRoundScriptedProvider(p);
    const perCall: number[] = [];
    const all: ModelOutput[] = [];
    for (let i = 0; i < 5; i++) {
      const got: ModelOutput[] = [];
      for await (const o of provider.stream([] as never)) got.push(o);
      perCall.push(got.length);
      all.push(...got);
    }
    expect(perCall).toEqual([2, 1, 2, 0, 0]);
    expect(all).toHaveLength(5);
    expect(all.some((o) => (o as { type: string }).type === ROUND_END), "哨兵漏进了模型输出").toBe(false);
  });

  it("与 mock 同一口径：同一份带哨兵剧本，两个 provider 的逐轮输出逐字一致", async () => {
    const p = join(dir, "parity.jsonl");
    await writeFile(p, markedLines.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    const gym = createRoundScriptedProvider(p);
    const mock = createMockProvider(p);
    const gymRounds: ModelOutput[][] = [];
    const mockRounds: ModelOutput[][] = [];
    for (let i = 0; i < 4; i++) {
      const g: ModelOutput[] = [];
      for await (const o of gym.stream([] as never)) g.push(o);
      const m: ModelOutput[] = [];
      for await (const o of mock.stream([] as never)) m.push(o);
      gymRounds.push(g);
      mockRounds.push(m);
    }
    expect(gymRounds.map((r) => r.length)).toEqual([2, 1, 2, 0]);
    expect(gymRounds, "两边对同一份剧本的切法必须逐字一致（一份实现，见 round-marker.ts）").toEqual(mockRounds);
  });

  it("旧口径的分歧是刻意的：无哨兵剧本靶场按 tool_call 切、mock 整条一轮", async () => {
    const p = join(dir, "legacy.jsonl");
    const lines = [
      { type: "assistant_message", content: "读它" },
      { type: "tool_call", id: "c1", name: "read_file", args: { path: "a" } },
      { type: "assistant_message", content: "改它" },
      { type: "tool_call", id: "c2", name: "write_file", args: { path: "a" } },
    ] as AgentEvent[];
    await writeFile(p, lines.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    const gymLens: number[] = [];
    const gym = createRoundScriptedProvider(p);
    for (let i = 0; i < 3; i++) {
      let n = 0;
      for await (const _o of gym.stream([] as never)) n++;
      gymLens.push(n);
    }
    const mockLens: number[] = [];
    const mock = createMockProvider(p);
    for (let i = 0; i < 2; i++) {
      let n = 0;
      for await (const _o of mock.stream([] as never)) n++;
      mockLens.push(n);
    }
    expect(gymLens, "靶场记账纪律：每轮最多一个 tool_call").toEqual([2, 2, 0]);
    expect(mockLens, "mock 对无哨兵剧本是「整条一次给完」——两条旧口径谁都不许被顺手统一").toEqual([4, 0]);
  });
});
