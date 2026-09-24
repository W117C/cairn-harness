import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { replayLongAssembly, diffLongReplay } from "../src/agent/gym/probe";
import { createMockSummarizer } from "../src/agent/compaction";
import { GYM_PROBE_SYSTEM } from "../src/agent/gym/runner";
import type { GlmToolSpec } from "../src/providers/glm";

/** 冻结每请求的固定开销（`tests/compaction-cost.test.ts` 里那条的同款理由）：下面这条 A/B 拿
 *  「压缩次数」「作废前缀字节」当判据，而两者都由「阈值 − 每请求常数」决定。取活面时，任何一次
 *  往模型面加工具的无关改动都会搬动那个常数。2026-09-24 实测这条链的**有效窗口只有 ~640 B**：
 *  · 活面 13 把 / 6,544 B（`dee8139`）⇒ 三条断言全绿；
 *  · 活面 15 把 / 7,180 B（`a0db9ea`，多一把 `refine_goal`）⇒ 红成「OFF 4 vs ON 5」；
 *  · 活面 20 把 / 10,024 B（HEAD，定时五件入库后）⇒ 同样红。
 *  ⇒ 把它钉成**当初那档字节数**（13 把 × 描述重复 122 次 ⇒ 6,543 B）：判据一字未改，
 *    只是不再被别人的工具面牵着走。窗口这么窄本身是这条读数的已知弱点（已记进第 44 页）。 */
const FROZEN_FACE: GlmToolSpec[] = (() => {
  const out: GlmToolSpec[] = [];
  for (let i = 0; i < 13; i++) {
    out.push({
      type: "function",
      function: {
        name: "frozen_tool_" + String(i),
        description: "冻结面".repeat(122), // 尺寸即判据的一部分：改这个数 = 改分母，须连读数一起复跑
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    });
  }
  return out;
})();

/** 长时程回放（能力 11）：靶场原有 case 全是 `requests=1`，只在多轮生效的机制一次都触发不到
 *  （BLOCKED 裁决 3 的原话）。这里走的是该裁决留下的**方案②**——不动冻结判卷文件，只在临时目录里
 *  把会话续长出历史，于是「第 N 轮装配长什么样、这一轮比上一轮多作废多少前缀」第一次可测。 */

const CASE = "config-default";
const CASE_DIR = join("fixtures", "gym", "cases", CASE);
// 与 `prefix-churn-check` PC7 同一配方：窗口与 ratio 让触发停在 threshold，tail 三个旋钮不覆盖
// （覆盖了就会落到工作集下限之下，摊销按设计拒绝动作——那是样本不像生产，不是策略坏）。
const COMPACT = { inputLimit: 12_000, maxOutputReserve: 400, ratio: 0.35, retryBackoffMs: 1 };
const SUMMARY = "SUMMARY：这段是长时程回放里的冻结摘要，内容不重要，重要的是它真的落了一次压缩。";

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

async function scratch(): Promise<{ eventsPath: string; workspace: string }> {
  const dir = await mkdtemp(join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "gym-long-"));
  dirs.push(dir);
  return { eventsPath: join(dir, "events.jsonl"), workspace: dir };
}

/** 冻结判卷区的指纹：本能力的红线是「只读 fixture，写只落临时目录」。 */
async function fingerprint(dir: string): Promise<string> {
  const h = createHash("sha256");
  for (const name of (await readdir(dir)).sort()) {
    const p = join(dir, name);
    if (existsSync(p) && (await readFile(p).catch(() => null))) {
      h.update(name).update(await readFile(p));
    }
  }
  return h.digest("hex");
}

async function runFor(id: string, amortize: boolean) {
  const { eventsPath, workspace } = await scratch();
  return replayLongAssembly({
    caseId: id,
    eventsPath,
    workspace,
    system: GYM_PROBE_SYSTEM,
    scriptPath: scriptOf(id),
    map: false,
    longTurns: 8,
    growthChars: 4_000,
    amortize,
    toolsOverride: FROZEN_FACE,
    compactionConfig: COMPACT,
    summarizer: createMockSummarizer(SUMMARY),
  });
}
const run = (amortize: boolean) => runFor(CASE, amortize);
const scriptOf = (id: string) => join("fixtures", "gym", "cases", id, "script.jsonl");

describe("长时程回放：机制与红线", () => {
  it("续长的会话真的会被反复装配：requests = longTurns、历史在涨、且至少压一次（否则样本无分辨力）", async () => {
    const r = await run(false);
    expect(r.requests).toBe(8);
    expect(r.turns.at(-1)!.historyBytes).toBeGreaterThan(r.turns[0]!.historyBytes);
    expect(r.compactions).toBeGreaterThanOrEqual(1);
    expect(r.rewrites).toBeGreaterThanOrEqual(1);
    expect(r.totalRewroteBytes).toBeGreaterThan(0);
    // 抖动必须只出现在压缩之后的轮上：没压过的相邻轮应当逐字纯追加
    const pureAppends = r.turns.filter((t) => t.headSurvival === 1).length;
    expect(pureAppends).toBeGreaterThan(0);
  }, 120_000);

  it("冻结判卷区一个字节都没动（本能力只读 case，写只落临时目录）", async () => {
    const before = await fingerprint(CASE_DIR);
    await run(false);
    expect(await fingerprint(CASE_DIR)).toBe(before);
  }, 120_000);

  it("摊销开关在同一条链上真省：压缩次数不更多、作废前缀严格更少（A/B 可复跑）", async () => {
    const off = await run(false);
    const on = await run(true);
    expect(off.compactions).toBeGreaterThanOrEqual(2); // 非恒真前提：连压两次才有得省
    const d = diffLongReplay(off, on);
    expect(on.compactions).toBeLessThanOrEqual(off.compactions);
    expect(d.totalRewroteBytes).toBeLessThan(0);
    expect(on.totalPromptBytes).toBeLessThan(off.totalPromptBytes);
  }, 240_000);

  it("仪器读的是 case，不是我塞的字数：两条 case 的账单必须不同", async () => {
    const a = await runFor("config-default", false);
    const b = await runFor("sum-clamp", false);
    expect(a.totalRewroteBytes).not.toBe(b.totalRewroteBytes);
    expect(a.turns[1]?.historyBytes).not.toBe(b.turns[1]?.historyBytes);
  }, 240_000);

  it("剧本里没有可用正文时**拒绝跑**（宁可不量，也不拿编造内容当某条 case 的读数）", async () => {
    const { eventsPath, workspace } = await scratch();
    const dir = await mkdtemp(join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "gym-empty-"));
    dirs.push(dir);
    const emptyScript = join(dir, "script.jsonl");
    // 剧本**装得下**（assistant_message 是合法变体），但正文是空的——这才是要拒的情形；
    // 用非法变体会被装载器先拒，测的就不是这条守卫了。
    await writeFile(emptyScript, JSON.stringify({ type: "assistant_message", content: "   " }) + "\n");
    await expect(replayLongAssembly({
      caseId: "synthetic-empty",
      eventsPath,
      workspace,
      system: GYM_PROBE_SYSTEM,
      scriptPath: emptyScript,
      map: false,
      longTurns: 2,
    })).rejects.toThrow("拒绝用编造内容放大");
  });

  it("空/单轮回放不炸（longTurns=1 时没有相邻对，rewrites 必须记 0 而不是 NaN）", async () => {
    const { eventsPath, workspace } = await scratch();
    const r = await replayLongAssembly({
      caseId: CASE,
      eventsPath,
      workspace,
      system: GYM_PROBE_SYSTEM,
      scriptPath: join(CASE_DIR, "script.jsonl"),
      map: false,
      longTurns: 1,
    });
    expect(r.requests).toBe(1);
    expect(r.rewrites).toBe(0);
    expect(r.totalRewroteBytes).toBe(0);
    expect(r.turns[0]?.headSurvival).toBeNull();
  }, 60_000);
});
