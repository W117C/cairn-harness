// 调度器 roadmap 三件（2026-11-10）：per-automation 并发帽 / 触发抖动 / BufferOne 重叠策略。
// 语义锚点：
//   · maxConcurrent 缺省 1 = 旧「同任务 queued/running 即 overlap」逐字同形（改前改后同判定）；
//   · bufferOne 只缓存最新一拍，收束后以 `<key>#b` 补发（补发走完整准入，可再被闸拦）；
//   · jitter 只抖**调度触发**（tick 路径），run_now 手动触发永不抖。
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { Scheduler, type SchedulerDeps, type TriggerExecutor } from "../src/main/scheduler";

const CREATED = "2026-09-11T00:00:00.000Z"; // 早于所有 fake now 的 dueAt
let dir: string;
beforeAllFixture();
async function beforeAllFixture(): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), "sched-overlap-"));
}
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });
afterEach(() => { vi.restoreAllMocks(); });

const base = (over: Record<string, unknown> = {}) => ({
  name: "t-" + Math.random().toString(36).slice(2, 8),
  prompt: "p",
  schedule: { kind: "interval", everyMinutes: 5 },
  catchUp: "latest",
  createdAt: CREATED,
  ...over,
});

function makeScheduler(over: Partial<SchedulerDeps> = {}): { s: Scheduler; now: () => number; setNow: (n: number) => void } {
  const sessions = join(dir, "sessions-" + Math.random().toString(36).slice(2, 8));
  const data = join(dir, "data-" + Math.random().toString(36).slice(2, 8));
  let now = Date.parse("2026-09-12T02:00:00Z");
  const s = new Scheduler({
    dataDir: data,
    sessionsDir: sessions,
    workspace: dir,
    clock: () => now,
    jitterMs: () => 0,
    runTimeoutMs: 60_000,
    settlesWithinMs: 60_000,
    ...over,
  });
  return { s, now: () => now, setNow: (n: number) => { now = n; } };
}

/** 闸测试执行器：挂起但 abort 即收束（真实取消语义），不留悬空长定时器。 */
function hangExecutor(): TriggerExecutor {
  return ({ signal }) => new Promise<{ ok: boolean }>((resolve) => {
    if (signal.aborted) { resolve({ ok: true }); return; }
    signal.addEventListener("abort", () => resolve({ ok: true }));
  });
}

/** fixture 助手：upsert 失败直接炸（ok 检查后 `.value` 才收窄——8 条 tsc 错的源头就是裸取）。 */
async function upsertOk(s: Scheduler, def: Record<string, unknown>): Promise<{ id: string }> {
  const r = await s.upsert(def);
  if (!r.ok) throw new Error("fixture upsert 失败: " + r.errors.join());
  return r.value;
}

describe("per-automation 并发帽", () => {
  it("maxConcurrent=2：同任务第二位放行，第三位 overlap", async () => {
    const { s, setNow } = makeScheduler({ getCap: () => 8, runSession: hangExecutor() });
    const created = await upsertOk(s, base({ maxConcurrent: 2 }));
    expect((await s.runNow(created.id)).ok).toBe(true);
    setNow(Date.parse("2026-09-12T02:00:01Z")); // 拨时钟：不同 occurrence 键，落到帽判定
    expect((await s.runNow(created.id)).ok).toBe(true); // 同任务第二位：帽内
    setNow(Date.parse("2026-09-12T02:00:02Z"));
    expect(await s.runNow(created.id)).toEqual({ ok: false, error: "触发被闸拒绝: overlap" });
    expect(s.inflightCount).toBe(2);
  });

  it("缺省（不声明）保持旧重叠闸：同任务第二位即 overlap（逐字同形）", async () => {
    const { s, setNow } = makeScheduler({ getCap: () => 8, runSession: hangExecutor() });
    const created = await upsertOk(s, base());
    expect((await s.runNow(created.id)).ok).toBe(true);
    setNow(Date.parse("2026-09-12T02:00:01Z"));
    expect(await s.runNow(created.id)).toEqual({ ok: false, error: "触发被闸拒绝: overlap" });
  });

  it("maxConcurrent 白名单：0 / 9 / 非整数全拒", async () => {
    const { s } = makeScheduler({});
    for (const bad of [0, 9, 1.5]) {
      const r = await s.upsert(base({ maxConcurrent: bad }));
      expect(r.ok).toBe(false);
      expect(r.ok ? [] : r.errors.join()).toContain("maxConcurrent");
    }
  });
});

describe("BufferOne 重叠策略", () => {
  it("帽满记 skipped(buffered)；收束后以 #b 补发并落 triggered 账", async () => {
    let finish!: (r: { ok: boolean }) => void;
    const gate = new Promise<{ ok: boolean }>((resolve) => { finish = resolve; });
    const executor: TriggerExecutor = vi.fn(() => gate);
    const { s, setNow } = makeScheduler({ getCap: () => 8, runSession: executor });
    const created = await upsertOk(s, base({ overlap: "bufferOne" }));
    const id = created.id;
    expect((await s.runNow(id)).ok).toBe(true);
    setNow(Date.parse("2026-09-12T02:00:01Z"));
    expect(await s.runNow(id)).toEqual({ ok: false, error: "触发被闸拒绝: buffered" });
    expect(s.inflightCount).toBe(1);
    finish({ ok: true }); // 收束 ⇒ settle ⇒ 补发
    // 补发的键带 #b：journal 出现它 = 补发准入已完成（比 inflight 计数可靠——补发跑完又会归零）
    await vi.waitFor(async () => {
      expect(await readFile(s.journalPath, "utf8")).toContain("#b");
    });
    const journal = await readFile(s.journalPath, "utf8");
    expect(journal).toContain("buffered"); // 缓存账
    expect(journal).toContain('"decision":"triggered"'); // 补发落 triggered 账
  });

  it("只缓存最新一拍：两次帽满一次补发；补发期间再满按策略再缓存", async () => {
    // 每次执行一个独立的 gate：run#1 与补发 #b 各挂各的，resolve 互不串扰
    const gates: Array<(r: { ok: boolean }) => void> = [];
    const executor: TriggerExecutor = vi.fn(
      () => new Promise<{ ok: boolean }>((resolve) => { gates.push(resolve); }),
    );
    const { s, setNow } = makeScheduler({ getCap: () => 8, runSession: executor });
    const created = await upsertOk(s, base({ overlap: "bufferOne" }));
    const id = created.id;
    expect((await s.runNow(id)).ok).toBe(true);
    setNow(Date.parse("2026-09-12T02:00:01Z"));
    expect(await s.runNow(id)).toEqual({ ok: false, error: "触发被闸拒绝: buffered" });
    setNow(Date.parse("2026-09-12T02:00:02Z"));
    expect(await s.runNow(id)).toEqual({ ok: false, error: "触发被闸拒绝: buffered" }); // 顶掉旧缓存
    gates[0]!({ ok: true }); // run#1 收束 ⇒ 补发（拿 gates[1]，仍挂起）
    // 假同步点订正（2026-11-11 判定书）：inflight==1 在 K1 未删时也满足，waitFor 会提前通过。
    // 改等持久面信号：journal 出现 #b 键 = 原键已删、补发准入已完成（此后 inflight==1 只能是补发）。
    await vi.waitFor(async () => {
      expect(await readFile(s.journalPath, "utf8")).toContain("#b");
    });
    await vi.waitFor(() => expect(s.inflightCount).toBe(1));
    setNow(Date.parse("2026-09-12T02:00:03Z"));
    expect(await s.runNow(id)).toEqual({ ok: false, error: "触发被闸拒绝: buffered" }); // 补发期间再满 → 再缓存
  });

  it("overlap 白名单外的值拒收", async () => {
    const { s } = makeScheduler({});
    const r = await s.upsert(base({ overlap: "queueAll" }));
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.errors.join()).toContain("overlap");
  });
});

describe("触发抖动 jitterSec", () => {
  it("tick 路径延迟入飞（jitterRand=0.5、jitterSec=2 ⇒ ~1s）；run_now 不抖", async () => {
    const { s, setNow } = makeScheduler({ getCap: () => 8, runSession: hangExecutor(), jitterRand: () => 0.5 });
    const created = await upsertOk(s, base({ jitterSec: 2, maxConcurrent: 3 }));
    const id = created.id;
    // 启动 tick（首拍必须走 startup，否则整个 tick 被跳过）：02:00 一拍走 catchup，不抖，立即入飞
    await s.tick({ startup: true });
    expect(s.inflightCount).toBe(1);
    // run_now：手动触发不抖——立即入飞（02:00:10 这一拍，与 catchup 键不同）
    setNow(Date.parse("2026-09-12T02:00:10Z"));
    expect((await s.runNow(id)).ok).toBe(true);
    expect(s.inflightCount).toBe(2);
    // tick 路径：拨到下一拍 02:05:10 到期 → 抖动分支延迟 ~1s
    setNow(Date.parse("2026-09-12T02:05:10Z"));
    const t0 = Date.now();
    await s.tick();
    expect(s.inflightCount, "抖动未到点：还不准入").toBe(2); // 只有两拍已在飞
    await vi.waitFor(() => expect(s.inflightCount).toBe(3), { timeout: 3000 }); // ~1s 后补准
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900); // 延迟确实发生
  }, 15_000);

  it("jitter 等待中的同一拍不被后续 tick 双进管线（jitterPending 去重）", async () => {
    const { s, setNow } = makeScheduler({ getCap: () => 8, runSession: hangExecutor(), jitterRand: () => 0.9 });
    const created = await upsertOk(s, base({ jitterSec: 2, maxConcurrent: 2 }));
    // 启动 tick 先行（首拍必须 startup），02:00 一拍 catchup 立即入飞
    await s.tick({ startup: true });
    expect(s.inflightCount).toBe(1);
    setNow(Date.parse("2026-09-12T02:05:10Z"));
    await s.tick();
    await s.tick(); // 同一拍再 tick：jitterPending 挡住，不重复排队
    await vi.waitFor(() => expect(s.inflightCount).toBe(2), { timeout: 4000 }); // 只有一次补准（1.8s 后）
    await new Promise((r) => { setTimeout(r, 300); });
    expect(s.inflightCount).toBe(2);
  }, 15_000);

  it("jitterSec 白名单：600 OK，601 / 负数 / 非整数全拒", async () => {
    const { s } = makeScheduler({});
    expect((await s.upsert(base({ jitterSec: 600 }))).ok).toBe(true);
    for (const bad of [601, -1, 1.5]) {
      const r = await s.upsert(base({ jitterSec: bad }));
      expect(r.ok).toBe(false);
      expect(r.ok ? [] : r.errors.join()).toContain("jitterSec");
    }
  });
});
