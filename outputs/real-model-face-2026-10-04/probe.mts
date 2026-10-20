/** 失败发生率·按面重做（只按真模型轨迹 / 只按脚本轨迹，绝不合并）。
 *
 *  取料面：`outputs/` 下任意深度的 `*.events.jsonl`（排除 `.worktrees/` 里的副本）＋ `fixtures/no-progress/` 下的 `*.events.jsonl`。
 *  分面判据：**只看流本身**——流里任一事件带 `"model"` 字段且值不是 `mock` ⇒ 真模型面；否则脚本面。
 *      （实测全仓只有 `mimo-v2.6-flash` 一种值；目录名 base/head-a/head-b 不作判据：同一题在三档各跑一遍，
 *        目录名会把同源事件重复计进同一格。）
 *  配对键：`tool_call.id ↔ tool_result.callId`。
 *  (a)(b)(c)(d) 一律**先写触发条件再数**：数的是"某个候选改动在什么条件下才改变行为"，不是症状字面相似数。
 *
 *  只读主树，不改任何生产代码/判卷，不跑 git 写操作。读数走 stdout（由外层重定向进 readings.txt，退出码显式取）。 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/Users/ze/Downloads/Cairn/deepseek harness";

/* ---------- 取料 ---------- */
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
walk(join(ROOT, "outputs"), 0);
walk(join(ROOT, "fixtures/no-progress"), 0);
files.sort();

interface Ev {
  type?: string; id?: string; callId?: string; name?: string; ok?: boolean; output?: unknown;
  args?: Record<string, unknown>; exitCode?: number | null; model?: string; auto?: boolean; step?: number; message?: string;
}
interface Trace {
  file: string; rel: string; face: "real" | "mock"; evs: Ev[]; calls: Map<string, Ev>;
  results: { r: Ev; c: Ev | undefined; name: string }[];
}

const modelVals = new Set<string>();
const traces: Trace[] = files.map((f) => {
  const evs: Ev[] = [];
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try { evs.push(JSON.parse(line) as Ev); } catch { /* 坏行跳过——本面不猜内容 */ }
  }
  const ms = evs.filter((e) => typeof e.model === "string").map((e) => e.model as string);
  for (const m of ms) modelVals.add(m);
  const face: "real" | "mock" = ms.length > 0 && ms.some((m) => m !== "mock") ? "real" : "mock";
  const calls = new Map<string, Ev>();
  for (const e of evs) if (e.type === "tool_call" && typeof e.id === "string") calls.set(e.id, e);
  const results = evs.filter((e) => e.type === "tool_result").map((r) => {
    const c = typeof r.callId === "string" ? calls.get(r.callId) : undefined;
    return { r, c, name: c && typeof c.name === "string" ? c.name : "(无名/未配对)" };
  });
  return { file: f, rel: f.slice(ROOT.length + 1), face, evs, calls, results };
});

const FACES = ["real", "mock"] as const;
const T = (face: "real" | "mock") => traces.filter((t) => t.face === face);
const line = (s: string): void => { console.log(s); };
const pad = (s: string | number, n: number): string => String(s).padStart(n);

line("面分类：model 字段值集合＝" + JSON.stringify([...modelVals]) + "｜轨迹总数＝" + String(traces.length)
  + "｜真模型面＝" + String(T("real").length) + "｜脚本面＝" + String(T("mock").length));
line("注：分类只读流里的 `model` 字段，目录名（base/head-a/head-b/a/a50）一律不参与判断。");

/* ---------- 1. 基本面量 ---------- */
line("\n=== [1] 两面基本量（轨迹 / tool_call / tool_result / ok:false）===");
line("面      轨迹  tool_call  tool_result   ok:false  失败率    未配对回执  发出未收 receipt");
for (const face of FACES) {
  const ts = T(face);
  const calls = ts.reduce((n, t) => n + t.evs.filter((e) => e.type === "tool_call").length, 0);
  const recs = ts.reduce((n, t) => n + t.results.length, 0);
  const fails = ts.reduce((n, t) => n + t.results.filter((x) => x.r.ok === false).length, 0);
  const unpaired = ts.reduce((n, t) => n + t.results.filter((x) => !x.c).length, 0);
  const callIds = new Set<string>();
  for (const t of ts) for (const x of t.results) if (x.c && typeof x.c.id === "string") callIds.add(x.c.id);
  const noReceipt = ts.reduce((n, t) => n + t.evs.filter((e) => e.type === "tool_call" && typeof e.id === "string" && !t.results.some((x) => x.c && x.c.id === e.id)).length, 0);
  const rate = recs === 0 ? "—" : (fails / recs * 100).toFixed(1) + "%";
  line(`${face}  ${pad(ts.length, 4)}  ${pad(calls, 9)}  ${pad(recs, 11)}  ${pad(fails, 9)}  ${pad(rate, 7)}  ${pad(unpaired, 11)}  ${pad(noReceipt, 12)}`);
}
const allCalls = traces.reduce((n, t) => n + t.evs.filter((e) => e.type === "tool_call").length, 0);
const allRecs = traces.reduce((n, t) => n + t.results.length, 0);
const allFails = traces.reduce((n, t) => n + t.results.filter((x) => x.r.ok === false).length, 0);
line("合计（只为对账，不作任何表的分子）：tool_call=" + String(allCalls) + "｜tool_result=" + String(allRecs) + "｜ok:false=" + String(allFails));
{
  const inOutputs = traces.filter((t) => t.rel.startsWith("outputs/"));
  const inFixtures = traces.filter((t) => t.rel.startsWith("fixtures/"));
  const failsOf = (arr: Trace[]) => arr.reduce((n, t) => n + t.results.filter((x) => x.r.ok === false).length, 0);
  line("对账原件：只取 `outputs/` 时 ok:false＝" + String(failsOf(inOutputs)) + "（verify-face.mts 那个 39 就是这一格，它没扫 fixtures）；"
    + "只取 `fixtures/no-progress/` ＝" + String(failsOf(inFixtures)) + "；两面相加 " + String(failsOf(inOutputs)) + "+" + String(failsOf(inFixtures))
    + "=" + String(allFails) + " ⇒ 旧表把 107 份当 39 条看，漏的正是 fixtures 这一头与分面这一刀。");
}

/* ---------- 2. 失败簇 ---------- */
const HEX = /\b(?:0x[0-9a-fA-F]{4,}|[0-9a-f]{16,})\b/gu;
const normKeep = (s: string): string => s.replace(HEX, "<hex>").replace(/\d+/gu, "<n>").replace(/\s+/gu, " ").trim().slice(0, 96);
const normFlat = (s: string): string => normKeep(s).replace(/(?:\/[\w.@-]+){2,}/gu, "<path>");
const firstOf = (o: unknown): string => { const t = String(o === undefined ? "" : o).split("\n")[0]; return t === undefined ? "" : t; };

interface Clu { n: number; files: Set<string>; sample: string }
const clusterOf = (ts: Trace[], norm: (s: string) => string): Map<string, Clu> => {
  const m = new Map<string, Clu>();
  for (const t of ts) for (const x of t.results) {
    if (x.r.ok !== false) continue;
    const raw = firstOf(x.r.output);
    const n = norm(raw);
    const key = x.name + " · " + (n === "" ? "(空首行)" : n);
    const g = m.get(key) ?? { n: 0, files: new Set<string>(), sample: raw.replace(/\s+/g, " ").slice(0, 120) };
    g.n += 1; g.files.add(t.rel); m.set(key, g);
  }
  return m;
};
const printTop = (label: string, ts: Trace[], norm: (s: string) => string): void => {
  const m = clusterOf(ts, norm);
  const top = [...m.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])).slice(0, 10);
  line("  " + label + "（簇总数＝" + String(m.size) + "，失败条数＝" + String(ts.reduce((n, t) => n + t.results.filter((x) => x.r.ok === false).length, 0)) + "）");
  for (const [k, g] of top) line("    n=" + pad(g.n, 2) + "｜散在 " + pad(g.files.size, 2) + " 份轨迹｜" + k);
};
line("\n=== [2] 失败簇 Top 10（键＝工具名 + 归一化输出首行）===");
line("主口径＝**保留路径本身**（数字→<n>、0x..／长哈希→<hex>，路径不抹）；对照口径＝再把两段以上路径→<path>。");
for (const face of FACES) {
  line("— " + (face === "real" ? "真模型面" : "脚本面") + " —");
  printTop("主口径（路径保留）", T(face), normKeep);
  printTop("对照口径（路径抹平）", T(face), normFlat);
}
line("抹平前后差多少（两面）：见 [2b]；空首行那一格的来历：见 [2c]。");
line("\n=== [2b] 路径抹平造成的合并（两面各数一遍）===");
for (const face of FACES) {
  const keep = clusterOf(T(face), normKeep);
  const flat = clusterOf(T(face), normFlat);
  line("  " + (face === "real" ? "真模型面" : "脚本面") + "：主口径簇数＝" + String(keep.size) + "｜抹平后簇数＝" + String(flat.size)
    + "｜被合并掉的簇＝" + String(keep.size - flat.size));
  const byFlat = new Map<string, string[]>();
  for (const [k, g] of keep) {
    if (g.n < 1) continue;
    const i = k.indexOf(" · ");
    const fk = k.slice(0, i + 3) + normFlat(k.slice(i + 3));
    const arr = byFlat.get(fk) ?? [];
    arr.push(k);
    byFlat.set(fk, arr);
  }
  let merged = 0;
  for (const [fk, arr] of byFlat) if (arr.length > 1) { merged++; line("    抹平后成一格：" + fk + "  ⟵ " + String(arr.length) + " 格：" + arr.join("  |  ")); }
  if (merged === 0) line("    （本面上没有任何两格因抹平而合并 ⇒ 这一格排序不受口径影响；换料面时这条要重数，不能沿用）");
}
line("\n=== [2c] 空首行那一格的来历（真模型面，注解不参与聚类键）===");
for (const face of FACES) {
  const rows = [];
  for (const t of T(face)) for (const x of t.results) {
    if (x.r.ok !== false) continue;
    if (firstOf(x.r.output).trim() !== "") continue;
    const all = String(x.r.output === undefined ? "" : x.r.output).split("\n");
    const nextNonEmpty = all.slice(1).find((s) => s.trim() !== "") ?? "(整条为空)";
    rows.push("      " + face + "｜" + x.name + "｜命令=" + JSON.stringify(String(x.c?.args?.command ?? "(无)")).slice(0, 60) + "｜次行=" + JSON.stringify(nextNonEmpty.replace(/\s+/g, " ").slice(0, 70)));
  }
  if (rows.length) line("  " + (face === "real" ? "真模型面" : "脚本面") + " 空首行 " + String(rows.length) + " 条：\n" + rows.join("\n"));
  else line("  " + (face === "real" ? "真模型面" : "脚本面") + " 空首行 0 条");
}

/* ---------- 3-(a) run_shell 分段提示 ---------- */
line("\n=== [3a] 候选：run_shell 失败回执的『分段提示』 ===");
line("触发条件（全满足才出声）：① 工具＝run_shell ② 回执判死 ③ 正文有内容（剥掉 [exit code: N]／[exec:…] 后 >20 字）"
  + " ④ 命令是复合的（含 ; && || 或换行，切完 ≥2 段）⑤ 命令里不含 \" ' ` 任一引号/反引号。");
const QUOTE = /["'`]/;
const bodyOf = (o: unknown): string => String(o === undefined ? "" : o).replace(/\[exit code: -?\d+\]/gi, "").replace(/\[exec:[^\]]*\]/gi, "").trim();
const exitMark = (o: unknown, e: Ev): { nonzero: boolean; via: string } => {
  const t = String(o === undefined ? "" : o);
  if (/\[exit code: -?[1-9]/.test(t)) return { nonzero: true, via: "正文标记" };
  if (/\[exit code: 0\]/.test(t)) return { nonzero: false, via: "正文标 0" };
  if (typeof e.exitCode === "number" && e.exitCode !== 0) return { nonzero: true, via: "exitCode 字段" };
  if (typeof e.exitCode === "number" && e.exitCode === 0) return { nonzero: false, via: "exitCode=0" };
  return { nonzero: false, via: "两者皆无" };
};
for (const face of FACES) {
  let sh = 0, mark = 0, fieldOnly = 0, body = 0, comp = 0, trig = 0, byQuote = 0, single = 0, alreadyNamed = 0;
  const ex: string[] = [];
  const noCode: string[] = [];
  for (const t of T(face)) for (const x of t.results) {
    if (x.r.ok !== false || x.name !== "run_shell") continue;
    sh++;
    const o = x.r.output;
    const cmd = String(x.c?.args?.command ?? "");
    const m = exitMark(o, x.r);
    const hasBody = bodyOf(o).length > 20;
    if (!m.nonzero) { if (hasBody) noCode.push("      " + t.rel + "｜判死但无非零码证据（" + m.via + "）｜正文 " + String(bodyOf(o).length) + " 字｜命令=" + JSON.stringify(cmd.slice(0, 70))); continue; }
    if (m.via === "exitCode 字段") fieldOnly++;
    mark++;
    if (!hasBody) continue;
    body++;
    const segs = cmd.split(/[;\n]|&&|\|\|/).map((s) => s.trim()).filter((s) => s !== "");
    if (segs.length > 1) comp++;
    if (segs.length > 1 && !QUOTE.test(cmd)) {
      trig++;
      if (/^(?:bash|sh): line \d+: /.test(firstOf(o))) alreadyNamed++;
      if (ex.length < 6) ex.push("      " + t.rel + "｜" + JSON.stringify(cmd.replace(/\s+/g, " ").slice(0, 86))
        + "\n        回执首行＝" + JSON.stringify(firstOf(o).slice(0, 90)) + "｜正文 " + String(bodyOf(o).length) + " 字"
        + (/^(?:bash|sh): line \d+: /.test(firstOf(o)) ? "〔首行已点名是哪一段炸的 ⇒ 分段提示在这一格不新增信息〕" : "〔首行没有点名 ⇒ 这是分段提示真正补信息的一格〕"));
    } else if (segs.length > 1) byQuote++;
    else single++;
  }
  line("  " + (face === "real" ? "真模型面" : "脚本面")
    + "：run_shell 判死＝" + String(sh) + " → 有非零码证据＝" + String(mark) + "（其中只靠 exitCode 字段＝" + String(fieldOnly) + "）"
    + " → 正文有内容＝" + String(body) + " → 复合命令＝" + String(comp) + " → 且不带引号＝触发 " + String(trig)
    + "（因带引号闭嘴 " + String(byQuote) + "，单段命令 " + String(single) + "）"
    + "｜触发里『回执首行已点名哪一段（bash: line N: …）』＝" + String(alreadyNamed) + " ⇒ 分段提示真正补信息的＝" + String(trig - alreadyNamed));
  if (ex.length) line("    出声样本：\n" + ex.join("\n"));
  if (noCode.length) line("    判死却拿不出非零码（补丁看不到『哪一段失败』那一格，另计）：\n" + noCode.join("\n"));
}

/* ---------- 3-(b) maxSteps 帽 → 没收束就退出 ---------- */
line("\n=== [3b] 候选：撞 maxSteps 帽导致的『没收束就退出』 ===");
line("触发条件：① 轨迹尾部是步数帽终态 ② 该 run 写过盘（write_file/edit_file/apply_patch 有成功回执）③ 全程没出现过自动验证拍。");
{
  const inStream = traces.reduce((n, t) => n + t.evs.filter((e) => e.type === "error" && /maxSteps|强制中止/.test(String(e.message ?? ""))).length, 0);
  line("先说取料面能不能支撑『步数帽终态』这句话：流里带 maxSteps／强制中止 字样的事件＝" + String(inStream)
    + " 条；error 事件全仓＝" + String(traces.reduce((n, t) => n + t.evs.filter((e) => e.type === "error").length, 0)) + " 条（都是 message=\"terminated\"，无帽值）。");
  line("⇒ 帽值不在流里（跑器 --max-steps 是命令行参数：loop-eval 缺省 20，本面这几档实跑 30／50）。这里用**流内可观测的帽终形状**代理：");
  line("   尾部形状＝最后一个实质事件是 tool_result（其后没有 verify_result 收口、也没有任何 assistant_delta 文本收口），且模型请求数（usage 事件）≥20。");
}
const WRITE = new Set(["write_file", "edit_file", "apply_patch"]);
const capShapes: { rel: string; usage: number; wrote: boolean; face: string }[] = [];
for (const face of FACES) {
  let shape = 0, shapeWrite = 0, shapeNoAuto = 0, both = 0, neverVerified = 0;
  const rows: string[] = [];
  let autoBeats = 0;
  for (const t of T(face)) {
    const types = t.evs.map((e) => e.type);
    const lastSubIdx = types.map((ty, i) => ({ ty, i })).filter(({ ty }) => ty !== "assistant_delta" && ty !== "usage").map(({ i }) => i).pop();
    const lastSub = lastSubIdx === undefined ? "(空轨)" : String(t.evs[lastSubIdx].type);
    const lastReceipt = Math.max(types.lastIndexOf("tool_result"), types.lastIndexOf("verify_result"));
    const textAfter = types.some((ty, i) => ty === "assistant_delta" && i > lastReceipt);
    const usage = types.filter((ty) => ty === "usage").length;
    const vAuto = t.evs.filter((e) => e.type === "verify_result" && e.auto === true).length;
    autoBeats += vAuto;
    const isCapShape = lastSub === "tool_result" && !textAfter && usage >= 20;
    if (!isCapShape) continue;
    shape++;
    const wrote = t.results.some((x) => x.c && typeof x.c.name === "string" && WRITE.has(x.c.name) && x.r.ok !== false);
    const verif = t.evs.filter((e) => e.type === "verify_result").length;
    if (wrote) shapeWrite++;
    if (vAuto === 0) shapeNoAuto++;
    if (wrote && vAuto === 0) both++;
    if (verif === 0) neverVerified++;
    capShapes.push({ rel: t.rel, usage, wrote, face });
    rows.push("      usage=" + pad(usage, 3) + "｜calls=" + pad(t.evs.filter((e) => e.type === "tool_call").length, 3) + "｜写盘=" + (wrote ? "是" : "否")
      + "｜verify拍=" + pad(verif, 2) + "｜自动拍=" + String(vAuto) + "｜" + t.rel);
  }
  line("  " + (face === "real" ? "真模型面" : "脚本面")
    + "：帽终形状＝" + String(shape) + " → ∧写过盘＝" + String(shapeWrite) + " → ∧从无自动验证拍＝" + String(both)
    + "（该面自动验证拍总数＝" + String(autoBeats) + "；帽终形状里一次 verify 都没跑过的＝" + String(neverVerified) + "）");
  if (rows.length) line("    逐条：\n" + rows.join("\n"));
}
line("  分面收口方式普查（(b) 的分母在这一格）：");
{
  for (const face of FACES) {
    const kinds = new Map<string, number>();
    for (const t of T(face)) {
      const types = t.evs.map((e) => e.type);
      const subs = types.map((ty, i) => ({ ty, i })).filter(({ ty }) => ty !== "assistant_delta" && ty !== "usage").map(({ i }) => i);
      const lastSub = subs.length ? String(t.evs[subs[subs.length - 1]!]!.type) : "(空轨)";
      const lastReceipt = Math.max(types.lastIndexOf("tool_result"), types.lastIndexOf("verify_result"));
      const textAfter = types.some((ty, i) => ty === "assistant_delta" && i > lastReceipt);
      const usage = types.filter((ty) => ty === "usage").length;
      const k = lastSub === "verify_result" ? "以验证拍收口"
        : lastSub === "error" ? "以 error 事件终止（＝abort/terminated）"
        : lastSub === "tool_result" ? (textAfter ? "以模型文本收口（末事件是工具回执）" : (usage >= 20 ? "帽终形状（末回执无文本收口且请求数≥20）" : "末回执无文本收口但请求数<20"))
        : "其它末态（" + lastSub + "）";
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
    }
    line("    " + (face === "real" ? "真模型面" : "脚本面") + "（" + String(T(face).length) + " 份）："
      + [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + " " + String(v)).join("｜"));
  }
}
line("  附①：判据『从无自动验证拍』在全仓不区分任何东西——107 份流里 verify_result 带 auto=true 的＝"
  + String(traces.reduce((n, t) => n + t.evs.filter((e) => e.type === "verify_result" && e.auto === true).length, 0))
  + " 条（run.log 那几档也印『闸拍=0』）⇒ 这一条子句在本面上恒真，不能用来筛。");
{
  const low = new Map<string, string[]>();
  for (const t of traces) {
    const types = t.evs.map((e) => e.type);
    const subs = types.map((ty, i) => ({ ty, i })).filter(({ ty }) => ty !== "assistant_delta" && ty !== "usage").map(({ i }) => i);
    const lastSub = subs.length ? String(t.evs[subs[subs.length - 1]!].type) : "(空轨)";
    const lastReceipt = Math.max(types.lastIndexOf("tool_result"), types.lastIndexOf("verify_result"));
    const textAfter = types.some((ty, i) => ty === "assistant_delta" && i > lastReceipt);
    const usage = types.filter((ty) => ty === "usage").length;
    if (!(lastSub === "tool_result" && !textAfter && usage < 20)) continue;
    const arr = low.get(t.face) ?? [];
    arr.push("      usage=" + String(usage) + "｜" + t.rel);
    low.set(t.face, arr);
  }
  const tot = [...low.values()].reduce((n, a) => n + a.length, 0);
  line("  附②：同样的尾部形状但 usage<20 的轨迹＝" + String(tot) + " 份（分面：" + [...low.entries()].map(([k, v]) => k + " " + String(v.length)).join("，")
    + "）——都是 0 请求的合成件，代理把它们排除掉了：\n" + [...low.values()].flat().join("\n"));
}

/* ---------- 3-(c) 同参数逐字重发 ---------- */
line("\n=== [3c] 候选：同参数逐字重发（失败后原样再发一次同一调用） ===");
line("口径 A＝窗口：那条失败回执之后**紧接着的 6 次回执**内出现同工具名＋args 逐字相同的调用；");
line("口径 B＝整尾：同一条失败回执之后**任意靠后**位置出现同样的调用。两数之差＝中间隔了别的事、窗口看不见的重发。");
line("口径 C＝不看成败的整尾重复：同一 (工具名, args 逐字) 在同一条流里被发过 ≥2 次时，后面那些次的条数——任何『重发去抖』类改动都会碰到这一格。");
for (const face of FACES) {
  let win = 0, tail = 0, farOnly = 0;
  const winTraces = new Set<string>();
  const tailTraces = new Set<string>();
  const dist: number[] = [];
  const gaps: string[] = [];
  const hits: string[] = [];
  for (const t of T(face)) {
    const seq = t.results;
    for (let i = 0; i < seq.length; i++) {
      const a = seq[i]!;
      if (a.r.ok !== false || !a.c) continue;
      const key = a.name + "·" + JSON.stringify(a.c.args ?? {});
      let firstAt = -1;
      for (let j = i + 1; j < seq.length; j++) {
        const b = seq[j]!;
        if (!b.c) continue;
        if (b.name + "·" + JSON.stringify(b.c.args ?? {}) === key) { firstAt = j - i; break; }
      }
      if (firstAt < 0) continue;
      tail++; tailTraces.add(t.rel);
      dist.push(firstAt);
      if (firstAt <= 6) {
        win++; winTraces.add(t.rel);
        if (hits.length < 6) hits.push("      隔 " + String(firstAt) + " 条｜" + a.name + "｜" + t.rel + "｜args=" + JSON.stringify(String(JSON.stringify(a.c.args ?? {})).slice(0, 64)));
      } else {
        farOnly++;
        if (gaps.length < 6) gaps.push("      隔 " + String(firstAt) + " 条｜" + a.name + "｜" + t.rel + "｜args=" + JSON.stringify(String(JSON.stringify(a.c.args ?? {})).slice(0, 64)));
      }
    }
  }
  let dupFollowed = 0;
  const dupTraces = new Set<string>();
  const dupByTool = new Map<string, number>();
  for (const t of T(face)) {
    const seen = new Map<string, number>();
    for (const e of t.evs) {
      if (e.type !== "tool_call" || typeof e.name !== "string") continue;
      const k = e.name + "·" + JSON.stringify(e.args ?? {});
      const c = seen.get(k) ?? 0;
      seen.set(k, c + 1);
      if (c >= 1) {
        dupFollowed++; dupTraces.add(t.rel);
        dupByTool.set(e.name, (dupByTool.get(e.name) ?? 0) + 1);
      }
    }
  }
  dist.sort((x, y) => x - y);
  const med = dist.length === 0 ? "—" : String(dist[Math.floor((dist.length - 1) / 2)]);
  line("  " + (face === "real" ? "真模型面" : "脚本面")
    + "：A 窗口＝" + String(win) + "（散在 " + String(winTraces.size) + " 份）｜B 整尾＝" + String(tail) + "（散在 " + String(tailTraces.size) + " 份）"
    + "｜B−A（隔 >6 条才重发）＝" + String(farOnly) + "｜C 不看成败＝" + String(dupFollowed) + "（散在 " + String(dupTraces.size) + " 份）"
    + "｜首次重发距离中位＝" + med + (dist.length ? "（最小 " + String(dist[0]) + "，最大 " + String(dist[dist.length - 1]) + "）" : ""));
  if (hits.length) line("    A 命中的样子：\n" + hits.join("\n"));
  if (gaps.length) line("    B 比 A 多出来的（窗口漏掉的）：\n" + gaps.join("\n"));
  line("    C 按工具拆开：" + [...dupByTool.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + " " + String(v)).join("｜")
    + "〔注意 `verify`／`propose_plan` 这类 args＝{} 或定值，『逐字同参』对它们是恒真，不能当『模型在原地重发』的证据〕");
}

/* ---------- 3-(d) apply_patch 补丁不完整 / read_file 文件不存在 ---------- */
line("\n=== [3d] 实际发生次数：apply_patch 补丁不完整 与 read_file 文件不存在 ===");
const PATCH_INCOMPLETE = /补丁不完整|hunk 声明/;
const PATCH_HEADER = /出现文件头行但不在某个|出现 @@ 行但不在某个/;
const READ_MISSING = /文件不存在或不可读/;
for (const face of FACES) {
  let apAll = 0, apInc = 0, apHdr = 0, apOther = 0, rfAll = 0, rfMissing = 0, rfOther = 0;
  const det: string[] = [];
  for (const t of T(face)) for (const x of t.results) {
    if (x.r.ok !== false) continue;
    const o = String(x.r.output === undefined ? "" : x.r.output);
    if (x.name === "apply_patch") {
      apAll++;
      if (PATCH_INCOMPLETE.test(o)) { apInc++; det.push("      补丁不完整｜" + t.rel + "｜" + JSON.stringify(firstOf(o).slice(0, 110))); }
      else if (PATCH_HEADER.test(o)) { apHdr++; det.push("      头行不在段内｜" + t.rel + "｜" + JSON.stringify(firstOf(o).slice(0, 110))); }
      else { apOther++; det.push("      其它 apply_patch 失败｜" + t.rel + "｜" + JSON.stringify(firstOf(o).slice(0, 110))); }
    }
    if (x.name === "read_file") {
      rfAll++;
      if (READ_MISSING.test(o)) { rfMissing++; det.push("      read_file 不存在｜" + t.rel + "｜" + JSON.stringify(firstOf(o).slice(0, 110))); }
      else { rfOther++; det.push("      其它 read_file 失败｜" + t.rel + "｜" + JSON.stringify(firstOf(o).slice(0, 110))); }
    }
  }
  line("  " + (face === "real" ? "真模型面" : "脚本面")
    + "：apply_patch 判死＝" + String(apAll) + "（补丁不完整 " + String(apInc) + "｜头行不在段内 " + String(apHdr) + "｜其它 " + String(apOther) + "）"
    + "｜read_file 判死＝" + String(rfAll) + "（文件不存在或不可读 " + String(rfMissing) + "｜其它 " + String(rfOther) + "）");
  if (det.length) line("    逐条：\n" + det.join("\n"));
}
{
  let apAllT = 0, rfAllT = 0;
  for (const t of traces) for (const x of t.results) {
    if (x.r.ok !== false) continue;
    if (x.name === "apply_patch") apAllT++;
    if (x.name === "read_file") rfAllT++;
  }
  const apCalls = traces.reduce((n, t) => n + t.evs.filter((e) => e.type === "tool_call" && e.name === "apply_patch").length, 0);
  const rfCalls = traces.reduce((n, t) => n + t.evs.filter((e) => e.type === "tool_call" && e.name === "read_file").length, 0);
  line("  分母对照（整面，只为看这一格有多小，不合并两面）：apply_patch 调用 " + String(apCalls) + " 次／两面判死合计 " + String(apAllT)
    + "；read_file 调用 " + String(rfCalls) + " 次／两面判死合计 " + String(rfAllT) + "。");
}

/* ---------- 4. 与原件对账 ---------- */
line("\n=== [4] 与参考原件对账（同判据应复现，复现不了先查这里）===");
for (const face of FACES) {
  let deadBody = 0, trig = 0;
  for (const t of T(face)) for (const x of t.results) {
    if (x.r.ok !== false || x.name !== "run_shell") continue;
    const o = String(x.r.output === undefined ? "" : x.r.output);
    if (!/\[exit code: [1-9]/.test(o)) continue;
    if (bodyOf(o).length <= 20) continue;
    deadBody++;
    const cmd = String(x.c?.args?.command ?? "");
    const segs = cmd.split(/[;\n]|&&|\|\|/).map((s) => s.trim()).filter((s) => s !== "");
    if (segs.length > 1 && !QUOTE.test(cmd)) trig++;
  }
  line("  " + face + "：『正文有却被判死』＝" + String(deadBody) + "（原件：real 10／mock 12）｜其中补丁会出声＝" + String(trig) + "（原件：real 2／mock 5）");
}
/* ---------- 5. 面外佐证（不进表，只验代理有没有指错东西） ---------- */
line("\n=== [5] 面外佐证：帽终形状那几份，同级 run.log 怎么说 ===");
line("说明：这一段读的是 `run.log`（跑器 stdout 留档），**不参与分面、不进表**——它只回答『代理挑中的是不是真撞帽』。");
{
  const cov = new Map<string, { n: number; w: number }>();
  for (const t of traces) {
    const dir = join(ROOT, t.rel.split("/").slice(0, -1).join("/"));
    const has = existsSync(join(dir, "run.log")) || existsSync(join(dir, "readings.json"));
    const v = cov.get(t.face) ?? { n: 0, w: 0 };
    v.n++; if (has) v.w++;
    cov.set(t.face, v);
  }
  line("  可外部核对的覆盖率（同级有没有 run.log／readings.json 证人）："
    + [...cov.entries()].map(([k, v]) => (k === "real" ? "真模型面" : "脚本面") + " " + String(v.w) + "/" + String(v.n) + " 份").join("｜"));
}
{
  let shown = 0;
  for (const c of capShapes) {
    const dir = join(ROOT, c.rel.split("/").slice(0, -1).join("/"));
    const log = join(dir, "run.log");
    const taskId = c.rel.split("/").pop()!.replace(/-rep\d+-\w+\.events\.jsonl$/, "");
    let hit = "（同级无 run.log）";
    let cap = "（同级无 run.log）";
    try {
      const txt = readFileSync(log, "utf8");
      for (const l of txt.split("\n")) {
        if (l.includes("maxSteps=") && l.includes("强制中止")) cap = l.slice(l.indexOf("maxSteps="), l.indexOf("maxSteps=") + 30);
        else if (l.includes("maxSteps=") && cap === "（同级无 run.log）") cap = "档位 " + l.slice(l.indexOf("maxSteps="), l.indexOf("maxSteps=") + 16);
        if (l.includes("] " + taskId + " ")) hit = l.replace(/^\[loop-eval\]\s*/, "").slice(0, 150);
      }
    } catch { /* 没有 run.log 就再试 readings.json */ }
    if (cap === "（同级无 run.log）") {
      const sj = join(dir, "readings.json");
      try {
        const arr = JSON.parse(readFileSync(sj, "utf8")) as { r?: Record<string, unknown> }[];
        for (const e of arr) {
          const x = (e.r ?? e) as { id?: string; requests?: number; exitError?: string | null; autoVerifyBeat?: boolean };
          if (x.id !== taskId) continue;
          cap = "readings.json：exitError=" + JSON.stringify(x.exitError) + "｜requests=" + String(x.requests) + "｜autoVerifyBeat=" + String(x.autoVerifyBeat);
          hit = "（该档无 run.log，取同档 readings.json）";
        }
      } catch { /* 两样都没有就如实说没有 */ }
    }
    if (shown < 8) line("  " + c.rel + "\n      流内 usage=" + String(c.usage) + " 写盘=" + (c.wrote ? "是" : "否") + "\n      跑器档「" + cap + "」 ⇒ " + hit);
    shown++;
  }
  const byFace = new Map<string, number>();
  for (const c of capShapes) byFace.set(c.face, (byFace.get(c.face) ?? 0) + 1);
  line("  帽终形状轨迹合计＝" + String(shown) + " 份（分面实测：" + [...byFace.entries()].map(([k, v]) => (k === "real" ? "真模型面" : "脚本面") + " " + String(v)).join("｜")
    + "；其中同级有证人文件可外部核对的＝" + String(capShapes.length) + " 份里上面逐条给出）。");
}

line("\n探针结束。所有数字来自本次遍历，未合并两面。");
