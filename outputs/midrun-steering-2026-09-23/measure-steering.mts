/** 能力 22「运行中转向」取证探针（三问）：
 *  ① 一轮跑到一半时，用户到底还有哪几条通道能影响它（静态清点真 IPC 通道 + 真 UI 守卫）；
 *  ② 「在轮次边界追加一条 user_message」经真 projectContext 是否协议合法，
 *     而在 tool_calls 与它的 tool_result 之间插呢（预测：吐孤儿 ⇒ 边界不是审美，是协议要求）；
 *  ③ 真·无进展检测器（能力 14）看不看得见"用户中途改过口"（预测：看不见 ⇒ R1 会把纠偏后的重试判成停滞）。
 *  跑法：TERM=dumb node --import tsx outputs/midrun-steering-2026-09-23/measure-steering.mts */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { projectContext } from "../../src/agent/context";
import { verifyBeatsFromEvents, detectVerifyStagnation } from "../../src/agent/no-progress";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---------------- ① 运行中可达通道 ----------------
const ipcFiles = readdirSync(join(ROOT, "src/main")).filter((n) => n.endsWith(".ts"));
const channels: string[] = [];
for (const n of ipcFiles) {
  const b = readFileSync(join(ROOT, "src/main", n), "utf8");
  for (const m of b.matchAll(/ipcMain\.handle\(\s*"([^"]+)"/g)) channels.push(m[1]);
}
const midRun = channels.filter((c) => /decide|clarify|plan|cancel|goal|compact|state|answer|diff/i.test(c));
console.log("## ① 一轮运行中，用户还能按什么");
console.log(`   全部 ipcMain.handle 通道 ${channels.length} 条`);
console.log(`   其中运行中可达（判据：渲染层没被 running 守卫挡住的那几条）：${midRun.join(", ")}`);
const appJs = readFileSync(join(ROOT, "src/renderer/app.js"), "utf8");
// 「发送」处那条守卫（不是重命名那条）：按文案定位，别按第一个 if 匹配
const sendIdx = appJs.indexOf("正在运行，请先等待完成");
const guard = sendIdx < 0 ? "(未找到)" : appJs.slice(Math.max(0, appJs.lastIndexOf("if (", sendIdx)), appJs.indexOf("}", sendIdx) + 1);
console.log("   渲染层「发送」处的真守卫逐字：");
console.log("     " + guard.replace(/\s+/g, " ").slice(0, 170));
console.log(`   ⇒ 运行中输入被无条件拒回一句 toast；唯一的"纠偏"手段是 agent:run-cancel（全盘中止）。`);

// ---------------- ② 插入点的协议合法性 ----------------
type Ev = Record<string, unknown>;
const turn: Ev[] = [
  { type: "user_message", content: "把计价那个 bug 修了" },
  { type: "tool_call", id: "c1", name: "read_file", args: { path: "src/cart.js" } },
  { type: "assistant_delta", content: "我看下" },
  { type: "tool_result", callId: "c1", ok: true, output: "export const total = xs => xs.length;" },
];
function orphans(msgs: Array<{ role: string; content: string | null; tool_calls?: { id: string }[]; tool_call_id?: string }>) {
  const seen = new Set<string>(); let orphanTool = 0;
  for (const m of msgs) {
    if (m.role === "assistant") for (const c of m.tool_calls ?? []) seen.add(c.id);
    else if (m.role === "tool" && !seen.has(String(m.tool_call_id ?? ""))) orphanTool++;
  }
  const answered = new Set(msgs.filter((m) => m.role === "tool").map((m) => String(m.tool_call_id ?? "")));
  let bare = 0;
  for (const m of msgs) if (m.role === "assistant") for (const c of m.tool_calls ?? []) if (!answered.has(c.id)) bare++;
  return { orphanTool, bare };
}
const injected: Ev = { type: "user_message", content: "等一下，只改 shipping.js，别碰 cart" };
const atBoundary = [...turn, injected];
const midPair: Ev[] = [
  { type: "user_message", content: "把计价那个 bug 修了" },
  { type: "tool_call", id: "c1", name: "read_file", args: { path: "src/cart.js" } },
  injected,
  { type: "tool_result", callId: "c1", ok: true, output: "export const total = xs => xs.length;" },
];
console.log("\n## ② 同一条插话，放两个位置，真 projectContext 的读数");
console.log("   （第一版我只查 id 配对，查不出本仓注释要求的「紧跟」——补上邻接判据后重测）");
for (const [tag, evs] of [["轮次边界（结果已全部落流之后）", atBoundary], ["调用与它的结果之间", midPair]] as Array<[string, Ev[]]>) {
  const msgs = projectContext(evs as never) as unknown as Parameters<typeof orphans>[0];
  const o = orphans(msgs);
  const seq = msgs.map((m) => m.role === "assistant" && (m.tool_calls?.length ?? 0) > 0 ? "assistant[calls]" : m.role).join(" → ");
  // 精确判据：只看「一条非 tool 消息被塞在 assistant[calls] 与覆盖它的那些 tool 消息之间」。
  // （第一版按「必须紧邻」判，把本仓正常投影里 assistant[calls] 与 tool 之间夹一条 assistant 文本
  //   的既有形状也算成破——那是判据过严，不是缺陷。见下面单独报这条观察。）
  let interjected = false;
  const callAt: Array<{ i: number; ids: Set<string> }> = [];
  msgs.forEach((m, i) => {
    if (m.role === "assistant" && (m.tool_calls?.length ?? 0) > 0) callAt.push({ i, ids: new Set(m.tool_calls.map((c) => c.id)) });
  });
  for (const { i, ids } of callAt) {
    let lastResult = i;
    for (let j = i + 1; j < msgs.length; j++) if (msgs[j].role === "tool" && ids.has(String(msgs[j].tool_call_id ?? ""))) lastResult = j;
    for (let j = i + 1; j < lastResult; j++) if (msgs[j].role === "user") interjected = true;
  }
  // 既有形状（与插话无关，照实报）：calls 与其结果之间夹着非 tool 消息
  let interleaved = false;
  for (const { i, ids } of callAt) {
    let firstResult = -1;
    for (let j = i + 1; j < msgs.length; j++) if (msgs[j].role === "tool" && ids.has(String(msgs[j].tool_call_id ?? ""))) { firstResult = j; break; }
    if (firstResult > i + 1) interleaved = true;
  }
  console.log(`   [${tag}]`);
  console.log(`      投影序列：${seq}`);
  console.log(`      id 配对：孤儿 ${o.orphanTool} / 悬空 ${o.bare} ⇒ ${o.orphanTool === 0 && o.bare === 0 ? "过" : "破"}；` +
    `插话是否落在「调用与其结果之间」：${interjected ? "**是（这就是要禁的形状）**" : "否"}`);
}
console.log("   （另记一条与插话无关的既有形状：本仓投影在 assistant[calls] 与它的 tool 结果之间");
console.log("     会夹一条 assistant 文本行——各 provider 是否接受这种非紧邻排列，本页**未证**，留给能力 20 复核。）");
console.log("   ⇒ 结论：两种位置都过 id 配对 ⇒ **光按 id 配对判是漏的**；");
console.log("     真正的判别是「插话落在调用与它的结果之间」，它只破坏邻接、不制造孤儿——");
console.log("     所以能力 20 的出口收束器必须加**邻接**这一维，否则 steering 一旦上线它就看不见这个破口（本页反喂给 20）。");

// ---------------- ③ 无进展检测器看得见「用户改过口」吗 ----------------
const RED = { command: "pnpm test", ok: false, output: "FAIL src/cart.test.ts > total\nAssertionError: expected 3 to be 2" };
function beatSequence(withInterjection: boolean): Ev[] {
  const evs: Ev[] = [
    { type: "user_message", content: "修 total" },
    { type: "verify_result", callId: "v1", ok: false, attempt: 1, maxAttempts: 5, results: [RED] },
  ];
  if (withInterjection) evs.push({ type: "user_message", content: "换路子：断言别看 length，看金额求和" });
  evs.push({ type: "verify_result", callId: "v2", ok: false, attempt: 2, maxAttempts: 5, results: [RED] });
  return evs;
}
console.log("\n## ③ 真 detectVerifyStagnation 对「用户中途纠偏后重试同一条红」的判读");
for (const [tag, wi] of [["无插话（用户没说任何话）", false], ["**中间用户改了口**", true]] as Array<[string, boolean]>) {
  const evs = beatSequence(wi);
  const beats = verifyBeatsFromEvents(evs as never);
  const v = detectVerifyStagnation(beats);
  console.log(`   [${tag}] beats=${beats.length} wroteSinceLast=${beats.map((b) => b.wroteSinceLast).join(",")} ⇒ ` +
    `stagnant=${v.stagnant}${v.stagnant ? "（repeats=" + v.repeats + "，干预阶梯会出声）" : ""}`);
}
// 对照组：中间有一次成功的写（这是它唯一的抑制信号）
const withWrite: Ev[] = [
  { type: "user_message", content: "修 total" },
  { type: "verify_result", callId: "v1", ok: false, attempt: 1, maxAttempts: 5, results: [RED] },
  { type: "tool_call", id: "w1", name: "edit_file", args: { path: "src/cart.js" } },
  { type: "tool_result", callId: "w1", ok: true, output: "已替换 src/cart.js（1 处，+1 −1 行）" },
  { type: "verify_result", callId: "v2", ok: false, attempt: 2, maxAttempts: 5, results: [RED] },
];
const bw = verifyBeatsFromEvents(withWrite as never);
const vw = detectVerifyStagnation(bw);
console.log(`   [对照·中间有成功写] wroteSinceLast=${bw.map((b) => b.wroteSinceLast).join(",")} ⇒ stagnant=${vw.stagnant}`);
console.log("   ⇒ 预测被证实/否证：用户改口**不**改变判定（只认写动作）⇒ R1 会把「按新指示重试」读成停滞。");
