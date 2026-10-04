/** 今天新落的 5 把尺：逐条变异，看判卷到底咬不咬得住。
 *
 *  全部动作发生在**干净 HEAD 的验证树**里（主树有 164 条别人在飞的改动，一根手指都不碰）。
 *  每台：断言锚点在该文件里恰好命中 1 次 ⇒ 落变异 ⇒ 只跑配对的那一支判卷 ⇒ 记下退出码与红在哪条用例
 *  ⇒ 立刻 `git checkout -- <单个文件>` 还原 ⇒ 回读那棵树的状态必须为 0 行。
 *  基线（未变异）先跑一次，证明判卷确实在执行（passed > 0），否则"红 0 条"与"什么都没跑"长得一模一样。
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripAnsi, vitestSummary } from "../../scripts/lib/vitest-summary";

const TREE = "/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/verify-c7f2ea0f";
const VITEST = "node_modules/vitest/vitest.mjs";

interface Case {
  id: string;
  ruler: string;
  file: string;
  from: string;
  to: string;
  judge: string;
  /** 变异方向：blind＝尺变哑（该响的不响）；polarity＝反极性；cap＝松一档；wiring＝生产端绕过这把尺。 */
  kind: "blind" | "polarity" | "cap" | "wiring";
  why: string;
}

const CASES: Case[] = [
  {
    id: "C1", ruler: "subrepo-dep-need", file: "scripts/lib/subrepo-dep-need.ts",
    from: '  return count === null ? true : count > 0;',
    to: '  return count === null ? true : count >= 0;',
    judge: "tests/subrepo-dep-need.test.ts", kind: "cap",
    why: "把「恰好 0 项 ⇒ 不需要」松成「0 项也算需要」＝免罪符那一档重新发不出去，零依赖靶子又混进补齐面",
  },
  {
    id: "C2", ruler: "subrepo-dep-need", file: "scripts/head-cert.ts",
    from: "  if (!needsNodeModules(subPkg)) {",
    to: "  if (false && !needsNodeModules(subPkg)) {",
    judge: "tests/subrepo-dep-need.test.ts", kind: "wiring",
    why: "生产端把这把尺短路＝算出来不接。这是对「接线钉用源码文本」的**外部**验证：判卷自己在用例里跑的变异与它自己的正则共享决策点，算不出这个证据",
  },
  {
    id: "C3", ruler: "agents-command-face", file: "scripts/lib/agents-command-face.ts",
    from: "    if (desktopKnown && f.name !== i.desktopPkgName) {",
    to: "    if (false && desktopKnown && f.name !== i.desktopPkgName) {",
    judge: "tests/agents-command-face.test.ts", kind: "blind",
    why: "撤掉 filter 名对账 ⇒ 本尺存在的理由（改名只改一处）整格变哑",
  },
  {
    id: "C4", ruler: "agents-command-face", file: "scripts/lib/agents-command-face.ts",
    from: '  const desktopKnown = i.desktopPkgName !== null && i.desktopPkgName !== "";',
    to: "  const desktopKnown = true;",
    judge: "tests/agents-command-face.test.ts", kind: "blind",
    why: "取不到包名时当作「知道且等于」⇒「说不清＝未检、不许当通过」那一格静默",
  },
  {
    id: "C5", ruler: "scratch-tree-naming", file: "scripts/lib/scratch-tree-naming.ts",
    from: "    if (!head.toLowerCase().startsWith(prefix)) {",
    to: "    if (head.toLowerCase().startsWith(prefix)) {",
    judge: "tests/scratch-tree-naming.test.ts", kind: "polarity",
    why: "反极性：名字对的响、名字说谎的闭嘴——两态各钉一次的话这条必须同时红两条用例",
  },
  {
    id: "C6", ruler: "scratch-tree-naming", file: "scripts/lib/scratch-tree-naming.ts",
    from: "    if (names.length > 1) {",
    to: "    if (names.length > 2) {",
    judge: "tests/scratch-tree-naming.test.ts", kind: "cap",
    why: "重复 HEAD 那档松一格 ⇒ 两棵树钉同一笔不再出声",
  },
  {
    id: "C7", ruler: "eval-report outcomeGate", file: "scripts/eval/report.ts",
    from: '    .filter((l) => OUTCOME_METRICS.has(l.metric) && l.assessment === "worse")',
    to: '    .filter((l) => OUTCOME_METRICS.has(l.metric) && l.assessment === "better")',
    judge: "tests/eval-report.test.ts", kind: "polarity",
    why: "闸被「结果变好」咬住 ⇒ 成功率塌了照样印 ★改善（本尺要拦的正是这个）",
  },
  {
    id: "C8", ruler: "eval-report outcomeGate", file: "scripts/eval/report.ts",
    from: "  const gate = outcomeGate(cmp);",
    to: "  const gate: OutcomeRuling = { blocked: false, degraded: [], suppressed: [] };",
    judge: "tests/eval-report.test.ts", kind: "wiring",
    why: "渲染端不吃这个决策函数、自己给一副恒不拦的裁决 ⇒ 语义突变全红而接线突变全绿就是本格的洞",
  },
  {
    id: "C9", ruler: "eval-report outcomeGate", file: "scripts/eval/report.ts",
    from: "    suppressed: blocked ? beyond.filter((l) => l.assessment === \"better\").map((l) => l.metric) : [],",
    to: "    suppressed: [],",
    judge: "tests/eval-report.test.ts", kind: "blind",
    why: "闸咬住时不再登记被压下来的成本项 ⇒ 那一格回到印「★改善」",
  },
  {
    id: "C10", ruler: "projection-invariant 分母", file: "tests/projection-invariant.test.ts",
    from: "    return disk.filter((p) => !seen.has(p));",
    to: "    return [];",
    judge: "tests/projection-invariant.test.ts", kind: "blind",
    why: "差集写死成空 ⇒ git 看不见的语料再混进盘也不响（#64 那一格本来就是这台造红逼出来的）",
  },
];

const JUDGES = [...new Set(CASES.map((c) => c.judge))];

interface Run {
  status: number;
  found: boolean;
  passed: number;
  failed: number;
  redTitles: string[];
  ms: number;
  raw: string;
}

function runJudge(judge: string): Run {
  const t0 = Date.now();
  const r = spawnSync("node", [VITEST, "run", "--config", "tests/vitest.config.ts", judge], {
    cwd: TREE, encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
  });
  const out = stripAnsi((r.stdout ?? "") + (r.stderr ?? ""));
  const s = vitestSummary(out);
  const titles: string[] = [];
  for (const line of out.split("\n")) {
    if (/(^|\s)(×|FAIL)(\s|$)/.test(line)) {
      const t = line.trim().replace(/\s+\d+\s?ms\s*$/u, "");
      if (t.length > 240) continue;
      if (!titles.includes(t)) titles.push(t);
    }
  }
  return { status: r.status ?? -1, found: s.found, passed: s.passed, failed: s.failed, redTitles: titles.slice(0, 8), ms: Date.now() - t0, raw: out };
}

const treeStatus = (): number => {
  const r = spawnSync("git", ["-C", TREE, "status", "--porcelain"], { encoding: "utf8" });
  return (r.stdout ?? "").split("\n").filter((l) => l.trim() !== "").length;
};

const lines: string[] = [];
const emit = (s: string): void => { lines.push(s); process.stdout.write(s + "\n"); };

emit(`取料面：树=${TREE}  HEAD=${spawnSync("git", ["-C", TREE, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout?.trim()}`);
emit(`开跑前该树 status 行数=${String(treeStatus())}（必须 0，否则我在别人的在飞面上动刀）`);
emit("");
emit("== 基线：未变异先跑一次，证明每支判卷确实在执行 ==");
for (const j of JUDGES) {
  const run = runJudge(j);
  emit(`${j} ⇒ exit=${String(run.status)} 摘要行=${run.found ? "有" : "无（没跑起来，不是全绿）"} passed=${String(run.passed)} failed=${String(run.failed)} 用时=${String(run.ms)}ms`);
  if (run.status !== 0 || !run.found || run.passed <= 0) emit(`  ⚠️ 基线不成立：这一台的读数全部作废（exit≠0／无摘要／一条都没跑起来）`);
}
emit("");

interface Row { id: string; ruler: string; kind: string; judge: string; exit: number; found: boolean; passed: number; failed: number; killed: boolean; redTitles: string; ms: number; note: string }
const rows: Row[] = [];

for (const c of CASES) {
  const abs = join(TREE, c.file);
  const src = readFileSync(abs, "utf8");
  const hits = src.split(c.from).length - 1;
  if (hits !== 1) {
    rows.push({ id: c.id, ruler: c.ruler, kind: c.kind, judge: c.judge, exit: -1, found: false, passed: -1, failed: -1, killed: false, redTitles: "", ms: 0, note: `锚点命中 ${String(hits)} 次（要求恰好 1）⇒ 这台没落地，读数不是「存活」而是「未跑」` });
    emit(`${c.id} ${c.ruler} [${c.kind}] ⇒ 跳过：锚点命中 ${String(hits)} 次`);
    continue;
  }
  writeFileSync(abs, src.replace(c.from, c.to));
  const dirty = treeStatus();
  const run = runJudge(c.judge);
  // 还原：单条 spawn、绝对路径、不与其他命令串联
  const rev = spawnSync("git", ["-C", TREE, "checkout", "--", c.file], { encoding: "utf8" });
  const afterStatus = treeStatus();
  const same = readFileSync(abs, "utf8") === src;
  const note: string[] = [];
  if (rev.status !== 0) note.push(`还原 exit=${String(rev.status)}`);
  if (afterStatus !== 0) note.push(`还原后 status=${String(afterStatus)} 行（残骸！）`);
  if (!same) note.push("还原后文件与原文不一致");
  if (dirty !== 1) note.push(`变异态 status=${String(dirty)} 行（应为 1）`);
  const killed = run.status !== 0 && run.found && run.failed > 0;
  rows.push({ id: c.id, ruler: c.ruler, kind: c.kind, judge: c.judge, exit: run.status, found: run.found, passed: run.passed, failed: run.failed, killed, redTitles: run.redTitles.join(" | "), ms: run.ms, note: note.join("；") });
  emit(`${c.id} ${c.ruler} [${c.kind}] ${c.file} ⇒ exit=${String(run.status)} 摘要行=${run.found ? "有" : "无（未跑，不算存活）"} passed=${String(run.passed)} failed=${String(run.failed)} 杀死=${killed ? "是" : "否（尺有洞）"} 用时=${String(run.ms)}ms${note.length ? " ⚠️" + note.join("；") : ""}`);
  for (const t of run.redTitles) emit(`      红：${t}`);
  emit(`      为什么这台该红：${c.why}`);
  const safe = run.raw.split("\n").filter((l) => /(Test Files|Tests\s|Unhandled|Error:)/.test(l)).slice(0, 4);
  emit(`      汇总行：${safe.join(" ⏎ ")}`);
}

emit("");
emit("== 收口 ==");
emit(`末态该树 status 行数=${String(treeStatus())}（必须 0）`);
const notKilled = rows.filter((r) => !r.killed);
emit(`落地 ${rows.length} 台，杀死 ${String(rows.length - notKilled.length)}，存活/未跑 ${String(notKilled.length)}${notKilled.length ? "：" + notKilled.map((r) => r.id).join("、") : ""}`);
writeFileSync(join(TREE, "..", "..", "outputs", "new-ruler-mutation-matrix-2026-10-04", "rows.json"), JSON.stringify(rows, null, 2) + "\n");
writeFileSync(join(TREE, "..", "..", "outputs", "new-ruler-mutation-matrix-2026-10-04", "readings.txt"), lines.join("\n") + "\n");
