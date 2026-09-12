// 根因 4 回归：出网停滞守卫（src/net.ts）。
//
// 旧行为：provider 适配器 / 更新检查 / MCP 连接都不带任何超时——对端接受连接后
// 永不响应（或流中途静默）时，fetch / reader.read() 永不 settle，整条调用链挂死
// （IPC promise 悬空 → UI 永久转圈；agent loop 卡死且轮界才检查 abort，取消也救不回）。
//
// 本文件两层验证：
//   ① 单测守卫自身语义（静默窗口 / 续期 / 收束 / 显式关闭）；
//   ② 用**真实 socket**（本地 http server 接受连接但不响应）证明「挂起 → 按窗口收束」——
//      这两条在旧实现上会永久挂起（测试超时），故是会红的回归测试。
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { DEFAULT_STALL_MS, stallGuard, withTimeout } from "../src/net";
import type { ProviderMessage } from "../src/providers";
import { streamAnthropic } from "../src/providers/anthropic";
import { streamOpenAI } from "../src/providers/openai";

const USER: ProviderMessage[] = [{ role: "user", content: "hi" }];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function collect(iter: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
});

/** 起一个本地 server 并返回 base URL（端口 0 = 内核分配，避免端口冲突）。 */
async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(port)}`;
}

describe("停滞守卫 stallGuard（根因 4）", () => {
  it("静默到点 → signal 被 abort，且 reason 可读（fail-visible，不吞成通用 abort）", async () => {
    const g = stallGuard(60, "测试调用");
    expect(g.signal.aborted).toBe(false);
    await sleep(160);
    expect(g.signal.aborted).toBe(true);
    expect(g.stalled()).toBe(true);
    expect(String(g.signal.reason)).toContain("停滞超时");
    expect(String(g.signal.reason)).toContain("测试调用");
    g.dispose();
  });

  it("bump 续期 → 只要持续有分片就不 abort（模拟长回答：总时长 > 窗口也不算停滞）", async () => {
    const g = stallGuard(120, "测试调用");
    for (let i = 0; i < 6; i++) {
      await sleep(45);
      g.bump(); // 每 45ms 一片：累计已 270ms，远超 120ms 窗口
    }
    expect(g.signal.aborted).toBe(false);
    expect(g.stalled()).toBe(false);
    g.dispose();
  });

  it("dispose 后不再 abort（收束必须清掉看门狗，否则定时器泄漏）", async () => {
    const g = stallGuard(50, "测试调用");
    g.dispose();
    await sleep(140);
    expect(g.signal.aborted).toBe(false);
    expect(g.stalled()).toBe(false);
  });

  it("windowMs <= 0 → 显式关闭守卫（测试/关闭开关用）", async () => {
    const g = stallGuard(0, "测试调用");
    await sleep(80);
    expect(g.signal.aborted).toBe(false);
    g.dispose();
  });

  it("默认窗口是 60s（常量即事实源）", () => {
    expect(DEFAULT_STALL_MS).toBe(60_000);
  });
});

describe("一次性请求超时 withTimeout（根因 4）", () => {
  it("按时完成 → 原样返回，不误伤", async () => {
    await expect(withTimeout(Promise.resolve(7), 1_000, "x")).resolves.toBe(7);
  });

  it("永不 settle → 以可读错误收束（旧实现：MCP server 挂起则 IPC 永不 settle）", async () => {
    const never = new Promise<number>(() => {
      /* 永不 settle */
    });
    await expect(withTimeout(never, 60, "MCP server p/s 连接")).rejects.toThrow(/MCP server p\/s 连接 超时/);
  });

  it("ms <= 0 → 关闭超时（直通）", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 0, "x")).resolves.toBe("ok");
  });
});

describe("出网停滞 → 真实 socket 上按窗口收束（旧实现永久挂起）", () => {
  it("建连后对端不响应：fetch 被 abort（Anthropic 适配器）", async () => {
    // 接受连接、读掉请求，但永不写响应头 → fetch 永远等不到 headers。
    const base = await listen((req, _res) => {
      req.resume();
    });
    const t0 = Date.now();
    await expect(
      collect(streamAnthropic(USER, { apiKey: "test", baseURL: base, stallTimeoutMs: 150 })),
    ).rejects.toThrow(/停滞超时/);
    expect(Date.now() - t0).toBeLessThan(4_000);
  });

  it("流中途静默：先收到分片，随后 reader.read() 被 abort（OpenAI 适配器）", async () => {
    const base = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n');
      // 之后既不写也不结束 → 旧实现里 reader.read() 永不 settle。
    });
    const seen: AgentEvent[] = [];
    const t0 = Date.now();
    await expect(
      (async () => {
        for await (const e of streamOpenAI(USER, { apiKey: "test", baseURL: base, stream: true, stallTimeoutMs: 200 })) {
          seen.push(e);
        }
      })(),
    ).rejects.toThrow(/停滞超时/);
    // 停滞前确实收到了数据 —— 证明「静默才判停滞」，不是建连即超时。
    expect(seen.some((e) => e.type === "assistant_delta")).toBe(true);
    expect(Date.now() - t0).toBeLessThan(4_000);
  });
});
