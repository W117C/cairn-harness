// 阶段 3 · 会话全文检索的判卷（core 套件）。
// 夹具是**真会话日志**：用 `createEventLog` 写出的 JSONL（append-only 的事件流本体），
// 不是手搓的字符串数组——检索读的就是它。
//
// 判的是三件事：①可见语料（用户看得见的正文才进语料）；②按会话聚合（一个会话一条）；
// ③**「没量到 ≠ 没有」**（三态在类型层面分开：ok / partial / unavailable）。
import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeAllEventLogs, createEventLog, type AgentEvent } from "../src/events";
import {
  keywordsOf,
  matchKeywords,
  searchSessions,
  snippetOf,
  visibleTextOf,
  type SessionSearchResult,
} from "../src/main/session-search";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-session-search-"));
});

afterEach(async () => {
  await closeAllEventLogs();
  await rm(root, { recursive: true, force: true });
});

/** 写一条真会话日志（JSONL）。 */
async function writeSession(id: string, events: readonly AgentEvent[]): Promise<string> {
  const path = join(root, id + ".jsonl");
  const log = createEventLog(path);
  for (const event of events) await log.append(event);
  return path;
}

function expectOk(result: SessionSearchResult): Extract<SessionSearchResult, { kind: "ok" }> {
  if (result.kind !== "ok") throw new Error(`期望 ok，实得 ${result.kind}: ${JSON.stringify(result)}`);
  return result;
}

describe("会话全文检索 · 命中与语料口径", () => {
  it("命中的会话进结果、不含该词的会话不进（可见正文）", async () => {
    await writeSession("hit", [
      { type: "session_meta" },
      { type: "user_message", content: "请帮我看看登录失败的问题" },
      { type: "assistant_message", content: "先看日志" },
    ]);
    await writeSession("miss", [
      { type: "session_meta" },
      { type: "user_message", content: "今天天气不错" },
      { type: "assistant_message", content: "嗯" },
    ]);

    const result = expectOk(await searchSessions({ root, query: "登录" }));
    expect(result.matches.map((m) => m.sessionId)).toEqual(["hit"]);
    expect(result.matches[0]!.matchCount).toBe(1);
    expect(result.totalSessions).toBe(2);
    expect(result.scannedSessions).toBe(2);
  });

  it("可见性过滤：只有 thinking_delta 里出现的词不算命中；同样的正文进 assistant_message 就命中", async () => {
    await writeSession("thinking-only", [
      { type: "session_meta" },
      { type: "thinking_delta", callId: "c1", text: "我先想想 紫罗兰 的配色" },
      { type: "user_message", content: "无关内容" },
    ]);
    await writeSession("spoken", [
      { type: "session_meta" },
      { type: "assistant_message", content: "我建议用 紫罗兰 这个颜色" },
    ]);

    const result = expectOk(await searchSessions({ root, query: "紫罗兰" }));
    expect(result.matches.map((m) => m.sessionId)).toEqual(["spoken"]);
  });

  it("可见性过滤：工具载荷 / usage / session_meta 里出现的词不算命中", async () => {
    await writeSession("tool-noise", [
      { type: "session_meta" },
      { type: "user_message", content: "跑一下" },
      { type: "tool_call", id: "t1", name: "read_file", args: { path: "/tmp/紫罗兰.txt" } },
      { type: "tool_result", callId: "t1", ok: true, output: "紫罗兰 的内容" },
      { type: "usage", inputTokens: 1, outputTokens: 1 },
    ]);

    const result = expectOk(await searchSessions({ root, query: "紫罗兰" }));
    expect(result.matches).toEqual([]);
  });

  it("assistant_delta 按 callId 合并：跨两段片段的关键词仍命中，且只算一条消息", async () => {
    await writeSession("streamed", [
      { type: "session_meta" },
      { type: "user_message", content: "打招呼" },
      { type: "assistant_delta", callId: "a1", text: "我们先" },
      { type: "assistant_delta", callId: "a1", text: "看看日志" },
    ]);

    const result = expectOk(await searchSessions({ root, query: "先看看" }));
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.matchCount).toBe(1);
    expect(result.matches[0]!.snippets[0]!.kind).toBe("assistant_delta");
  });

  it("按会话聚合：两个会话都命中 ⇒ 恰好两条结果，各带自己的计数与摘录", async () => {
    await writeSession("alpha", [
      { type: "session_meta" },
      { type: "user_message", content: "橙子很好" },
      { type: "assistant_message", content: "橙子确实不错" },
    ]);
    await writeSession("beta", [
      { type: "session_meta" },
      { type: "user_message", content: "橙子馅的包子" },
    ]);

    const result = expectOk(await searchSessions({ root, query: "橙子" }));
    expect(result.matches).toHaveLength(2);
    const alpha = result.matches.find((m) => m.sessionId === "alpha");
    const beta = result.matches.find((m) => m.sessionId === "beta");
    expect(alpha?.matchCount).toBe(2);
    expect(beta?.matchCount).toBe(1);
    // 聚合面：命中次数与摘录都挂在会话上，不是每条消息一条结果。
    expect(alpha?.snippets.length).toBe(2);
    expect(beta?.snippets.length).toBe(1);
    for (const snippet of [...(alpha?.snippets ?? []), ...(beta?.snippets ?? [])]) {
      expect(snippet.excerpt).toContain("橙子");
    }
  });

  it("关键词 OR：命中任一即算；两个都没有则不命中", async () => {
    await writeSession("one", [
      { type: "session_meta" },
      { type: "user_message", content: "只有苹果" },
    ]);
    await writeSession("none", [
      { type: "session_meta" },
      { type: "user_message", content: "只有香蕉" },
    ]);

    const hit = expectOk(await searchSessions({ root, query: "苹果 梨子" }));
    expect(hit.matches.map((m) => m.sessionId)).toEqual(["one"]);

    const miss = expectOk(await searchSessions({ root, query: "梨子 桃子" }));
    expect(miss.matches).toEqual([]);
  });
});

describe("会话全文检索 · 「没量到 ≠ 没有」", () => {
  it("会话根读不到 ⇒ unavailable（绝不是 ok + 空数组）", async () => {
    const result = await searchSessions({ root: join(root, "not-there"), query: "登录" });
    expect(result.kind).toBe("unavailable");
    if (result.kind !== "unavailable") throw new Error("unreachable");
    expect(result.reason).toBeTruthy();
    expect(result).not.toHaveProperty("matches");
  });

  it("会话根不是目录 ⇒ unavailable", async () => {
    const file = join(root, "plain.txt");
    await writeFile(file, "not a directory", "utf8");
    const result = await searchSessions({ root: file, query: "登录" });
    expect(result.kind).toBe("unavailable");
  });

  it("扫完了但没有命中 ⇒ ok + 空数组（与 unavailable 可区分）", async () => {
    await writeSession("quiet", [
      { type: "session_meta" },
      { type: "user_message", content: "完全无关的内容" },
    ]);

    const result = await searchSessions({ root, query: "登录" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unreachable");
    expect(result.matches).toEqual([]);
    expect(result.scannedSessions).toBe(1);
    expect(result.totalSessions).toBe(1);
  });

  it("字节帽用尽 ⇒ partial（不是 ok），且已扫到的那份命中是真的、必须在结果里", async () => {
    const first = await writeSession("first", [
      { type: "session_meta" },
      { type: "user_message", content: "命中词在这里" },
    ]);
    const second = await writeSession("second", [
      { type: "session_meta" },
      { type: "user_message", content: "命中词也在那里" },
    ]);
    // 扫描顺序是 **mtime 降序**（近的先扫：预算有限时先救近的）⇒ 这里把 mtime 钉死，
    // 让 "first" 确实排在 "second" 前面。不钉 mtime 的话，写盘顺序会决定谁先扫，
    // 那条用例就在断言「文件系统返回顺序」而不是断言「预算怎么切」⇒ 不可复现。
    await utimes(first, new Date(2_000_000_000_000), new Date(2_000_000_000_000));
    await utimes(second, new Date(1_000_000_000_000), new Date(1_000_000_000_000));
    const firstBytes = (await stat(first)).size;

    const result = await searchSessions({ root, query: "命中词", budgetBytes: firstBytes + 8 });
    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") throw new Error("unreachable");
    expect(result.budgetExhaustedAt).toBe("bytes");
    // 已扫完的那份命中是真的、必须在结果里。
    expect(result.matches.map((m) => m.sessionId)).toContain("first");
    // 被切断的那份 id 要点名（它的命中数只是下界）。
    expect(result.truncatedSessions).toContain("second");
  });

  it("预算充足 ⇒ ok（与 partial 可区分）", async () => {
    await writeSession("first", [
      { type: "session_meta" },
      { type: "user_message", content: "命中词在这里" },
    ]);
    await writeSession("second", [
      { type: "session_meta" },
      { type: "user_message", content: "命中词也在那里" },
    ]);

    const result = await searchSessions({ root, query: "命中词", budgetBytes: 1024 * 1024 });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unreachable");
    expect(result.matches).toHaveLength(2);
  });

  it("会话条数帽用尽 ⇒ partial（budgetExhaustedAt = sessions）", async () => {
    await writeSession("a", [{ type: "session_meta" }, { type: "user_message", content: "命中词" }]);
    await writeSession("b", [{ type: "session_meta" }, { type: "user_message", content: "命中词" }]);

    const result = await searchSessions({ root, query: "命中词", maxSessions: 1 });
    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") throw new Error("unreachable");
    expect(result.budgetExhaustedAt).toBe("sessions");
    expect(result.scannedSessions).toBe(1);
    expect(result.totalSessions).toBe(2);
  });
});

describe("会话全文检索 · 纯函数面", () => {
  it("keywordsOf：空白分词 + 引号短语", () => {
    expect(keywordsOf("苹果 梨子")).toEqual(["苹果", "梨子"]);
    expect(keywordsOf('苹果 "红富士"')).toEqual(["苹果", "红富士"]);
    expect(keywordsOf("  ")).toEqual([]);
  });

  it("visibleTextOf：只投影可见语料，delta 按 callId 合并", () => {
    const messages = visibleTextOf([
      { type: "user_message", content: "问" },
      { type: "thinking_delta", callId: "c1", text: "想" },
      { type: "assistant_delta", callId: "a1", text: "答" },
      { type: "assistant_delta", callId: "a1", text: "案" },
      { type: "tool_call", id: "t", name: "read_file", args: {} },
    ]);
    expect(messages).toEqual([
      { kind: "user_message", text: "问" },
      { kind: "assistant_delta", text: "答案" },
    ]);
  });

  it("matchKeywords 大小写不敏感；snippetOf 摘录里必须看得见命中词", () => {
    expect(matchKeywords("Hello World", ["hello"])).toEqual(["hello"]);
    expect(matchKeywords("Hello World", ["nope"])).toEqual([]);
    const excerpt = snippetOf("前面的铺垫文字".repeat(20) + "紫罗兰" + "后面的尾巴".repeat(20), "紫罗兰");
    expect(excerpt).toContain("紫罗兰");
    expect(excerpt.length).toBeLessThanOrEqual(242);
  });
});
