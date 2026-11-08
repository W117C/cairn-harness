// session-search-check —— 会话全文检索的运行期验收（2026-10-22 · 阶段 3）。
// 与 fork-check 同式：真建夹具会话日志（JSONL）→ 真调 `searchSessions` → 逐条断言。
// 判的是**三态**（ok / partial / unavailable）——「没量到 ≠ 没有」是本门的主要判据。
// 任一断言失败 → 退出码非 0。
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAllEventLogs, createEventLog, type AgentEvent } from "../src/events";
import { searchSessions, type SessionSearchResult } from "../src/main/session-search";

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log("  ✅ " + label);
  } else {
    failures++;
    console.error("  ❌ " + label);
  }
}

const dir = await mkdtemp(join(tmpdir(), "dsh-session-search-check-"));

async function writeSession(id: string, events: readonly AgentEvent[]): Promise<string> {
  const path = join(dir, id + ".jsonl");
  const log = createEventLog(path);
  for (const event of events) await log.append(event);
  return path;
}

try {
  // 夹具：三个真会话日志。
  //  hit：正文含「紫罗兰」；miss：正文不含；hidden：只在 thinking_delta（模型私有思考）里出现。
  await writeSession("hit", [
    { type: "session_meta" },
    { type: "user_message", content: "帮我把 紫罗兰 主题调亮一点" },
    { type: "assistant_message", content: "已经调好了" },
  ]);
  await writeSession("miss", [
    { type: "session_meta" },
    { type: "user_message", content: "今天天气不错" },
  ]);
  await writeSession("hidden", [
    { type: "session_meta" },
    { type: "thinking_delta", callId: "c1", text: "内部想想 紫罗兰 的配色" },
  ]);
  console.log("[session-search-check] 夹具 3 份真会话日志 @ " + dir);

  // ① 命中 / 不命中
  const hit = await searchSessions({ root: dir, query: "紫罗兰" });
  assert(hit.kind === "ok", "查询根目录 ⇒ kind=ok");
  if (hit.kind !== "ok") throw new Error("unreachable");
  assert(
    hit.matches.map((m) => m.sessionId).join(",") === "hit",
    "命中会话 = hit（不命中/不存在的会话都不在结果里）",
  );
  assert(hit.matches[0]?.matchCount === 1, "命中消息计数 = 1");
  assert((hit.matches[0]?.snippets[0]?.excerpt ?? "").includes("紫罗兰"), "摘录里看得见命中词");

  // ② 可见性过滤：thinking_delta 里的词不算命中
  assert(
    !hit.matches.some((m) => m.sessionId === "hidden"),
    "可见性过滤：只有 thinking_delta 命中 ⇒ 不算命中（hidden 不在结果里）",
  );

  // ③ 按会话聚合：一个会话一条结果
  const alpha = await writeSession("alpha", [
    { type: "session_meta" },
    { type: "user_message", content: "紫罗兰 与 橙子" },
    { type: "assistant_message", content: "紫罗兰 更好看" },
  ]);
  await writeSession("beta", [
    { type: "session_meta" },
    { type: "user_message", content: "紫罗兰 馅的包子" },
  ]);
  const aggregated = await searchSessions({ root: dir, query: "紫罗兰" });
  assert(aggregated.kind === "ok", "聚合查询 ⇒ kind=ok");
  if (aggregated.kind !== "ok") throw new Error("unreachable");
  const alphaEntry = aggregated.matches.find((m) => m.sessionId === "alpha");
  const betaEntry = aggregated.matches.find((m) => m.sessionId === "beta");
  assert(alphaEntry !== undefined && betaEntry !== undefined, "两个会话各自一条结果（按会话聚合）");
  assert(alphaEntry?.matchCount === 2, "alpha 的命中消息数 = 2（不是 2 条结果）");
  assert(betaEntry?.matchCount === 1, "beta 的命中消息数 = 1");

  // ④ 字节帽 ⇒ partial（不是 ok）
  const alphaBytes = (await stat(alpha)).size;
  const partial = await searchSessions({ root: dir, query: "紫罗兰", budgetBytes: alphaBytes + 8 });
  assert(partial.kind === "partial", "字节帽用尽 ⇒ kind=partial（不是 ok）");
  if (partial.kind === "partial") {
    assert(partial.budgetExhaustedAt === "bytes", "partial 的成因 = 字节预算");
    assert(partial.matches.length > 0, "partial 里仍带着已扫到的那份命中");
    assert(partial.truncatedSessions.length > 0, "partial 点名被切断的会话 id");
  }

  // ⑤ 预算充足 ⇒ ok
  const ok = await searchSessions({ root: dir, query: "紫罗兰", budgetBytes: 4 * 1024 * 1024 });
  assert(ok.kind === "ok", "预算充足 ⇒ kind=ok");

  // ⑥ 根目录读不到 ⇒ unavailable（绝不是 ok + 空数组）
  const broken = await searchSessions({ root: join(dir, "no-such-root"), query: "紫罗兰" });
  assert(broken.kind === "unavailable", "会话根不存在 ⇒ kind=unavailable（不是 ok+空数组）");
  assert(broken.kind === "unavailable" && broken.reason.length > 0, "unavailable 带机器可读的原因");

  // ⑦ 根目录不是目录 ⇒ unavailable
  const notADir = join(dir, "plain.txt");
  await writeFile(notADir, "x", "utf8");
  const bad = await searchSessions({ root: notADir, query: "紫罗兰" });
  assert(bad.kind === "unavailable", "会话根不是目录 ⇒ kind=unavailable");

  // ⑧ 扫完了没命中 ⇒ ok + 空数组（与 unavailable 形状不同：可区分）
  const quietDir = await mkdtemp(join(tmpdir(), "dsh-session-search-quiet-"));
  try {
    await writeSession("quiet", [
      { type: "session_meta" },
      { type: "user_message", content: "完全无关" },
    ]);
    const quiet = await searchSessions({ root: quietDir, query: "紫罗兰" });
    assert(quiet.kind === "ok", "扫完没命中 ⇒ kind=ok");
    assert(quiet.kind === "ok" && quiet.matches.length === 0, "扫完没命中 ⇒ matches 为空数组");
  } finally {
    await rm(quietDir, { recursive: true, force: true });
  }

  // ⑨ 空查询 = 没量（unavailable），不是「没有匹配」
  const empty = await searchSessions({ root: dir, query: "   " });
  assert(empty.kind === "unavailable", "空查询 ⇒ kind=unavailable（没有可匹配的词 ≠ 没有匹配）");
} finally {
  await closeAllEventLogs();
  await rm(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error("[session-search-check] 失败: " + String(failures) + " 项断言未通过");
  process.exitCode = 1;
} else {
  console.log("[session-search-check] 全部断言通过");
}
