// 起 Electron 验收窗之前的端口前置（panels-check / 其它 CDP 门共用这一份实现）。
//
// 要挡的失效不是"窗口起不来"，是**起来了、但连上的是上一相那扇窗**：
// 产品开着 `requestSingleInstanceLock`（`src/main/index.ts`），前一个进程没退干净时新进程会自己退出，
// 而固定端口上的 `/json/version` 由**旧浏览器**继续应答 ⇒ 探针连得上、读得到 DOM、断言逐字通过，
// 只是那份读数是别人的现场。2026-09-23 在 panels-check 的三臂对比里首次撞到（只有第一臂撞上残留，
// 当场被误读成"设置没生效"）——所以这条等待不该只住在那一相里。
//
// 三态必须各说各的话：空 ⇒ 放行；一直有人听 ⇒ `free:false`（**不许**把"等不到"当成"空"）；
// 探针自己炸 ⇒ 也 `free:false` 并带 `error`（坏仪器不冒充读数）。
import { connect } from "node:net";

export interface PortWait {
  readonly free: boolean;
  readonly probes: number;
  readonly waitedMs: number;
  readonly error?: string;
}

/** 一次探测：能连上 = 有人在这个端口上听。连不上（ECONNREFUSED / 超时）= 空。 */
export function portInUse(port: number, opts: { timeoutMs?: number } = {}): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 400;
  return new Promise((resolve) => {
    const sock = connect({ host: "127.0.0.1", port });
    let settled = false;
    const done = (v: boolean): void => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

/** 等到端口**真空出来**再起窗。`probe` / `sleep` / `now` 可注入，是为了让三态判卷不挂在宿主负载上；
 *  缺省走真 `portInUse` + 真计时器，因此被测的就是发货的那条路径。 */
export async function waitForPortFree(
  port: number,
  opts: {
    budgetMs: number;
    stepMs?: number;
    probe?: (port: number) => Promise<boolean>;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<PortWait> {
  const probe = opts.probe ?? ((p: number): Promise<boolean> => portInUse(p));
  const sleep = opts.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const stepMs = opts.stepMs ?? 200;
  const start = now();
  let probes = 0;
  for (;;) {
    probes++;
    let busy: boolean;
    try {
      busy = await probe(port);
    } catch (err) {
      return { free: false, probes, waitedMs: now() - start, error: err instanceof Error ? err.message : String(err) };
    }
    if (!busy) return { free: true, probes, waitedMs: now() - start };
    if (now() - start >= opts.budgetMs) return { free: false, probes, waitedMs: now() - start };
    await sleep(stepMs);
  }
}
