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
