/** 本地基线率与误报率探针：把「停滞/卡死」的六只规则检测器跑在**本仓自己的录制**上，
 *  量出两件外部世界没人公布的事：① 这些信号在我们自己的跑里出现的频率；② 在**最终成功**的跑里
 *  它们会误报几次（外部只公布阈值，不公布 precision/recall —— 见 00-读物与缺口.md §5）。
 *
 *  跑法：TERM=dumb node --import tsx outputs/stagnation-detection-2026-09-23/measure-local-base-rate.mts
 *  只读物：outputs 下所有 .events.jsonl（既有录制）；不改任何判卷面、不写任何文件。
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { replay } from "../../src/events/index";

type Ev = Record<string, unknown> & { type: string };

/* ---------- 签名（判"同一件事又做了一次"用的是语义签名，不是逐字身份） ---------- */

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);
const str = (v: unknown) => (typeof v === "string" ? v : v === undefined ? "" : JSON.stringify(v) ?? "");

/** 工具调用签名：名字 + 参数（参数按 key 排序，消除序列化顺序抖动）。 */
function callSig(e: Ev): string {
  const args = e.args;
  const norm = args && typeof args === "object"
    ? Object.keys(args as object).sort().map((k) => k + "=" + str((args as Record<string, unknown>)[k])).join(",")
    : str(args);
  return String(e.name ?? "?") + "(" + norm.slice(0, 400) + ")";
}
/** 归一化错误行：数字/路径/十六进制串抹平，让「同一类失败」能被认成同一件。 */
function errSig(s: string): string {
  return s.toLowerCase().replace(/0x[0-9a-f]+/gu, "#").replace(/\d+/gu, "N").replace(/[\s]+/gu, " ").trim().slice(0, 160);
}

interface RunReading {
  file: string;
  events: number;
  toolCalls: number;
  turns: number;
  label: "green" | "red" | "unknown";
  /** 每只检测器：首次触发点（以第 n 次工具调用计），未触发则 null。 */
  fired: Record<string, number | null>;
  /** 每只检测器：整跑里触发次数（同一条规则反复报警的量）。 */
  fires: Record<string, number>;
}

const DETECTORS = ["D1-action-error", "D2-action-observation", "D3-alternating", "D4-verify-stagnation", "D5-zero-write", "D6-monologue"] as const;

function readRun(file: string, events: Ev[]): RunReading {
  // 把 tool_call 与它自己的 tool_result 配成对（事件流里 callId 是键）
  const results = new Map<string, Ev>();
  for (const e of events) if (e.type === "tool_result") results.set(str(e.callId) || str(e.id), e);
  const calls = events.filter((e) => e.type === "tool_call");
  const verifies = events.filter((e) => e.type === "verify_result");

  const sigs = calls.map((c) => {
    const r = results.get(str(c.id));
    const out = r ? str(r.output) + str(r.error) + str(r.detail) : "";
    const ok = r ? r.ok !== false : true;
    return { call: callSig(c), outHash: hash(out), ok, err: ok ? "" : errSig(out), name: String(c.name ?? "?") };
  });

  const fired: Record<string, number | null> = {};
  const fires: Record<string, number> = {};
  const note = (id: string, at: number | null, count: number) => {
    if (at !== null && (fired[id] === undefined || fired[id] === null)) fired[id] = at;
    fires[id] = (fires[id] ?? 0) + count;
  };

  // D1：同一工具 + 同一类错误 连续 ≥3 次
  {
    let first: number | null = null, n = 0, prev = "";
    for (let i = 0; i < sigs.length; i++) {
      const key = sigs[i]!.ok ? "" : sigs[i]!.name + "|" + sigs[i]!.err;
      if (key !== "" && key === prev) n++;
      else { n = key === "" ? 0 : 1; prev = key; }
      if (n === 3) { if (first === null) first = i; n = 0; }
    }
    note("D1-action-error", first, first === null ? 0 : 1);
  }
  // D2：同一调用 + 同一结果哈希 重复 ≥4 次（OpenHands 4×，Gemini CLI 5× ⇒ 两个阈值都记）
  for (const k of [4, 5]) {
    let first: number | null = null;
    let worstSig = "", worstN = 0;
    const seen = new Map<string, number>();
    for (let i = 0; i < sigs.length; i++) {
      const key = sigs[i]!.call + "#" + sigs[i]!.outHash;
      const c = (seen.get(key) ?? 0) + 1;
      seen.set(key, c);
      if (c === k && first === null) first = i;
      if (c > worstN) { worstN = c; worstSig = key; }
    }
    // 两个阈值分开记：同一把尺上 4× 与 5× 的误报率之差，就是"能不能 escalade"的那条线
    note(k === 4 ? "D2-action-observation" : "D2-thresh5", first, first === null ? 0 : 1);
    if (k === 4) { maxRepeat = worstN; maxRepeatSig = worstSig.slice(0, 90); }
  }
  // D3：A/B 交替 ≥6 拍（edit→revert 那族）
  {
    let first: number | null = null, run = 0;
    for (let i = 2; i < sigs.length; i++) {
      const alt = sigs[i]!.call === sigs[i - 2]!.call && sigs[i]!.call !== sigs[i - 1]!.call;
      run = alt ? run + 1 : 0;
      if (run === 4) { if (first === null) first = i; run = 0; }
    }
    note("D3-alternating", first, first === null ? 0 : 1);
  }
  // D4：连续红 verify 且失败签名相同（外部**没有**已发布的这种检测器）
  {
    let first: number | null = null, n = 0;
    let prevKey = "";
    verifies.forEach((v, i) => {
      const key = v.ok === false ? errSig(str(v.output) + str(v.detail) + str(v.summary) + JSON.stringify(v.failures ?? "")) : "";
      n = key !== "" && key === prevKey ? n + 1 : key === "" ? 0 : 1;
      prevKey = key;
      if (n === 2 && first === null) first = i;
    });
    note("D4-verify-stagnation", first, first === null ? 0 : 1);
  }
  // D5：连续 M=8 次调用里没有任何一次成功的写（写类工具名单见 src/tools）
  {
    const WRITE = new Set(["write_file", "edit_file", "run_shell", "apply_patch", "delete_file"]);
    let first: number | null = null;
    for (let i = 0; i + 8 <= sigs.length; i++) {
      const win = sigs.slice(i, i + 8);
      if (!win.some((s) => s.ok && WRITE.has(s.name))) { if (first === null) first = i + 7; break; }
    }
    note("D5-zero-write", first, first === null ? 0 : 1);
  }
  // D6：连续 ≥3 段 assistant 文本且中间没有任何工具调用/新用户输入
  {
    let first: number | null = null, n = 0;
    events.forEach((e) => {
      if (e.type === "assistant_delta" || e.type === "assistant_message") {
        const c = str(e.content);
        n = c.trim().length > 0 ? n : n; // 增量流式：整段归并留给上层，这里只数"没有工具调用的轮"
      } else if (e.type === "tool_call" || e.type === "user_message") n = 0;
    });
    note("D6-monologue", first, 0); // 录制里 assistant 是 delta 流，这条量不出真轮 ⇒ 如实留空
  }

  const lastVerify = [...verifies].reverse().find((v) => v.ok !== undefined);
  const label: RunReading["label"] = lastVerify === undefined ? "unknown" : lastVerify.ok === true ? "green" : "red";
  const turns = new Set(calls.map((c) => str(c.id))).size;
  return { file, events: events.length, toolCalls: calls.length, turns, label, fired, fires };
}

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".events.jsonl")) out.push(p);
  }
  return out;
}

const files = walk("outputs", []);
const runs: RunReading[] = [];
for (const f of files) {
  const ev = (await replay(f)) as unknown as Ev[];
  if (ev.length === 0) continue;
  runs.push(readRun(f, ev));
}

console.log("录制条数：", runs.length, "（含", runs.filter((r) => r.label === "green").length, "绿 /",
  runs.filter((r) => r.label === "red").length, "红 /", runs.filter((r) => r.label === "unknown").length, "无 verify 结论）");
console.log("工具调用数：min", Math.min(...runs.map((r) => r.toolCalls)), "median",
  runs.map((r) => r.toolCalls).sort((a, b) => a - b)[Math.floor(runs.length / 2)], "max", Math.max(...runs.map((r) => r.toolCalls)));
console.log("\n逐跑首次触发点（数字 = 第几次工具调用时报警；- = 未触发）");
console.log(["文件", "结论", "调用数", ...DETECTORS.map((d) => d.slice(0, 10))].join("\t"));
for (const r of runs) {
  console.log([r.file.replace("outputs/", ""), r.label, String(r.toolCalls),
    ...DETECTORS.map((d) => (r.fired[d] ?? null) === null ? "-" : String(r.fired[d]))].join("\t"));
}
const green = runs.filter((r) => r.label === "green");
console.log("\n误报面（只在**最终成功**的跑上算；这是外部没人公布的那个数）");
for (const d of DETECTORS) {
  const hit = green.filter((r) => (r.fired[d] ?? null) !== null).length;
  console.log("  ", d, "在", String(green.length), "条绿跑上报警", String(hit), "条 ⇒ 该配方的经验误报率",
    green.length === 0 ? "n/a" : Math.round((hit / green.length) * 100) + "%");
}
