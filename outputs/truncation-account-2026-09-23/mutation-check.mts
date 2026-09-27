/** 能力 31 C1（ring 的字节帽）判据的分辨力实测：四条突变，各点名要它红的那条用例。
 *  跑法：TERM=dumb node --import tsx outputs/truncation-account-2026-09-23/mutation-check.mts
 *  备份 → 突变 → 跑 tests/output-ring.test.ts → 逐字还原（还原失败即红着退出）。 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = "src/tools/output-ring.ts";
const TEST = "tests/output-ring.test.ts";

const MUTS: { id: string; what: string; from: string; to: string; mustKill: string[] }[] = [
  {
    id: "R1-seen-chars",
    what: "把喂入量退回 UTF-16 字符计数（= 省略量少报 3 倍那一半）",
    from: "    const n = bytesOf(s);", to: "    const n = s.length;",
    mustKill: ["省略数报的是真实省略字节"],
  },
  {
    id: "R2-head-chars",
    what: "头部按字符取（= 帽被中文撑破那一半）",
    from: "    const b = utf8Bytes(ch.codePointAt(0) ?? 0);", to: "    const b = ch.length;",
    mustKill: ["中文输出守字节帽", "emoji（代理对"],
  },
  {
    id: "R3-tail-chars",
    what: "尾部按字符取（同一只错的另一半：尾环保留量）",
    from: "    const b = utf8Bytes(cps[k - 1]?.codePointAt(0) ?? 0);", to: "    const b = cps[k - 1]?.length ?? 0;",
    mustKill: ["中文输出守字节帽"],
  },
  {
    id: "R4-headratio",
    what: "反面对手：把头尾分配从 0.55 改成 0.5（证明 ASCII 那条逐字对照不是恒真）",
    from: "  const headBudget = Math.floor(keepBytes * HEAD_RATIO);", to: "  const headBudget = Math.floor(keepBytes * 0.5);",
    mustKill: ["ASCII 路径逐字不变"],
    // 「省略数不撒谎」刻意不在这张单里：omitted = 喂入 − (头+尾)，而头尾之和恒 = keepBytes，
    // 改分配比例不动这个和 ⇒ 那条**本就该活着**。把它列进去等于给自己写了条期望错的账。
  },
];

function runTests(): { exit: number; failed: string[]; raw: string } {
  try {
    const out = execFileSync(process.execPath,
      ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", TEST],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, TERM: "dumb" } });
    return { exit: 0, failed: [], raw: out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    const text = (err.stdout ?? "") + (err.stderr ?? "");
    return {
      exit: err.status ?? 1,
      failed: [...text.matchAll(/^ FAIL\s+\S+\s+>\s+(.+)$/gm)].map((m) => (m[1] ?? "").trim()),
      raw: text,
    };
  }
}

const backup = mkdtempSync(join(tmpdir(), "ring-mut-bak-"));
const file = join(ROOT, SRC);
const orig = readFileSync(file, "utf8");
copyFileSync(file, join(backup, "output-ring.ts"));
let code = 0;
try {
  for (const m of MUTS) {
    if (!orig.includes(m.from)) throw new Error(`${m.id}: 靶文本没找到 → ${m.from}`);
    writeFileSync(file, orig.replace(m.from, m.to), "utf8");
    const r = runTests();
    console.log(`\n## ${m.id} ${m.what}`);
    console.log(`   exit=${String(r.exit)}  红 ${String(r.failed.length)} 条`);
    if (r.exit !== 0 && r.failed.length === 0) {
      console.log(`   ⚠️ 非零退出但一条 FAIL 都没有 = 收集期崩了，读数不可信：` +
        (r.raw.split("\n").find((l) => /Error|Expected|Unexpected/.test(l)) ?? "?").slice(0, 150));
    }
    for (const k of m.mustKill) {
      const hit = r.failed.some((t) => t.includes(k));
      if (!hit) code = 1;
      console.log(`   ${hit ? "杀掉 " : "存活!"} ${k}`);
    }
    for (const f of r.failed) if (!m.mustKill.some((k) => f.includes(k))) console.log(`   （附带红：${f}）`);
    writeFileSync(file, orig, "utf8");
  }
} finally {
  if (readFileSync(file, "utf8") !== orig) { console.log(`❌ 还原失败：${SRC}`); code = 1; }
  else console.log("\n还原核对：源文件逐字相同。");
  rmSync(backup, { recursive: true, force: true });
}
console.log(code === 0 ? "⇒ 四条突变全部被抓：字节帽的两侧、省略数、以及 ASCII 对照的分辨力都成立。" : "⇒ 有突变存活。");
process.exit(code);
