// M2g：`pnpm gates` —— 一条命令跑齐全部门并打印逐道退出码 + 汇总。
// 设计要点（任务书 §4 任务 5 / §2 裁决 2）：
//   1) **清单即事实源**：GATES 常量就是门数口径，不再靠任务书自报（M2e 16 / M2f 17 两轮口径偏差的根治）。
//   2) **恒真式体检**（静态扫描）：任何 `check(..., true)` 形式的空断言、`|| true` / `=== null || true`
//      一类恒真式、以及「暗卷段零 check/assert」都在这里报警——让门说的话等于门测的事。
//   3) 退出码 0 = 全部门绿且体检零命中；任何一道红或体检命中 → 退出码 1。
// 用法：pnpm gates            （全跑）
//       pnpm gates --only=test,tools-check   （只跑指定门，调试用）
//       pnpm gates --no-scan   （跳过恒真式体检）
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { countUnverified, scanAssertionHealth, scanDisjunctions, type ScanHit } from "./assertion-health";
import { checkGateManifest, EXEMPT_SCRIPTS, GATES } from "./gate-manifest";

// 断言体检实现已抽到 ./assertion-health.ts：gates.ts 顶层有 `await main()`，
// 直接 import 会跑起全套门禁——抽出去才能单测。此处再导出，对外接口不变。
export { countUnverified, scanAssertionHealth, scanDisjunctions };
export type { ScanHit };
// 清单/漂移护栏同族：清单抽到 ./gate-manifest.ts，此处再导出，对外接口不变。
export { GATES, checkGateManifest, EXEMPT_SCRIPTS };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface GateResult {
  name: string;
  code: number;
  ms: number;
  output: string;
}

/** 全量体检：空断言 / 恒真式 / 无断言段 + H-1 的 AST 级析取式弱断言。
 *  H5（审查 P2）：不再只扫 *.ts——.mjs/.cjs 验收脚本同样纳入（否则换扩展名即整门逃逸）；
 *  子目录递归。脚本文件不含 TS 类型语法时 AST 扫描按 JS 解析（ts.createSourceFile 兼容）。 */
async function scanAll(): Promise<ScanHit[]> {
  const dir = join(ROOT, "scripts");
  const hits: ScanHit[] = [];
  const SCAN_EXT = /\.(?:ts|tsx|mjs|cjs|js)$/;
  const walk = async (d: string): Promise<void> => {
    for (const ent of await readdir(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules") continue;
        await walk(p);
        continue;
      }
      if (!SCAN_EXT.test(ent.name)) continue;
      const src = await readFile(p, "utf8");
      hits.push(...scanAssertionHealth(ent.name, src));
      hits.push(...scanDisjunctions(ent.name, src)); // H-1：AST 级析取式弱断言
    }
  };
  await walk(dir);
  return hits;
}

/** H11（审查 P3）：单门超时——旧实现 spawn 无超时，任一门挂起即无限阻塞整套门禁。
 *  20 分钟 = 当前最慢门（test ~110s）的 10 倍以上余量；超时判红（exit 124）。 */
const GATE_TIMEOUT_MS = 20 * 60_000;

function runGate(name: string): Promise<GateResult> {
  return new Promise((settle) => {
    const t0 = Date.now();
    let done = false;
    let timer: NodeJS.Timeout | null = null;
    const finish = (code: number, output: string): void => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      settle({ name, code, ms: Date.now() - t0, output });
    };
    // TERM=dumb + NO_COLOR：判据不依赖调用者 TERM（M2g §1.4-2 修正：假红根因在 ANSI 序列）
    // detached：让 pnpm 及其子进程同属一个新进程组——超时只能整组杀，否则 SIGKILL 打在
    // pnpm 包装器上，真正的 check 脚本（固定 CDP 端口、固定 tmpdir 快照名、共享 fixtures
    // 靶子）活下来与后续门并发互踩，造成连锁假红/假绿（审查 H-4/agents 分片）。
    const child = spawn("pnpm", ["run", name], {
      cwd: ROOT,
      env: { ...process.env, TERM: "dumb", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const killTree = (): void => {
      try {
        if (typeof child.pid === "number") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* 已退出 */
        }
      }
    };
    let out = "";
    child.stdout?.on("data", (d: Buffer) => {
      out += String(d);
    });
    child.stderr?.on("data", (d: Buffer) => {
      out += String(d);
    });
    child.on("error", (err) => finish(127, String(err)));
    child.on("close", (code) => finish(code ?? 1, out));
    timer = setTimeout(() => {
      killTree();
      finish(124, out + "\n[gates] 超时（" + String(GATE_TIMEOUT_MS / 60_000) + " 分钟），已强制终止判红");
    }, GATE_TIMEOUT_MS);
    timer.unref?.();
  });
}

async function main(): Promise<void> {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",").map((s) => s.trim())) : null;
  const noScan = process.argv.includes("--no-scan");
  /** H-2：严格模式——未证项直接判红（CI / 有凭据环境用）。 */
  const strictUnverified = process.argv.includes("--strict-unverified") || process.env.DSH_STRICT_UNVERIFIED === "1";
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
  if (drift.length === 0) {
    console.log("  清单漂移校验：✅ GATES ↔ package.json scripts 一致（无孤儿验收脚本）");
  } else {
    console.log("  清单漂移校验：❌ " + String(drift.length) + " 条");
    for (const d of drift) console.log("    [" + d.kind + "] " + d.detail);
  }
  console.log("");

  const results: GateResult[] = [];
  let unverified = 0;
  for (const g of gates) {
    process.stdout.write("  ▶ " + g + " …");
    const r = await runGate(g);
    results.push(r);
    unverified += countUnverified(r.output); // H-2：未证数上浮到门禁汇总
    process.stdout.write("\r  " + (r.code === 0 ? "✅" : "❌") + " " + g.padEnd(18) + " exit=" + String(r.code) + "  " + String(r.ms) + "ms\n");
    if (r.code !== 0) {
      const tail = r.output.trim().split("\n").slice(-12).join("\n");
      console.log("      ── 失败输出尾 12 行 ──");
      console.log(tail.split("\n").map((l) => "      " + l).join("\n"));
    }
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
  if (scanHits.length > 0) console.log("  体检命中 " + String(scanHits.length) + " 条（见上）");
  if (unverified > 0) {
    console.log("  ⚠️  未证 " + String(unverified) + " 项（连网/凭据限制未跑到的断言——**不等于通过**）");
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
