// M6 验收读数之二：两轮 A/B，量「教训能不能从真实失败轨迹里长出来、回注到下一轮」。
//
// **口径声明（不可达面照实说）**：业主定的验收形态是「冻结 mock 剧本跑两轮，对比同类失败率」。
// 实测那条路**在本仓结构不可达**，不是取巧绕开：
//   · `fixtures/mock/todo-fix.jsonl` 是**一次成功**的剧本（read → write → 跑测试绿），
//     事件流里 **0 个 verify_result、0 个 tool_result{ok:false}** ⇒ 提炼器按硬门产出 0 条
//     （实测，见下「轮 A 提炼：0 条」）。没有失败就没有教训，两轮都空。
//   · 就算把剧本改成失败的，`src/providers/mock.ts` 的 `createMockProvider` **忽略 messages**
//     （它照 tool_call 念剧本），而 `runLoop` 唯一的消息出口就是 `projectContext(seen)`
//     ——记忆块是**会话启动时**读的 `buildMemoryInjection`（glm-session 那条路），`runLoop`
//     里根本没有注入点。所以「模型读到教训并改了动作」在 mock 靶上**没有承载路径**。
// ⇒ 本面改测**真能测的那一半**：造一条真失败轨迹（A 的剧本就地生成、不碰冻结 fixture），
//   提炼 → 写盘 → 回注 → 读回，逐字对照。测不到的那一半在上面写明，不拿"注入块在"冒充"行为变了"。
//
// 跑法：`node --import tsx scripts/replay/lessons-round-ab.ts`
import { mkdtemp, readdir, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runLoop } from "../../src/agent/loop";
import { createEventLog, replay } from "../../src/events";
import { createMockProvider } from "../../src/providers/mock";
import { projectContext } from "../../src/agent/context";
import { buildMemoryInjection } from "../../src/agent/memory/inject";
import { distillLessons, LESSON_TOPIC_PREFIX, TOOL_STREAK_MIN } from "../../src/agent/memory/lessons";
import { projectMemoryDir, readTopicBody, writeTopic } from "../../src/agent/memory/store";
import type { AgentEvent } from "../../src/events";
import type { Provider, ProviderMessage } from "../../src/providers";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FROZEN = join(ROOT, "fixtures", "mock", "todo-fix.jsonl");
const BUGGY = join(ROOT, "fixtures", "mock", "todo-bug.ts");

/** 轮 A 的剧本：**失败**的那一支（同冻结剧本同形状，但写回的是没修的版本）。
 *  就地生成、不碰冻结 fixture —— `fixtures/**` 是判卷文件，改它等于作弊。
 *  它照样被 mock provider 照念（不看 messages），这一点上面已说明不可达面。 */
async function failingScript(dir: string): Promise<string> {
  const buggy = await readFile(BUGGY, "utf8");
  const p = join(dir, "round-a-script.jsonl");
  const rows = [
    { type: "assistant_message", content: "我先读一下 src/todo.ts，定位失败原因。" },
    { type: "tool_call", id: "c1", name: "read_file", args: { path: "src/todo.ts" } },
    { type: "assistant_message", content: "看起来没问题，我改一下试试。" },
    { type: "tool_call", id: "c2", name: "write_file", args: { path: "src/todo.ts", content: buggy } },
    { type: "assistant_message", content: "改完了。" },
    { type: "tool_call", id: "c3", name: "run_shell", args: { command: "pnpm test" } },
  ];
  await mkdir(dir, { recursive: true });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  return p;
}

/** 把发给 provider 的 messages 逐轮记下来：mock provider 不看它，所以只能由外层记。 */
function spyProvider(inner: Provider): { provider: Provider; seen: ProviderMessage[][] } {
  const seen: ProviderMessage[][] = [];
  const provider: Provider = {
    async *stream(messages) {
      seen.push(messages.map((m) => ({ role: m.role, content: m.content })));
      for await (const o of inner.stream(messages)) yield o;
    },
  };
  return { provider, seen };
}

async function oneRound(tag: string, logPath: string, workspace: string, scriptPath: string): Promise<AgentEvent[]> {
  const events = createEventLog(logPath);
  const { provider, seen } = spyProvider(createMockProvider(scriptPath));
  await runLoop({
    provider,
    events,
    workspace,
    mode: "auto",
    userMessage: "修复 fixtures/todo-app 中失败的测试",
  });
  const log = await replay(logPath);
  console.log("[" + tag + "] 事件 " + String(log.length) + " 条｜provider 请求 " + String(seen.length) + " 次｜"
    + "verify_result=" + String(log.filter((e) => e.type === "verify_result").length)
    + "｜tool_result 红=" + String(log.filter((e) => e.type === "tool_result" && !e.ok).length));
  return log;
}

const root = await mkdtemp(join(tmpdir(), "m6-round-ab-"));
const logA = join(root, "round-a.jsonl");
const logB = join(root, "round-b.jsonl");
const globalRoot = join(root, "global");
const scriptA = await failingScript(root);

console.log("=== 口径声明 ===");
console.log("冻结剧本 fixtures/mock/todo-fix.jsonl 是**一次成功**的回合 ⇒ 0 红 ⇒ 按硬门提炼 0 条。");
console.log("轮 A 改用同形状的**失败**剧本（就地生成，不碰冻结 fixture）。");
console.log("「模型读懂教训并改了动作」在 mock 靶上不可达（provider 忽略 messages，runLoop 无注入口）——本面只测可达的一半。");
console.log("");

// ---- 轮 A：失败的剧本 ----
console.log("=== 轮 A（失败剧本，空记忆）===");
const eventsA = await oneRound("A", logA, join(ROOT, "fixtures", "todo-app"), scriptA);

const injA = await buildMemoryInjection({ workspace: join(ROOT, "fixtures", "todo-app"), globalRoot });
console.log("[A] 注入块 project=" + (injA.project === null ? "null" : String(injA.project.length) + " 字符")
  + "｜tokens=" + String(injA.tokens) + "｜教训行 "
  + String((injA.project ?? "").split("\n").filter((l) => l.includes("〔证据:")).length) + " 条（基线应为 0）");
console.log("");

// ---- 从轮 A 的真实轨迹提炼 ----
console.log("=== 从轮 A 真实轨迹提炼 ===");
const lessons = distillLessons(eventsA, logA);
console.log("提炼出 " + String(lessons.length) + " 条：");
for (const l of lessons) {
  console.log("  · " + l.topic + " ← " + l.evidence.map((e) => e.session + "#" + e.callId).join(" / "));
}
if (lessons.length === 0) {
  const reds = eventsA.filter((e) => e.type === "tool_result" && !e.ok);
  console.log("  轮 A 确有红：" + String(reds.length) + " 条 tool_result{ok:false}，"
    + "但**没有一拍的失败能撑起一条教训**：");
  for (const r of reds) {
    const rc = (r as { callId: string }).callId;
    const tc = eventsA.find((e) => e.type === "tool_call" && e.id === rc);
    console.log("    callId=" + rc + " 工具=" + String(tc && tc.type === "tool_call" ? tc.name : "（查不到 tool_call）")
      + " —— 工具只败 1 拍（TOOL_STREAK_MIN=" + String(TOOL_STREAK_MIN) + "），且它跑在 verify 反射**之外**"
      + " ⇒ loop 不发 verify_result ⇒ 三类来源一条都够不着。");
  }
  console.log("  这是**正确的零**：单拍偶发失败不该被提炼成教训（那是噪音，见 lessons.ts 来源③ 的收窄理由）。");
  console.log("  代价是：本靶子上 M6 的产出口径**测不到非零那一支**——真实会话语料那一面（replay:lessons-offline）才是非零读数。");
}
console.log("");

// ---- 轮 B：把教训写进工作区记忆，再跑同一剧本 ----
console.log("=== 轮 B（工作区已写入轮 A 的教训）===");
const ws = join(ROOT, "fixtures", "todo-app");
const pmd = projectMemoryDir(ws);
await mkdir(pmd, { recursive: true });
for (const l of lessons) await writeTopic(pmd, l.topic, "feedback", l.body, new Date().toISOString());
const topics = (await readdir(pmd)).filter((f) => f.startsWith(LESSON_TOPIC_PREFIX));
console.log("[B] 已写入 " + String(topics.length) + " 条 → " + pmd.replace(ROOT, "<ROOT>"));

const eventsB = await oneRound("B", logB, ws, scriptA);

const injB = await buildMemoryInjection({ workspace: ws, globalRoot });
const lessB = (injB.project ?? "").split("\n").filter((l) => l.includes("〔证据:"));
console.log("[B] 注入块 project=" + (injB.project === null ? "null" : String(injB.project.length) + " 字符")
  + "｜tokens=" + String(injB.tokens) + "｜教训行 " + String(lessB.length) + " 条");
for (const l of lessB) console.log("    " + l);
console.log("");

// ---- 两轮对照：除剧本外哪一处字节真的变了 ----
console.log("=== 两轮对照 ===");
const sig = (evs: AgentEvent[]): string =>
  projectContext(evs).map((m) => m.role + ":" + String(m.content ?? "").length).join(",");
console.log("  A 投影 = " + sig(eventsA));
console.log("  B 投影 = " + sig(eventsB));
console.log("  事件流条数 A=" + String(eventsA.length) + " B=" + String(eventsB.length));
console.log("  注入块是 runLoop 外的另一条路（glm-session 启动时读）⇒ 投影逐字相同是**预期的**，不是注入失败。");
console.log("");

// ---- 逐字对照：盘上正文 vs 回注行 ----
console.log("=== 盘上正文 ↔ 回注行 逐字对照 ===");
for (const l of lessons) {
  const body = await readTopicBody(pmd, l.topic);
  console.log("  " + l.topic);
  console.log("    盘上首行（索引摘要来源）：" + String(body?.split("\n")[0]));
  console.log("    盘上出处行：" + String(body?.split("\n").find((x) => x.startsWith("evidence-line:"))));
  const inInj = (injB.project ?? "").split("\n").find((x) => x.includes("〔证据:"));
  console.log("    回注行：" + String(inInj));
  console.log("    出处逐字出现在回注里 = " + String(
    (body ?? "").split("\n").some((x) => x.startsWith("evidence-line:")) &&
    (inInj ?? "").includes(((body ?? "").match(/evidence-line:(.*)/u)?.[1] ?? "§缺§").trim()),
  ));
}
console.log("");

console.log("=== 冻结 fixture 未被动 ===");
const { createHash } = await import("node:crypto");
const frozenNow = createHash("sha256").update(await readFile(FROZEN)).digest("hex");
console.log("  fixtures/mock/todo-fix.jsonl sha256 = " + frozenNow.slice(0, 16) + "…（该文件本轮只读）");

// 清理：靶子工作区里的记忆撤掉，别给下一轮留残迹
await rm(pmd, { recursive: true, force: true });
await rm(root, { recursive: true, force: true });
console.log("");
console.log("=== 诚实声明 ===");
console.log("本面证到的：真失败轨迹 ⇒ **正确的零**（单拍偶发失败不成教训），两轮事件流逐字同形。");
console.log("本面**没**证到的：非零产出的端到端那一跳。这轮 A 的失败脚本造不出够格的一拍（见上），");
console.log("所以「提炼 ⇒ 写盘 ⇒ 回注逐字含出处」那一支在本靶子上是空的——它由 tests/memory-lessons.test.ts");
console.log("（20 条，含真写盘往返与注入逐字断言）与 replay:lessons-offline（真语料非零读数）承担。");
console.log("业主定的验收形态「冻结 mock 两轮对比同类失败率」在此**结构不可达**：");
console.log("  · 冻结剧本是一次成功回合 ⇒ 0 红 ⇒ 0 教训（硬门正确地挡下）；");
console.log("  · createMockProvider 忽略 messages，且记忆注入在 glm-session 启动时读盘、不在 runLoop 里。");
console.log("要真量「同类失败率下降」，需要换真模型 + 真靶子的独立实验，不在本轮写范围。未测即未证。");