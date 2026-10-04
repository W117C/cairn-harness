/** #71 的决策数：把 `mayHaveWrittenDisk` 的 shell 半边从「未证明只读」换成「证明写面」之后，
 *  三个消费者各受多大影响。一把尺量三格，全部现读自同一批轨迹。
 *   ① wroteThisRun（能力 5 自动拍的门闩）⇒ 有多少轨迹的「写过盘」会变成假 ⇒ 省下白付的验证拍；
 *   ② R1 验证停滞 ⇒ 有多少能重新开口；
 *   ③ stale 判定 ⇒ 有多少「绿拍之后又跑了条命令」的流会从 stale 变 verified，其中有多少那条命令
 *      真可能改盘（首词不在窄清单里）⇒ 这就是假绿暴露面，是这笔买卖的代价。 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { replay } from "../../src/events";
import { detectVerifyStagnation, verifyBeatsFromEvents } from "../../src/agent/no-progress";
import { mayHaveWrittenDisk } from "../../src/agent/write-face";
import { isReadOnlyShellCommand, READONLY_SHELL_COMMANDS, READONLY_GIT_SUBCOMMANDS } from "../../src/agent/worker-shell-tools";

/** 窄口径（拟议）：三档答案 `source`（改仓库里的码）／`deps`（改环境／依赖，可能翻转测试结果）／`none`。
 *  今天的 `mayHaveWrittenDisk` 把三档压成一位「未证明只读」⇒ 跑一次测试就等于「改过盘」。 */
const WRITE_META = /[<>`]|\$\(|\$\{|\+\+|<<<|\(\(/;
const SOURCE_HEADS = new Set([
  "rm", "rmdir", "mv", "cp", "install", "touch", "mkdir", "ln", "tee", "sed", "awk", "patch", "perl", "python", "node",
]);
const DEP_HEADS = new Set(["chmod", "chown", "tar", "unzip", "npm", "pnpm", "yarn", "bun", "bunx", "npx", "pip", "pip3", "poetry", "uv", "cargo", "go", "make", "cmake", "docker", "brew", "pnpx"]);
/** 包管理器里「只跑不改」的子命令（`pnpm run test`／`npx vitest`）：环境已在，跑一遍不动仓库。 */
const RUN_ONLY_SUB = new Set(["run", "test", "exec", "dlx", "which", "list", "ls", "outdated", "why", "doctor", "inspect", "show"]);
type Touch = "none" | "deps" | "source";
interface Narrow { touch: Touch; shape: string }
function narrowDidWrite(tool: string, args: Record<string, unknown>): Narrow {
  if (tool === "shell_ro") return { touch: "none", shape: "readonly-tool" };
  if (tool === "run_shell" || tool === "shell_rw") {
    const cmd = typeof args.command === "string" ? args.command : "";
    if (cmd.trim() === "") return { touch: "none", shape: "empty" };
    if (WRITE_META.test(cmd)) return { touch: "source", shape: "meta" };
    let worst: Touch = "none";
    let shape = "readonly-cmd";
    for (const seg of cmd.replace(/\r\n?|\n/g, ";").split(/&&|\|\||;|\||&/)) {
      const words = seg.trim().split(/\s+/).filter((w) => w !== "");
      if (words.length === 0) continue;
      const head = words[0]!;
      let t: Touch = "none";
      let s = "readonly-cmd";
      if (READONLY_SHELL_COMMANDS.includes(head)) { t = "none"; s = "readonly-cmd"; }
      else if (head === "git") t = READONLY_GIT_SUBCOMMANDS.includes(words[1] ?? "") ? "none" : "source", s = t === "none" ? "git-readonly" : "git-write";
      else if (SOURCE_HEADS.has(head)) { t = "source"; s = "source-head:" + head; }
      else if (DEP_HEADS.has(head)) {
        const sub = words[1] ?? "";
        const runOnly = (head === "npx" || head === "pnpx" || head === "bunx") ? true : RUN_ONLY_SUB.has(sub);
        t = runOnly ? "none" : "deps";
        s = runOnly ? "pkg-run:" + head : "pkg-mutate:" + head;
      } else { t = "deps"; s = "unknown-head:" + head; }
      if (t === "source" || (t === "deps" && worst === "none")) { worst = t; shape = s; }
      else if (t === "deps" && worst === "deps") { /* 保持第一个出处 */ }
    }
    return { touch: worst, shape };
  }
  return { touch: mayHaveWrittenDisk(tool, args) ? "source" : "none", shape: "non-shell" };
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

let wroteBroad = 0, wroteSource = 0, wroteSrcDeps = 0, noLongerWrote = 0, unknownHeadSeen = 0;
let r1Broad = 0, r1Narrow = 0;
let fakeGreen: string[] = [];
let shellOkResults = 0;
const shapeCount = new Map<string, number>();

for (const f of files) {
  let ev: Record<string, unknown>[];
  try { ev = (await replay(f)) as unknown as Record<string, unknown>[]; } catch { continue; }
  const calls = new Map<string, { name: string; args: Record<string, unknown> }>();
  for (const e of ev) if (e["type"] === "tool_call") calls.set(String(e["id"] ?? ""), { name: String(e["name"] ?? "?"), args: (e["args"] ?? {}) as Record<string, unknown> });

  let anyBroad = false, anySource = false, anySourceOrDeps = false, unknownOnly = false;
  let lastVerifyIdx = -1, lastVerifyOk = false;
  let unknownAfterGreen: string | null = null;

  ev.forEach((e, i) => {
    if (e["type"] !== "tool_result") {
      if (e["type"] === "verify_result") { lastVerifyIdx = i; lastVerifyOk = e["ok"] !== false; }
      return;
    }
    const c = calls.get(String(e["callId"] ?? ""));
    if (!c || e["ok"] === false) return;
    const broad = mayHaveWrittenDisk(c.name, c.args);
    const nr = narrowDidWrite(c.name, c.args);
    if (c.name === "run_shell" || c.name === "shell_rw") {
      shellOkResults++;
      shapeCount.set(nr.shape, (shapeCount.get(nr.shape) ?? 0) + 1);
    }
    if (broad) anyBroad = true;
    if (nr.touch === "source") anySource = true;
    if (nr.touch !== "none") anySourceOrDeps = true;
    if (broad && nr.touch === "none" && nr.shape.startsWith("unknown-head")) unknownOnly = true;
    if (lastVerifyOk && lastVerifyIdx >= 0 && i > lastVerifyIdx && broad && nr.touch === "none" && nr.shape.startsWith("unknown-head")) {
      unknownAfterGreen = String(c.args.command ?? "").replace(/\s+/gu, " ").slice(0, 70);
    }
  });

  if (anyBroad) wroteBroad++;
  if (anySource) wroteSource++;
  if (anySourceOrDeps) wroteSrcDeps++;
  if (anyBroad && !anySourceOrDeps) noLongerWrote++;
  if (unknownOnly) unknownHeadSeen++;
  if (unknownAfterGreen !== null) fakeGreen.push(`${f}｜绿拍后只被这条判成写：${unknownAfterGreen}`);

  // ②R1：窄口径（source 档）下的 wroteSinceLast
  const r1NarrowBeats = beatsFrom(ev, calls);
  if (detectVerifyStagnation(verifyBeatsFromEvents(ev)).stagnant) r1Broad++;
  if (detectVerifyStagnation(r1NarrowBeats).stagnant) r1Narrow++;
}

/** 与 verifyBeatsFromEvents 同形，只把写向判据换成窄口径。 */
function beatsFrom(ev: Record<string, unknown>[], calls: Map<string, { name: string; args: Record<string, unknown> }>) {
  const out: ReturnType<typeof verifyBeatsFromEvents> = [];
  let wrote = false, userSpoke = false, attempt = 0, maxAttempts = 3;
  ev.forEach((e, i) => {
    if (e["type"] === "user_message") { userSpoke = true; return; }
    if (e["type"] === "tool_result") {
      const c = calls.get(String(e["callId"] ?? ""));
      if (c && e["ok"] !== false && narrowDidWrite(c.name, c.args).touch === "source") wrote = true;
      return;
    }
    if (e["type"] !== "verify_result") return;
    attempt = Number(e["attempt"] ?? attempt + 1);
    maxAttempts = Number(e["maxAttempts"] ?? maxAttempts);
    const results = Array.isArray(e["results"]) ? (e["results"] as { command?: string; ok?: boolean; output?: string }[]) : [];
    const failing = results.filter((r) => r.ok === false);
    const sig = e["ok"] === false ? failing.map((r) => String(r.command ?? "?") + "#" + normalize(String(r.output ?? "").split("\n").map((l) => l.trim()).filter((l) => l !== "")[0] ?? "")).sort().join("|") : "ok";
    out.push({ index: i, attempt, maxAttempts, ok: e["ok"] !== false, signature: sig, named: [], wroteSinceLast: wrote, userSpokeSinceLast: userSpoke });
    wrote = false; userSpoke = false;
  });
  return out;
}
function normalize(s: string): string {
  return s.replace(/\b0x[0-9a-f]{2,}\b/giu, "#").replace(/\b[0-9a-f]{12,}\b/giu, "#").replace(/\d+/gu, "N").replace(/\s+/gu, " ").trim().slice(0, 160);
}

console.log(`取料面：冻结 ${String(fixtureN)} 份 ＋ outputs ${String(files.length - fixtureN)} 份＝${String(files.length)} 份`);
console.log(`①「这一跑写过盘」（自动验证拍的门闩）：今日口径 ${String(wroteBroad)} 份｜source 档 ${String(wroteSource)} 份｜source∪deps 档 ${String(wroteSrcDeps)} 份`);
console.log(`   收窄后从「写过」翻成「没写」的 = ${String(noLongerWrote)} 份（这些跑不再白付一拍验证）`);
console.log(`   含「首词未登记」命令的跑 = ${String(unknownHeadSeen)} 份`);
console.log(`   shell 成功结果共 ${String(shellOkResults)} 条，窄口径形状分布（前 12 项）：`);
console.log("   " + [...shapeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => k + ":" + String(v)).join(" "));
console.log(`②R1 验证停滞报数：今日口径=${String(r1Broad)} 份｜窄口径(source)=${String(r1Narrow)} 份`);
console.log(`③假绿暴露面（绿拍之后只跑了未登记首词命令，窄口径下不再判 stale）= ${String(fakeGreen.length)} 份`);
for (const s of fakeGreen.slice(0, 8)) console.log("   ★ " + s);
