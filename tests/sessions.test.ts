// M1e 会话列表存储单测：新建/列表/重命名/删除/行数口径/名字校验/当前会话回退数据面。
import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSession,
  deleteSession,
  isValidSessionName,
  listSessions,
  pathOf,
  readSessionEvents,
  renameSession,
} from "../src/main/sessions";
import { createEventLog } from "../src/events";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "m1e-sessions-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("会话列表存储（M1e：JSONL 即会话）", () => {
  it("新建 → 出现在列表；事件追加后行数 = JSONL 行数", async () => {
    const id = await createSession(root, "测试会话");
    const log = createEventLog(pathOf(root, id));
    await log.append({ type: "user_message", content: "hi" });
    await log.append({ type: "usage", inputTokens: 1, outputTokens: 1 });
    const list = await listSessions(root);
    expect(list.map((s) => s.id)).toContain("测试会话");
    expect(list.find((s) => s.id === "测试会话")?.lines).toBe(2);
  });

  it("新建撞名自动加序号；空目录列表为空", async () => {
    await createSession(root, "A");
    const second = await createSession(root, "A");
    expect(second).toBe("A (2)");
    const empty = await mkdtemp(join(tmpdir(), "m1e-empty-"));
    expect(await listSessions(empty)).toEqual([]);
    await rm(empty, { recursive: true, force: true });
  });

  it("重命名后内容逐字不变（重放无损）；删除后目录内消失", async () => {
    const id = await createSession(root, "旧名");
    const log = createEventLog(pathOf(root, id));
    await log.append({ type: "user_message", content: "内容" });
    const before = await readSessionEvents(root, id);
    await renameSession(root, id, "新名");
    const after = await readSessionEvents(root, "新名");
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    // 旧名消失、新名在列（重命名 = 文件重命名）
    const mid = await listSessions(root);
    expect(mid.map((s) => s.id)).toEqual(["新名"]);
    await deleteSession(root, "新名");
    expect(await listSessions(root)).toEqual([]);
  });

  it("非法名字 fail-closed（路径分隔/点开头/空）；删除不存在会话抛错", async () => {
    expect(isValidSessionName("a/b")).toBe(false);
    expect(isValidSessionName("..")).toBe(false);
    expect(isValidSessionName("")).toBe(false);
    await expect(createSession(root, "x/y")).rejects.toThrow();
    await expect(deleteSession(root, "不存在")).rejects.toThrow();
  });

  it("mtime 降序（最近在上）——当前会话回退取列表首个的数据面", async () => {
    const a = await createSession(root, "早");
    const b = await createSession(root, "晚");
    // I4（审查 P2）：不赌 sleep 时长——mtime 粒度粗的卷（部分 CI 为 1s）上 30ms 不保证分出先后。
    // 显式 utimes 把 b 的 mtime 推到 a 之后（相对固定差值），排序语义本身才是被测对象。
    const aSt = await stat(pathOf(root, a));
    const past = new Date(aSt.mtimeMs - 60_000);
    await utimes(pathOf(root, a), past, past);
    const list = await listSessions(root);
    expect(list[0]?.id).toBe(b);
    expect(list[1]?.id).toBe(a);
    // 文件真实存在于 root（目录扫描口径）
    expect((await stat(pathOf(root, b))).isFile()).toBe(true);
  });
});

describe("会话名边界与重命名守卫（补齐：路径穿越与覆盖式重命名）", () => {
  it("前后空白的名字非法（trim 规则）", () => {
    expect(isValidSessionName(" ok")).toBe(false);
    expect(isValidSessionName("ok ")).toBe(false);
    expect(isValidSessionName("ok")).toBe(true);
  });
  it("控制字符 / 点号开头的名字非法", () => {
    expect(isValidSessionName("a\u0000b")).toBe(false);
    expect(isValidSessionName(".hidden")).toBe(false);
    expect(isValidSessionName("..")).toBe(false);
  });
  it("deleteSession / readSessionEvents 对非法名字直接拒绝（消息=非法会话名，而非 ENOENT）", async () => {
    // sessionPath 的闸在碰文件系统之前：拆掉后 " ok" 会走到 rm/readFile 的 ENOENT
    await expect(deleteSession(root, " ok")).rejects.toThrow("非法会话名");
    expect(() => readSessionEvents(root, "a/b")).toThrow("非法会话名"); // 同步抛（sessionPath 在 replay 前）
    expect((await listSessions(root)).length).toBe(0); // 什么也没被碰
  });
  it("重命名到「映射成可写路径」的非法名字被拒，原会话不动", async () => {
    // " 借道" 通过正则但过不了 trim；守卫拆除后会静默重命名成功（不抛错）
    const a = await createSession(root, "原名");
    const log = createEventLog(pathOf(root, a));
    await log.append({ type: "user_message", content: "留" });
    await expect(renameSession(root, a, " 借道")).rejects.toThrow();
    const list = await listSessions(root);
    expect(list.map((x) => x.id)).toEqual(["原名"]);
    expect((await readSessionEvents(root, "原名")).length).toBe(1);
  });
  it("重命名撞名被拒：目标会话内容不被覆盖", async () => {
    const a = await createSession(root, "A");
    const b = await createSession(root, "B");
    const logB = createEventLog(pathOf(root, b));
    await logB.append({ type: "user_message", content: "B 的内容" });
    await expect(renameSession(root, a, "B")).rejects.toThrow();
    const list = await listSessions(root);
    expect(list.map((x) => x.id).sort()).toEqual(["A", "B"]);
    expect((await readSessionEvents(root, "B")).length).toBe(1);
  });
  it("交互会话不投影 scheduled 徽标（只有首行 session_meta origin=scheduled 才投影）", async () => {
    const id = await createSession(root, "交互");
    const log = createEventLog(pathOf(root, id));
    await log.append({ type: "user_message", content: "hi" });
    const list = await listSessions(root);
    expect(list.find((x) => x.id === "交互")?.origin).toBeUndefined();
  });
});
