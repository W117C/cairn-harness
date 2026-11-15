// 置顶清单的读取必须和写入走同一条「显式根优先」判据：
// 同 id 跨工作区时，只带 sessionId 的读会落到归属解析器的歧义分支（或启动根），
// 用户看到的是一次没有解释的「置顶状态为空」。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleFeedbackList, handleFeedbackSubmit, handlePinList, handlePinSet, initSessionsDir, setSessionRootResolver } from "../src/main/session-handlers";

let root = "";
let sessionsA = "";
let sessionsB = "";
const sessionId = "same-pin-session";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cairn-pin-routing-"));
  sessionsA = join(root, "a", ".agent", "sessions");
  sessionsB = join(root, "b", ".agent", "sessions");
  for (const dir of [sessionsA, sessionsB]) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${sessionId}.jsonl`), JSON.stringify({ type: "user_message", content: "x" }) + "\n", "utf8");
  }
  initSessionsDir(sessionsA, { pinsPath: join(root, "pins.jsonl") });
});

afterEach(async () => {
  setSessionRootResolver(null);
  await rm(root, { recursive: true, force: true });
});

describe("置顶清单按显式工作区读", () => {
  it("两个工作区都有同 id 时，A 的置顶不会出现在 B", async () => {
    await handlePinSet({ sessionId, eventId: 3, pinned: true }, sessionsA);
    expect(await handlePinList(sessionId, sessionsA)).toEqual([{ eventId: 3 }]);
    expect(await handlePinList(sessionId, sessionsB)).toEqual([]);
  });

  it("写 A 后从 A 读得到；显式 B 不会拿 A 的 sidecar 冒充成功", async () => {
    await handlePinSet({ sessionId, eventId: 3, pinned: true }, sessionsA);
    expect(await handlePinList(sessionId, sessionsA)).toEqual([{ eventId: 3 }]);

    // B 根里没有这条会话：读取必须当场拒绝，不回落 A 根的 sidecar。
    await rm(join(sessionsB, `${sessionId}.jsonl`));
    await expect(handlePinList(sessionId, sessionsB)).rejects.toThrow(/会话不存在/u);
  });

  it("缺省根遇到同 id 两工作区 ⇒ 归属歧义拒绝；给显式根才可读", async () => {
    setSessionRootResolver(async (id) => {
      if (id !== sessionId) return null;
      return null; // 同 id 两处都有：解析器 fail-closed
    });
    await handlePinSet({ sessionId, eventId: 7, pinned: true }, sessionsA);
    await expect(handlePinList(sessionId)).rejects.toThrow(/会话不存在/u);
    expect(await handlePinList(sessionId, sessionsA)).toEqual([{ eventId: 7 }]);
  });
});

describe("反馈清单按显式工作区读", () => {
  it("两个工作区都有同 id 时，A 的反馈不会出现在 B", async () => {
    await handleFeedbackSubmit({ sessionId, eventId: 2, rating: "up" }, sessionsA);
    expect(await handleFeedbackList(sessionId, sessionsA)).toHaveLength(1);
    expect(await handleFeedbackList(sessionId, sessionsB)).toEqual([]);
  });

  it("显式根里没有该会话 ⇒ 拒绝，不拿另一根的反馈冒充", async () => {
    await handleFeedbackSubmit({ sessionId, eventId: 2, rating: "up" }, sessionsA);
    expect(await handleFeedbackList(sessionId, sessionsA)).toHaveLength(1);

    await rm(join(sessionsB, `${sessionId}.jsonl`));
    await expect(handleFeedbackList(sessionId, sessionsB)).rejects.toThrow(/会话不存在/u);
  });
});
