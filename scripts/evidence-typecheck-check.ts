/** 证据面类型检查门（第 259 页；任务 #4）。用法：`pnpm evidence-typecheck-check`。
 *  退出码：0＝现读不高于登记帽；1＝**涨了**或**没量到**（两种都出声，但归因句不同——见 `verdict` 的三态）；
 *  2＝用法错（本门不收参数，多给的按"没量到"处理前先把话说清）。
 *  判定与解析都在 `scripts/lib/evidence-typecheck.ts`（可单测的那一份），这里只做进程编排——与本仓「门的判定面可测」的分法一致。 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DANGER_BASELINE, DANGER_CODES, parseTscLine, runEvidenceTsc, tally, verdict } from "./lib/evidence-typecheck";

const CWD = process.cwd();
const extra = process.argv.slice(2).filter((a) => !a.startsWith("--help"));
if (extra.length > 0) {
  console.error(`❌ 本门不认参数：${extra.join(" ")}（拼错的开关不许静默当成"没给参数"，那是拿默认口径去量另一件事）`);
  process.exit(2);
}
if (existsSync(join(CWD, "tsconfig.evidence.json")) === false) {
  console.error("❌ 取不到 `tsconfig.evidence.json` ⇒ 证据面这一格压根没跑，不等于干净（口径必须落在仓内文件里）");
  process.exit(1);
}

const started = Date.now();
const tsc = runEvidenceTsc(CWD);
const v = verdict({ tsc, baseline: DANGER_BASELINE });
const ms = Date.now() - started;

// 自证一行：解析出的条数与总报错条数配成对（分母漂了就当场可见，不用等人去 grep tsc 输出）
const t = tsc === null ? null : tally(tsc.out.split("\n"));
const sample = t === null ? "" : `｜解析 ${String(t.parsed)}/${String(t.total)} 条`;
// 反向证人的取料口：门自己说清"哪一行会被算进危险码"，判卷据此造红（不必去猜正则）
const firstDangerLine = tsc === null ? "" : (tsc.out.split("\n").find((l) => {
  const h = parseTscLine(l);
  return h !== null && DANGER_CODES.includes(h.code);
}) ?? "");

console.log(`${v.ok ? "✅" : "❌"} evidence-typecheck：${v.cell}（${String(ms)}ms${sample}）`);
if (firstDangerLine !== "") {
  console.log(`   被算进危险码的第一行（原文照贴，判卷钉的就是这个形状）：${firstDangerLine.slice(0, 140)}`);
}
if (!v.ok) {
  console.log("   修法：那条读数如果是真的类型缺陷就改掉（证据面的探针也是代码）；");
  console.log("        如果是新加的探针本来就带危险码，那正是本门要拦的——不要往登记表里加名字，先修它。");
  console.log("   登记表在 `scripts/lib/evidence-typecheck.ts` 的 `DANGER_BASELINE`，**只准调低**（清掉一条就把数字改小）。");
}
process.exit(v.ok ? 0 : 1);
