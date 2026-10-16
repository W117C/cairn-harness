// M6 · 跨会话教训的判卷。核心是路线图点名的那条硬要求：**教训必须带证据指针，
// 不许凭空总结**。所以判卷的重心不在「提炼得准」，而在「**造不出证据就产不出条目**」。
//
// 分组：
//   B 无证据不产出 —— 核心验收 + 反向验证的落点。
//   A 三类来源各提炼出条目，且出处逐字可核。
//   C 环境红不进教训（沿用 distill.ts 的既有裁决）。
//   D 落盘真走 writeTopic（往返 + 索引行 + frontmatter）。
//   E 回注限量且带出处；无出处的条目**不会**被注入。
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EVIDENCE_LINE_PREFIX,
  LESSON_TOPIC_PREFIX,
  REPEAT_ACTION_MIN,
  TOOL_STREAK_MIN,
  distillLessons,
  lessonLine,
  parseLessonDigest,
  sessionOf,
} from "../src/agent/memory/lessons";
import { runSessionEndDistill, writeLessons } from "../src/agent/memory/distill";
import { buildMemoryInjection, LESSONS_RECENT_DEFAULT } from "../src/agent/memory/inject";
import { projectMemoryDir, readTopicBody, writeTopic, parseTopicDoc } from "../src/agent/memory/store";
import type { AgentEvent, ToolCallEvent, ToolResultEvent, VerifyResultEvent } from "../src/events";
import { readFile } from "node:fs/promises";

let dir = "";
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ""; });

async function ws(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "memory-lessons-"));
  return dir;
}

const LOG = "/logs/sess-2026-10-01-abc.jsonl";

// ---- 轨迹构件 ----
function toolCall(id: string, name: string, args: unknown = {}): ToolCallEvent {
  return { type: "tool_call", id, name, args: args as Record<string, unknown> };
}
function toolFail(id: string, output = "ENOENT: no such file"): ToolResultEvent {
  return { type: "tool_result", callId: id, ok: false, output };
}
function toolOk(id: string, output = "ok"): ToolResultEvent {
  return { type: "tool_result", callId: id, ok: true, output };
}
function verifyRed(callId: string, opts: { cause?: VerifyResultEvent["cause"]; attempt?: number; maxAttempts?: number; out?: string } = {}): VerifyResultEvent {
  return {
    type: "verify_result",
    callId,
    ok: false,
    attempt: opts.attempt ?? 1,
    maxAttempts: opts.maxAttempts ?? 3,
    results: [{ command: "pnpm test", ok: false, output: opts.out ?? "FAIL 2 tests, expected 3 got 2", ...(opts.cause === undefined ? {} : { cause: opts.cause }) }],
    ...(opts.cause === undefined ? {} : { cause: opts.cause }),
  };
}

describe("M6 · B 核心：无证据指针 ⇒ 零条目（反向验证落点）", () => {
  it("空轨迹 ⇒ 零条目（不是一条空教训）", () => {
    expect(distillLessons([], LOG)).toEqual([]);
  });

  it("**取不出会话名 ⇒ 零条目**（证据指针要求指得出哪条会话；不是先产出再过滤）", () => {
    const ev: AgentEvent[] = [verifyRed("c1"), ...toolResultEcho("c1")];
    // 无扩展名、名为空、只有目录 —— 三种都取不出「哪条会话」。
    expect(sessionOf("")).toBe("");
    expect(sessionOf("/logs/")).toBe("");
    expect(distillLessons(ev, "")).toEqual([]);
    // 对照：同一条轨迹，换个能取出会话名的路径就产出 —— 说明变的是会话名，不是别的。
    expect(distillLessons(ev, LOG).length).toBeGreaterThan(0);
  });

  it("**事件不带 callId ⇒ 该来源零条目**（三类各测一次）", () => {
    // ① 验证红：无 callId（连 session 都还在——正是"证据指针造不出就不产出"该拦住的情形）
    const noCallId: AgentEvent = { ...verifyRed(""), ok: false } as VerifyResultEvent;
    expect(distillLessons([noCallId], LOG).filter((l) => l.topic.includes("verify-red"))).toEqual([]);
    // ② 工具连败：无 callId 的 tool_result
    expect(distillLessons([toolFail(""), toolFail("")], LOG)
      .filter((l) => l.topic.includes("tool-streak"))).toEqual([]);
    // ③ 重复动作：无 id 的 tool_call
    const noId = { type: "tool_call", name: "read_file", args: { path: "a" } } as unknown as ToolCallEvent;
    expect(distillLessons([noId, noId], LOG)
      .filter((l) => l.topic.includes("repeat-action"))).toEqual([]);
  });

  it("**tool_result 查不到归属工具 ⇒ 零条目**（不记成 unknown：那是噪音不是教训）", () => {
    // 有 callId 但没有配套 tool_call ⇒ 指不出是哪个工具失败 ⇒ 无从学。
    expect(distillLessons([toolFail("orphan-1"), toolFail("orphan-2")], LOG)
      .filter((l) => l.topic.includes("tool-streak"))).toEqual([]);
  });

  it("产出的每一条都自带 evidence 指针，且 pointer 里逐字含会话与 callId", () => {
    const ls = distillLessons([verifyRed("c7"), ...toolResultEcho("c7")], LOG);
    expect(ls.length).toBeGreaterThan(0);
    for (const l of ls) {
      expect(l.evidence.length).toBeGreaterThan(0);
      for (const ev of l.evidence) {
        expect(ev.session).toBe(sessionOf(LOG));
        expect(ev.callId).not.toBe("");
      }
      // 指针在**正文里**也逐字可见（不是只活在结构体里、模型看不见）。
      expect(l.body).toContain(EVIDENCE_LINE_PREFIX);
      expect(l.body).toContain("sess-2026-10-01-abc#c7");
    }
  });
});

/** verify 一拍在事件流里的完整回声：verify_result + 两声 tool_result（loop 会发三声，这里给两声即可）。 */
function toolResultEcho(callId: string): ToolResultEvent[] {
  return [
    { type: "tool_result", callId, ok: false, output: "[verify FAIL] pnpm test" },
    { type: "tool_result", callId, ok: false, output: "2 tests failed" },
  ];
}

describe("M6 · A 三类来源各成一条", () => {
  it("① 验证红（含失败原文摘录 + 出处）", () => {
    const ls = distillLessons([verifyRed("c1", { out: "FAIL src/a.test.ts\nExpected 3, got 2" })], LOG);
    const l = ls.find((x) => x.topic === "lesson-verify-red-1");
    expect(l).toBeDefined();
    expect(l!.body).toContain("pnpm test");
    expect(l!.body).toContain("Expected 3, got 2"); // 原文摘录在
    expect(l!.body).toContain("evidence-line:[验证红] sess-2026-10-01-abc#c1");
  });

  it("② 同一工具连败 N 次成一条，指针逐条列名；单次失败不成条", () => {
    const ev: AgentEvent[] = [
      toolCall("t1", "write_file", { path: "a" }), toolFail("t1"),
      toolCall("t2", "write_file", { path: "b" }), toolFail("t2"),
      toolCall("t3", "write_file", { path: "c" }), toolFail("t3"),
    ];
    const l = distillLessons(ev, LOG).find((x) => x.topic === "lesson-tool-streak-write_file");
    expect(l).toBeDefined();
    expect(l!.evidence).toHaveLength(3);
    expect(l!.body).toContain("连败 3 次");
    expect(l!.body).toContain("#t1 / ");
    expect(l!.body).toContain("#t2 / ");
    expect(l!.body).toMatch(/#t3\s*$/mu);
    // 阈值本身钉住：只失败一次不成条（偶发 ≠ 模式）。
    expect(TOOL_STREAK_MIN).toBe(2);
    expect(distillLessons([toolCall("t1", "write_file"), toolFail("t1")], LOG)
      .filter((x) => x.topic.includes("tool-streak"))).toEqual([]);
  });

  it("③ 写向动作的完全相同参数重复调用成条；推进式（参数不同）不算", () => {
    const same: AgentEvent[] = [
      toolCall("w1", "write_file", { path: "src/a.ts", content: "x" }), toolOk("w1"),
      toolCall("w2", "write_file", { path: "src/a.ts", content: "x" }), toolOk("w2"),
    ];
    const l = distillLessons(same, LOG).find((x) => x.topic === "lesson-repeat-action-1");
    expect(l).toBeDefined();
    expect(l!.body).toContain("完全相同的参数");
    expect(REPEAT_ACTION_MIN).toBe(2);
    // 推进式（参数不同）不是重复动作。
    const progressing: AgentEvent[] = [
      toolCall("w1", "edit_file", { path: "src/a.ts" }), toolOk("w1"),
      toolCall("w2", "edit_file", { path: "src/b.ts" }), toolOk("w2"),
    ];
    expect(distillLessons(progressing, LOG).filter((x) => x.topic.includes("repeat-action"))).toEqual([]);
  });

  it("**同一动作重复读同一文件不成条**（re-read 是正常确认动作，写成教训就是噪音）", () => {
    // 这条判据来自实测：对 tracked 的 20 份日志离线提炼，未收窄前 40 条里 35 条全是
    // `read_file` 读同一文件。判据收窄后同批日志降到 10 条。
    const reread: AgentEvent[] = [
      toolCall("r1", "read_file", { path: "src/a.ts" }), toolOk("r1"),
      toolCall("r2", "read_file", { path: "src/a.ts" }), toolOk("r2"),
      toolCall("r3", "read_file", { path: "src/a.ts" }), toolOk("r3"),
    ];
    expect(distillLessons(reread, LOG).filter((x) => x.topic.includes("repeat-action"))).toEqual([]);
    // 对照：同样的「同参数重复」，换成写向工具就成条 —— 变的只是写向与否。
    const rewrite: AgentEvent[] = [
      toolCall("w1", "write_file", { path: "src/a.ts", content: "x" }), toolOk("w1"),
      toolCall("w2", "write_file", { path: "src/a.ts", content: "x" }), toolOk("w2"),
    ];
    expect(distillLessons(rewrite, LOG).filter((x) => x.topic.includes("repeat-action"))).toHaveLength(1);
  });

  it("verify 那一拍的回声**不被数成工具连败**（同一 callId 不重复计数）", () => {
    // 一拍验证红 = 1 条 verify 教训，不是 1+2 条「verify 连败 3 次」。
    const ls = distillLessons([verifyRed("c1"), ...toolResultEcho("c1")], LOG);
    expect(ls.filter((l) => l.topic.includes("tool-streak"))).toEqual([]);
    expect(ls.filter((l) => l.topic.includes("verify-red"))).toHaveLength(1);
  });
});

describe("M6 · C 环境红不进教训（沿用 distill.ts 既有裁决）", () => {
  const ENVS: NonNullable<VerifyResultEvent["cause"]>[] = [
    "timeout", "toolchain-missing", "no-surface", "hook-error", "pkg-manager", "not-run",
  ];
  it("六类环境归因逐个不进；同为红的 code 进", () => {
    for (const c of ENVS) {
      const ls = distillLessons([verifyRed("c-" + c, { cause: c })], LOG);
      expect(ls.filter((l) => l.topic.includes("verify-red")), `${c} 不该成条`).toEqual([]);
    }
    expect(distillLessons([verifyRed("c-code", { cause: "code" })], LOG)
      .filter((l) => l.topic.includes("verify-red"))).toHaveLength(1);
    // 无 cause 的红（老会话流）按 code 处理 —— 不是"取不到就当环境"（那会让老会话静默无教训）。
    expect(distillLessons([verifyRed("c-none")], LOG).filter((l) => l.topic.includes("verify-red"))).toHaveLength(1);
  });
  it("环境红那一拍的 tool_result 回声也不被算成工具连败", () => {
    const ls = distillLessons([verifyRed("c1", { cause: "timeout" }), ...toolResultEcho("c1")], LOG);
    expect(ls.filter((l) => l.topic.includes("tool-streak"))).toEqual([]);
  });
});

describe("M6 · D 落盘走 writeTopic（真写盘往返）", () => {
  it("提炼 → 写Lessons → 索引行/frontmatter/正文逐项可核", async () => {
    const workspace = await ws();
    const events: AgentEvent[] = [verifyRed("c1"), toolCall("t1", "write_file", { p: 1 }), toolFail("t1")];
    const emitted: AgentEvent[] = [];
    const r = await writeLessons({ events, logPath: LOG, workspace, emit: (e) => { emitted.push(e); return Promise.resolve(); } });
    expect(r.written.length).toBeGreaterThan(0);
    expect(r.failed).toEqual([]);
    // 写盘成功不产生失败事件（fail-visible 的反面：成功是静默的）。
    expect(emitted.filter((e) => e.type === "tool_result")).toEqual([]);

    const pmd = projectMemoryDir(workspace);
    const topic = r.written[0]!;
    expect(topic.startsWith(LESSON_TOPIC_PREFIX)).toBe(true);
    const raw = await readFile(join(pmd, topic + ".md"), "utf8");
    const { meta, body } = parseTopicDoc(raw);
    expect(meta.type).toBe("feedback");
    expect(body).toContain(EVIDENCE_LINE_PREFIX);
    // 索引行在（注入侧与面板靠它认条目）。
    const idx = await readFile(join(pmd, "MEMORY.md"), "utf8");
    expect(idx).toContain("- " + topic + " · feedback ·");
  });

  it("写入失败（索引超上限）不连累沉淀结局，且留痕（fail-visible）", async () => {
    const workspace = await ws();
    const pmd = projectMemoryDir(workspace);
    await mkdir(pmd, { recursive: true });
    // 先把索引塞满到硬上限（200 行），使 writeTopic 的 index_overflow 必然触发。
    const filler = Array.from({ length: 200 }, (_, i) => "- filler-" + String(i) + " · project · 2026-01-01 · x").join("\n") + "\n";
    await writeFile(join(pmd, "MEMORY.md"), filler, "utf8");

    const emitted: AgentEvent[] = [];
    const r = await writeLessons({
      events: [verifyRed("c1")], logPath: LOG, workspace,
      emit: (e) => { emitted.push(e); return Promise.resolve(); },
    });
    expect(r.written).toEqual([]);
    expect(r.failed.length).toBeGreaterThan(0);
    expect(emitted.filter((e) => e.type === "tool_result" && !e.ok).length).toBeGreaterThan(0); // 留痕
  });

  it("runSessionEndDistill：enabled=false ⇒ 一条都不写、一次 provider 都不调", async () => {
    const workspace = await ws();
    let streams = 0;
    const r = await runSessionEndDistill({
      enabled: false,
      logPath: LOG, workspace,
      provider: { async *stream() { streams += 1; } },
      rememberTool: { name: "remember", description: "", schema: {} } as never,
      emit: () => Promise.resolve(),
    });
    expect(r).toEqual({ kind: "disabled" });
    expect(streams).toBe(0);
    expect(await readTopicBody(projectMemoryDir(workspace), "lesson-verify-red-1")).toBeNull();
  });
});

describe("M6 · E 回注：限量、带出处、无出处不注入", () => {
  const GLOBAL = () => mkdtemp(join(tmpdir(), "memory-lessons-global-"));

  it("有出处的教训按 modified 倒序注入，且每行逐字含出处", async () => {
    const workspace = await ws();
    const g = await GLOBAL();
    const pmd = projectMemoryDir(workspace);
    // 三条教训，倒序写入（最后写的 modified 最新 ⇒ 应排最前）。
    for (const [i, id] of ["c1", "c2", "c3"].entries()) {
      const ls = distillLessons([verifyRed(id)], LOG);
      await writeTopic(pmd, "lesson-verify-red-" + String(i + 1), "feedback", ls[0]!.body, new Date(2026, 0, 1 + i).toISOString());
    }
    const inj = await buildMemoryInjection({ workspace, globalRoot: g });
    const sec = inj.project!.split("\n").filter((l) => l.includes("证据:"));
    expect(sec).toHaveLength(3);
    expect(sec[0]).toContain("#c3"); // 最新在最前
    expect(sec[2]).toContain("#c1");
    expect(inj.project).toContain("[LESSONS 最近 3 条");
  });

  it("**无证据指针的教训正文不会被注入**（与 lessons 侧「无证据不写盘」同一道门）", async () => {
    const workspace = await ws();
    const g = await GLOBAL();
    // 手写一条**没有 evidence-line** 的条目（模拟判据被绕过/老数据）。抬头与正文用两段
    // 不同字面量：索引行取的是**首行**（store.indexLine），教训正文取的是解析结果，两条断言各扣各的。
    await writeTopic(projectMemoryDir(workspace), "lesson-forged-1", "feedback",
      "编出来的教训抬头\n编出来的教训正文：这里什么都没有", new Date().toISOString());
    const inj = await buildMemoryInjection({ workspace, globalRoot: g });
    // 只针对**教训正文那一行**：索引行是既有 §8.1.5 固定回注名单的一环，它照常注入
    // （否则这条断言就是在要求削弱既有机制，而不是在验 M6 的门）。
    const lessonLines = (inj.project ?? "").split("\n").filter((l) => l.startsWith("- ") && l.includes("证据:"));
    expect(lessonLines).toEqual([]);
    expect(inj.project ?? "").toContain("编出来的教训抬头"); // 索引行照常（既有机制未被动）
    expect(inj.project ?? "").not.toContain("编出来的教训正文"); // 教训正文没进来
    // 解析器本身也返回 null（注入侧不靠"正文里没有"这种巧合过滤）。
    expect(parseLessonDigest("编出来的教训抬头\n编出来的教训正文：这里什么都没有")).toBeNull();
  });

  // 第 312 页：`evidence-line:` **在而行内为空**是上面那支的兄弟支，此前没人判。
  // 修之前它一路走到 `lessonLine` 才抛，而三个生产调用点（session-provider / sidechat / worker-prompt）
  // 都把注入异常**静默吞掉** ⇒ 一句坏数据让整段跨会话教训消失，且没有任何人知道。
  it("指针行在、内容为空 ⇒ 与「没有那行」走同一道门（不合格，不是半合格）", () => {
    expect(parseLessonDigest("空指针抬头\nevidence-line:")).toBeNull();
    expect(parseLessonDigest("空指针抬头\nevidence-line:    \n")).toBeNull();
    // 反向一侧（规则 60）：正常指针照常合格，别把"收紧"做成"什么都不收"。
    const ok = parseLessonDigest("好抬头\nevidence-line:[验证红] sess-x#c1");
    expect(ok).not.toBeNull();
    expect(ok!.evidence).toBe("[验证红] sess-x#c1");
  });

  it("一条坏数据不许吃掉整段 LESSONS（注入侧那句「无出处的条目不会出现在这里」的真正内容）", async () => {
    const workspace = await ws();
    const g = await GLOBAL();
    const iso = new Date().toISOString();
    await writeTopic(projectMemoryDir(workspace), "lesson-good-1", "feedback",
      "合格教训抬头\nevidence-line:[验证红] sess-good#c1", iso);
    await writeTopic(projectMemoryDir(workspace), "lesson-empty-1", "feedback",
      "空指针教训抬头\nevidence-line:", iso);
    let inj;
    try {
      inj = await buildMemoryInjection({ workspace, globalRoot: g });
    } catch (e) {
      throw new Error("整段 LESSONS 被一条空指针炸掉了（调用点还会静默吞掉它）：" + String((e as Error).message));
    }
    const lessonLines = (inj.project ?? "").split("\n").filter((l) => l.startsWith("- ") && l.includes("证据:"));
    // 合格那条连同指针逐字可见（正控：证明"没炸"不是因为"整段都没了"）。
    expect(lessonLines, JSON.stringify(lessonLines)).toEqual(["- 合格教训抬头　〔证据: [验证红] sess-good#c1〕"]);
    // 不合格那条**不占一行**，也不留下 `〔证据: 〕` 这种半截形状。
    expect(inj.project ?? "").not.toContain("〔证据: 〕");
    expect(inj.project ?? "").not.toContain("空指针教训抬头　");
    // 抬头自己要说得出交了几条：段里几行就写几条（"最近 N 条"不许是候选数或心里想的数）。
    const header = ((inj.project ?? "").split("\n").find((l) => l.includes("[LESSONS 最近")) ?? "");
    expect(header, header).toContain("最近 " + String(lessonLines.length) + " 条");
  });

  it("lessonLine 遇到空出处抛错，不静默降级成一条无出处的行", () => {
    expect(() => lessonLine("t", { headline: "x", evidence: "", session: "s" })).toThrow(/证据/u);
    expect(lessonLine("t", { headline: "x", evidence: "[验证红] s#c1", session: "s" })).toContain("#c1");
  });

  it("回注入量受 lessonsLimit 约束（限量可配，不是全量注入）", async () => {
    const workspace = await ws();
    const g = await GLOBAL();
    const pmd = projectMemoryDir(workspace);
    const ls = distillLessons([verifyRed("c1")], LOG);
    for (let i = 0; i < 5; i++) {
      await writeTopic(pmd, "lesson-verify-red-" + String(i + 1), "feedback", ls[0]!.body, new Date(2026, 0, 1 + i).toISOString());
    }
    const full = await buildMemoryInjection({ workspace, globalRoot: g });
    expect(full.project!.split("\n").filter((l) => l.includes("证据:")).length).toBe(5);
    const capped = await buildMemoryInjection({ workspace, globalRoot: g, lessonsLimit: 2 });
    expect(capped.project!.split("\n").filter((l) => l.includes("证据:")).length).toBe(2);
    expect(LESSONS_RECENT_DEFAULT).toBe(10);
  });

  it("回注总量仍受既有 token 预算治理（教训段不绕过预算闸）", async () => {
    const workspace = await ws();
    const g = await GLOBAL();
    const pmd = projectMemoryDir(workspace);
    const ls = distillLessons([verifyRed("c1")], LOG);
    // 每条正文都很大 —— 若教训段绕过预算，这里会撑爆。
    const big = ls[0]!.body + "\n" + "x".repeat(3000);
    for (let i = 0; i < 20; i++) {
      await writeTopic(pmd, "lesson-verify-red-" + String(i), "feedback", big, new Date(2026, 0, 1 + i).toISOString());
    }
    const inj = await buildMemoryInjection({ workspace, globalRoot: g, tokenBudget: 200 });
    expect(inj.tokens).toBeLessThanOrEqual(200);
    expect(inj.truncated).toBe(true);
  });
});
