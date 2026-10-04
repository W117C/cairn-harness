/** 免费测量（决定改不改）：同一批轨迹喂给「离线那份写向清单」与「生产那份 mayHaveWrittenDisk」，
 *  R1 的读数在哪些轨迹上会不一样。零差异 ⇒ 这条漂移只是注释级别的；有差异 ⇒ 门与 burn 的读数不是生产读数。
 *  取料面＝fixtures/no-progress（冻结语料，只读）＋ outputs 下 *.events.jsonl。 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { replay } from "../../src/events";
import { detectVerifyStagnation, verifyBeatsFromEvents, verifySignature, type VerifyBeat } from "../../src/agent/no-progress";
import { mayHaveWrittenDisk } from "../../src/agent/write-face";

const OFFLINE_LIST = new Set(["write_file", "edit_file", "apply_patch", "delete_file", "move_file"]);

/** 生产口径重算一遍 verifyBeatsFromEvents：只把 wroteSinceLast 的判据换成 mayHaveWrittenDisk。 */
function beatsProduction(events: readonly Record<string, unknown>[]): VerifyBeat[] {
  const callById = new Map<string, { name: string; args: Record<string, unknown> }>();
  for (const e of events) if (e["type"] === "tool_call") callById.set(String(e["id"] ?? ""), { name: String(e["name"] ?? "?"), args: (e["args"] ?? {}) as Record<string, unknown> });
  const beats: VerifyBeat[] = [];
  let wrote = false, userSpoke = false, attempt = 0, maxAttempts = 3;
  events.forEach((e, i) => {
    if (e["type"] === "user_message") { userSpoke = true; return; }
    if (e["type"] === "tool_result") {
      const c = callById.get(String(e["callId"] ?? ""));
      if (c && e["ok"] !== false && mayHaveWrittenDisk(c.name, c.args)) wrote = true;
      return;
    }
    if (e["type"] !== "verify_result") return;
    attempt = Number(e["attempt"] ?? attempt + 1);
    maxAttempts = Number(e["maxAttempts"] ?? maxAttempts);
    const results = Array.isArray(e["results"]) ? (e["results"] as { command?: string; ok?: boolean; output?: string }[]) : [];
    const { signature, named } = verifySignature(results);
    beats.push({ index: i, attempt, maxAttempts, ok: e["ok"] !== false, signature: e["ok"] === false ? signature : "ok", named, wroteSinceLast: wrote, userSpokeSinceLast: userSpoke });
    wrote = false; userSpoke = false;
  });
  return beats;
}

const files: string[] = [];
const walk = (d: string, depth: number): void => {
  if (depth > 3 || d.includes(".worktrees")) return;
  let names: string[];
  try { names = readdirSync(d); } catch { return; }
  for (const n of names) {
    const p = join(d, n);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, depth + 1);
    else if (n.endsWith(".events.jsonl")) files.push(p);
  }
};
walk("fixtures/no-progress", 0);
const fixtureN = files.length;
walk("outputs", 0);
console.log(`取料面：冻结语料 ${String(fixtureN)} 份 ＋ outputs 轨迹 ${String(files.length - fixtureN)} 份＝共 ${String(files.length)} 份`);

let differ = 0, firedOffline = 0, firedProd = 0, shellWriteSeen = 0;
const diffList: string[] = [];
for (const f of files) {
  let ev: Record<string, unknown>[];
  try { ev = (await replay(f)) as unknown as Record<string, unknown>[]; } catch { continue; }
  const a = detectVerifyStagnation(verifyBeatsFromEvents(ev));
  const b = detectVerifyStagnation(beatsProduction(ev));
  if (a.stagnant) firedOffline++;
  if (b.stagnant) firedProd++;
  // 这份流里到底有没有「经 shell／diagnose 成功落盘」的动作——漂移的可达性前提
  const calls = new Map<string, { name: string; args: Record<string, unknown> }>();
  for (const e of ev) if (e["type"] === "tool_call") calls.set(String(e["id"] ?? ""), { name: String(e["name"] ?? "?"), args: (e["args"] ?? {}) as Record<string, unknown> });
  const hasShellWrite = ev.some((e) => e["type"] === "tool_result" && e["ok"] !== false && (() => { const c = calls.get(String(e["callId"] ?? "")); return c !== undefined && !OFFLINE_LIST.has(c.name) && mayHaveWrittenDisk(c.name, c.args); })());
  if (hasShellWrite) shellWriteSeen++;
  if (a.stagnant !== b.stagnant) { differ++; diffList.push(`${f}｜离线=${String(a.stagnant)} 生产=${String(b.stagnant)}`); }
}
console.log(`R1 报数：离线清单=${String(firedOffline)} 份｜生产口径=${String(firedProd)} 份｜读数不一致的轨迹=${String(differ)} 份`);
console.log(`含「离线清单没登记却按生产算落盘」动作的轨迹=${String(shellWriteSeen)} 份（漂移可达性前提）`);
for (const d of diffList.slice(0, 12)) console.log("  差 " + d);
