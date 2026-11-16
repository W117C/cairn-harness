// 成员 run 串行闸判卷：同一时刻只有一个在跑；后来的排队；抛错也放锁。
import { describe, expect, it } from "vitest";
import { createRunLock } from "../src/main/member-run-lock";

describe("成员 run 串行闸", () => {
  it("两个同时进来 ⇒ 串行执行（不重叠），第二个记录到等待", async () => {
    let clock = 0;
    const lock = createRunLock(() => clock);
    const order: string[] = [];
    const a = lock.run(async () => {
      order.push("a-start");
      clock += 100;
      await Promise.resolve();
      order.push("a-end");
      return "A";
    }, "m1");
    const b = lock.run(async () => {
      order.push("b-start");
      order.push("b-end");
      return "B";
    }, "m2");
    const [ra, rb] = await Promise.all([a, b]);
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
    expect(ra.result).toBe("A");
    expect(rb.result).toBe("B");
    expect(rb.waitedMs).toBeGreaterThanOrEqual(100);
  });

  it("抛错也放锁（后面的人不会卡死）", async () => {
    const lock = createRunLock();
    const bad = lock.run(async () => { throw new Error("炸了"); }, "m1");
    await expect(bad).rejects.toThrow("炸了");
    const ok = await lock.run(async () => "fine", "m2");
    expect(ok.result).toBe("fine");
  });

  it("current/pending 可观测（面板要说清「谁在跑／几个在等」）", async () => {
    const lock = createRunLock();
    const spy: string[] = [];
    const first = lock.run(async () => { spy.push(String(lock.current())); return 1; }, "m1");
    const second = lock.run(async () => { spy.push(String(lock.current())); return 2; }, "m2");
    await Promise.all([first, second]);
    expect(spy).toEqual(["m1", "m2"]);
    expect(lock.current()).toBeNull();
    expect(lock.pending()).toBe(0);
  });
});
