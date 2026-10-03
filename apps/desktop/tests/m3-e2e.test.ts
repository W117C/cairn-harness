// M3 验收锚 e2e（spec §11 M3 两条锚的机器证明，headless 可进 CI）：
// ① CLI 建会话桌面可见：fs 直写 <ws>/.agent/sessions/<id>.jsonl（模拟 CLI 产物）→
//    host.listSessions() 含它且 workspace 归属正确 → openSession 可读回。
// ② 并行两会话互不串流：A/B 同 host 并发 run（Promise.all，demo 通道）→ 事件运行时逐条按
//    session_id 载荷归属、分桶后 A/B 集合不相交；各自 JSONL 行数>0、文件体互不含对方消息。
//
// 勘定记录（写测试前实测源码口径）：
// - CLI 产物首行 = user_message：src/cli.ts:303 缺省新开 `cli-<ts>` 会话，runAgent pipeline 落的
//   首事件即 user_message；session_meta 首行只在 fork/sidechat/scheduled 会话出现。replay（events
//   index.ts:834）只要求「JSON 对象 + type 字符串」，user_message 首行合法——以此为准直写。
// - JSONL 落盘行**不带** session_id：盖章只发生在 outbox 推送面（agent-runner.ts:2129-2132，
//   handleAgentRun 的 onEvent 回调对每条事件浅拷贝加 session_id；pipeline 先 log.append 原事件后
//   onEvent）——故「逐行归属」的主断言落在事件运行时（分桶数据源），JSONL 行内若出现 session_id
//   字段则作反向 fail-safe（绝不许是对方的 id）。
// demo 通道不拨号不花钱（spec §3.2）：settings provider=demo + M3A_AGENTS_DEMO=1 ⇒ 确定性剧本。
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createKernelHost, type KernelHost } from "../src/main/kernel-host";

const dir = mkdtempSync(join(tmpdir(), "m0-m3-e2e-"));
const userData = join(dir, "userData");
mkdirSync(userData, { recursive: true });
// seed settings：provider=demo ⇒ 不拨号不花钱（同 kernel-host.test.ts 口径）
writeFileSync(join(userData, "settings.json"), JSON.stringify({ provider: "demo", model: "" }));

// 剧本 env 的外部残留会劫持判卷（M3A_MAIN_SCRIPT 优先级最高；M0A_PROVIDER 强推真 provider 会拨号）——
// 进门前清场，出门后还原（本进程只跑 apps/desktop 自己的套件，还原是礼貌不是必须）。
const ambientKeys = ["M3A_MAIN_SCRIPT", "M0A_PROVIDER", "M0_MODEL", "M0B_WORKSPACE"] as const;
const ambientBackup = ambientKeys.map((k) => [k, process.env[k]] as const);
for (const k of ambientKeys) delete process.env[k];
process.env.M3A_AGENTS_DEMO = "1"; // 脚本化主模型：fixtures/agents/main-demo.jsonl，确定性

afterAll(async () => {
  delete process.env.M3A_AGENTS_DEMO;
  for (const [k, v] of ambientBackup) {
    if (v !== undefined) process.env[k] = v;
  }
});

/** 悬挂防护（M2 T7 settleWithin 先例）：promise 越过上限未收束就当场炸，不挂死套件。 */
function settleWithin<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(what + " 未在 " + ms + "ms 内收束（悬挂 promise 防护）")), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e: unknown) => { clearTimeout(timer); reject(e); },
    );
  });
}

type OutboxEntry = readonly [string, unknown];

/** 每用例独立装配：自己的工作区目录 + 自己的 outbox 数组（分桶断言的数据面不被别的用例污染）。
 *  二次装配覆盖进程级出口（kernel-host 头注「最后一个赢」），用例串行、前序断言已收束，安全。 */
function makeHost(workspaces: string[], activeWorkspace: string, outbox: OutboxEntry[]): KernelHost {
  for (const ws of workspaces) mkdirSync(ws, { recursive: true });
  return createKernelHost({
    workspaces,
    activeWorkspace,
    userDataDir: userData,
    outbox: (channel, payload) => {
      outbox.push([channel, payload] as const);
    },
  });
}

describe("M3 验收锚 e2e", () => {
  it(
    "锚一 CLI 建会话桌面可见：fs 直写的会话文件进 listSessions（带 workspace 归属）且 openSession 可读回",
    async () => {
      const wsA = join(dir, "cli-ws-a");
      const wsB = join(dir, "cli-ws-b");
      const host = makeHost([wsA, wsB], wsA, []);
      // 模拟 CLI 产物：cli-<ts> 命名 + 首行 user_message（勘定见文件头注）。
      const cliId = `cli-${String(Date.now())}`;
      const cliMessage = "CLI 直写：这条会话不经过桌面端";
      const sessionsDir = join(wsA, ".agent", "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(
        join(sessionsDir, `${cliId}.jsonl`),
        JSON.stringify({ type: "user_message", content: cliMessage, ts: Date.now() }) + "\n"
          + JSON.stringify({ type: "assistant_message", content: "收到。", ts: Date.now() }) + "\n",
        "utf8",
      );
      // 清单可见且归属 wsA：两根扫描面下恰一条（不误归 wsB）、行数与盘上事实一致。
      const listed = (await host.listSessions()).filter((s) => s.id === cliId);
      expect(listed).toHaveLength(1);
      expect(listed[0]!.workspace).toBe(wsA);
      expect(listed[0]!.lines).toBe(2);
      // 显式工作区读回（硬判据口径 openSession(id, wsA)）。
      const opened = await host.openSession(cliId, wsA);
      expect(opened.events).toHaveLength(2);
      expect(opened.events[0]).toMatchObject({ type: "user_message", content: cliMessage });
      expect(opened.events[1]).toMatchObject({ type: "assistant_message" });
      // 缺省参读回：CLI 会话不在归属表 → 全工作区扫描解析（外部产物被桌面认领的产品语义）。
      const scanned = await host.openSession(cliId);
      expect(scanned.events.map((e) => e.type)).toEqual(["user_message", "assistant_message"]);
    },
    30_000,
  );

  it(
    "锚二 并行两会话互不串流：A/B 并发 run 分桶不相交，各自 JSONL 只含各自事件",
    async () => {
      const wsA = join(dir, "par-ws-a");
      const wsB = join(dir, "par-ws-b");
      const outbox: OutboxEntry[] = [];
      const host = makeHost([wsA, wsB], wsA, outbox);
      const a = await host.createSession(wsA);
      const b = await host.createSession(wsB);
      expect(a.id).not.toBe(b.id); // T3：host 级 id 唯一（秒级时间戳 + 归属表查重占位）
      const MSG_A = "并行甲-不串流锚甲_unique-marker";
      const MSG_B = "并行乙-不串流锚乙_unique-marker";
      // 同 host 并发 run（Promise.all；demo 通道不拨号）。锚只钉「不串流」，不钉真并发——
      // 若 AskGate 全局串行导致一先一后，本用例照样全绿（如实记录于 task-6-report）。
      const [ra, rb] = await Promise.all([
        settleWithin(host.run({ message: MSG_A, mode: "default", sessionId: a.id }), 30_000, "会话 A run"),
        settleWithin(host.run({ message: MSG_B, mode: "default", sessionId: b.id }), 30_000, "会话 B run"),
      ]);
      expect(ra.ok, JSON.stringify(ra)).toBe(true);
      expect(rb.ok, JSON.stringify(rb)).toBe(true);

      // ---- 事件运行时逐条归属（session_id 载荷盖章于 handleAgentRun onEvent）----
      interface OutEvent { session_id?: unknown; type?: string; content?: unknown }
      const events = outbox
        .filter(([channel]) => channel === "onEvent")
        .map(([, payload]) => payload as OutEvent);
      expect(events.length).toBeGreaterThan(0);
      const bucketA = events.filter((e) => e.session_id === a.id);
      const bucketB = events.filter((e) => e.session_id === b.id);
      // 恒带：每条载荷的 session_id 恰为 A/B 之一（无缺章、无第三值）⇒ 分桶完备、两集合不相交。
      expect(bucketA.length + bucketB.length).toBe(events.length);
      expect(bucketA.length).toBeGreaterThan(0);
      expect(bucketB.length).toBeGreaterThan(0);
      // 桶内内容各归各：A 桶的 user_message 全是甲的话、B 桶全是乙的话——路由错挂在这里现形。
      const userMessagesOf = (bucket: OutEvent[]): unknown[] =>
        bucket.filter((e) => e.type === "user_message").map((e) => e.content);
      expect(userMessagesOf(bucketA).length).toBeGreaterThan(0);
      expect(userMessagesOf(bucketA).every((c) => c === MSG_A)).toBe(true);
      expect(userMessagesOf(bucketB).length).toBeGreaterThan(0);
      expect(userMessagesOf(bucketB).every((c) => c === MSG_B)).toBe(true);

      // ---- JSONL 级：行数>0；行内若带 session_id 字段必是自己（fail-safe：绝不携带对方 id）----
      // 半写行跳过归属判定（与 replay 尾坏行降级容错同族——并发尾随写下一行可能正在落盘）。
      const readLines = async (ws: string, id: string): Promise<string[]> => {
        const raw = await readFile(join(ws, ".agent", "sessions", `${id}.jsonl`), "utf8");
        return raw.split("\n").filter((line) => line.trim() !== "");
      };
      const assertLinesOwnSelf = (lines: string[], ownId: string, otherId: string): void => {
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue; // 半写行：归属判定跳过（行数口径仍计入）
          }
          const sid = (parsed as OutEvent).session_id;
          if (sid !== undefined) {
            expect(sid).toBe(ownId);
            expect(sid).not.toBe(otherId);
          }
        }
      };
      assertLinesOwnSelf(await readLines(wsA, a.id), a.id, b.id);
      assertLinesOwnSelf(await readLines(wsB, b.id), b.id, a.id);
      // 文件体互不含对方消息串：错路由/串写在文件级现形（本端消息各落各的根）。
      const rawA = await readFile(join(wsA, ".agent", "sessions", `${a.id}.jsonl`), "utf8");
      const rawB = await readFile(join(wsB, ".agent", "sessions", `${b.id}.jsonl`), "utf8");
      expect(rawA).toContain(MSG_A);
      expect(rawA).not.toContain(MSG_B);
      expect(rawB).toContain(MSG_B);
      expect(rawB).not.toContain(MSG_A);
    },
    60_000,
  );
});
