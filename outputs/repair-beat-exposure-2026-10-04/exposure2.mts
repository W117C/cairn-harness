/** `#66` 的暴露面（正确的那一个）：`autoVerifyRepair` 只在 **harness 自己补的那拍红** 之后才有对象，
 *  而模型若自调 verify，收束闸让位（`src/agent/loop.ts:583-585` 的 `firstBeat = verifyAttempts === 0`）⇒ 开关全程不参与。
 *  所以"翻默认值不值"的正确分母不是"红过的趟"，而是**写过盘却从没自调 verify 的趟**。这一格免费可数。
 *  取料＝本机全部留档趟次行（按关系：有 `requests` 骨架键的行），字段缺就报"无从判"，不当 false。 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const files: string[] = [];
const walk = (d: string, depth: number): void => {
  if (depth > 2) return;
  let names: string[];
  try { names = readdirSync(d); } catch { return; }
  for (const n of names) {
    const p = join(d, n);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, depth + 1);
    else if (n === "readings.json") files.push(p);
  }
};
walk("outputs", 0);

interface Row { file: string; id: string; verified: number | null; wrote: boolean | null; beats: number | null; requests: number }
const rows: Row[] = [];
for (const f of files) {
  let j: unknown;
  try { j = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
  const arr = Array.isArray(j) ? j : Object.values(j as Record<string, unknown>);
  for (const item of arr) {
    const rec = ((item as { r?: Record<string, unknown> }).r ?? item) as Record<string, unknown>;
    if (!rec || typeof rec !== "object" || !("requests" in rec)) continue;
    rows.push({
      file: (f.split("/")[1] ?? f),
      id: String(rec.id ?? "?"),
      verified: "verified" in rec ? Number(rec.verified) : null,
      wrote: "changedFiles" in rec ? (Array.isArray(rec.changedFiles) && (rec.changedFiles as unknown[]).length > 0) : null,
      beats: "autoVerifyBeats" in rec ? Number(rec.autoVerifyBeats) : null,
      requests: Number(rec.requests ?? 0),
    });
  }
}
const have = (pick: (r: Row) => unknown): number => rows.filter((r) => pick(r) !== null).length;
console.log("趟次=" + String(rows.length) + "｜字段可用面：verified " + String(have((r) => r.verified)) +
  "/changedFiles " + String(have((r) => r.wrote)) + "/autoVerifyBeats " + String(have((r) => r.beats)));

const usable = rows.filter((r) => r.verified !== null && r.wrote !== null);
const exposure = usable.filter((r) => r.wrote === true && (r.verified as number) === 0);
const wroteTotal = usable.filter((r) => r.wrote === true);
console.log("两格都可判的趟=" + String(usable.length) + "｜其中写过盘的=" + String(wroteTotal.length));
console.log("★ 开关唯一可能有对象的总体：写过盘且从没自调 verify 的趟 = " + String(exposure.length) +
  "（占可判趟的 " + String(Math.round((exposure.length / Math.max(1, usable.length)) * 100)) + "%、占写过盘趟的 " +
  String(Math.round((exposure.length / Math.max(1, wroteTotal.length)) * 100)) + "%）");
console.log("  名单（前 20，带出处）：" + exposure.slice(0, 20).map((r) => r.id + "@" + r.file).join("、"));
const withBeats = rows.filter((r) => r.beats !== null);
console.log("同一批里 harness 补拍真的响过的趟=" + String(withBeats.filter((r) => (r.beats as number) > 0).length) + "／可判 " + String(withBeats.length) + " 趟");
console.log("读法：分母小、且这批留档的装配大多没装收束闸 ⇒ 这两个数都只是**下界**，不是发生率本身。");
