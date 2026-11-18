// IM 发送队列判卷（send-queue.ts 拆出后的专属判卷面）：钉队列状态机边界——
// FIFO/回执、连接窗口期、幂等键复用与 permanent 落账、park→adopt 停靠接手。
// 宿主级的两条丢消息路径由 host.test.ts 经公开 API 钉住，这里只钉队列本身。
import { describe, expect, it } from "vitest";
import { createSendQueues, type SendJob, type SendQueueDeps } from "../../src/im/send-queue";
import type { ImChat } from "../../src/im/types";

const CHAT: ImChat = { kind: "direct", key: "chat1", title: "" };

function jobOf(text: string, extra: Partial<SendJob> = {}): SendJob {
  return { chat: CHAT, text, attempts: 0, ...extra };
}

function make(overrides: Partial<SendQueueDeps> = {}) {
  const delivered: { text: string; key?: string }[] = [];
  const exhausted: string[] = [];
  let readyNow = true;
  const q = createSendQueues({
    deliver: async (_connId, job) => {
      delivered.push({ text: job.text, key: job.key });
      return {};
    },
    ready: () => readyNow,
    onExhausted: (_connId, message) => {
      exhausted.push(message);
    },
    retryMs: 5,
    ...overrides,
  });
  return { q, delivered, exhausted, setReady: (v: boolean): void => { readyNow = v; } };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("IM 发送队列", () => {
  it("FIFO 顺序投递；after 回调拿到回执", async () => {
    const order: string[] = [];
    const { q } = make({
      deliver: async (_connId, job) => {
        order.push(job.text);
        return { messageId: "m-" + job.text };
      },
    });
    const receipts: (string | undefined)[] = [];
    q.enqueue("c1", "chat1", jobOf("a", { after: (sent) => { receipts.push(sent.messageId); } }));
    q.enqueue("c1", "chat1", jobOf("b"));
    q.enqueue("c1", "chat1", jobOf("c"));
    for (let i = 0; i < 400 && order.length < 3; i += 1) await sleep(5);
    expect(order).toEqual(["a", "b", "c"]);
    expect(receipts).toEqual(["m-a"]);
  });

  it("连接窗口期：ready=false 入队不投递、留队头；kick 补发", async () => {
    const { q, delivered, setReady } = make();
    setReady(false);
    q.enqueue("c1", "chat1", jobOf("a"));
    q.enqueue("c1", "chat1", jobOf("b"));
    await sleep(10);
    expect(delivered).toEqual([]); // 窗口期：不投递也不丢
    setReady(true);
    q.kick("c1"); // 就绪那一拍由宿主 kick
    for (let i = 0; i < 400 && delivered.length < 2; i += 1) await sleep(5);
    expect(delivered.map((d) => d.text)).toEqual(["a", "b"]);
  });

  it("retryable（503）重试复用同一个键；permanent（400）当拍 onExhausted 一次", async () => {
    const seen: { text: string; key?: string }[] = [];
    let failA = true;
    const { q, exhausted } = make({
      deliver: async (_connId, job) => {
        seen.push({ text: job.text, key: job.key });
        if (job.text === "a" && failA) {
          failA = false;
          throw Object.assign(new Error("临时失败"), { status: 503 });
        }
        if (job.text === "b") {
          throw Object.assign(new Error("永久失败"), { status: 400 });
        }
        return {};
      },
    });
    q.enqueue("c1", "chat1", jobOf("a", { key: "k-a" }));
    for (let i = 0; i < 400 && seen.length < 2; i += 1) await sleep(5);
    // 同一条 job 两次尝试带同一个键：键在入队时定死，重试不换
    expect(seen.map((s) => s.key)).toEqual(["k-a", "k-a"]);
    q.enqueue("c1", "chat1", jobOf("b", { key: "k-b" }));
    for (let i = 0; i < 400 && exhausted.length < 1; i += 1) await sleep(5);
    expect(seen.filter((s) => s.text === "b")).toHaveLength(1); // permanent 只试一次
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0]!.startsWith("回信失败")).toBe(true);
  });

  it("park→adopt 保序接手；dropParked 之后 adopt 不再接手", async () => {
    const { q, delivered, setReady } = make();
    setReady(false);
    q.enqueue("c1", "chat1", jobOf("a"));
    q.enqueue("c1", "chat1", jobOf("b"));
    q.park("c1"); // 重连前停靠
    q.adopt("c1"); // 下一次建连原样接手
    setReady(true);
    q.kick("c1");
    for (let i = 0; i < 400 && delivered.length < 2; i += 1) await sleep(5);
    expect(delivered.map((d) => d.text)).toEqual(["a", "b"]); // 保序补发
    // remove 路：停靠队列一并丢弃，adopt 接不回来
    setReady(false);
    q.enqueue("c2", "chat1", jobOf("x"));
    q.park("c2");
    q.dropParked("c2");
    q.adopt("c2");
    setReady(true);
    q.kick("c2");
    await sleep(10);
    expect(delivered.map((d) => d.text)).toEqual(["a", "b"]); // x 没有复活
  });
});
