// 靶场剧本「按轮切分」自证（能力 10 的度量面前置）。
//
// 立这一层的唯一理由：切轮之前靶场每个会话只有一次请求（BLOCKED 裁决 3 实测：三条冻结 case
// 的装配账 requests 全是 1），于是「逐轮装配增长 / 缓存命中 / 压缩触发 / 跨轮保持目标」
// 这一整类机制**在靶场里不存在**——不是量得准不准的问题，是根本没有样本。
// 本文件钉的就是「一次请求一轮」这条新口径：轮边界正确、剧本一条不丢、请求数等于轮数。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentEvent } from "../src/events";
import { loadCase, loadGymIndex } from "../src/agent/gym/case";
import { cleanupRun, runCase } from "../src/agent/gym/runner";
import { createRoundScriptedProvider, loadScriptOutputs, takeRound } from "../src/agent/gym/script";
import { createProbeTransport, type AssemblyTurn } from "../src/agent/gym/probe";
import type { ModelOutput } from "../src/providers";

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
    for (;;) {
      if (cursor >= script.length) break;
      const r = takeRound(script, cursor);
      expect(r.outputs.length).toBeGreaterThan(0); // 不得原地不动（否则 loop 会死循环在同一条）
      rounds.push(...r.outputs);
      cursor = r.next;
    }
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

describe("切轮之后靶场能量多轮机制（端到端）", () => {
  let dir: string;
  let evPath: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "gym-rounds-"));
    evPath = join(dir, "events.jsonl");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("probe 档：请求数 == 轮数，且历史段逐轮递增（旧语义下这里恒为 1 条）", async () => {
    const p = join(dir, "s.jsonl");
    await writeFile(
      p,
      [
        JSON.stringify({ type: "assistant_message", content: "读第一个文件，它很长，因为要装下真实仓库里的一个模块" }),
        JSON.stringify({ type: "tool_call", id: "c1", name: "read_file", args: { path: "src/a.js" } }),
        JSON.stringify({ type: "assistant_message", content: "再读第二个，同样带回一大段内容以便历史段真的变长" }),
        JSON.stringify({ type: "tool_call", id: "c2", name: "read_file", args: { path: "src/b.js" } }),
        JSON.stringify({ type: "assistant_message", content: "改它" }),
        JSON.stringify({ type: "tool_call", id: "c3", name: "write_file", args: { path: "src/b.js", content: "// x\n" } }),
        JSON.stringify({ type: "assistant_message", content: "收工" }),
      ].join("\n") + "\n",
      "utf8",
    );
    const seen: AssemblyTurn[] = [];
    const yieldsPerCall: number[] = [];
    const transport = createProbeTransport(p, (t) => { seen.push(t); });
    // 手工按 loop 的粒度驱动：一次 transport 调用 = 一轮请求。
    // 这里只钉「记账轮号 + 每次调用的取数粒度」——装配增长不在这条链上（输入是我喂死的同一份
    // messages，真正逐轮变长的是 composeTurnMessages 那条路，由下面那条端到端 case 断言）。
    for (let i = 0; i < 5; i++) {
      let n = 0;
      for await (const _o of transport([{ role: "user", content: "任务" }] as never, {}, [])) { void _o; n++; }
      yieldsPerCall.push(n);
    }
    // 剧本 7 条 = 4 轮（3 轮各 2 条 + 尾部纯文本 1 条）；跑完即空，不多吐一条。
    // drain-all 回归（旧语义）会把这里打成 [7,0,0,0,0]，本条断言当场红。
    expect(yieldsPerCall).toEqual([2, 2, 2, 1, 0]);
    expect(seen.map((t) => t.turn)).toEqual([1, 2, 3, 4, 5]); // 记账按请求递增，不是重复第 1 轮
    expect(seen.every((t) => t.historyBytes === seen[0]!.historyBytes)).toBe(true); // 同一份输入 ⇒ 账不变
  });

  it("冻结 case 的 probe 跑不再退化成单次请求（裁决 3 的那条实测事实被推翻即为收口）", async () => {
    const GYM = join(process.cwd(), "fixtures", "gym");
    const index = await loadGymIndex(GYM);
    const c = await loadCase(GYM, index.cases[0]!);
    // 期望请求数从**冻结剧本本身**算出来，不写死数字（改 case = 剧本变，期望跟着变）：
    // 一次请求一轮；verify 通过即停 ⇒ 只消费到含 verify 的那一轮为止。
    const script = await loadScriptOutputs(join(c.dir, "script.jsonl"));
    const rounds: ModelOutput[][] = [];
    let cursor = 0;
    while (cursor < script.length) {
      const r = takeRound(script, cursor);
      rounds.push(r.outputs);
      cursor = r.next;
    }
    const verifyRound = rounds.findIndex((rs) => rs.some((o) => o.type === "tool_call" && o.name === "verify"));
    const expectedRequests = verifyRound >= 0 ? verifyRound + 1 : rounds.length;
    expect(expectedRequests).toBeGreaterThanOrEqual(2); // 这条 case 的剧本本就是多轮的——旧语义下请求数却是 1

    const r = await runCase(c, { model: "probe" });
    try {
      expect(r.assembly).toBeDefined();
      expect(r.assembly!.requests).toBe(expectedRequests);
      // 这条曲线是切轮之前**根本不存在**的东西：逐轮真实装配，历史段必须一轮比一轮长
      const histories = r.assembly!.turns.map((t) => t.historyBytes);
      for (let i = 1; i < histories.length; i++) {
        expect(histories[i]!, `第 ${String(i + 1)} 轮历史段（前一轮 ${String(histories[i - 1])}B）`).toBeGreaterThan(histories[i - 1]!);
      }
      expect(r.score).toBe(1); // 切轮不改判卷：明卷/探针都得把这道题做对
    } finally {
      await cleanupRun(r);
    }
  }, 30_000);
});
