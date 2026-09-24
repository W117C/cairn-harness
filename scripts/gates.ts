// M2g：`pnpm gates` —— 一条命令跑齐全部门并打印逐道退出码 + 汇总。
// 设计要点（任务书 §4 任务 5 / §2 裁决 2）：
//   1) **清单即事实源**：GATES 常量就是门数口径，不再靠任务书自报（M2e 16 / M2f 17 两轮口径偏差的根治）。
//   2) **恒真式体检**（静态扫描）：任何 `check(..., true)` 形式的空断言、`|| true` / `=== null || true`
//      一类恒真式、以及「暗卷段零 check/assert」都在这里报警——让门说的话等于门测的事。
//   3) 退出码 0 = 全部门绿且体检零命中；任何一道红或体检命中 → 退出码 1。
// 用法：pnpm gates            （全跑）
//       pnpm gates --only=test,tools-check   （只跑指定门，调试用）
//       pnpm gates --no-scan   （跳过恒真式体检）
//       pnpm gates --direct    （绕开 pnpm 的 deps 检查：主树被别的会话占着时，去隔离 worktree 跑整表）
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { countUnverified, gateUnverified, scanAssertionHealth, scanDisjunctions, silentGreenGate, type ScanHit } from "./assertion-health";
import { SCAN_EXT, trackedScriptFiles } from "./lib/scan-scope";
import { verdictLine } from "./lib/gate-verdict";
// 认证面自述（同族：判据在 ./lib/certified-face.ts，那边可单测；本文件只取料 + 打印）。
import { certifiedFace, porcelainStatus } from "./lib/certified-face";
// 跑一条命令 + 超时终止阶梯（同族：判据在 ./lib/gate-runner.ts 与 ./lib/gate-kill.ts，那边可单测；
// 本文件只组命令）。旧实现把 spawn 与「超时直接整组 SIGKILL」写在这里，测不到也换不掉。
import { runCommand, type GateResult } from "./lib/gate-runner";
import { checkGateManifest, EXEMPT_SCRIPTS, GATES, gateCommand } from "./gate-manifest";
// 耗时账本（同族：判据在 ./facts.ts，那边可单测；本文件只负责「跑完顺手记一笔」）。
import { appendRun, currentHost, type GateRun } from "./facts";

// 断言体检实现已抽到 ./assertion-health.ts：gates.ts 顶层有 `await main()`，
// 直接 import 会跑起全套门禁——抽出去才能单测。此处再导出，对外接口不变。
export { countUnverified, scanAssertionHealth, scanDisjunctions };
export type { ScanHit };
// 清单/漂移护栏同族：清单抽到 ./gate-manifest.ts，此处再导出，对外接口不变。
export { GATES, checkGateManifest, EXEMPT_SCRIPTS };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 全量体检：空断言 / 恒真式 / 无断言段 + H-1 的 AST 级析取式弱断言。
 *  H5（审查 P2）：不再只扫 *.ts——.mjs/.cjs 验收脚本同样纳入（否则换扩展名即整门逃逸）；
 *  子目录递归。脚本文件不含 TS 类型语法时 AST 扫描按 JS 解析（ts.createSourceFile 兼容）。 */
async function scanAll(): Promise<ScanHit[]> {
  const dir = join(ROOT, "scripts");
  const hits: ScanHit[] = [];
  const walk = async (d: string): Promise<string[]> => {
    const out: string[] = [];
    for (const ent of await readdir(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== "node_modules") out.push(...await walk(p));
        continue;
      }
      if (SCAN_EXT.test(ent.name)) out.push(relative(ROOT, p));
    }
    return out;
  };
  // 扫描面 = 已跟踪脚本（口径见 ./lib/scan-scope.ts）。git 清单取不到时退回磁盘遍历并出声：
  // 宁可把在飞草稿多判几条，也不许"取不到清单"变成"没有要扫的东西"。
  const tracked = trackedScriptFiles(ROOT);
  const files = tracked ?? await walk(dir);
  if (tracked === null) console.log("  ⚠️ 取不到 git 清单，体检退回磁盘遍历（会把未跟踪的在飞草稿一起判）");
  else console.log("  扫描面：" + String(files.length) + " 个已跟踪脚本（未跟踪草稿不判，口径同 tests/assertion-health-scan.test.ts）");
  const gone: string[] = [];
  for (const rel of files) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) {
      gone.push(rel); // 别人未提交的删除：跳过但不静默
      continue;
    }
    const src = await readFile(abs, "utf8");
    hits.push(...scanAssertionHealth(rel, src));
    hits.push(...scanDisjunctions(rel, src)); // H-1：AST 级析取式弱断言
  }
  if (gone.length > 0) console.log("  ⚠️ 清单里有 " + String(gone.length) + " 个文件盘上不存在，已跳过：" + gone.join("、"));
  return hits;
}

/** 本文件只组命令；跑与超时终止在 ./lib/gate-runner（那边可单测，判卷共用一份阶梯）。 */
function runGate(name: string, opts: { direct: boolean; scripts: Record<string, string> }): Promise<GateResult> {
  // 执行器选择在 gate-manifest.gateCommand（可单测）：缺省 `pnpm run <门名>`，
  // 直跑模式 `/bin/sh -c <package.json 脚本正文>` + PATH 前置 node_modules/.bin。
  // 为什么要直跑：pnpm 11 跑任何脚本前都做 deps 状态检查，而它拒绝「node_modules 解析目标不在项目根内」
  // 的目录（隔离 worktree + symlink node_modules 正是这个形状，报 ERR_PNPM_UNSAFE_MODULES_DIR 并试图就地
  // pnpm install）⇒ `pnpm gates` 只能在主树跑，而主树可能正被另一个会话写入，整表验证被无限期挂起。
  // 门清单与命令事实源都不变（gate-manifest + package.json），只换执行器。
  const plan = gateCommand(name, { direct: opts.direct, scripts: opts.scripts, root: ROOT });
  if (plan.missingScript === true) {
    // 脚本查不到必须判红：当成"没有要跑的东西"静默跳过 = 一道从不运行的门（provider:check 的历史形状）
    return Promise.resolve({ name, code: 1, ms: 0, output: "[gates] 直跑模式：package.json scripts 里没有 " + JSON.stringify(name) + "（不静默跳门）" });
  }
  let env: NodeJS.ProcessEnv = { ...process.env, TERM: "dumb", NO_COLOR: "1" };
  if (plan.pathPrepend !== undefined) {
    env = { ...env, PATH: plan.pathPrepend + ":" + (process.env.PATH ?? "") };
  }
  return runCommand(name, { cmd: plan.cmd, args: plan.args, cwd: ROOT, env });
}

async function main(): Promise<void> {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",").map((s) => s.trim())) : null;
  const noScan = process.argv.includes("--no-scan");
  /** H-2：严格模式——未证项直接判红（CI / 有凭据环境用）。 */
  const strictUnverified = process.argv.includes("--strict-unverified") || process.env.DSH_STRICT_UNVERIFIED === "1";
  /** 直跑模式：`--direct` 或 `DSH_GATE_DIRECT=1`。给「主树被别的会话占着、只能去隔离 worktree 跑整表」
   *  这条路用（pnpm 在 symlink node_modules 的 worktree 里必红，见 runGate 注释）。 */
  const direct = process.argv.includes("--direct") || process.env.DSH_GATE_DIRECT === "1";
  const gates = only ? GATES.filter((g) => only.has(g)) : GATES;
  // H6（审查 P2）：--only 拼错/为空时旧实现循环零次 → failed=[] → 打印"全部通过"并 exit 0。
  // 空集一律判红并打印可用门名（fail-visible）。
  if (only !== null && gates.length === 0) {
    console.error("--only 未命中任何门：" + onlyArg + "（可用门：" + GATES.join(" ") + "）");
    process.exitCode = 1;
    return;
  }

  // 清单漂移护栏（在跑门之前）：GATES ↔ package.json scripts 双向一致。
  // 发现验收形态脚本既不在 GATES 也不在 EXEMPT_SCRIPTS（曾经的 provider:check），
  // 或 GATES 列了不存在的 script，一律判红——不静默冷落任何一道门。
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as { scripts?: Record<string, string> };
  const drift = checkGateManifest(pkg.scripts ?? {});

  console.log("== pnpm gates ==");
  console.log("门清单（" + String(gates.length) + " 道，清单即事实源）：" + gates.join(" "));
  console.log("执行器：" + (direct ? "直跑（/bin/sh -c package.json 脚本正文，PATH 前置 node_modules/.bin）" : "pnpm run"));
  if (drift.length === 0) {
    console.log("  清单漂移校验：✅ GATES ↔ package.json scripts 一致（无孤儿验收脚本）");
  } else {
    console.log("  清单漂移校验：❌ " + String(drift.length) + " 条");
    for (const d of drift) console.log("    [" + d.kind + "] " + d.detail);
  }
  console.log("");

  const results: GateResult[] = [];
  const gateRuns: GateRun[] = [];
  let unverified = 0;
  const silent: string[] = [];
  for (const g of gates) {
    process.stdout.write("  ▶ " + g + " …");
    const r = await runGate(g, { direct, scripts: pkg.scripts ?? {} });
    results.push(r);
    // H-2：未证数上浮到门禁汇总。含「绿而零输出」一格（gateUnverified 里合并，汇总与账本同口径）。
    const uv = gateUnverified(r.code, r.output);
    unverified += uv;
    if (silentGreenGate(r.code, r.output)) silent.push(g);
    gateRuns.push({ gate: g, exit: r.code, ms: r.ms, unverified: uv });
    process.stdout.write("\r  " + (r.code === 0 ? "✅" : "❌") + " " + g.padEnd(18) + " exit=" + String(r.code) + "  " + String(r.ms) + "ms\n");
    if (r.code !== 0) {
      const tail = r.output.trim().split("\n").slice(-12).join("\n");
      console.log("      ── 失败输出尾 12 行 ──");
      console.log(tail.split("\n").map((l) => "      " + l).join("\n"));
    } else {
      // 绿门也把它自己的结论带出来：过去整表跑完看不出这道门跑了多少东西，要数就得单独复跑。
      const verdict = verdictLine(r.output);
      if (verdict !== "") console.log("      └ " + verdict);
    }
  }

  // 耗时账本：每道门的 ms 本来就在这儿，落一份生成物就不必再往文档里手抄（`pnpm facts` 读它）。
  // 侧信道语义——写失败只 warn，绝不改变任何一道门的结论或退出码。
  try {
    appendRun({
      ts: new Date().toISOString(),
      host: currentHost(),
      gates: gateRuns,
      // 范围必须跟着写：`--only=` 也走这条路径，缺了这个字段，一次 1 道门的调试
      // 在 `pnpm facts` 里与整跑长得一模一样（页头原先一律写「本次整跑」）。
      scope: { ran: results.length, total: GATES.length },
    });
  } catch (e) {
    console.warn("  ⚠️ 耗时账本写入失败（不影响门禁结论）：" + String(e));
  }

  let scanHits: ScanHit[] = [];
  if (!noScan) {
    console.log("");
    console.log("== 断言体检（空断言 / 恒真式 / 暗卷段零断言 / 析取式弱断言）==");
    scanHits = await scanAll();
    if (scanHits.length === 0) console.log("  ✅ 零命中");
    else for (const h of scanHits) console.log("  ❌ " + h.file + ":" + String(h.line) + " [" + h.kind + "] " + h.text);
  }

  const failed = results.filter((r) => r.code !== 0);
  console.log("");
  console.log("== 汇总 ==");
  console.log("  绿 " + String(results.length - failed.length) + " / " + String(results.length) + "，红 " + String(failed.length) + (failed.length > 0 ? "（" + failed.map((f) => f.name).join("、") + "）" : ""));
  console.log("  逐道退出码：" + results.map((r) => r.name + "=" + String(r.code)).join(" "));
  // 逐道退出码只说明「各道门怎么退的」，不说**取料的是哪棵树**。多会话并发是这里的常态，
  // 少了这一行，「整表全 0」就会被读成「HEAD 全 0」（2026-09-24 实测为此花掉一天，第 44 页 §十三）。
  const facePorcelain = porcelainStatus(ROOT);
  console.log(facePorcelain === null
    ? "  认证面：**没尺**（`git status --porcelain` 取不到）⇒ 不许把本表读成 HEAD 认证"
    : certifiedFace(facePorcelain).line);
  if (scanHits.length > 0) console.log("  体检命中 " + String(scanHits.length) + " 条（见上）");
  if (silent.length > 0) {
    console.log("  ⚠️  绿而零输出的门（查了没发现 与 没查 同形，已按未证计入）：" + silent.join("、"));
  }
  if (unverified > 0) {
    console.log("  ⚠️  未证 " + String(unverified) + " 项（连网/凭据限制未跑到的断言，或绿而零输出的门——**不等于通过**）");
    console.log("     严格模式：DSH_STRICT_UNVERIFIED=1 或 --strict-unverified 可让未证直接判红");
  }

  if (drift.length > 0 || failed.length > 0 || scanHits.length > 0) {
    process.exitCode = 1;
  } else if (strictUnverified && unverified > 0) {
    // H-2：严格模式下未证 = 红（CI / 有凭据环境用），杜绝「降级成未证 yet 全绿」。
    console.log("  ❌ 严格模式：存在 " + String(unverified) + " 项未证，判红");
    process.exitCode = 1;
  } else if (unverified > 0) {
    // 未证不算绿：明确改写口径，禁止宣称「全部通过」。
    console.log("  ⚠️  " + String(results.length) + " 道门退出码全 0，但有 " + String(unverified) + " 项未证——不得宣称「全部通过」");
  } else {
    // H6（审查）：子集运行与全量运行在汇总上必须可区分。
    const scope = only !== null && results.length < GATES.length
      ? "（子集 " + String(results.length) + "/" + String(GATES.length) + " 道门——非全量运行，不等于全量全绿）"
      : "（" + String(results.length) + " 道门 + 体检零命中 + 零未证）";
    console.log("  ✅ pnpm gates 全部通过 " + scope);
  }
}

await main();
