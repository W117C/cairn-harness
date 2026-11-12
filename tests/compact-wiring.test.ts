// 手动压缩的**产品路径**（IPC agent:compact → handleCompact）。
// 判卷面原先只走得到演示那条支：runAgent 里 M1D_COMPACTION_DEMO 传的是会话管线 emit（落盘 + 推送），
// 而产品这条支传的是「只推送」的 lambda ⇒ 压缩卡当场看得见、事件从不上 JSONL：下一次 run 重放又是
// 全文，等于花一次摘要的钱换个零效果（compaction-check 全绿也看不见，因为它跑的就是演示那条）。
// 另一半：缺省目标曾是 lastLogPath（本进程最后一次 run 的会话），不是用户屏幕上这条。
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventLog, replay, type AgentEvent } from "../src/events";
import { createSession, pathOf } from "../src/main/sessions";
import { initSessionsDir } from "../src/main/session-handlers";
import { handleCompact, setAppHooks } from "../src/main/agent-runner";

const user = (content: string): AgentEvent => ({ type: "user_message", content });
const call = (id: string): AgentEvent => ({ type: "tool_call", id, name: "read_file", args: { path: "src/a.ts" } });
const result = (callId: string, output: string): AgentEvent => ({ type: "tool_result", callId, ok: true, output });

/** 够触发一次压缩的会话（演示档 tail 帽 150–300 ⇒ 几千字节的工具输出处处可压）。 */
async function fill(logPath: string, tag: string): Promise<void> {
  const log = createEventLog(logPath);
  await log.append(user(tag + " 的目标：把排序修绿"));
  for (let i = 0; i < 6; i++) {
    await log.append(call(tag + "-t" + String(i)));
    await log.append(result(tag + "-t" + String(i), "z".repeat(2000)));
  }
  await log.append({ type: "assistant_message", content: tag + " 完成" });
}

let dir: string | undefined;
const savedEnv: Record<string, string | undefined> = {};
function useEnv(name: string, value: string | undefined): void {
  if (!(name in savedEnv)) savedEnv[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(async () => {
  setAppHooks({ onAppend: undefined, onAppendFailed: undefined, onEvent: undefined });
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete savedEnv[k];
  }
  vi.restoreAllMocks();
});

/** 演示档：无 key 时显式走 mock 摘要器（零真钱、可复现）。 */
function demoMode(): void {
  useEnv("M1D_COMPACTION_DEMO", "1");
  useEnv("CAIRN_API_KEY", undefined);
}

async function twoSessions(): Promise<{ a: string; b: string }> {
  dir = await mkdtemp(join(tmpdir(), "dsh-compact-"));
  initSessionsDir(dir);
  const a = await createSession(dir, "压缩靶子");
  const b = await createSession(dir, "隔壁会话");
  await fill(pathOf(dir, a), "A");
  await fill(pathOf(dir, b), "B");
  return { a, b };
}

describe("手动压缩的产品路径（handleCompact）", () => {
  it("压缩事件既上屏**也**落盘：只推不写就是花一次摘要钱换个零效果", async () => {
    demoMode();
    const { a } = await twoSessions();
    const pushed: AgentEvent[] = [];
    setAppHooks({ onEvent: (e) => { pushed.push(e); } });

    const res = await handleCompact({ sessionId: a });
    expect(res.ok, res.error ?? "").toBe(true);

    const events = await replay(pathOf(dir!, a));
    expect(events[events.length - 1]?.type, "compaction 必须是这条会话日志的最后一条").toBe("compaction");
    expect(pushed.filter((e) => e.type === "compaction"), "上屏恰好一次（不得两头各写一份）").toHaveLength(1);
    // 回条带的是实测读数，不是估算
    const p = res.cardPayload ?? {};
    expect(Number(p.tokensBefore)).toBeGreaterThan(Number(p.tokensAfter));
    expect(Number(p.compressedCount)).toBeGreaterThan(0);
  });

  it("归因钩子先于 append，推送钩子只在成功落盘后触发", async () => {
    demoMode();
    const { a } = await twoSessions();
    const order: string[] = [];
    Reflect.apply(setAppHooks, undefined, [{
      onAppend: () => { order.push("append"); },
      onEvent: () => { order.push("event"); },
    }]);

    expect((await handleCompact({ sessionId: a })).ok).toBe(true);
    expect(order).toEqual(["append", "event"]);
  });

  it("压的是 sessionId 那条，不是「本进程最后跑过的」那条", async () => {
    demoMode();
    const { a, b } = await twoSessions();
    setAppHooks({ onEvent: undefined });

    expect((await handleCompact({ sessionId: b })).ok).toBe(true);
    const typesOf = async (id: string) => (await replay(pathOf(dir!, id))).map((e) => e.type);
    expect(await typesOf(b), "点的那条才被压").toContain("compaction");
    expect(await typesOf(a), "另一条一个字都不许动").not.toContain("compaction");  });

  it("既无 API key 也无演示档 ⇒ fail-closed 明说不可用，不静默造一条压缩", async () => {
    useEnv("M1D_COMPACTION_DEMO", undefined);
    useEnv("CAIRN_API_KEY", undefined);
    const { a } = await twoSessions();
    const before = await readFile(pathOf(dir!, a), "utf8");

    const res = await handleCompact({ sessionId: a });
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("CAIRN_API_KEY");
    expect(await readFile(pathOf(dir!, a), "utf8"), "拒绝就得一个字都不写").toBe(before);
  });

  it("sessionId 不存在 ⇒ 点名拒绝，且不在盘上凭空开一条会话", async () => {
    demoMode();
    const { a } = await twoSessions();
    const res = await handleCompact({ sessionId: "没有这条会话" });
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("会话不存在");
    await expect(readFile(pathOf(dir!, "没有这条会话"), "utf8")).rejects.toBeTruthy();
    expect((await replay(pathOf(dir!, a))).some((e) => e.type === "compaction"), "拒绝时别顺手压了别的").toBe(false);
  });
});
