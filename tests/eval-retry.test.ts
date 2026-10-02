// 「被 provider 打断 ⇒ 要不要再拨一次」的判卷（2026-10-02）。
//
// 缘起是 36 趟 × 那一次真实读数：32 趟 `requests=0`、报的都是
// `HTTP 429 … free-models-per-day-stealth`，错误体里带 `X-RateLimit-Reset`（日配额时刻）。
// 分母那一半已由 `eval-validity.runValidity` 修好（打断不算数）；这一半管的是**跑器行为**：
// 分钟级的抖动该再拨，日配额那种不该装重试——两种都得说清为什么。
//
// ★本文件的重点在「模型自己干坏事不重拨」那两条：
//   给坏行为第二次机会＝给分数第二次机会，那正是本仓最忌的形状（同 `runValidity` 的第二向）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { providerInterruptOf, runValidity } from "../scripts/lib/eval-validity";
import {
  RETRY_BASE_MS,
  RETRY_MAX_ATTEMPTS,
  RETRY_WAIT_CAP_MS,
  retryVerdict,
  withProviderRetry,
} from "../scripts/lib/eval-retry";

const INTERRUPT = ['runLoop 抛错:GLM 请求失败 HTTP 429: {"error":{"message":"Rate limit exceeded"}}'];
const DAY_QUOTA = ['runLoop 抛错:GLM 请求失败 HTTP 429: {"error":{"message":"Rate limit exceeded: free-models-per-day-stealth",'
  + '"metadata":{"headers":{"X-RateLimit-Limit":"1000","X-RateLimit-Remaining":"0","X-RateLimit-Reset":"1790985600000"}}}}'];
const MODEL_BAD = ["改了判卷面"];
const VERIFY_BAD = ["verify 未通过/未跑"];
const NOW = 1_700_000_000_000;

describe("retryVerdict：只有 provider 侧打断值得再拨，且等待要有帽", () => {
  it("打断但端点没给 reset ⇒ 按基础等待再拨（分钟级抖动）", () => {
    const v = retryVerdict(INTERRUPT, 1, { nowMs: NOW });
    expect(v.retry).toBe(true);
    if (v.retry) expect(v.waitMs).toBe(RETRY_BASE_MS);
  });

  it("端点给了帽内的 reset ⇒ 等它给的时长，而不是自己猜一个", () => {
    const reset = NOW + 90_000;
    const v = retryVerdict(['runLoop 抛错:HTTP 429 X-RateLimit-Reset: ' + String(reset)], 1, { nowMs: NOW });
    expect(v.retry).toBe(true);
    if (v.retry) expect(v.waitMs).toBe(90_000);
  });

  it("★日配额（reset 在明天）⇒ 判不重拨，并把要等多久说出口", () => {
    const v = retryVerdict(DAY_QUOTA, 1, { nowMs: NOW });
    expect(v.retry).toBe(false);
    if (!v.retry) {
      expect(v.why).toContain("分钟");
      expect(v.why).not.toContain("试第"); // 不许一边说「不重拨」一边给出重拨计划
    }
  });

  it("reset 已经过去 ⇒ 不等，直接再拨", () => {
    const v = retryVerdict(['runLoop 抛错:HTTP 429 X-RateLimit-Reset: ' + String(NOW - 5_000)], 1, { nowMs: NOW });
    expect(v.retry).toBe(true);
    if (v.retry) expect(v.waitMs).toBe(RETRY_BASE_MS);
  });

  it("★模型自己干坏事 ⇒ 不重拨（这是被度量的行为，不是故障）", () => {
    for (const fails of [MODEL_BAD, VERIFY_BAD]) {
      const v = retryVerdict(fails, 1, { nowMs: NOW });
      expect(v.retry, fails[0]).toBe(false);
      // 反向证人：同一份 fails 在分母那一头是「算数」的 ⇒ 两半说的是同一件事
      expect(runValidity({ requests: 20 }, fails).valid, fails[0]).toBe(true);
    }
  });

  it("到帽就停，并把帽印出来（不靠永远试下去把跑器挂死）", () => {
    const v = retryVerdict(INTERRUPT, 3, { nowMs: NOW, maxAttempts: 3 });
    expect(v.retry).toBe(false);
    if (!v.retry) expect(v.why).toContain("帽 3");
  });

  it("缺省帽是个明确的数，且基础等待小于帽（否则第一趟就等着越帽）", () => {
    expect(RETRY_MAX_ATTEMPTS).toBe(3);
    expect(RETRY_BASE_MS).toBe(20_000);
    expect(RETRY_WAIT_CAP_MS).toBe(300_000);
    expect(RETRY_WAIT_CAP_MS).toBeGreaterThan(RETRY_BASE_MS);
  });
});

describe("withProviderRetry：次数与等待都是读数，不是说法", () => {
  const noWait = (): Promise<void> => Promise.resolve();
  const stopNow = (): Promise<never> => Promise.reject(new Error("本不该等"));

  it("首趟被 429 打断、第二趟成 ⇒ 拨 2 趟、等了一次基础时长", async () => {
    let calls = 0;
    const slept: number[] = [];
    const out = await withProviderRetry(
      () => { calls += 1; return Promise.resolve(calls === 1 ? "429" : "ok"); },
      (value, n) => retryVerdict(value === "429" ? INTERRUPT : [], n, { nowMs: NOW }),
      (ms) => { slept.push(ms); return Promise.resolve(); },
      { maxAttempts: 3 },
    );
    expect([out.value, out.attempts, out.waitedMs]).toEqual(["ok", 2, RETRY_BASE_MS]);
    expect(slept).toEqual([RETRY_BASE_MS]);
  });

  it("★模型行为坏 ⇒ 一趟就收、一次都不等（不给第二次机会）", async () => {
    let calls = 0;
    const out = await withProviderRetry(
      () => { calls += 1; return Promise.resolve("bad"); },
      () => ({ retry: false as const, why: "不是 provider 侧打断" }),
      stopNow,
    );
    expect([out.value, out.attempts, out.waitedMs]).toEqual(["bad", 1, 0]);
  });

  it("日配额 ⇒ 不装重试：拨 1 趟、不等、并把停的原因带回来", async () => {
    let calls = 0;
    const slept: number[] = [];
    const out = await withProviderRetry(
      () => { calls += 1; return Promise.resolve("quota"); },
      (_v, n) => retryVerdict(DAY_QUOTA, n, { nowMs: NOW }),
      (ms) => { slept.push(ms); return Promise.resolve(); },
    );
    expect(out.attempts).toBe(1);
    expect(slept).toEqual([]);
    expect(out.stoppedWhy).toContain("分钟");
  });

  it("一直被打断 ⇒ 到帽就停，attempts 等于帽（不静默加试）", async () => {
    let calls = 0;
    const out = await withProviderRetry(
      () => { calls += 1; return Promise.resolve("429"); },
      (_v, n) => retryVerdict(INTERRUPT, n, { nowMs: NOW, maxAttempts: 2 }),
      noWait,
    );
    expect([out.attempts, calls, out.waitedMs]).toEqual([2, 2, RETRY_BASE_MS]);
    expect(out.stoppedWhy).toContain("帽 2");
  });
});

describe("共用决策点与接线", () => {
  it("★同一份 fails：providerInterruptOf／runValidity／retryVerdict 三处说的必须是同一件事", () => {
    const cases: { fails: string[]; interrupt: boolean }[] = [
      { fails: INTERRUPT, interrupt: true },
      { fails: DAY_QUOTA, interrupt: true },
      { fails: MODEL_BAD, interrupt: false },
      { fails: ["runLoop 抛错:模型返回了无法解析的 tool_call"], interrupt: false },
    ];
    for (const c of cases) {
      expect(providerInterruptOf(c.fails) !== null, c.fails[0]).toBe(c.interrupt);
      expect(runValidity({ requests: 7 }, c.fails).valid, c.fails[0]).toBe(!c.interrupt);
      const v = retryVerdict(c.fails, 1, { nowMs: NOW });
      if (!c.interrupt) {
        // 非打断 ⇒ 一律不重拨，且理由要点明「那是被度量的行为」
        expect(v.retry, c.fails[0]).toBe(false);
        expect(v.why, c.fails[0]).toContain("被度量的行为");
      } else {
        // 打断 ⇒ 只有两条出路：真重拨，或以「等不起／到帽」为由停，且必须点名理由
        expect(v.retry || /分钟|帽/u.test(v.why), c.fails[0]).toBe(true);
      }
    }
  });

  const evalSrc = () => readFileSync(fileURLToPath(new URL("../scripts/loop-eval.ts", import.meta.url)), "utf8");

  it("接线：跑器真的走 withProviderRetry，判据真的吃 grade 出来的那份 fails（不自己再算一遍）", () => {
    const src = evalSrc();
    expect(src).toContain("withProviderRetry(");
    expect(src).toContain("retryVerdict(grade(res, t).fails");
    // 读数面上要有这几趟的账：拨数与重拨原因都必须印出来
    expect(src).toContain("拨数=${String(r.attempts)}");
    expect(src).toContain("重拨账：拨 ");
  });
});
