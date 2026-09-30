/** 证据面类型检查那一格（第 259 页；任务 #4）：解析形状、三态、以及"只准调低"的水位判定。
 *  本文件的存在理由：门自己也要有分辨力证人——写它的时候我自己犯过两个"看着绿其实是空转"的错
 *  （tsc 退出码当成 1 而不是 2；`(error)` 白占一个捕获组导致 code 恒为 "error"），两个都不会让解析自证红。 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  DANGER_BASELINE,
  DANGER_CODES,
  parseTscLine,
  runEvidenceTsc,
  tally,
  verdict,
} from "../scripts/lib/evidence-typecheck";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

/** 真 tsc 原文（从 `outputs/foreign-witness-2026-10-01/evidence-tsc-baseline2.log` 逐字取，不自己编形状）。 */
const LINE_2551 = `outputs/anchor-resolvability-2026-09-23/measure-anchor.mts(110,14): error TS2551: Property 'line' does not exist on type '{ kind: "path" }'. Did you mean 'lines'?`;
const LINE_18048 = "outputs/composed-title-audit-2026-09-30/probe.mts(87,24): error TS18048: 'face' is possibly 'undefined'.";
const LINE_7006 = "outputs/sequencer-status-readings-2026-10-01/probe-fail.mts(82,26): error TS7006: Parameter 'e' implicitly has an 'any' type.";
const LINE_CONT = "  No index signature with a parameter of type 'string' was found on type '{}'.";
const LINE_TSCSUMMARY = "Found 51 errors in 14 files.";

describe("parseTscLine：只吃报错行，字段不许取错", () => {
  it("真报错行 ⇒ file 与 code 都取对（code 必须是 TS 码，不是 'error'）", () => {
    const h = parseTscLine(LINE_2551);
    expect(h?.file).toBe("outputs/anchor-resolvability-2026-09-23/measure-anchor.mts");
    // 这一句是**字段序号的证人**：上一版正则把 `(error)` 也括起来当一组，`m[4]` 就成了常量 "error"
    // ⇒ 危险码恒 0 命中、门永远绿，而"解析 51/51"的自证完全看不出来。
    expect(h?.code, "code 取错一位，这一格就从「拦得住」变成「永远绿」").toBe("TS2551");
    expect(DANGER_CODES).toContain(h?.code);
    expect(parseTscLine(LINE_18048)?.code).toBe("TS18048");
  });

  it("非报错行一律 null：缩进续行／汇总行／空行／不带行列号的行", () => {
    expect(parseTscLine(LINE_CONT)).toBeNull();
    expect(parseTscLine(LINE_TSCSUMMARY)).toBeNull();
    expect(parseTscLine("")).toBeNull();
    expect(parseTscLine("scripts/foo.ts:1:1 something")).toBeNull();
  });
});

describe("tally：计数要能自证，装饰性码不许混进危险码", () => {
  it("三条真行混合 ⇒ total 与 parsed 相等、perFile 只含危险码那两条", () => {
    const t = tally([LINE_2551, LINE_18048, LINE_7006, LINE_CONT, ""]);
    expect(t.total).toBe(3);
    expect(t.parsed).toBe(3);
    expect(t.perFile).toEqual({
      "outputs/anchor-resolvability-2026-09-23/measure-anchor.mts": 1,
      "outputs/composed-title-audit-2026-09-30/probe.mts": 1,
    });
  });

  it("解析不完整时不许静默少算：parsed 与 total 的差由 verdict 读成「没量到」（这里先证分母形状）", () => {
    // 造一条"看着像报错但抽不出来"的行：路径里带括号 ⇒ 解析器按形状会跳过它
    const weird = "outputs/weird(x)/probe.mts(1,2): error TS2339: nope";
    const t = tally([weird, LINE_7006]);
    expect(t.total).toBe(2);
    expect(t.parsed).toBe(1);
    const v = verdict({ tsc: { status: 2, out: [weird, LINE_7006].join("\n") }, baseline: {} });
    expect(v.state).toBe("unreadable");
    expect(v.ok).toBe(false);
    expect(v.cell).toContain("没量到");
  });
});

describe("verdict：三态分开印，水位只准调低", () => {
  const base = { "outputs/a.mts": 2, "outputs/b.mts": 1 };

  it("没跑到／取不到 ⇒ unreadable（既不是红也不是绿）", () => {
    for (const tsc of [null, { status: null, out: "" }, { status: 1, out: "" }]) {
      const v = verdict({ tsc, baseline: base });
      expect(v.state).toBe("unreadable");
      expect(v.ok).toBe(false);
      expect(v.grew).toEqual([]);
    }
  });

  it("现读等于帽 ⇒ clean，且不出声喊调低", () => {
    const out = ["outputs/a.mts(1,2): error TS2339: x", "outputs/a.mts(3,4): error TS2339: y", "outputs/b.mts(5,6): error TS2551: z"].join("\n");
    const v = verdict({ tsc: { status: 2, out }, baseline: base });
    expect(v.state).toBe("clean");
    expect(v.ok).toBe(true);
    expect(v.lowered).toEqual([]);
    expect(v.grew).toEqual([]);
  });

  it("老文件多一条 ⇒ 红，且点名 now>cap", () => {
    const out = ["outputs/a.mts(1,2): error TS2339: x", "outputs/a.mts(3,4): error TS2339: y", "outputs/a.mts(5,6): error TS2339: z", "outputs/b.mts(7,8): error TS2551: z"].join("\n");
    const v = verdict({ tsc: { status: 2, out }, baseline: base });
    expect(v.state).toBe("grew");
    expect(v.grew).toEqual([{ file: "outputs/a.mts", now: 3, cap: 2 }]);
    expect(v.cell).toContain("只准调低");
  });

  it("新文件带危险码 ⇒ 红（帽按 0 算）——登记不是入口，修它才是", () => {
    const out = "outputs/new-probe.mts(1,2): error TS2304: Cannot find name 'x'";
    const v = verdict({ tsc: { status: 2, out }, baseline: base });
    expect(v.state).toBe("grew");
    expect(v.grew).toEqual([{ file: "outputs/new-probe.mts", now: 1, cap: 0 }]);
  });

  it("清了要出声让人调低，但不许自己悄悄降帽", () => {
    const v = verdict({ tsc: { status: 2, out: "outputs/a.mts(1,2): error TS2339: x" }, baseline: base });
    expect(v.state).toBe("clean");
    expect(v.ok).toBe(true);
    expect(v.lowered.sort()).toEqual(["outputs/a.mts", "outputs/b.mts"]);
    expect(v.cell).toContain("把登记值调低即可");
  });

  it("分区证人：grew ∪ lowered ∪ 恰好在帽上的文件 必须盖住 baseline 的每一个键（分格不是筛子）", () => {
    const out = ["outputs/a.mts(1,2): error TS2339: x", "outputs/c.mts(3,4): error TS2305: y"].join("\n");
    const v = verdict({ tsc: { status: 2, out }, baseline: { "outputs/a.mts": 2, "outputs/b.mts": 1, "outputs/c.mts": 0 } });
    const covered = new Set([...v.grew.map((g) => g.file), ...v.lowered]);
    for (const f of Object.keys({ "outputs/a.mts": 2, "outputs/b.mts": 1 })) {
      expect(covered.has(f), `baseline 里的 ${f} 既没进 grew 也没进 lowered ⇒ 这一格被静默吞了`).toBe(true);
    }
  });
});

describe("真环境：这一格得在真仓里跑得出东西（规则 237/320）", () => {
  it("仓内 tsconfig.evidence.json 存在，且 tsc 真跑了（退出码 0 或 2，不是「没跑到」）", () => {
    expect(existsSync(join(repoRoot, "tsconfig.evidence.json")), "口径必须落在仓内文件里，不能留在 /tmp").toBe(true);
    const ran = runEvidenceTsc(repoRoot);
    expect(ran, "runEvidenceTsc 把 tsc 的退出码 2 当成「没跑到」过——那会把红读成没测").not.toBeNull();
    expect(ran?.status === 0 || ran?.status === 2, `退出码只能是 0/2，现读 ${String(ran?.status)}`).toBe(true);
    const t = tally((ran?.out ?? "").split("\n"));
    expect(t.parsed, "报错行一条都抽不出来 ⇒ 解析形状与真 tsc 输出对不上").toBe(t.total);
    expect(t.total, "证据面一条报错都没有？那要么门白装，要么取料面空了").toBeGreaterThan(0);
  }, 15_000); // 一次真 tsc：安静态实测 2.56s，三套判卷并行时越过缺省 5s（第 262 页）

  it("登记表里的文件都还在盘上（删了的登记＝下一笔必须把帽撤到 0，不许留幽灵条目）", () => {
    for (const f of Object.keys(DANGER_BASELINE)) {
      expect(existsSync(join(repoRoot, f)), `登记里的 ${f} 已不在盘上 ⇒ 帽该撤（只准调低也含"清零后删名"）`).toBe(true);
      expect(DANGER_BASELINE[f]!, "登记值必须 ≥1（0 就不该占一行，走删除）").toBeGreaterThanOrEqual(1);
    }
  });
});

/* 门那一半（进程编排）的两个拒绝分支。判定全在 lib，但「拒绝」只长在 runner 里：
   这两条不跑，runner 就是无证人的代码——而它的两个坏法都是**fail-open**（把「没跑」交出去当结论）。 */
describe("门那一半：runner 的两个拒绝分支各自要出声", () => {
  const GATE = join(repoRoot, "scripts", "evidence-typecheck-check.ts");
  /* `--import tsx` 这个**裸标识符**是按 cwd 解析的：把 cwd 换成空目录时它自己就先炸（ERR_MODULE_NOT_FOUND、也是退 1）。
     上一版正是被这点骗到——那一条想要的是「门取不到口径」的 1，拿到的却是「tsx 加载不到」的 1，
     而两者退出码相同，只有 stderr 内容能分开。故这里喂 tsx 入口的绝对路径（`tsx` 的 `.` 就是 dist/loader.mjs）。 */
  const TSX = join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");
  const runGate = (args: string[], cwd: string): { status: number | null; out: string } => {
    const r = spawnSync(process.execPath, ["--import", TSX, GATE, ...args], { cwd, encoding: "utf8" });
    return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
  };

  it("拼错的开关 ⇒ 退 2 并点名，不许当成「没给参数」拿默认口径跑", () => {
    const { status, out } = runGate(["--tree=.worktrees/whatever"], repoRoot);
    expect(status, `现读 ${String(status)}：未知参数被放行 ⇒ 这一格量的是另一件事`).toBe(2);
    expect(out).toContain("本门不认参数");
    // 反向证人：同一个脚本不带参数时**不许**退 2（否则上面那条恒真）
    expect(runGate([], repoRoot).status === 2, "不带参数也退 2 ⇒ 拒绝分支写反了，上面那条就没分辨力了").toBe(false);
  }, 15_000); // 反向证人那一跑要真把门跑一遍（含一次 tsc）：安静态 2.74s（第 262 页）

  it("口径文件取不到 ⇒ 出声且非零，不许读成干净", () => {
    const empty = mkdtempSync(join(tmpdir(), "dsh-evtsf-"));
    try {
      const { status, out } = runGate([], empty);
      expect(status, `cwd 换成空目录后现读 ${String(status)}：取不到口径却退 0 ⇒ 「压根没跑」被读成「跑了且干净」`).toBe(1);
      expect(out, "退出码相同不代表成因相同：这里要的是门自己那一句，不是加载器炸了").toContain("证据面这一格压根没跑");
      expect(out).not.toContain("ERR_MODULE_NOT_FOUND");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
