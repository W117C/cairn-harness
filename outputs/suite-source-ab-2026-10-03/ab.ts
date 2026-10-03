/** 任务 #32 的现读（第 331 页之后，零模型零花费）：贴帽判据到底该吃哪份 suite？
 *  两个候选源：
 *   A ＝ 冻结留档 `outputs/suite-refresh-2026-10-03/suite-quiet.json`（第 #29 页那次独占安静态全量刷新）
 *   B ＝ `head-cert` 每趟自产的 `/tmp/dsh-head-cert-<rev>/suite.json`（同一次认证里跑出来的）
 *  问两件事：①标题集漂多少（这决定"改吃 B"能不能治 #39 那一格的取料键作废）；
 *           ②同一批标题的耗时要差多少（这决定拿 B 学预算会不会把慢测试静默认下来）。 */
import { readFileSync } from "node:fs";

const A_PATH = "outputs/suite-refresh-2026-10-03/suite-quiet.json";
const B_PATH = "/tmp/dsh-head-cert-c6a61eb/suite.json";

const load = (p) => {
  const j = JSON.parse(readFileSync(p, "utf8"));
  const out = new Map();
  for (const f of j.testResults ?? []) {
    const file = (f.name ?? "").replace(/^.*\/(tests\/.+)$/, "$1");
    for (const a of f.assertionResults ?? []) {
      const title = (a.ancestorTitles ?? []).concat(a.title ?? "").join(" > ");
      // 字段名现读来的（本文件第一版拿 `durationMs` 取，两棵树一起读成 0 ⇒ 量法坏了，不是源里没有）：
      // vitest 这份 json 报告器给的是 `duration`（毫秒，浮点）。
      if (!out.has(title)) out.set(title, { file, dur: a.duration ?? 0, status: a.status ?? "" });
    }
  }
  return out;
};

const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
const stats = (xs) => `n=${String(xs.length)} 中位=${String(pct(xs, 0.5))}ms p90=${String(pct(xs, 0.9))}ms 最大=${String(Math.max(...xs))}ms`;

const A = load(A_PATH), B = load(B_PATH);
console.log(`A 留档：标题 ${String(A.size)} 条｜B＝head-cert 自产（@c6a61eb）：标题 ${String(B.size)} 条`);

const onlyA = [...A.keys()].filter((t) => !B.has(t));
const onlyB = [...B.keys()].filter((t) => !A.has(t));
console.log(`只在 A（B 里找不到＝留档有、这趟没跑出来）：${String(onlyA.length)} 条`);
for (const t of onlyA.slice(0, 6)) console.log("  A−  " + t.slice(0, 96));
console.log(`只在 B（A 里没有＝这趟跑出来了、留档不认它 ⇒ 按标题回档取预算会取空）：${String(onlyB.length)} 条`);
for (const t of onlyB.slice(0, 10)) console.log("  B−  " + t.slice(0, 96));

const shared = [...B.keys()].filter((t) => A.has(t));
const dA = shared.map((t) => A.get(t)!.dur), dB = shared.map((t) => B.get(t)!.dur);
console.log(`\n同分母配对（两边都在的标题 ${String(shared.length)} 条）耗时：`);
console.log(`  A 安静态留档 ${stats(dA)}`);
console.log(`  B 认证自产   ${stats(dB)}`);
const ratio = dB.reduce((a, b) => a + b, 0) / Math.max(1, dA.reduce((a, b) => a + b, 0));
console.log(`  总耗时比 B/A = ${ratio.toFixed(2)}×（**两棵树/两个时刻，不是同温**：B 那趟有没有并发判卷未知 ⇒ 只当上界看）`);
const worse = shared.filter((t, i) => dB[i] > dA[i] * 2 && dB[i] > 200).length;
console.log(`  其中 B 比 A 慢一倍以上且 >200ms 的：${String(worse)} 条 ⇒ 拿 B 学预算＝这些格的水位会被悄悄抬高`);
