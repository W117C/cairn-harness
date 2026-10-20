// 还原（撤销此文件改动）之后，改动面要如实反映"这一项被撤了"（2026-10-19 独立评审追出的真缺陷）。
//
// 缺陷形状：还原只改盘上的文件、**不留任何事件**，而改动面（Inspector 的「改动」Tab、变更窗格、
// 顶栏 Changes 徽标、交付卡的「改动已验证」）**全部**从事件流投影 ⇒ 还原之后那一行仍写着"修改"、
// 仍提供"撤销"、徽标仍数着它、交付卡仍说"改动已验证"——而那个改动在盘上已经不存在了。
// 这不是显示小疵：产品对"这一轮交付了什么"在撒谎。
//
// 修法：还原成功时主进程向该会话事件流落一条 `file_restored`，投影按**最后一次动作**判定
// （还原之后再被写 ⇒ 重新进改动面；只还原过 ⇒ 退出改动面）。
//
// 判据落在**纯函数**上（restoredPathsOf / changedFilesOf / changedFileCount / turnDelivery）：
// 本仓无 jsdom，交互逻辑走「纯函数 + 接线见证」两面。纯函数能真跑 ⇒ 这一条不是恒真的源码断言。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { restoredPathsOf, turnDelivery } from "../src/renderer/projections";
import { changedFileCount, changedFilesOf } from "../src/renderer/components/panes";
import type { AgentEvent } from "../../../src/events";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const ev = (o: Record<string, unknown>): AgentEvent => o as unknown as AgentEvent;

/** 一轮：用户说话 → 写 a.ts（成了）→ 写 b.ts（成了）。 */
const base = (): AgentEvent[] => [
  ev({ type: "user_message", content: "改文件", ts: 1000 }),
  ev({ type: "tool_call", id: "t1", name: "write_file", args: { path: "a.ts" }, ts: 1100 }),
  ev({ type: "tool_result", callId: "t1", ok: true, change: "modified", snapshotId: "s1", ts: 1200 }),
  ev({ type: "tool_call", id: "t2", name: "write_file", args: { path: "b.ts" }, ts: 1250 }),
  ev({ type: "tool_result", callId: "t2", ok: true, change: "created", snapshotId: "s2", ts: 1260 }),
];

describe("还原之后：被撤的文件退出改动面", () => {
  it("★还原 a.ts ⇒ 改动 Tab 里没有它，徽标少一个，交付卡不再说「改动已验证」", () => {
    const events = [...base(), ev({ type: "file_restored", path: "a.ts", snapshotId: "s1", ts: 1300 })];
    // 改动 Tab
    expect(changedFilesOf(events).map((f) => f.path)).toEqual(["b.ts"]);
    // 顶栏徽标
    expect(changedFileCount(events)).toBe(1);
    // 交付卡：a.ts 被撤了 ⇒ 这一轮没有待审的改动
    const delivery = turnDelivery(events);
    expect(delivery[0]!.files.map((f) => f.path)).toEqual(["b.ts"]);
  });

  it("没还原 ⇒ 行为逐字不变（回归锁）", () => {
    const events = base();
    expect(changedFilesOf(events).map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    expect(changedFileCount(events)).toBe(2);
    expect(turnDelivery(events)[0]!.files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
  });

  it("还原之后再被写 ⇒ 重新进改动面（还原只撤掉改动，没撤掉它以后再被改的资格）", () => {
    const events = [
      ...base(),
      ev({ type: "file_restored", path: "a.ts", snapshotId: "s1", ts: 1300 }),
      ev({ type: "tool_call", id: "t3", name: "edit_file", args: { path: "a.ts" }, ts: 1400 }),
      ev({ type: "tool_result", callId: "t3", ok: true, change: "modified", snapshotId: "s3", ts: 1500 }),
    ];
    expect(changedFilesOf(events).map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    expect(changedFileCount(events)).toBe(2);
  });

  it("还原事件本身不算一次改动（不凭空多出一行）", () => {
    const events = [...base(), ev({ type: "file_restored", path: "a.ts", ts: 1300 })];
    // 撤掉 a.ts 后只剩 b.ts —— 不是"撤掉的 a.ts + b.ts"两行
    expect(changedFilesOf(events)).toHaveLength(1);
  });

  it("还原一个没被写过的文件 ⇒ 不影响任何行（不许凭空多一行也不许误伤）", () => {
    const events = [...base(), ev({ type: "file_restored", path: "zzz.ts", ts: 1300 })];
    expect(changedFilesOf(events).map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
  });
});

// 2026-10-20 真机缺陷：审批被拒的 write_file 同样带 path，旧实现把每一笔 tool_result 都当改动
// ⇒ 一次什么都没写的拒绝，会在改动面凭空多一行、徽标多 1、交付卡说「有改动未验证」。
// 判据落在纯函数上：ok:false 的回执既不进 files，也不推进 lastWriteIndex（不把验证拍成 stale）。
describe("被拒绝/失败的写入不算改动", () => {
  const denied = (): AgentEvent[] => [
    ev({ type: "user_message", content: "改文件", ts: 1000 }),
    ev({ type: "tool_call", id: "t1", name: "write_file", args: { path: "a.ts" }, ts: 1100 }),
    ev({ type: "tool_result", callId: "t1", ok: false, output: "[permission denied] 用户拒绝", ts: 1200 }),
  ];

  it("★拒绝的写入不进改动面（文件列表 / 徽标 / 交付卡三面同口径）", () => {
    const events = denied();
    expect(changedFilesOf(events)).toEqual([]);
    expect(changedFileCount(events)).toBe(0);
    expect(turnDelivery(events)).toEqual([]); // 没有文件也没有验证 ⇒ 这一轮不产交付卡
  });

  it("验证之后一笔被拒的写入不把「已验证」打成 stale", () => {
    const events = [
      ...base(),
      ev({ type: "verify_result", callId: "v1", ok: true, attempt: 1, maxAttempts: 3, results: [], ts: 1300 }),
      ev({ type: "tool_call", id: "t3", name: "write_file", args: { path: "c.ts" }, ts: 1400 }),
      ev({ type: "tool_result", callId: "t3", ok: false, output: "[permission denied] 用户拒绝", ts: 1500 }),
    ];
    // base 的两笔写发生在验证之前，验证之后只有一笔没发生的写入 ⇒ 仍是 verified
    expect(turnDelivery(events)[0]!.verification.status).toBe("verified");
  });

  it("还原之后再遇一笔被拒写入 ⇒ 文件仍留在「已还原」侧（不被没发生的写拉回改动面）", () => {
    const events = [
      ...base(),
      ev({ type: "file_restored", path: "a.ts", snapshotId: "s1", ts: 1300 }),
      ev({ type: "tool_call", id: "t3", name: "write_file", args: { path: "a.ts" }, ts: 1400 }),
      ev({ type: "tool_result", callId: "t3", ok: false, output: "[permission denied] 用户拒绝", ts: 1500 }),
    ];
    expect(restoredPathsOf(events).has("a.ts")).toBe(true);
    expect(changedFilesOf(events).map((f) => f.path)).toEqual(["b.ts"]);
  });
});

describe("restoredPathsOf（判定面）", () => {
  it("只还原过、没再写 ⇒ 在集合里", () => {
    const s = restoredPathsOf([...base(), ev({ type: "file_restored", path: "a.ts", ts: 1300 })]);
    expect([...s]).toEqual(["a.ts"]);
  });

  it("还原之后再写 ⇒ 不在集合里", () => {
    const s = restoredPathsOf([
      ...base(),
      ev({ type: "file_restored", path: "a.ts", ts: 1300 }),
      ev({ type: "tool_call", id: "t3", name: "edit_file", args: { path: "a.ts" }, ts: 1400 }),
      ev({ type: "tool_result", callId: "t3", ok: true, change: "modified", ts: 1500 }),
    ]);
    expect(s.has("a.ts")).toBe(false);
  });

  it("空事件流 ⇒ 空集合（不编一个假集合）", () => {
    expect(restoredPathsOf([]).size).toBe(0);
  });
});

describe("接线：还原要落事件，且带上会话 id", () => {
  const app = read("../src/renderer/App.tsx");
  const handlers = read("../../../src/main/session-handlers.ts");

  it("渲染层把 sessionId 一起递过去（不递 ⇒ 主进程不知道往哪条事件流落）", () => {
    // 形状是条件展开（sessionId 在协议里可选：没有活动会话时不递，主进程也不落流）
    expect(app).toContain("...(sid !== null ? { sessionId: sid } : {}),");
    // 2026-10-20：主进程 append 不推流，渲染层成功后本地补一条；只补发起还原的那个会话。
    expect(app).toContain('setEvents((prev) => [...prev, { type: "file_restored", path, snapshotId } as AgentEvent]);');
    expect(app).toContain("if (sid !== null && activeIdRef.current === sid)");
  });

  it("主进程还原成功后落 file_restored 事件", () => {
    expect(handlers).toContain('type: "file_restored"');
    expect(handlers).toContain("createEventLog(logPath).append(");
  });

  it("还原失败不落事件（失败就是没还原，落了就是撒谎）", () => {
    const fn = handlers.slice(
      handlers.indexOf("export async function handleSnapshotRestore"),
      handlers.indexOf("export async function handleSnapshotRestore") + 2000,
    );
    const failAt = fn.indexOf("if (r.ok !== true) return r;");
    const appendAt = fn.indexOf('type: "file_restored"');
    expect(failAt).toBeGreaterThan(-1);
    expect(appendAt).toBeGreaterThan(failAt); // 落流在失败分支之后
  });
});
