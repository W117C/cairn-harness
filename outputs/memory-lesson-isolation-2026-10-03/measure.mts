// 第 316 页取料：一份坏 lesson 文件名，该丢那一份还是丢整段？
//
// 同一份输入跑两遍（`SRC` 指旧树 / 新树），两栏数字同分母——「一份坏文件吃掉整段记忆」这件事
// 只有摆在一起才看得出丢了几条。降级那一路也需要一个新触发：隔离之后，坏文件名不再抛，
// 整次注入只剩「外部引用的决议写不进去」这一条真实的抛出点（生产默认 persist = 真写盘）。
//
// 跑法：node --import tsx outputs/memory-lesson-isolation-2026-10-03/measure.mts [SRC=<src 目录>]
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = process.env.SRC ? resolve(process.env.SRC) : join(ROOT, "src");
const inject = await import(pathToFileURL(join(SRC, "agent/memory/inject.ts")).href);
const store = await import(pathToFileURL(join(SRC, "agent/memory/store.ts")).href);
const { EVIDENCE_LINE_PREFIX } = await import(pathToFileURL(join(SRC, "agent/memory/lessons.ts")).href);

const lessonBody = (n: string) => "教训正文 " + n + "\n" + EVIDENCE_LINE_PREFIX + " session s1 / callId c1\n";

/** 造一份记忆目录：`goods` 走真 writeTopic（形状不由我手抄），`bads` 只能手写文件名。 */
async function makeWorkspace(goods: { topic: string; modified: string }[], bads: string[], archText = ""): Promise<string> {
  const workspace = mkdtempSync(join(tmpdir(), "memiso-"));
  const memdir = store.projectMemoryDir(workspace);
  mkdirSync(memdir, { recursive: true });
  writeFileSync(join(memdir, "MEMORY.md"), "# Memory Index\n");
  if (archText) writeFileSync(join(store.projectAgentDir(workspace), "ARCHITECTURE.md"), archText);
  for (const g of goods) await store.writeTopic(memdir, g.topic, "feedback", lessonBody(g.topic), g.modified);
  for (const b of bads) writeFileSync(join(memdir, b), "---\ntype: feedback\nmodified: 2026-12-01T00:00:00.000Z\n---\n\n" + lessonBody(b));
  return workspace;
}

/** LESSONS 抬头之后、`chars_current=` 之前的那些行才是这一段的内容。 */
const lessonsLines = (project: string | null): { lessons: string[]; notes: string[] } => {
  const all = (project ?? "").split("\n");
  const at = all.findIndex((l) => l.includes("[LESSONS 最近"));
  if (at < 0) return { lessons: [], notes: [] };
  const body: string[] = [];
  for (let i = at + 1; i < all.length; i++) {
    if (all[i]!.startsWith("chars_current=")) break;
    body.push(all[i]!);
  }
  return {
    lessons: body.filter((l) => l.startsWith("- ")).map((l) => l.slice(2, 26)),
    notes: body.filter((l) => l.startsWith("[lessons]")),
  };
};
const count = (project: string | null): string =>
  (project ?? "").match(/\[LESSONS 最近 (\d+) 条/u)?.[1] ?? "无段";

function row(label: string, r: { injection: { project: string | null }; unavailable: string | null }): void {
  const inj = r.injection.project;
  const { lessons, notes } = lessonsLines(inj);
  console.log([
    label,
    "unavailable=" + (r.unavailable === null ? "null" : "有（" + r.unavailable.slice(0, 46).replace(/\n/gu, " ") + "…）"),
    "抬头条数=" + count(inj),
    "实际教训=" + lessons.length,
    "点名行=" + (notes.length > 0 ? "有" : "无"),
    "留下的=" + JSON.stringify(lessons),
    "点名原文=" + JSON.stringify(notes[0] ?? ""),
  ].join(" ｜ "));
}

console.log("SRC=" + SRC);
const d = (n: number) => new Date(Date.UTC(2026, 9, 10 - n)).toISOString();

// A 一份坏 + 三份好（坏的那份 modified 最新 ⇒ 旧写法先读到它，整段就没了）
let ws = await makeWorkspace(
  [{ topic: "lesson-a", modified: d(1) }, { topic: "lesson-b", modified: d(2) }, { topic: "lesson-c", modified: d(3) }],
  ["lesson-中文命名.md"]);
row("A 一份坏＋三份好", await inject.buildMemoryInjectionSafe({ workspace: ws, globalRoot: join(ws, "no-global") }));

// B 槽位：limit=3，坏文件排最新 ⇒ 先切后筛就会少一条真好教训
ws = await makeWorkspace(
  [{ topic: "lesson-a", modified: d(1) }, { topic: "lesson-b", modified: d(2) }, { topic: "lesson-c", modified: d(3) }, { topic: "lesson-d", modified: d(4) }],
  ["lesson-坏 名字.md"]);
row("B limit=3 四好一坏", await inject.buildMemoryInjectionSafe({ workspace: ws, globalRoot: join(ws, "no-global"), lessonsLimit: 3 }));

// C 整批只有坏名字 ⇒ 段还在、条数 0、点名行说话
ws = await makeWorkspace([], ["lesson-一.md", "lesson-二.md", "lesson-三.md", "lesson-四.md"]);
row("C 整批四个坏名", await inject.buildMemoryInjectionSafe({ workspace: ws, globalRoot: join(ws, "no-global") }));

// D 反向对照：全合规 ⇒ 一个字都不许多
ws = await makeWorkspace([{ topic: "lesson-a", modified: d(1) }], []);
row("D 全合规", await inject.buildMemoryInjectionSafe({ workspace: ws, globalRoot: join(ws, "no-global") }));

// E/F 降级那一路的新触发：记忆文本里有工作区外 @引用 ⇒ 生产默认 persist 真写盘；写不进去 ⇒ 整次抛出
const blocked = mkdtempSync(join(tmpdir(), "memiso-home-"));
writeFileSync(join(blocked, "blocker"), "x"); // blocker 是**文件**，它下面的路径建不出目录 ⇒ ENOTDIR
const badHome = join(blocked, "blocker", "memory");
const goodHome = join(blocked, "ok", "memory");
process.env.M2D_MEMORY_HOME = badHome;
store.initMemoryHome(badHome);
ws = await makeWorkspace([{ topic: "lesson-a", modified: d(1) }], [], "本文提到 @/etc/hosts 这一条引用。\n");
row("E 决议写不进去", await inject.buildMemoryInjectionSafe({ workspace: ws, globalRoot: join(ws, "no-global") }));
process.env.M2D_MEMORY_HOME = goodHome;
store.initMemoryHome(goodHome);
row("F 同一个触发、家目录可写", await inject.buildMemoryInjectionSafe({ workspace: ws, globalRoot: join(ws, "no-global") }));

for (const p of [ws]) rmSync(p, { recursive: true, force: true });
rmSync(blocked, { recursive: true, force: true });
