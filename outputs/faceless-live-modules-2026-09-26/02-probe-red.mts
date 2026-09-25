// 观测者证明（跑完即恢复）：`tests/updater-safety-core.test.ts` 那 7 条真能抓到Updater 说谎吗？
// 判据：把每条安全不变量的实现**照样废掉一次**，要求对应那格用例红——
//   红 ⇒ 这格有观测者；不红 ⇒ 我刚写的测试是恒绿的装饰（规则 65/129：新判据必须当场造红）。
// 用法：node --import tsx outputs/faceless-live-modules-2026-09-26/02-probe-red.mts <case id>
// 安全：只写"盘上确实存在的整段字面量"（找不到就拒绝运行）；恢复走 finally + 逐字比对；外层再 `git status` 复核。
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const SRC = "src/main/updater.ts";
const TEST = "tests/updater-safety-core.test.ts";

interface Case { id: string; claim: string; title: string; from: string; to: string }

const CASES: readonly Case[] = [
  {
    id: "https-gate-removed",
    claim: "manifest 源只放行 https（D5：放行 http/file = 借主进程做 SSRF/明文劫持）",
    title: "非 https 的 manifest 源一律 error，且一次都不碰网络",
    from: '    if (p.protocol !== "https:") return { state: "error", message: "更新源必须为 https（拒绝 " + p.protocol + "）" };',
    to: "    void p;",
  },
  {
    id: "external-url-whitelist-removed",
    claim: "下载页只允许 http(s)——防 manifest 注入 file:/自定义协议进 openExternal",
    title: "只放 http(s)；file/自定义协议/相对串/空串全拒",
    from: "    return p.protocol === \"https:\" || p.protocol === \"http:\";",
    to: "    return true;",
  },
  {
    id: "semver-string-compare",
    claim: "三段逐段**数值**比较（字典序会把 1.10.0 判成旧于 1.9.0）",
    title: "semver 逐段数值比较：1.10.0 大于 1.9.0（字典序会反）",
    from: "    const x = pa[i]!;\n    const y = pb[i]!;",
    to: "    const x = String(pa[i]!);\n    const y = String(pb[i]!);",
  },
  {
    id: "declared-length-cap-skipped",
    claim: "响应帽先看声明的 Content-Length（对端说谎时不必先吃满 1MB 才发现）",
    title: "声明的 Content-Length 超帽 ⇒ 报「上限」且不落进「不是合法 JSON」那一支",
    from: '  if (Number.isFinite(declared) && declared > cap) throw new Error("body 超上限");',
    to: "  void declared;",
  },
];

/** 读 vitest 汇总：`N failed` 这一段**在全绿时根本不存在**——把它当"读不出"会让基线自检误判成红
 *  （本探针第一版就死在这里：基线明明 exit=0 却报「红 NaN 格」）。
 *  分三种：拿到 failed 数 ⇒ 用它；只有 passed 数 ⇒ 0；两个都没有 ⇒ `null`＝没尺，红着退。 */
function readSummary(out: string): { failed: number | null; passed: number | null } {
  const f = /Tests\s+(\d+) failed/.exec(out);
  const p = /Tests\s+(\d+) passed/.exec(out);
  if (f !== null) return { failed: Number(f[1]), passed: p === null ? 0 : Number(p[1]) };
  if (p !== null) return { failed: 0, passed: Number(p[1]) };
  return { failed: null, passed: null };
}

const wanted = process.argv[2] ?? "";
const c = CASES.find((x) => x.id === wanted);
if (c === undefined) {
  console.log("可用 id：" + CASES.map((x) => "  " + x.id + "  →  「" + x.title + "」").join("\n"));
  process.exit(2);
}
const abs = resolve(ROOT, SRC);
const original = readFileSync(abs, "utf8");
if (!original.includes(c.from)) {
  console.error("拒绝运行：盘上找不到那段字面量（说明实现又动了，先重取事实源）");
  process.exit(2);
}
try {
  // 基线先量一次（规则 67）：改前就红的话，"改后红在期望那一格"什么也不证明。
  const base = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", TEST],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
  const baseOut = (base.stdout ?? "") + (base.stderr ?? "");
  const bs = readSummary(baseOut);
  if (bs.failed === null || bs.failed !== 0 || base.status !== 0) {
    console.log("**基线就不是绿的（或读不出汇总）**（红 " + String(bs.failed) + " 格，exit=" + String(base.status) + "）⇒ 先修基线，本探针不判");
    process.exit(3);
  }
  console.log("基线：全绿（" + String(bs.passed) + " 条通过，exit=0）");
  writeFileSync(abs, original.replace(c.from, c.to), "utf8");
  const r = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", TEST],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const ms = readSummary(out);
  // 标题去哪找：关掉颜色后 vitest 的失败行是「× <suite> > <用例名>」，**不带引号**——
  // 第一版按 `"…"` 抽标题 ⇒ 抽不出东西，"红了几格"有数而"红在哪一格"读不出（半瞎的读数不许发，规则 128）。
  const failLines = out.split("\n").filter((l) => /^\s*(?:×|✗|FAIL)/.test(l) || l.includes("FAIL"));
  const killed = failLines.some((l) => l.includes(c.title));
  console.log(`[${c.id}] 废掉：${c.claim}`);
  console.log("  门跑：红 " + String(ms.failed ?? "?") + " 格（exit=" + String(r.status) + "，失败行 " + String(failLines.length) + " 条）");
  if (ms.failed === null || (ms.failed === 0) !== (r.status === 0)) {
    console.log("  **读数不可信**：汇总与退出码不一致 ⇒ 这轮结论不算数（规则 128）");
  }
  console.log("  " + (killed ? "红在期望那一格「" + c.title + "」⇒ 这条不变量确有观测者 ✅"
    : ((ms.failed ?? 0) > 0 ? "红了但不是期望那一格（可能误伤无关用例）：" + (failLines[0] ?? "读不出失败行").slice(0, 150) : "**没红 ⇒ 这条不变量零观测者，测试是装饰**")));
  if (!killed) for (const l of failLines.slice(0, 4)) console.log("      " + l.slice(0, 150));
} finally {
  writeFileSync(abs, original, "utf8");
  console.log("  还原：" + (readFileSync(abs, "utf8") === original ? "逐字一致 ✅" : "**不一致——立刻人工检查** ❌"));
}
