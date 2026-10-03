/** 第 325 页 · 返修那一格的**现读**：把 `verifyRecovery` 喂给盘上已有的真轨迹，看这一格到底有没有分子。
 *
 *  为什么走留档而不是跑一次基准：跑一次要花真钱（12 条 × rep），而这批 `.events.jsonl` 已经在仓里
 *  ——同分母、可复跑、零花费（本机归档日志当取料面是这仓反复用过的办法）。
 *  取料口径：只数 `git ls-files` 里那份（未跟踪的临时轨迹不进分母），逐条点名，不报比值不报均值。
 *
 *  跑法：node --import tsx outputs/eval-recovery-2026-10-03/scan.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { HARNESS_VERIFY_CALL_ID } from "../../src/agent/loop";
import { verifyBeatFace, verifyRecovery } from "../../scripts/lib/eval-validity";
import type { VerifyRecovery } from "../../scripts/lib/eval-validity";

const ROOT = join(import.meta.dirname, "../..");

const STATES: VerifyRecovery[] = ["modelRecovery", "harnessOnly", "notRecovered", "attributionUnknown", "greenFirst", "noVerify"];
const LABEL: Record<VerifyRecovery, string> = {
  modelRecovery: "模型自己红→绿", harnessOnly: "闸补的绿", notRecovered: "红没回",
  attributionUnknown: "归属不可知", greenFirst: "一次绿", noVerify: "没验",
};

const files = execFileSync("git", ["ls-files", "outputs"], { cwd: ROOT, encoding: "utf8" })
  .split("\n").filter((l) => l.endsWith(".events.jsonl")).sort();
/* 在盘但未跟踪的那些**不进分母**，但必须逐条点名：分母少了什么如果不出声，
 *  读数就成了「这仓只有 N 份轨迹」，而实际是「有 M 份，其中 M−N 份还没入库」。 */
const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "outputs"], { cwd: ROOT, encoding: "utf8" })
  .split("\n").filter((l) => l.endsWith(".events.jsonl")).sort();

const tally = new Map<VerifyRecovery, string[]>();

/** 一份轨迹 → 这一格的态。解不开就抛，由调用方点名（静默少一条＝少一分母）。 */
function stateOf(rel: string): VerifyRecovery {
  const rows = readFileSync(join(ROOT, rel), "utf8").split("\n").filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  const verifyCallIds = new Set(
    rows.filter((e) => e.type === "tool_call" && e.name === "verify").map((e) => String(e.id)),
  );
  const verifies = rows.filter((e) => e.type === "verify_result") as { ok: boolean; auto?: boolean; callId: string }[];
  return verifyRecovery(verifies.map((v) => verifyBeatFace(v, verifyCallIds, HARNESS_VERIFY_CALL_ID)));
}

let parsed = 0;
for (const rel of files) {
  let st: VerifyRecovery;
  try {
    st = stateOf(rel);
  } catch {
    console.log(`  ⚠️ 读不到／解不开：${rel}（算不进分母，但要点名——静默少一条就是少一分母）`);
    continue;
  }
  parsed += 1;
  (tally.get(st) ?? tally.set(st, []).get(st)!).push(rel);
}

console.log(`[scan] 取料：git ls-files outputs ⇒ ${String(files.length)} 份 .events.jsonl｜解得开 ${String(parsed)} 份`);
if (files.length === 0 || parsed === 0) {
  console.error("❌ 一份轨迹都没读到 ⇒ 这一格没有取料面，读数作废（不许把空分母读成\"零返修\"）");
  process.exitCode = 1;
} else {
  for (const st of STATES) {
    const list = tally.get(st) ?? [];
    console.log(`  ${LABEL[st].padEnd(14, " ")} ${String(list.length)} 份` + (list.length > 0 && list.length <= 6 ? "：" + list.join("、") : ""));
  }
  const withVerify = STATES.filter((s) => s !== "noVerify").reduce((n, s) => n + (tally.get(s)?.length ?? 0), 0);
  console.log(`  分母口径：有 verify 拍的趟次 ${String(withVerify)}／全部 ${String(parsed)} 份`);
  if (untracked.length > 0) {
    const named = untracked.map((rel) => {
      try { return `${rel.split("/")[1]}＝${LABEL[stateOf(rel)]}`; } catch { return `${rel.split("/")[1]}＝解不开`; }
    });
    console.log(`  ⚠️ 在盘但未跟踪 ${String(untracked.length)} 份（不进上面的分母）：${named.join("、")}`);
  }
  /* 自证（分辨力）：拿一份合成轨迹走**同一条**投影，态必须从"一次绿"变成"模型自己红→绿"。
   *  没变 ⇒ 上面那串分布是恒真的，读数一律作废。 */
  const fakeIds = new Set(["c1", "c2"]);
  const before = verifyRecovery([
    verifyBeatFace({ ok: true, callId: "c1" }, fakeIds, HARNESS_VERIFY_CALL_ID),
  ]);
  const after = verifyRecovery([
    verifyBeatFace({ ok: false, callId: "c1" }, fakeIds, HARNESS_VERIFY_CALL_ID),
    verifyBeatFace({ ok: true, callId: "c2" }, fakeIds, HARNESS_VERIFY_CALL_ID),
  ]);
  const harness = verifyRecovery([
    verifyBeatFace({ ok: false, callId: "c1" }, fakeIds, HARNESS_VERIFY_CALL_ID),
    verifyBeatFace({ ok: true, callId: HARNESS_VERIFY_CALL_ID }, fakeIds, HARNESS_VERIFY_CALL_ID),
  ]);
  const ok = before === "greenFirst" && after === "modelRecovery" && harness === "harnessOnly";
  console.log(`  ${ok ? "✅" : "❌"} 自证：同一拍序列里「一次绿」→「红后模型再绿」→「红后只有闸补的绿」= ${before} → ${after} → ${harness}（三态不同才算这把尺在动）`);
  if (!ok) process.exitCode = 1;
}
