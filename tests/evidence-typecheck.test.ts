/** 证据面类型检查那一格（第 259 页；任务 #4）：解析形状、三态、以及"只准调低"的水位判定。
 *  本文件的存在理由：门自己也要有分辨力证人——写它的时候我自己犯过两个"看着绿其实是空转"的错
 *  （tsc 退出码当成 1 而不是 2；`(error)` 白占一个捕获组导致 code 恒为 "error"），两个都不会让解析自证红。 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  DANGER_BASELINE,
  DANGER_CODES,
  evidenceOthersPrefixes,
  parseTscLine,
  runEvidenceTsc,
  tally,
  verdict,
} from "../scripts/lib/evidence-typecheck";
import { gitOthersArgs } from "../scripts/prose-needle-scan";

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

/* ── 第 281 页：归因分面。第 259 页的口径一直写在注释里（「只登记在 HEAD 里的文件」），
   但判定面把隔壁未入库的草稿一视同仁 ⇒ 共享工作树里「别人的草稿」= 我的红，交笔自检只能靠人肉归因。
   这四条各钉一种坏法：豁免写过头（把已跟踪的也放走）、豁免写反（一个都不放）、
   面取不到被读成"没有未跟踪件"（fail-open）、口径没印进读数（同一个 12 条在两种口径下是两件事）。 ── */
describe("归因分面：未跟踪（不在 HEAD）的危险码只点名、不进棘轮", () => {
  const outMine = "outputs/a.mts(1,2): error TS2339: x";
  const outFly1 = "outputs/neighbor-fly.mts(9,9): error TS2339: y";
  const outFly2 = "outputs/neighbor-fly.mts(8,8): error TS2551: z";
  const out = [outMine, outFly1, outFly2].join("\n");

  it("隔壁未入库的草稿 ⇒ 不红、点名，且 HEAD 口径的数字真的比工作树口径小（两种口径不许同数）", () => {
    const v = verdict({ tsc: { status: 2, out }, baseline: { "outputs/a.mts": 1 }, untracked: { files: ["outputs/neighbor-fly.mts"], unavailable: false } });
    expect(v.ok, `隔壁的草稿推动了棘轮：${v.cell}`).toBe(true);
    expect(v.state).toBe("clean");
    expect(v.flying).toEqual([{ file: "outputs/neighbor-fly.mts", now: 2 }]);
    expect(v.grew).toEqual([]);
    // 口径必须印出来，否则下一个读者分不清这 1 条是"仓里的"还是"整棵树的"
    expect(v.cell).toContain("HEAD 口径");
    expect(v.cell).toContain("不计我的账");
    expect(v.cell).toContain("outputs/neighbor-fly.mts(2)");
    // 同一份输入、不喂面 ⇒ 那条草稿就落回我的账（1 条帽 vs 3 条现读 ⇒ 红）。两种口径必须读得出差别。
    const bare = verdict({ tsc: { status: 2, out }, baseline: { "outputs/a.mts": 1 } });
    expect(bare.state, "喂面与不喂面同为 clean ⇒ 分面根本没生效").toBe("grew");
    expect(bare.grew).toEqual([{ file: "outputs/neighbor-fly.mts", now: 2, cap: 0 }]);
  });

  it("豁免只认「清单里那一个文件」：同目录的已跟踪新件照样红（豁免不许按前缀放行）", () => {
    const v = verdict({
      tsc: { status: 2, out: [outMine, "outputs/same-dir-new.mts(1,2): error TS2339: x"].join("\n") },
      baseline: { "outputs/a.mts": 1 },
      untracked: { files: ["outputs/neighbor-fly.mts"], unavailable: false },
    });
    expect(v.ok, "已跟踪的新探针被当成在飞放走了 ⇒ 这就是假绿").toBe(false);
    expect(v.grew).toEqual([{ file: "outputs/same-dir-new.mts", now: 1, cap: 0 }]);
  });

  it("面取不到 ⇒ 不许读成「没有未跟踪件」：退回工作树口径判（最坏假红）并把话说明白", () => {
    const v = verdict({ tsc: { status: 2, out }, baseline: { "outputs/a.mts": 1 }, untracked: { files: [], unavailable: true } });
    expect(v.flyFace).toBe("unavailable");
    expect(v.cell).toContain("工作树口径");
    expect(v.cell).toContain("取不到");
    expect(v.state).toBe("grew");
    expect(v.flying).toEqual([]);
    // 空清单且面可取，与"取不到"必须是两句不同的话
    const empty = verdict({ tsc: { status: 2, out }, baseline: { "outputs/a.mts": 1 }, untracked: { files: [], unavailable: false } });
    expect(empty.cell).toContain("HEAD 口径");
    expect(empty.flyFace).toBe("ok");
  });

  it("守恒式：HEAD 那一半 ＋ 在飞那一半 ＝ tally 的全部（分出去的不许凭空少一条）", () => {
    const v = verdict({ tsc: { status: 2, out }, baseline: { "outputs/a.mts": 1 }, untracked: { files: ["outputs/neighbor-fly.mts"], unavailable: false } });
    const all = Object.values(tally(out.split("\n")).perFile).reduce((a, b) => a + b, 0);
    const flySum = v.flying.reduce((a, f) => a + f.now, 0);
    const cellNum = Number(/危险码 (\d+) 条/u.exec(v.cell)?.[1]);
    expect(cellNum + flySum, `cell 的 ${String(cellNum)} ＋ 在飞 ${String(flySum)} ≠ 全部 ${String(all)}`).toBe(all);
  });
});

describe("evidenceOthersPrefixes：取料面与 tsc 的 include 同宽（不写死目录名）", () => {
  it("普通目录原样、带通配的取到目录为止、整树写法与空 include 都交 \".\"", () => {
    expect(evidenceOthersPrefixes(["outputs"])).toEqual(["outputs"]);
    expect(evidenceOthersPrefixes(["outputs/**/*.mts"])).toEqual(["outputs"]);
    expect(evidenceOthersPrefixes(["outputs/", "outputs"])).toEqual(["outputs"]); // 去重去尾斜杠
    expect(evidenceOthersPrefixes(["**/*.mts"])).toEqual(["."]);
    expect(evidenceOthersPrefixes([])).toEqual(["."]);
    // 反向证人：写死成常量时，include 加一个目录就读不出差别
    expect(evidenceOthersPrefixes(["outputs", "tools"])).toEqual(["outputs", "tools"]);
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

  it("真仓那一趟：被豁免的每一支都必须真的不在 HEAD，且 HEAD 那一半与独立重数同值", () => {
    const ran = runEvidenceTsc(repoRoot);
    expect(ran, "取料面跑不起来 ⇒ 这一格没量到，不能拿它当豁免的证人").not.toBeNull();
    const raw = execFileSync("git", gitOthersArgs(evidenceOthersPrefixes(["outputs"])), { cwd: repoRoot, encoding: "utf8" });
    const fly = raw.split("\0").filter((s) => s.length > 0);
    const v = verdict({ tsc: ran, baseline: DANGER_BASELINE, untracked: { files: fly, unavailable: false } });
    const tracked = new Set(execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim().split("\n"));
    for (const f of v.flying) {
      // 豁免面的合法性判据：它豁免的是"HEAD 里没有的东西"。哪天有已跟踪文件混进未跟踪清单，
      // 这条就红——那正是把假绿写进归因的那一格。
      expect(tracked.has(f.file), `被算成在飞的 ${f.file} 其实在 HEAD 里 ⇒ 豁免面写宽了`).toBe(false);
      expect(existsSync(join(repoRoot, f.file)), `${f.file} 盘上都没有，却在 flying 名单里`).toBe(true);
    }
    // 独立重数（不走 verdict 的分面代码路）：tsc 原文里"文件不在未跟踪清单"的那些危险码，该等于 cell 的 HEAD 口径
    const flySet = new Set(fly);
    const independent = (ran?.out ?? "").split("\n").reduce((acc, line) => {
      const h = parseTscLine(line);
      return h !== null && DANGER_CODES.includes(h.code) && !flySet.has(h.file) ? acc + 1 : acc;
    }, 0);
    expect(Number(/危险码 (\d+) 条/u.exec(v.cell)?.[1]), "cell 的 HEAD 口径与独立重数不等 ⇒ 分面数错了").toBe(independent);
  }, 15_000); // 一次真 tsc ＋ 两次 git：与上面那条约量级（安静态 2.3s）
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

  it("归属面取料那一行必须印出来，且前缀与 tsc 的 include 同源（接线证人：这行掉了，豁免就没人看得见）", () => {
    const { status, out } = runGate([], repoRoot);
    // 不断言 0/1：现读是几取决于 HEAD 里有没有新危险码（那是棘轮的事），这里只钉"门跑到了并交代了取料面"
    expect(status === 0 || status === 1, `门只能退 0（不涨）或 1（涨/没量到），现读 ${String(status)}`).toBe(true);
    const cfg = JSON.parse(readFileSync(join(repoRoot, "tsconfig.evidence.json"), "utf8")) as { include?: unknown };
    const inc = Array.isArray(cfg.include) ? cfg.include.filter((x): x is string => typeof x === "string") : [];
    expect(out).toContain(`归属面取料：前缀 ${evidenceOthersPrefixes(inc).join("、")}`);
    expect(out, "未跟踪那一半没印条数 ⇒ 「豁免了几支」读不出来").toMatch(/未跟踪 \d+ 支/u);
  }, 15_000); // 又一次真门（含一次 tsc）：安静态 2.3s（第 281 页现读）

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
