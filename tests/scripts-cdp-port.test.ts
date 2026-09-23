// 复跑面判卷 · `scripts/lib/cdp-port.ts`（起 Electron 之前的「等端口空出来」）。
//
// 这条防要挡的失效不是"起不来"，是**起来了但不是我的那一扇窗**：
// 产品开着 `requestSingleInstanceLock`（`src/main/index.ts`），上一扇窗没退干净时新进程会**自己退出**，
// 而固定端口上的 `/json/version` 由**旧浏览器**继续应答 ⇒ CDP 连上、读到东西、断言逐字通过，
// 只是那份读数是上一相的。2026-09-23 在 panels-check 首次撞到（三臂里只有第一臂撞上残留，
// 当场被误读成"设置没生效"）。本文件锁的是这条前置的**三态**与**不猜**：
// ⑴ 空 ⇒ 放行；⑵ 一直有人听 ⇒ `free:false`（**不许**把"等不到"当成"空"，那是把门改成撒谎）；
// ⑶ 探针自己坏 ⇒ 不许静默当空。另有 `portInUse` 的真 IO 成对（真 listen / 真 close），不 mock。
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { portInUse, waitForPortFree } from "../scripts/lib/cdp-port";

/** 注入时钟的假探针：前 `busyTimes` 次有人听，之后空。 */
function probeScript(busyTimes: number, failAfter?: number): { probe: (port: number) => Promise<boolean>; calls: () => number } {
  let n = 0;
  return {
    calls: () => n,
    probe: async () => {
      const i = n++;
      if (failAfter !== undefined && i >= failAfter) throw new Error("探针自己炸了");
      return i < busyTimes;
    },
  };
}

/** 假 sleep：只累积"应当经过的时间"，测试因此是秒级的，且不依赖宿主负载。 */
function fakeClock(): { sleep: (ms: number) => Promise<void>; now: () => number } {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => { t += ms; },
  };
}

describe("waitForPortFree：等不到就说等不到", () => {
  it("端口本来就空 ⇒ 一次探测即放行（探针不许跳过）", async () => {
    const p = probeScript(0);
    const c = fakeClock();
    const r = await waitForPortFree(9222, { budgetMs: 12_000, probe: p.probe, sleep: c.sleep, now: c.now });
    expect(r).toEqual({ free: true, probes: 1, waitedMs: 0 });
  });

  it("前两次有人听、第三次空 ⇒ 放行且如实记探测数与等待时长", async () => {
    const p = probeScript(2);
    const c = fakeClock();
    const r = await waitForPortFree(9222, { budgetMs: 12_000, stepMs: 200, probe: p.probe, sleep: c.sleep, now: c.now });
    expect(r.free).toBe(true);
    expect(r.probes).toBe(3);
    expect(r.waitedMs).toBe(400);
  });

  it("预算用尽仍有人听 ⇒ free=false（把「等不到」读成「空」就等于放行旧窗）", async () => {
    const p = probeScript(999);
    const c = fakeClock();
    const r = await waitForPortFree(9222, { budgetMs: 1_000, stepMs: 200, probe: p.probe, sleep: c.sleep, now: c.now });
    expect(r.free).toBe(false);
    // 等式而非区间：预算 1000ms、步长 200ms ⇒ 探测数恰为 6（0/200/400/600/800/1000 那次之后停）。
    // 写 `>= 5` 会把"根本没循环起来"这种红放过去。
    expect(r.probes).toBe(6);
    expect(r.waitedMs).toBe(1000);
    expect(p.calls()).toBe(6);
  });

  it("探针抛错 ⇒ 按「没空出来」处理并停止（坏仪器不许冒充读数）", async () => {
    const p = probeScript(1, 1);
    const c = fakeClock();
    const r = await waitForPortFree(9222, { budgetMs: 5_000, stepMs: 200, probe: p.probe, sleep: c.sleep, now: c.now });
    expect(r.free).toBe(false);
    expect(r.error).toContain("探针自己炸了");
    expect(r.probes).toBe(2);
  });

  it("缺省 sleep/now 那条路也真能等（防止只有注入面能用、真跑时静默失灵）", async () => {
    let n = 0;
    const r = await waitForPortFree(9222, {
      budgetMs: 2_000,
      stepMs: 25, // 不用 1ms：`Date.now` 的毫秒粒度会让"真等了"读成 0，那是自造假红
      probe: async () => n++ < 1,
    });
    expect(r.free).toBe(true);
    expect(r.probes).toBe(2);
    expect(r.waitedMs).toBeGreaterThan(0);
  });
});

describe("portInUse：真 IO 成对（同一条尺量「在听」与「没在听」）", () => {
  it("真 listen ⇒ true；真 close ⇒ false", async () => {
    const srv = createServer();
    await new Promise<void>((res) => srv.listen(0, "127.0.0.1", res));
    const port = (srv.address() as { port: number }).port;
    expect(await portInUse(port)).toBe(true);
    await new Promise<void>((res) => srv.close(() => res()));
    expect(await portInUse(port)).toBe(false);
  });

  it("探针有超时：黑洞端口不会把等待者挂死", async () => {
    // 127.x 上未监听的端口会立刻 RST（→ false），这条只确认调用不被挂住即可。
    const started = Date.now();
    const r = await portInUse(1, { timeoutMs: 300 });
    expect(r).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("接线：panels-check 只有这一个起窗出口", () => {
  // 判据写在**出口**上而不是某一相里：上面那三态单测全绿，也照样允许某相绕过等待自己 spawn。
  // 「等端口」这条防的全部价值就是"没有第二扇门"，所以它得由一条读源文件的对账钉住。
  const src = readFileSync(new URL("../scripts/panels-check.ts", import.meta.url), "utf8");

  it("spawnElectron 内先等端口、等不到就中止（不 spawn 进旧窗）", () => {
    expect(src).toContain("await waitForPortFree(PORT, { budgetMs: 12_000 })");
    expect(src).toContain("if (!wait.free) abortPortHeld(wait);");
  });

  it("整份门里只有一处真 spawn，且各相都走 spawnElectron", () => {
    const spawns = src.split("spawn(bin").length - 1;
    expect(spawns).toBe(1);
    const calls = src.split("await spawnElectron(").length - 1;
    // 四个起窗点（B 相主窗 / B4 重启窗 / 引导窗 / B30 三臂各一次走同一 helper）——少一处 = 有人又开始自己起窗
    expect(calls).toBeGreaterThanOrEqual(4);
    expect(src).not.toContain("= spawnElectron("); // 漏 await 的写法：同步取值在新签名下会拿到 Promise
  });
});
