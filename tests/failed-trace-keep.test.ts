// 判卷 · `scripts/lib/failed-trace-keep.ts`（#109：基准的失败轨迹 ⇒ 学习环的输入）。
//
// 病灶（现读，非抄台账）：`package.json:53-57` 那四支 bench 脚本从不传 `--keep`，而跑器的临时目录是
// `mkdtemp` + `rm(dir)`（HEAD 的 `scripts/loop-eval.ts:582`）⇒ 每趟的 `events.jsonl` 跟着目录一起没。
// `src/agent/gym/draft.ts` 那条「失败轨迹 → 回归草稿」的通路是齐的，但它吃的是**事件流原文**
// （`replay(path)` → `draftFromEvents(events)`），原文没了 ⇒ bench 跑一片红也学不到任何东西。
//
// 判卷纪律与四条判据：
//  ① FAIL 那一趟 ⇒ 预期路径上**恰好一份**草稿输入，且**读回来**真能被既有取料口吃下去（行为不是旗标）；
//  ② PASS / 「无效」⇒ 一份都不落（让它小的不是帽，是裁决本身）；
//  ③ 超过帽的 N 条不许静默不写 ⇒ 那行读数点名"丢了几条"；
//  ④ 落点必须在 `scripts/repo-hygiene-check.ts` 面① 量的那棵树（`outputs/`）里。
// 全程零真模型、零网络、零花费：夹具是合成的目录与手写的 JSONL。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { AgentEvent } from "../src/events";
import { replay } from "../src/events";
import { draftFromEvents } from "../src/agent/gym/draft";
import { trackedCounts } from "../scripts/repo-hygiene-check";
import {
  FAILED_VERDICT, TRACE_COUNT_CAP, TRACE_SUFFIX, caseIdOfTrace, failedTraceDir,
  keepFailedTrace, traceKeepLine, type TraceKeepOutcome,
} from "../scripts/lib/failed-trace-keep";

const HERE = resolve(fileURLToPath(import.meta.url), "../..");
const DAY = "2026-10-05";
const OUT = "outputs/bench";

/** 一条**真形状**的失败转录：写成一笔 + 验证到上限仍红（cause=code ⇒ 归模型，不是环境红）。 */
const FAILING: AgentEvent[] = [
  { type: "user_message", content: "把分页 size 修对并跑测试证明全绿\n" },
  { type: "tool_call", id: "c1", name: "edit_file", args: { path: "src/pagination.js" } },
  { type: "tool_result", callId: "c1", ok: true, output: "written" },
  { type: "tool_call", id: "c2", name: "run_shell", args: { command: "pnpm test" } },
  { type: "tool_result", callId: "c2", ok: true, output: "1 failed" },
  { type: "verify_result", callId: "v3", ok: false, attempt: 3, maxAttempts: 3, results: [], cause: "code" },
];
/** 反向证人：全程顺利、验绿的轨迹。 */
const GREEN: AgentEvent[] = [
  { type: "user_message", content: "把分页 size 修对并跑测试证明全绿\n" },
  { type: "tool_call", id: "c1", name: "edit_file", args: { path: "src/pagination.js" } },
  { type: "tool_result", callId: "c1", ok: true, output: "written" },
  { type: "verify_result", callId: "v1", ok: true, attempt: 1, maxAttempts: 3, results: [] },
];

/** 一个假仓根 + 一个假临时目录（跑器那侧的 mkdtemp 替代品）。 */
async function fixture(): Promise<{ root: string; tmp: string }> {
  const root = await mkdtemp(join(tmpdir(), "dsh109-root-"));
  const tmp = await mkdtemp(join(tmpdir(), "dsh109-run-"));
  return { root, tmp };
}
/** 把转录写进"临时目录里那份 events.jsonl"，并盖一个独有标记（覆盖与否就靠它分辨）。 */
async function writeSource(tmp: string, events: readonly AgentEvent[], marker = ""): Promise<string> {
  const p = join(tmp, "events.jsonl");
  const lines = events.map((e) => JSON.stringify(marker === "" ? e : { ...e, __probe: marker }));
  await writeFile(p, lines.join("\n") + "\n", "utf8");
  return p;
}
const keep = (over: Partial<Parameters<typeof keepFailedTrace>[0]>) => keepFailedTrace({
  verdict: FAILED_VERDICT, root: "/absent/root", out: OUT, day: DAY,
  sourcePath: "/absent/events.jsonl", caseId: "probe", keepAll: false, ...over,
});
const traceDirOf = (root: string): string => join(root, failedTraceDir(OUT, DAY));
/** 目录里现有的留档名（空目录 ⇒ 空数组；目录压根没造出来 ⇒ 也算空数组，由调用方另外钉"没造出来"）。 */
async function listed(root: string): Promise<string[]> {
  return (await readdir(traceDirOf(root)).catch(() => [] as string[])).slice().sort();
}

describe("① FAIL 那一趟 ⇒ 预期路径上恰好一份草稿输入（读回来才算数）", () => {
  it("落点名与内容都钉得住：这份输入真能被既有取料口 replay→draftFromEvents 吃下去", async () => {
    const { root, tmp } = await fixture();
    const src = await writeSource(tmp, FAILING);
    const out = await keep({ root, sourcePath: src, caseId: "I2-rep1-base" });
    expect(out.skipped, JSON.stringify(out)).toBeNull();
    expect(out.relPath).toBe(OUT + "/failures/" + DAY + "/I2-rep1-base.events.jsonl");
    expect(await listed(root)).toEqual(["I2-rep1-base.events.jsonl"]);
    // 读回来（行为，不是返回值）：既有那条通路吃的就是这份文件。
    const back = await readFile(out.absPath!, "utf8");
    expect(back).toBe(await readFile(src, "utf8"));
    const draft = draftFromEvents(await replay(out.absPath!));
    expect(draft.task).toContain("把分页 size 修对");
    expect(draft.verifyOk).toBe(false);
    expect(draft.candidateChanges).toEqual(["src/pagination.js"]);
    await rm(root, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  });

  it("字节数是真的：留档那份与源那份逐字同尺寸（不是写了个空壳）", async () => {
    const { root, tmp } = await fixture();
    const src = await writeSource(tmp, FAILING);
    const out = await keep({ root, sourcePath: src, caseId: "I9-rep2-short" });
    expect(out.bytes).toBe((await stat(src)).size);
    expect(out.bytes).toBeGreaterThan(0);
    expect((await stat(join(traceDirOf(root), "I9-rep2-short" + TRACE_SUFFIX))).size).toBe(out.bytes);
    await rm(root, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  });
});

describe("② 绿的那趟一份都不落（让目录小的不是帽，是裁决）", () => {
  const greenCase = (verdict: "PASS" | "无效") => async () => {
    const { root, tmp } = await fixture();
    const src = await writeSource(tmp, GREEN);
    const out = await keep({ root, sourcePath: src, caseId: "I1-rep1-base", verdict });
    expect(out.skipped).toBe("not-a-failure");
    expect(out.relPath).toBeNull();
    expect(await listed(root)).toEqual([]);
    expect(await stat(traceDirOf(root)).catch(() => null)).toBeNull();
    await rm(root, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  };
  // 两条各写死标题（不用 loop 拼）：拼接标题让锚点指针只能靠占位符展开才认得（松钉水位只准调低），
  // 且 runner 的 `-t` 选不中它 ⇒ 变异那一拍会退化成整文件跑法。
  it("verdict=「PASS」⇒ skipped=not-a-failure，且连 failures/ 目录都不该被造出来", greenCase("PASS"));
  it("verdict=「无效」⇒ skipped=not-a-failure，且连 failures/ 目录都不该被造出来", greenCase("无效"));

  it("反向一侧：把帽放大到 100 条，绿的那趟仍然不落（帽不是唯一让它小的东西）", async () => {
    const { root, tmp } = await fixture();
    const src = await writeSource(tmp, GREEN);
    const out = await keep({ root, sourcePath: src, caseId: "I1-rep1-base", verdict: "PASS", countCap: 100 });
    expect(out.skipped).toBe("not-a-failure");
    expect(await listed(root)).toEqual([]);
    await rm(root, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  });
});

describe("③ 超过帽的那几条不许静默消失：那行读数点名丢了几条", () => {
  it("4 条 FAIL / 帽 2 ⇒ 盘上恰好 2 份，读数里「超条数帽 2」与「丢弃合计 2」都在", async () => {
    const { root, tmp } = await fixture();
    const src = await writeSource(tmp, FAILING);
    const outcomes: TraceKeepOutcome[] = [];
    for (const id of ["A1", "A2", "A3", "A4"]) {
      outcomes.push(await keep({ root, sourcePath: src, caseId: id, countCap: 2 }));
    }
    expect(await listed(root)).toEqual(["A1.events.jsonl", "A2.events.jsonl"]);
    const line = traceKeepLine({
      root, out: OUT, day: DAY, outcomes,
      countCap: 2, fileBytesCap: 256 * 1024, totalBytesCap: 1_536 * 1024,
    });
    expect(line).toContain("写出 2 条");
    expect(line).toContain("丢弃合计 2");
    expect(line).toContain("超条数帽 2");
    // 帽的值本身也要印得出来（只说"丢了 2 条"不说帽是几，读的人没法判断该不该抬）
    expect(line).toContain("帽 2 条/日");
    await rm(root, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  });

  it("单条超帽 ⇒ 整条不留、**不截断**（截过的转录是一份假草稿输入）", async () => {
    const { root, tmp } = await fixture();
    const big = join(tmp, "events.jsonl");
    await writeFile(big, "x".repeat(4096) + "\n", "utf8");
    const out = await keep({ root, sourcePath: big, caseId: "B1", fileBytesCap: 1024 });
    expect(out.skipped).toBe("file-bytes-cap");
    expect(await listed(root)).toEqual([]);
    const line = traceKeepLine({
      root, out: OUT, day: DAY, outcomes: [out],
      countCap: 12, fileBytesCap: 1024, totalBytesCap: 1_536 * 1024,
    });
    expect(line).toContain("超单条帽 1");
    await rm(root, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  });

  it("目录总字节帽：第二条放不进去 ⇒ 点名「超目录总帽 1」而不是少写一条没人说", async () => {
    const { root, tmp } = await fixture();
    const src = await writeSource(tmp, FAILING);
    const size = (await stat(src)).size;
    // 帽是**含界**的（与条数帽、单条帽同一口径：`== 帽` 仍可留）。所以要让第二条放不下，
    // 上限得取「一条 + 1 字节」，而不是「两条」——两条那个数字测的是"恰好等于帽"，那是**该留**的那一格。
    const first = await keep({ root, sourcePath: src, caseId: "C1", totalBytesCap: size + 1 });
    const second = await keep({ root, sourcePath: src, caseId: "C2", totalBytesCap: size + 1 });
    expect(first.skipped).toBeNull();
    expect(second.skipped).toBe("total-bytes-cap");
    expect(await listed(root)).toEqual(["C1.events.jsonl"]);
    await rm(root, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  });

  it("同日同靶再跑一次 ⇒ 不覆盖人已补过的件，那一格叫「已在场」不叫「被帽丢掉」", async () => {
    const { root, tmp } = await fixture();
    const src1 = await writeSource(tmp, FAILING, "第一份");
    const first = await keep({ root, sourcePath: src1, caseId: "D1" });
    expect(first.skipped).toBeNull();
    // 人已经开始补件（草稿侧的补件走的是同一份转录的读法，这里只证明"不覆盖"）
    const src2 = await writeSource(tmp, FAILING, "第二份");
    const again = await keep({ root, sourcePath: src2, caseId: "D1" });
    expect(again.skipped).toBe("already-there");
    expect(await listed(root)).toEqual(["D1.events.jsonl"]);
    expect(await readFile(join(traceDirOf(root), "D1.events.jsonl"), "utf8")).toContain("第一份");
    expect(await readFile(join(traceDirOf(root), "D1.events.jsonl"), "utf8")).not.toContain("第二份");
    await rm(root, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  });

  it("`--keep` 在场 ⇒ 不写第二份，那一格有自己的名字", async () => {
    const { root, tmp } = await fixture();
    const src = await writeSource(tmp, FAILING);
    const out = await keep({ root, sourcePath: src, caseId: "E1", keepAll: true });
    expect(out.skipped).toBe("covered-by-keep-all");
    expect(await listed(root)).toEqual([]);
    await rm(root, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  });

  it("源读不到 / 写不进 ⇒ 落到「没留成而报错」那一格，不许退回 0 冒充安静", async () => {
    const { root, tmp } = await fixture();
    const missing = await keep({ root, sourcePath: join(tmp, "压根没有这份.jsonl"), caseId: "F1" });
    expect(missing.skipped).toBe("source-unreadable");
    const line = traceKeepLine({
      root, out: OUT, day: DAY, outcomes: [missing],
      countCap: 12, fileBytesCap: 256 * 1024, totalBytesCap: 1_536 * 1024,
    });
    expect(line).toContain("没留成而报错 1");
    await rm(root, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  });
});

describe("④ 落点必须在 repo-hygiene 面① 量的那棵树里", () => {
  it("留档路径被那把尺的取料谓词数得着（同一份 `trackedCounts`，不是另写一遍 startsWith）", async () => {
    const { root, tmp } = await fixture();
    const src = await writeSource(tmp, FAILING);
    const out = await keep({ root, sourcePath: src, caseId: "G1-rep1-base" });
    expect(out.relPath, "留档没落到产物目录里").not.toBeNull();
    expect(out.relPath!.startsWith("outputs/")).toBe(true);
    const counts = trackedCounts(out.relPath! + "\0" + "src/a.ts\0");
    expect([counts.total, counts.outputs, counts.rest]).toEqual([2, 1, 1]);
    const v = traceKeepLine({
      root, out: OUT, day: DAY, outcomes: [out],
      countCap: TRACE_COUNT_CAP, fileBytesCap: 256 * 1024, totalBytesCap: 1_536 * 1024,
    });
    // 门内的写法：不出现那句"量不到"
    expect(v).not.toContain("repo-hygiene");
    await rm(root, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  });

  it("反向一侧：`--out` 指到 outputs/ 之外 ⇒ 那行当场说出「门量不到它」（不静默写到没人量的树上）", async () => {
    const { root, tmp } = await fixture();
    const src = await writeSource(tmp, FAILING);
    const out = await keep({ root, out: "elsewhere", sourcePath: src, caseId: "H1" });
    expect(out.skipped).toBeNull();
    const line = traceKeepLine({
      root, out: "elsewhere", day: DAY, outcomes: [out],
      countCap: 12, fileBytesCap: 256 * 1024, totalBytesCap: 1_536 * 1024,
    });
    expect(line).toContain("repo-hygiene");
    await rm(root, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  });
});

describe("留档名 ⇄ 草稿 id：两端共用同一份规则（两处各写一遍迟早漂）", () => {
  it("基准那种 `.events.jsonl` 剥干净，旧的 `--keep` 单后缀也认", () => {
    expect(caseIdOfTrace(join(OUT, "failures", DAY, "I2-rep1-base.events.jsonl"))).toBe("I2-rep1-base");
    expect(caseIdOfTrace("solo.jsonl")).toBe("solo");
    expect(caseIdOfTrace("outputs/bench/failures/2026-10-06/B4-bugfix pagination-rep1-base.events.jsonl"))
      .toBe("B4-bugfix-pagination-rep1-base");
    expect(caseIdOfTrace("-.jsonl")).toBe("session");
  });
});

describe("那行读数：永远印，且格子之间守恒", () => {
  it("一条都没留也有一行（「没有 FAIL」与「这一跳没接」不许同形）", () => {
    const line = traceKeepLine({
      root: "/r", out: OUT, day: DAY, outcomes: [],
      countCap: 12, fileBytesCap: 262144, totalBytesCap: 1_572_864,
    });
    expect(line).toContain("写出 0 条");
    expect(line).toContain(failedTraceDir(OUT, DAY) + "/");
    expect(line).toContain("scripts/gym-draft.ts");
  });

  it("守恒：写出 ＋ 各 skipped 格子之和 ＝ 递进来的行数（漏一格就会静默少算）", async () => {
    const { root, tmp } = await fixture();
    const src = await writeSource(tmp, FAILING);
    const outcomes = [
      await keep({ root, sourcePath: src, caseId: "K1" }),
      await keep({ root, sourcePath: src, caseId: "K2", verdict: "PASS" }),
      await keep({ root, sourcePath: src, caseId: "K1" }),
      await keep({ root, sourcePath: join(tmp, "没有.jsonl"), caseId: "K4" }),
    ];
    const line = traceKeepLine({
      root, out: OUT, day: DAY, outcomes,
      countCap: 12, fileBytesCap: 256 * 1024, totalBytesCap: 1_536 * 1024,
    });
    const num = (label: string): number => Number((new RegExp(label + " (\\d+)").exec(line) ?? [])[1]);
    const sum = num("写出") + num("非失败不写") + num("同日已在场不覆盖") + num("没留成而报错")
      + num("超条数帽") + num("超单条帽") + num("超目录总帽") + num("--keep 已留全量而未写");
    expect(sum, line).toBe(outcomes.length);
    await rm(root, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  });
});

describe("接线：既有那个取料口真吃得下这份留档（spawn 真脚本，不调模型）", () => {
  const CLI = join(HERE, "scripts", "gym-draft.ts");
  const run = (args: string[]): { code: number | null; out: string } => {
    const r = spawnSync(process.execPath, ["--import", "tsx", ...args], { cwd: HERE, encoding: "utf8", timeout: 60_000 });
    return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
  };

  it("留档文件 → `gym-draft --out <目录> --apply` ⇒ 草稿三件真落盘（闭环走通，不是打印一句话）", async () => {
    const { root, tmp } = await fixture();
    const src = await writeSource(tmp, FAILING);
    const kept = await keep({ root, sourcePath: src, caseId: "N71-rep1-base" });
    expect(kept.skipped, JSON.stringify(kept)).toBeNull();
    const dest = join(tmp, "drafts", "N71-rep1-base");
    const dry = run([CLI, kept.absPath!, "--out", dest]);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("dry run");
    expect(await readdir(dest).catch(() => [] as string[])).toEqual([]);
    const applied = run([CLI, kept.absPath!, "--out", dest, "--apply"]);
    expect(applied.code, applied.out).toBe(0);
    expect((await readdir(dest)).sort()).toEqual(["DRAFT.md", "expect.candidate.json", "task.md"]);
    expect(await readFile(join(dest, "task.md"), "utf8")).toContain("把分页 size 修对");
    expect(JSON.parse(await readFile(join(dest, "expect.candidate.json"), "utf8")).mustChangeFiles).toEqual(["src/pagination.js"]);
    await rm(root, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  });

  it("目录模式缺省仍是 dry run：逐份点名候选，而仓里的 fixtures/gym/drafts/ 一个字节都不落", async () => {
    const { root, tmp } = await fixture();
    const src = await writeSource(tmp, FAILING);
    const tag = "zzdsh109-" + String(process.pid);
    const a = await keep({ root, sourcePath: src, caseId: tag + "-A" });
    const b = await keep({ root, sourcePath: src, caseId: tag + "-B" });
    expect([a.skipped, b.skipped]).toEqual([null, null]);
    const r = run([CLI, traceDirOf(root)]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("源会话 " + join(traceDirOf(root), tag + "-A.events.jsonl"));
    expect(r.out).toContain("计划写出 2 条草稿");
    // dry run 逐字不落盘（真落盘就会污染隔壁会话的 hunk 归属读数——第 394 页那条裁决）
    for (const id of [tag + "-A", tag + "-B"]) {
      const p = join(HERE, "fixtures", "gym", "drafts", id);
      if (existsSync(p)) {
        await rm(p, { recursive: true, force: true });
        expect.unreachable("dry run 把草稿写进了真仓：" + p);
      }
    }
    await rm(root, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  });

  it("目录 + `--id`／`--out` ⇒ 拒跑（一批各按自己靶名，静默只听第一个是 #63c 那一族）", async () => {
    const { root, tmp } = await fixture();
    const src = await writeSource(tmp, FAILING);
    await keep({ root, sourcePath: src, caseId: "P1" });
    expect(run([CLI, traceDirOf(root), "--id", "手递一个名"]).code).toBe(2);
    expect(run([CLI, traceDirOf(root), "--out", join(tmp, "x")]).code).toBe(2);
    await rm(root, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  });

  it("空目录 ⇒ 退出码 2 并说清这是「没取到料」不是「没有失败」", async () => {
    const empty = await mkdtemp(join(tmpdir(), "dsh109-empty-"));
    const r = run([CLI, empty]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("没取到料");
    await rm(empty, { recursive: true, force: true });
  });
});

describe("接线面：跑器真的走这一跳（脚本形状，照 tests/loop-eval-invocation-face.test.ts 的先例）", () => {
  const src = require$(["scripts", "loop-eval.ts"]);
  const pkg = JSON.parse(require$(["package.json"], "utf8") as unknown as string) as { scripts: Record<string, string> };

  function require$(rel: string[], enc?: "utf8"): string {
    // eslint-disable-next-line no-undef
    return readFileSync(join(HERE, ...rel), "utf8") as string;
  }

  it("跑器每行都递 verdict 给留档器，且临时目录不再在 runOnce 里就地删", () => {
    expect(src).toContain("keepFailedTrace({");
    expect(src).toContain("retainStagedRuns(STAGED.splice(stagedMark), verdict, traceKeeps)");
    expect(src).toContain("traceKeepLine({");
    // 反向一侧：runOnce 里那句「跑完就 rm(dir)」必须已经没了（它就是 #109 的本体）
    expect(src).not.toContain("await rm(dir, { recursive: true, force: true });");
    expect(src).toContain("STAGED.push({ key: t.id");
  });

  it("四支 bench 脚本**仍然不传** `--keep`：修的是「失败默认有档」，不是把全量开关打开", () => {
    const bench = Object.entries(pkg.scripts).filter(([k]) => k === "bench" || k.startsWith("bench:"));
    expect(bench.length).toBe(4);
    for (const [name, cmd] of bench) {
      expect(cmd, name + " 不该靠 --keep 才留得住东西").not.toContain("--keep");
      expect(cmd).toContain("scripts/loop-eval.ts");
    }
  });
});
