// 第 316 页：一份坏 lesson 文件名，该丢的是那一份，不是整段记忆。
//
// 第 315 页把"断掉了却没人知道"修成降级可见；这一笔修的是它前面那一半——
// `lessonsSection` 从前是 `topics.slice(0, limit)` 之后才逐条 `readTopicBody`，
// 而那份读不动的**只是名字不合 topic 规矩**（`validateTopic` 抛 MemoryError）。
// 于是盘上一个 `lesson-中文命名.md` 能让整段 LESSONS 与同批的合规教训一起消失，
// 并且**占掉 `limit` 的一个槽位**（先切后筛 ⇒ 最近 N 条里天然少一条）。
// 隔离之后，"整次注入断掉"仍然存在，只是触发点换了（见 `memory-degradation.test.ts`）。
//
// 判的两半：⑴ 逐份隔离的行为（真盘、真触发）；⑵ 尺本身（纯函数对全部输入不区分 ⇒ 没有观测者）。
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  LESSON_SKIP_NAME_MAX_CHARS, LESSON_SKIP_NOTE_MAX_NAMES, buildMemoryInjectionSafe,
  lessonSkipNote, splitLessonCandidates,
} from "../src/agent/memory/inject";
import { globalMemoryDir, initMemoryHome, isCompliantTopic, projectMemoryDir, validateTopic, writeTopic } from "../src/agent/memory/store";
import { EVIDENCE_LINE_PREFIX } from "../src/agent/memory/lessons";
import { buildWorkerSystemMessages } from "../src/agent/worker-prompt";
import { buildSidechatContext } from "../src/agent/sidechat";

// 全局记忆目录在本文件里改到临时盘：注入器对「工作区外 @引用」会走**生产默认**决议落账
// （`saveExternalRefDecision` 真写盘），不重定向就会把这些测试的决议写进用户真正的全局目录。
let prevEnvHome: string | undefined;
let prevHomeDir: string;
const scratch = mkdtempSync(join(tmpdir(), "memiso-home-"));
beforeAll(() => {
  prevEnvHome = process.env.M2D_MEMORY_HOME;
  prevHomeDir = globalMemoryDir();
  process.env.M2D_MEMORY_HOME = join(scratch, "ok");
  initMemoryHome(join(scratch, "ok"));
});
afterAll(() => {
  if (prevEnvHome === undefined) delete process.env.M2D_MEMORY_HOME;
  else process.env.M2D_MEMORY_HOME = prevEnvHome;
  initMemoryHome(prevHomeDir);
  rmSync(scratch, { recursive: true, force: true });
});

const lessonBody = (n: string): string => "教训正文 " + n + "\n" + EVIDENCE_LINE_PREFIX + " session s1 / callId c1\n";
const dayAt = (n: number): string => new Date(Date.UTC(2026, 9, 10 - n)).toISOString();

/** 合规那些走真 `writeTopic`（frontmatter 往返形状不由我手抄）；坏名字只能手写文件名——
 *  写入口自己就拒这种名字，这正是这个触发点的来历（也是它为什么一直没被人看见）。 */
async function workspaceWith(goods: { topic: string; day: number }[], bads: string[]): Promise<string> {
  const workspace = mkdtempSync(join(tmpdir(), "memiso-"));
  const memdir = projectMemoryDir(workspace);
  mkdirSync(memdir, { recursive: true });
  writeFileSync(join(memdir, "MEMORY.md"), "# Memory Index\n");
  for (const g of goods) await writeTopic(memdir, g.topic, "feedback", lessonBody(g.topic), dayAt(g.day));
  for (const b of bads) writeFileSync(join(memdir, b),
    "---\ntype: feedback\nmodified: 2026-12-01T00:00:00.000Z\n---\n\n" + lessonBody(b));
  track(workspace);
  return workspace;
}
const live: string[] = [];
const track = (p: string): void => { live.push(p); };
afterAll(() => { for (const p of live) rmSync(p, { recursive: true, force: true }); });

const inject = (workspace: string, lessonsLimit?: number) =>
  buildMemoryInjectionSafe({ workspace, globalRoot: join(workspace, "no-global"), lessonsLimit });
/** LESSONS 抬头之后、`chars_current=` 之前才是这一段的内容。 */
function lessonsBlock(project: string | null): { header: string; lessons: string[]; notes: string[] } {
  const all = (project ?? "").split("\n");
  const at = all.findIndex((l) => l.includes("[LESSONS 最近"));
  if (at < 0) return { header: "", lessons: [], notes: [] };
  const body: string[] = [];
  for (let i = at + 1; i < all.length; i++) {
    if (all[i]!.startsWith("chars_current=")) break;
    body.push(all[i]!);
  }
  return {
    header: all[at]!,
    lessons: body.filter((l) => l.startsWith("- ")),
    notes: body.filter((l) => l.startsWith("[lessons]")),
  };
}

describe("教训段的逐份隔离：一份坏文件只丢那一份（第 316 页）", () => {
  it("真触发：一份坏名字 ＋ 三条好教训 ⇒ 好教训全在、unavailable 为 null，点名行说出那一份坏文件", async () => {
    const workspace = await workspaceWith(
      [{ topic: "lesson-a", day: 1 }, { topic: "lesson-b", day: 2 }, { topic: "lesson-c", day: 3 }],
      ["lesson-中文命名.md"]);
    const r = await inject(workspace);
    expect(r.unavailable, "一份坏文件仍让整段抛 ⇒ 第 315 页那句『不可用』被当成了替代品").toBeNull();
    const blk = lessonsBlock(r.injection.project);
    expect(blk.lessons.length).toBe(3);
    expect(blk.notes.length, "被跳过的那一份没人名＝无痕丢数据换了个位置").toBe(1);
    expect(blk.notes[0]).toContain("lesson-中文命名");
    // 抬头那句「最近 N 条」数的是**真教训**：把点名行算进去，就是这句承诺自己先说错数。
    expect(blk.header).toContain("[LESSONS 最近 3 条");
  });

  it("槽位：坏文件排在最新（modified 最大）时也不许吃掉 limit 的槽位 ⇒ limit=3 仍交回三条好教训", async () => {
    const workspace = await workspaceWith(
      [{ topic: "lesson-a", day: 1 }, { topic: "lesson-b", day: 2 }, { topic: "lesson-c", day: 3 }, { topic: "lesson-d", day: 4 }],
      ["lesson-坏 名字.md"]);
    const blk = lessonsBlock((await inject(workspace, 3)).injection.project);
    expect(blk.lessons.length, "先切后筛＝一份读不动的文件占掉一个槽位（最近 N 条少一条，读数看不出来）").toBe(3);
    expect(blk.notes[0]).toContain("有 1 个");
  });

  it("整批只有坏名字 ⇒ 段还在、条数 0、点名行说话（旧写法在这里整段返回 null）", async () => {
    const workspace = await workspaceWith([],
      ["lesson-一.md", "lesson-二.md", "lesson-三.md", "lesson-四.md"]);
    const r = await inject(workspace);
    expect(r.unavailable).toBeNull();
    const blk = lessonsBlock(r.injection.project);
    expect(blk.header).toContain("[LESSONS 最近 0 条");
    expect(blk.lessons.length).toBe(0);
    // K 必须是真总数：只点前 3 个名字，但"有 4 个"这句不许缩成 3。
    expect(blk.notes[0]).toContain("有 4 个");
    expect((blk.notes[0].match(/lesson-/gu) ?? []).length).toBe(LESSON_SKIP_NOTE_MAX_NAMES);
  });

  it("反向对照：全合规那批一个字都不许多——没有点名行，三个消费者也不许说『记忆注入不可用』", async () => {
    const workspace = await workspaceWith([{ topic: "lesson-a", day: 1 }], []);
    const r = await inject(workspace);
    expect(r.unavailable).toBeNull();
    const blk = lessonsBlock(r.injection.project);
    expect(blk.notes.length).toBe(0);
    expect(blk.lessons.length).toBe(1);

    // 隔离之后，"坏文件"不再是降级态 ⇒ 消费者要是还照旧报『不可用』，就是**过报**：
    // 一句假话把模型支去怀疑自己的经验，代价不比当初那句真话小。
    const workerMsgs = await buildWorkerSystemMessages({ task: "t", context: { files: [] } }, workspace);
    expect(workerMsgs.map((m) => m.content ?? "").join("\n")).not.toContain("本次记忆注入不可用");
    const sidechat = await buildSidechatContext({
      sidechatLogPath: join(workspace, "s.jsonl"), mainLogPath: join(workspace, "m.jsonl"), workspace,
    });
    expect(sidechat.messages.map((m) => m.content ?? "").join("\n")).not.toContain("本次记忆注入不可用");
  });

  it("点名有帽：名字里的空白折成单空格、每条截到帽内，整行长度有上限（文件名是外界文本）", async () => {
    const nasty = "lesson-" + "长".repeat(200) + ".md";
    const workspace = await workspaceWith([], [nasty, "lesson-带 空 格.md", "lesson-换\n行.md"]);
    const note = lessonsBlock((await inject(workspace)).injection.project).notes[0] ?? "";
    expect(note.split("\n").length, "名字里的换行把一行点名撑成多行＝块里的行结构被文件名改掉了").toBe(1);
    expect(note).not.toMatch(/[ \t]{2,}/u);
    expect(note.length).toBeLessThan(400);
    expect(note).toContain("有 3 个");
    // 帽真的落下去了（不是"整条丢掉"，也不是"原样带出 200 字"）：帽内那一截还在，帽外那一截不许出现。
    expect(note).toContain("长".repeat(LESSON_SKIP_NAME_MAX_CHARS - 7));
    expect(note).not.toContain("长".repeat(LESSON_SKIP_NAME_MAX_CHARS + 1));
  });

  it("纯函数·分辨力：canRead 恒真与恒假必须给出**不同**答案，且 limit 作用在筛之后（假表，不碰盘）", () => {
    const topics = [{ topic: "lesson-zzz" }, { topic: "中文" }, { topic: "lesson-aaa" }, { topic: "带 空格" }, { topic: "lesson-mmm" }];
    const allIn = splitLessonCandidates(topics, 2, () => true);
    const allOut = splitLessonCandidates(topics, 2, () => false);
    expect(allIn.skipped.length, "恒真时 skipped 必须为空——非空＝谓词没参与判定").toBe(0);
    expect(allIn.keep.map((t) => t.topic)).toEqual(["lesson-zzz", "中文"]);
    expect(allOut.keep.length, "恒假时一条都不该留下").toBe(0);
    expect(allOut.skipped).toEqual(topics.map((t) => t.topic));
    // 顺序钉死：坏名字在索引 0 时，先切后筛会把它算进 limit ⇒ 第五条被挤掉。
    const afterFilter = splitLessonCandidates(topics, 3, (name) => !name.includes("中文") && !name.includes("空格"));
    expect(afterFilter.keep.map((t) => t.topic)).toEqual(["lesson-zzz", "lesson-aaa", "lesson-mmm"]);
    expect(afterFilter.skipped).toEqual(["中文", "带 空格"]);
    expect(splitLessonCandidates(topics, 0, () => true).keep.length).toBe(0);
    expect(splitLessonCandidates(topics, -1, () => true).keep.length, "负 limit 不许退化成『全给』").toBe(0);
  });

  it("同一个决策点：topic 谓词与 validateTopic 的抛出对同一批输入必须同答（注入器筛的就是谓词，抄两份迟早漂）", () => {
    const cases = ["lesson-good", "a", "-", "-a", "中文", "带 空格", "with/slash", "l".repeat(64), "l".repeat(65), "", "a.b"];
    for (const c of cases) {
      let threw = false;
      try {
        validateTopic(c);
      } catch {
        threw = true;
      }
      expect(isCompliantTopic(c), c + "：谓词与抛出说了两套话（注入器筛的就是谓词）").toBe(!threw);
    }
  });

  it("跳过为 0 ⇒ 点名行是 null（缺省零行为；恒返回一句话＝每轮都往块里塞一句假话）", () => {
    expect(lessonSkipNote([])).toBeNull();
    expect(lessonSkipNote(["x"]) ?? "").toContain("有 1 个");
  });
});
