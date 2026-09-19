// 切轮口径的端到端自证：走真 runLoop + 真冻结 case。
// 与 tests/gym-script.test.ts（纯函数 + 有界粒度，变异表的锚点面）分文件：
// 这里一条用例能让 runLoop 跑满几十步，突变命中时不适合当具名判据的落点。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ModelOutput } from "../src/providers";
import { loadCase, loadGymIndex } from "../src/agent/gym/case";
import { cleanupRun, runCase } from "../src/agent/gym/runner";
import { createProbeTransport, type AssemblyTurn } from "../src/agent/gym/probe";
import { loadScriptOutputs, takeRound } from "../src/agent/gym/script";

describe("切轮之后靶场能量多轮机制（端到端）", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "gym-rounds-e2e-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("probe 档逐轮装配：轮号递增、同一输入下账不变、尾部跑完即空", async () => {
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
    // 手工按 loop 的粒度驱动：一次 transport 调用 = 一轮请求。装配增长不在这条链上
    // （输入是我喂死的同一份 messages），逐轮变长由下面那条冻结 case 断言。
    for (let i = 0; i < 5; i++) {
      let n = 0;
      for await (const _o of transport([{ role: "user", content: "任务" }] as never, {}, [])) { void _o; n++; }
      yieldsPerCall.push(n);
    }
    // 剧本 7 条 = 4 轮（3 轮各 2 条 + 尾部纯文本 1 条）；drain-all 会打成 [7,0,0,0,0]
    expect(yieldsPerCall).toEqual([2, 2, 2, 1, 0]);
    expect(seen.map((t) => t.turn)).toEqual([1, 2, 3, 4, 5]);
    expect(seen.every((t) => t.historyBytes === seen[0]!.historyBytes)).toBe(true);
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
      // 这条曲线是切轮之前**根本不存在**的东西：逐轮真实装配，历史段一轮比一轮长
      const histories = r.assembly!.turns.map((t) => t.historyBytes);
      for (let i = 1; i < histories.length; i++) {
        expect(histories[i]!, `第 ${String(i + 1)} 轮历史段（前一轮 ${String(histories[i - 1])}B）`).toBeGreaterThan(histories[i - 1]!);
      }
      expect(r.score).toBe(1); // 切轮不改判卷：探针档也得把这道题做对
    } finally {
      await cleanupRun(r);
    }
  }, 30_000);

  it("长时程 case 的逐轮账：十轮十请求，且峰值远大于可缓存前缀（前缀被整轮重送的证据）", async () => {
    const GYM = join(process.cwd(), "fixtures", "gym");
    const index = await loadGymIndex(GYM);
    const entry = index.cases.find((x) => x.id === "order-pricing-triple-fix");
    expect(entry, "长时程 case 必须在清单里（不在 = 判卷面被摘掉）").toBeDefined();
    const c = await loadCase(GYM, entry!);
    const r = await runCase(c, { model: "probe" });
    try {
      expect(r.turns).toBe(10); // 十条 tool_call，一轮一条
      expect(r.assembly!.requests).toBe(10);
      const cacheable = r.assembly!.cacheableBytes;
      const totalRepeatable = cacheable * r.assembly!.requests;
      // 静态前缀 × 请求数 必须真的落在总账的量级里——否则这条 case 不是「长时程」而是又一条单轮题
      expect(totalRepeatable).toBeLessThanOrEqual(r.assembly!.totalPromptBytes);
      expect(r.assembly!.totalPromptBytes).toBeGreaterThan(4 * cacheable);
      expect(r.score).toBe(1);
    } finally {
      await cleanupRun(r);
    }
  }, 60_000);
});
