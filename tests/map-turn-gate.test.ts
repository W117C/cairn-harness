/* 「地图只在首轮」这条闸的**另一半**（待办 #34）。
   第 206 页那条尺守的是「首轮有没有」；今天现读 `glm-session.ts` 里
   `if (!mapBuilder || historyForMap.length > 2) return null;` 的另一支——**第二轮起不送**——仓里零个观察者：
   把 `> 2` 改成 `> 200`，全量判卷一条都不红（本仓反复点名的那一族：答不出哪条用例会红，就是这一格没有观测者）。
   这条闸不是免费的偏好，是省钱的位置：地图消息排在**历史之前**（`composeTurnMessages` 的 system 块里），
   而实测地图正文 919 token、且会变（同一份仓库连建两次逐字相同；只动一个文件的 mtime 就在第 804 个字符分叉）
   ⇒ 「每轮都送」抖掉的不是这 919 token，而是它后面整段可缓存前缀。取料：`outputs/map-inject-cost-2026-09-30/measurements.md`。
   ⇒ 本文件只钉**现读行为**（首轮送／次轮根本不送／而且不是因为构建失败才不送），不替任何新政策背书。 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type MapBuilder, type MapBuildResult } from "../src/agent/map/build";
import { MAX_FILES_DEFAULT } from "../src/agent/map/cap";
import { createGlmSessionProvider } from "../src/agent/glm-session";
import { createEventLog, type EventLog } from "../src/events";

const TMP: string[] = [];
const logs: EventLog[] = [];

function countingBuilder(result: Partial<MapBuildResult> = {}): { builder: MapBuilder; calls: () => number } {
  let n = 0;
  const full: MapBuildResult = {
    text: "MAP-BODY", tokens: 8, ok: true, fromTagsCache: 0, parsed: 0, fromRenderCache: false,
    fingerprint: "fp", cap: MAX_FILES_DEFAULT, graphFiles: 10, candidates: 10, retrievedFiles: 0, ...result,
  };
  return { calls: () => n, builder: { build: async () => { n += 1; return full; } } };
}

/** 跑两次请求：第一次历史只有 user_message（≤2），第二次垫上 tool_call＋tool_result（>2）。
 *  回每一次请求**发出去的整串文本**。 */
async function twoRequests(builder: MapBuilder): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "map-turn-"));
  TMP.push(dir);
  const path = join(dir, "events.jsonl");
  const log = createEventLog(path);
  logs.push(log);
  await log.append({ type: "user_message", content: "TASK" });
  const seen: string[] = [];
  const provider = createGlmSessionProvider(path, {
    workspace: dir,
    system: "SYSTEM",
    mapBuilder: builder,
    transport: async function* (messages) {
      seen.push(messages.map((m) => `${m.role}:${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n"));
      yield { type: "assistant_message", content: "ok" };
    },
  });
  for await (const _ of provider.stream([])) { /* drain */ }
  await log.append({ type: "tool_call", id: "c1", name: "read_file", args: { path: "a.ts" } });
  await log.append({ type: "tool_result", callId: "c1", ok: true, output: "FEEDBACK" });
  for await (const _ of provider.stream([])) { /* drain */ }
  return seen;
}

describe("地图注入的首轮闸：第二轮起这一位根本没有", () => {
  afterAll(async () => {
    for (const l of logs) await l.close?.();
    for (const d of TMP) await rm(d, { recursive: true, force: true });
  });

  it("首轮带地图正文，次轮不带，也不写成「本次不可用」", async () => {
    const counter = countingBuilder();
    const seen = await twoRequests(counter.builder);
    expect(seen.length, "前提：真的发出过两次请求").toBe(2);
    expect(seen[0]).toContain("[符号地图]");
    expect(seen[0]).toContain("MAP-BODY");
    // 另一半：闸的正确行为是**没有这一位**，而不是给模型一句降级说明
    // （「这轮没有地图」与「这仓库没结构」同形，正是第 206 页拆掉的那种形状——所以这里不许出现降级行）
    expect(seen[1], "第二轮还带着地图 ⇒ 首轮闸失效").not.toContain("[符号地图]");
    expect(seen[1]).not.toContain("仓库地图本次不可用");
    expect(counter.calls(), "次轮那次不送是闸给的，不是构建器被叫了却返回空").toBe(1);
  });

  it("负控：地图正文为空时，首轮也不带这一位（这条断言看得见地图消息本身）", async () => {
    const counter = countingBuilder({ text: "" });
    const seen = await twoRequests(counter.builder);
    expect(seen.length, "前提：两次请求都发出").toBe(2);
    expect(counter.calls(), "前提：构建器真的被叫过一次（不是整条路没跑）").toBe(1);
    expect(seen[0]).not.toContain("[符号地图]");
    expect(seen[1]).not.toContain("[符号地图]");
  });
});
