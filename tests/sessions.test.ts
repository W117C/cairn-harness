// M1e 会话列表存储单测：新建/列表/重命名/删除/行数口径/名字校验/当前会话回退数据面。
// ESM 命名空间不可 spy（见 secrets.test.ts 同型注释）⇒ 用 mock 工厂把 open/readFile
// 包一层真实现：行为走真的，调用面走 mock.calls，用来钉「列表到底读了多少文件」。
import { appendFile, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open), readFile: vi.fn(actual.readFile) };
});
import { open as openFn, readFile as readFileFn } from "node:fs/promises";
const openSpy = vi.mocked(openFn);
const readFileSpy = vi.mocked(readFileFn);
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSession,
  createSidechatSession,
  deleteSession,
  deriveSessionTitle,
  isValidSessionName,
  listSessions,
  listSidechatSessions,
  pathOf,
  readSessionQueue,
  readSessionEvents,
  renameSession,
  sidechatEventsPath,
  writeSessionQueue,
} from "../src/main/sessions";
import { createEventLog } from "../src/events";
import { markSessionRunLive, unmarkSessionRunLive } from "../src/main/session-liveness";

/** 某个文件被整份 readFile 了几次（增量计数生效后应为 0/1，而不是每次列表都 1）。 */
function fullReads(p: string): number {
  return readFileSpy.mock.calls.filter((c) => c[0] === p).length;
}
function opens(p: string): number {
  return openSpy.mock.calls.filter((c) => c[0] === p).length;
}

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
  it("首行不是 session_meta ⇒ 不投影 scheduled 徽标（origin=scheduled 才投影，这条判到的是 type 半边）", async () => {
    const id = await createSession(root, "交互");
    const log = createEventLog(pathOf(root, id));
    await log.append({ type: "user_message", content: "hi" });
    const list = await listSessions(root);
    expect(list.find((x) => x.id === "交互")?.origin).toBeUndefined();
  });
  it("首行是 session_meta 但没有 origin ⇒ 同样不投影（origin 半边：上面那条判不到它，变异存活实测抓出来的缺口）", async () => {
    const id = await createSession(root, "有 meta 无 origin");
    await createEventLog(pathOf(root, id)).append({ type: "session_meta", branch_of: "原会话" });
    const hit = (await listSessions(root)).find((x) => x.id === "有 meta 无 origin");
    expect(hit?.origin).toBeUndefined();
    expect(hit?.automationId).toBeUndefined();
    expect(hit?.automationName).toBeUndefined();
  });
});

describe("会话发送队列 sidecar（重启恢复的数据面）", () => {
  const queuePath = (id: string): string => pathOf(root, id).replace(/\.jsonl$/, ".queue.json");

  it("写入后可跨模块实例读回；空队列清掉文件", async () => {
    const id = await createSession(root, "排队会话");
    await writeSessionQueue(root, id, [
      { text: "第一条", attachments: [] },
      { text: "第二条", attachments: [{ path: "src/a.ts", kind: "file", explicit: true }] },
    ]);
    expect(await readSessionQueue(root, id)).toEqual([
      { text: "第一条", attachments: [] },
      { text: "第二条", attachments: [{ path: "src/a.ts", kind: "file", explicit: true }] },
    ]);
    await writeSessionQueue(root, id, []);
    expect(await readSessionQueue(root, id)).toEqual([]);
    await expect(stat(queuePath(id))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("重命名跟随队列 sidecar；删除同时清掉队列", async () => {
    const id = await createSession(root, "旧队列名");
    await writeSessionQueue(root, id, [{ text: "重启后继续", attachments: [] }]);
    await renameSession(root, id, "新队列名");
    expect(await readSessionQueue(root, "新队列名")).toEqual([{ text: "重启后继续", attachments: [] }]);
    await expect(stat(queuePath(id))).rejects.toMatchObject({ code: "ENOENT" });
    await deleteSession(root, "新队列名");
    expect(await readSessionQueue(root, "新队列名")).toEqual([]);
    await expect(stat(queuePath("新队列名"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("损坏队列 fail-visible，不静默当空队列", async () => {
    const id = await createSession(root, "坏队列");
    await writeFile(queuePath(id), "{not-json", "utf8");
    await expect(readSessionQueue(root, id)).rejects.toThrow(/发送队列损坏/);
  });

  it("非法条目 fail-closed：空文本、未知字段、坏附件都不落盘", async () => {
    const id = await createSession(root, "坏条目");
    await expect(writeSessionQueue(root, id, [{ text: " ", attachments: [] }])).rejects.toThrow(/text/);
    await expect(
      writeSessionQueue(root, id, [{ text: "x", attachments: [], extra: true } as never]),
    ).rejects.toThrow(/未知字段/);
    await expect(
      writeSessionQueue(root, id, [{ text: "x", attachments: [{ path: "", kind: "file", explicit: true }] }]),
    ).rejects.toThrow(/attachments/);
    expect(await readSessionQueue(root, id)).toEqual([]);
  });

  it("孤儿 sidecar 不被同名新会话继承（JSONL 被外部删掉后留下的队列不许易主）", async () => {
    const id = await createSession(root, "易主会话");
    await writeSessionQueue(root, id, [{ text: "上一个会话没发完的", attachments: [] }]);
    // 外部删除只删了 JSONL（CLI / 手工清理 / 崩溃半写），sidecar 留在盘上：
    // 此时新建一个同名字的会话，id 会复用同一个 sidecar 路径。
    await rm(pathOf(root, id), { force: true });
    const again = await createSession(root, "易主会话");
    expect(again).toBe(id);
    // 新会话是全新的空会话：读到别人的待发消息会把「别人的话」当成自己的话发出去。
    expect(await readSessionQueue(root, again)).toEqual([]);
  });
});

// 列表的读取面：旧实现每次列表都把每个会话**整份** readFile（只为数一个行数），另开一次读首行
// ⇒ 会话列表 = O(盘上总字节)，且随列表刷新反复付。现在：首行 meta 走 O(1) 头读，行数按
// (ino,size) 增量计数（JSONL append-only ⇒ 未变即复用，长大只读追加段）。
describe("会话列表只读头 + 行数增量计数", () => {
  it("未变的文件在第二次列表里不再被整份 readFile（只剩一次头读）", async () => {
    const id = await createSession(root, "两次列表");
    const p = pathOf(root, id);
    const log = createEventLog(p);
    await log.append({ type: "user_message", content: "一" });
    await log.append({ type: "user_message", content: "二" });
    await log.append({ type: "usage", inputTokens: 1, outputTokens: 1 });

    expect((await listSessions(root)).find((s) => s.id === id)?.lines).toBe(3);
    const reads0 = fullReads(p);
    const opens0 = opens(p);
    expect(reads0).toBeGreaterThan(0); // 首访确实整份扫过（增量计数需要一个基线）

    const second = await listSessions(root);
    expect(second.find((s) => s.id === id)?.lines).toBe(3); // 复用缓存，值不变
    expect(fullReads(p) - reads0).toBe(0); // 第二次列表零整份读
    expect(opens(p) - opens0).toBe(1); // 只有首行 meta 那一次头读
  });

  it("追加后按增量计数：含纯空白行不计、未换行尾段计 1 且补全后不双计", async () => {
    const id = await createSession(root, "增量");
    const p = pathOf(root, id);
    await writeFile(p, '{"type":"user_message","content":"a"}\n', "utf8");
    expect((await listSessions(root)).find((s) => s.id === id)?.lines).toBe(1);

    await appendFile(p, "   \n", "utf8"); // 纯空白段：旧口径 split+filter 也不计
    expect((await listSessions(root)).find((s) => s.id === id)?.lines).toBe(1);

    await appendFile(p, '{"type":"usage"', "utf8"); // 崩溃半写行（无换行尾段）
    expect((await listSessions(root)).find((s) => s.id === id)?.lines).toBe(2);

    await appendFile(p, ',inputTokens:1,outputTokens:1}\n{"type":"user_message","content":"b"}\n', "utf8");
    // 补全的是**同一条**已计过的尾段，不得双计：1 完整 + 尾段 + 新的一条 = 3
    expect((await listSessions(root)).find((s) => s.id === id)?.lines).toBe(3);
  });

  it("超长未收尾尾段（>4KB 崩溃半写）：当场如实计 1，补全后不双计", async () => {
    const id = await createSession(root, "长尾");
    const p = pathOf(root, id);
    await writeFile(p, '{"type":"user_message","content":"a"}\n', "utf8");
    expect((await listSessions(root)).find((s) => s.id === id)?.lines).toBe(1);
    // 尾段超过缓存上限 ⇒ 水位退回上一个换行；报出的行数仍要如实含它（旧口径整份扫也计 1）
    await appendFile(p, '{"type":"user_message","content":"' + "x".repeat(5000), "utf8");
    expect((await listSessions(root)).find((s) => s.id === id)?.lines).toBe(2);
    await appendFile(p, '"}\n', "utf8"); // 补全的是同一条：不得双计
    expect((await listSessions(root)).find((s) => s.id === id)?.lines).toBe(2);
    await appendFile(p, '{"type":"usage","inputTokens":1,"outputTokens":1}\n', "utf8");
    expect((await listSessions(root)).find((s) => s.id === id)?.lines).toBe(3);
  });

  it("同路径被换成同字节数的新文件（inode 变）→ 计数重算，不沿用旧值", async () => {
    const id = await createSession(root, "换体");
    const p = pathOf(root, id);
    await writeFile(p, '{"a":1}\n{"b":2}\n{"c":3}\n', "utf8");
    const before = await stat(p);
    expect((await listSessions(root)).find((s) => s.id === id)?.lines).toBe(3);

    await rm(p);
    // 凑一个同字节数、行数不同的文件：size 守卫挡不住这种，只有 inode 守卫能重算
    const head = '{"d":4}\n';
    await writeFile(p, head + "\n".repeat(Math.max(0, before.size - head.length)), "utf8");
    const st = await stat(p);
    expect(st.size).toBe(before.size);
    expect(st.ino).not.toBe(before.ino); // 前提：真是换了个 inode，否则这条测的是别的东西
    expect((await listSessions(root)).find((s) => s.id === id)?.lines).toBe(1);
  });

  it("同 inode 被就地截断（size 变小）→ 计数重算", async () => {
    const id = await createSession(root, "截断");
    const p = pathOf(root, id);
    const log = createEventLog(p);
    for (const c of ["一", "二", "三", "四", "五"]) await log.append({ type: "user_message", content: c });
    expect((await listSessions(root)).find((s) => s.id === id)?.lines).toBe(5);

    await writeFile(p, '{"type":"user_message","content":"一"}\n', "utf8");
    expect((await listSessions(root)).find((s) => s.id === id)?.lines).toBe(1);
  });

  it("sidechat 按首行 meta 过滤：不匹配父会话的那些连一次整文件重放都不做", async () => {
    const pA = sidechatEventsPath(root, await createSidechatSession(root, "父A", "sc-a"));
    const pB = sidechatEventsPath(root, await createSidechatSession(root, "父B", "sc-b"));
    const logB = createEventLog(pB);
    await logB.append({ type: "user_message", content: "别写进我的父会话" });
    await logB.append({ type: "usage", inputTokens: 1, outputTokens: 1 });

    const list = await listSidechatSessions(root, "父A");
    expect(list.map((s) => s.id)).toEqual(["sc-a"]);
    expect(list[0]?.parentId).toBe("父A");
    expect(list[0]?.lines).toBe(1); // session_meta 那一行
    expect(fullReads(pB)).toBe(0); // 被过滤掉的那条：从未被整份读过
  });

  it("sidechat 行数 = 非空 JSONL 行数（与主会话同口径），第二次列表不再整份读", async () => {
    const id = await createSidechatSession(root, "父", "sc");
    const p = sidechatEventsPath(root, id);
    const log = createEventLog(p);
    await log.append({ type: "user_message", content: "问一句" });
    expect((await listSidechatSessions(root))[0]?.lines).toBe(2);
    const reads0 = fullReads(p);
    expect((await listSidechatSessions(root))[0]?.lines).toBe(2);
    expect(fullReads(p) - reads0).toBe(0);
  });
});

describe("第十八遍：首条消息 → 会话短标题（deriveSessionTitle；业主 21.50.54「对话命名也需要改」）", () => {
  it("取首条非空行；markdown 头/引用/列表前缀剥壳；空白压单格", () => {
    expect(deriveSessionTitle("# 帮我看看这个 bug")).toBe("帮我看看这个 bug");
    expect(deriveSessionTitle("> 引用一句原文")).toBe("引用一句原文");
    expect(deriveSessionTitle("- 列表项开头")).toBe("列表项开头");
    expect(deriveSessionTitle("1. 有序第一项")).toBe("有序第一项");
    expect(deriveSessionTitle("\n\n   第二行的开头\n后面不算")).toBe("第二行的开头");
    expect(deriveSessionTitle("查一下   deepseek   的 V4")).toBe("查一下 deepseek 的 V4");
  });

  it("显示宽预算 32（CJK 记 2）：恰好放得下不加省略号，超了截断加「…」", () => {
    expect(deriveSessionTitle("a".repeat(32))).toBe("a".repeat(32)); // 恰 32 宽：原样
    expect(deriveSessionTitle("a".repeat(33))).toBe("a".repeat(32) + "…"); // 33 宽：截 32 + …
    expect(deriveSessionTitle("一二三四五六七八九十一二三四五六七八")).toBe("一二三四五六七八九十一二三四五六七八".slice(0, 16) + "…"); // 18 字 = 36 宽 ⇒ 16 字 + …
    expect(deriveSessionTitle("fix the scrollback glitch")).toBe("fix the scrollback glitch"); // 25 宽：原样
  });

  it("全空/纯空白 ⇒ null（调用方保留时间戳名，不硬编凑）", () => {
    expect(deriveSessionTitle("")).toBeNull();
    expect(deriveSessionTitle("   \n\t\n  ")).toBeNull();
    expect(deriveSessionTitle("###   ")).toBeNull(); // 只剥出空壳
  });
});

// 2026-10-19 独立评审：删除/重命名运行中的会话会把日志 rename/unlink 掉，而 run 的常驻句柄
// 继续 append 到已删除的 inode ⇒ 后续事件静默消失（目录里再也看不到）。
describe("运行中的会话不许删除 / 重命名", () => {
  it("占用登记在场 ⇒ 两条通道都拒绝；摘除后照常可用", async () => {
    const root = await mkdtemp(join(tmpdir(), "sessions-busy-"));
    try {
      const id = await createSession(root, "busy-one");
      markSessionRunLive(pathOf(root, id));
      await expect(deleteSession(root, id)).rejects.toThrow(/正在运行/);
      await expect(renameSession(root, id, "busy-two")).rejects.toThrow(/正在运行/);
      // 失败不破坏文件：原 id 仍在，且内容可读。
      await expect(readSessionEvents(root, id)).resolves.toBeInstanceOf(Array);
      unmarkSessionRunLive(pathOf(root, id));
      await renameSession(root, id, "busy-two");
      await deleteSession(root, "busy-two");
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});

// 2026-10-19 独立评审：并发同名创建会互相删文件（stat→writeFile 两步可交错；
// 第二个的 metadata 回滚 rm 掉第一个刚建好的 JSONL）。独占创建后两者都必须成立。
describe("并发同名 createSession", () => {
  it("两个调用都成功、id 不同、两个 JSONL 都在", async () => {
    const root = await mkdtemp(join(tmpdir(), "sessions-race-"));
    const metadata = {
      async create(id: string): Promise<void> {
        // 模拟真实 sidecar：同样要求名字唯一（撞名抛错）——正是旧回滚删掉对方文件的路径。
        await stat(join(root, id + ".meta"));
        throw new Error("metadata exists");
      },
    };
    // 上面的桩一定会抛错并触发回滚；用它验证「回滚只删自己那份」。
    const results = await Promise.allSettled([
      createSession(root, "race", metadata as never),
      createSession(root, "race", metadata as never),
    ]);
    try {
      expect(results.every((r) => r.status === "rejected")).toBe(true);
      // 两个回滚都删自己的文件 ⇒ 目录里应当为空（不许出现「一个成功、一个被对方删掉」）。
      const names = (await import("node:fs/promises").then((fs) => fs.readdir(root))).filter((n) => n.endsWith(".jsonl"));
      expect(names).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }

    // 无 metadata 的正常路径：两个都成功且 id 不同、文件都在。
    const root2 = await mkdtemp(join(tmpdir(), "sessions-race2-"));
    try {
      const [a, b] = await Promise.all([createSession(root2, "race"), createSession(root2, "race")]);
      expect(a).not.toBe(b);
      await expect(stat(pathOf(root2, a))).resolves.toBeTruthy();
      await expect(stat(pathOf(root2, b))).resolves.toBeTruthy();
    } finally {
      await rm(root2, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
