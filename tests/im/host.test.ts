// IM 宿主判卷：配对闸、群聊闸、路由回信、发送队列与生命周期对账。
// 手法：假适配器在 connect 时把 handlers 交出来，测试直接投递入站消息。
import { describe, expect, it } from "vitest";
import { createImHost, type ImStoreLike } from "../../src/im/host";
import type { ImConnection, ImEnv, ImInboundMessage, ImPlatformAdapter, ImPlatformSpec, ImConnectHandlers } from "../../src/im/types";

const SPEC: ImPlatformSpec = {
  id: "test", name: "测试平台", ws: false, textLimit: 100,
  fields: [{ key: "token", label: "令牌", secret: true }],
};

function fakeStore(seed: ImConnection[] = []): { store: ImStoreLike; savedCount: () => number } {
  let rows: ImConnection[] = seed.map((c) => ({ ...c }));
  let saves = 0;
  return {
    store: {
      load: async () => rows,
      save: async (all) => {
        rows = all.map((c) => ({ ...c }));
        saves += 1;
      },
    },
    savedCount: () => saves,
  };
}

function conn(seed: Partial<ImConnection> = {}): ImConnection {
  return {
    id: "im_t1", platform: "test", account: null, sessionId: "s1", settings: {},
    secretKeys: { token: "im:t1:token" }, enabled: true,
    paired: [{ id: "u1", name: "用户一", at: 1 }],
    requests: [], chats: {}, createdAt: 1,
    ...seed,
  };
}

const ENV: ImEnv = { fetch: fetch };

let msgSeq = 0;

/** 假适配器：connect 时交出 handlers、记录 send 调用。 */
function captureAdapter() {
  const captured: { handlers: ImConnectHandlers | null; sends: string[] } = {
    handlers: null,
    sends: [],
  };
  const adapter: ImPlatformAdapter = {
    connect: (_f, _e, handlers) => {
      captured.handlers = handlers;
      return {
        send: async (chat, text) => {
          captured.sends.push(chat.key + "|" + text);
          return {};
        },
        stop: () => undefined,
      };
    },
    check: async () => ({ account: { id: "bot-1", name: "测试机器人" } }),
  };
  return { captured, adapter };
}

function msgOf(text: string, senderId = "u1", kind: "direct" | "group" = "direct", mentioned = true): ImInboundMessage {
  msgSeq += 1;
  return {
    chat: { key: "chat1", kind, title: kind === "group" ? "群" : "" },
    sender: { id: senderId, name: senderId },
    text,
    mentioned,
    messageId: "m" + String(msgSeq),
  };
}

describe("IM 宿主", () => {
  it("未配对发件人：落申请、回通知；批准后路由并回信", async () => {
    const { captured, adapter } = captureAdapter();
    const routes: string[] = [];
    const replies = ["你好，我是 Cairn 的回信。"];
    const { store } = fakeStore([conn()]);
    const host = createImHost({
      store,
      platforms: { test: SPEC },
      adapters: { test: adapter },
      env: ENV,
      secretValue: async () => "sv",
      routeInbound: async (_c, m) => {
        routes.push(m.text);
        return { ok: true, reply: replies.shift() ?? "" };
      },
    });
    await host.boot();
    const h1 = captured.handlers;
    if (h1 === null) throw new Error("适配器没有交出 handlers");
    // 未配对发件人 → 落申请 + 通知（不路由）
    await h1.onMessage(msgOf("你好", "u9"));
    expect(routes).toEqual([]);
    const view = host.view().connections[0];
    expect(view.requests).toHaveLength(1);
    expect(captured.sends.some((s) => s.includes("连接请求"))).toBe(true);
    // 批准 → 进 paired
    const pairOk = await host.pair("im_t1", "u9", true);
    expect(pairOk.ok).toBe(true);
    // 配对后：路由 + 回信出队
    await h1.onMessage(msgOf("帮我看看构建", "u9"));
    expect(routes).toEqual(["帮我看看构建"]);
    await new Promise((r) => setTimeout(r, 20));
    expect(captured.sends).toContain("chat1|你好，我是 Cairn 的回信。");
  });

  it("群聊闸：未 @ 不收；@ 了才路由", async () => {
    const { captured, adapter } = captureAdapter();
    const routes: string[] = [];
    const { store } = fakeStore([conn()]);
    const host = createImHost({ store, platforms: { test: SPEC }, adapters: { test: adapter }, env: ENV, secretValue: async () => "sv", routeInbound: async (_c, m) => { routes.push(m.text); return { ok: true }; } });
    await host.boot();
    const handlers = captured.handlers;
    if (handlers === null) throw new Error("适配器没有交出 handlers");
    await handlers.onMessage(msgOf("群里闲聊", "u1", "group", false));
    expect(routes).toEqual([]);
    await handlers.onMessage(msgOf("@Cairn 看看这个", "u1", "group", true));
    expect(routes).toEqual(["@Cairn 看看这个"]);
  });

  it("生命周期对账：禁用停适配器、移除即断", async () => {
    const { captured, adapter } = captureAdapter();
    let stoppedCount = 0;
    const testAdapter: ImPlatformAdapter = {
      ...adapter,
      connect: (f, e, h) => {
        const handle = adapter.connect(f, e, h);
        return {
          ...handle,
          stop: () => {
            stoppedCount += 1;
            handle.stop();
          },
        };
      },
    };
    const { store } = fakeStore([conn()]);
    const host = createImHost({ store, platforms: { test: SPEC }, adapters: { test: testAdapter }, env: ENV, secretValue: async () => "sv", routeInbound: async () => ({ ok: true }) });
    await host.boot();
    expect(captured.handlers).not.toBeNull();
    await host.update({ id: "im_t1", enabled: false, putSecret: async () => ({ ok: true }) });
    expect(stoppedCount).toBe(1);
    await host.remove("im_t1");
    expect(stoppedCount).toBe(1);
    expect(host.view().connections).toHaveLength(0);
  });

  it("逐连接运行态：适配器读到的 runtime 挂在连接记录上，写回即落盘", async () => {
    let seen: Record<string, string> | null = null;
    const adapter: ImPlatformAdapter = {
      connect: (_f, env) => {
        seen = { ...(env.runtime?.get() ?? {}) };
        env.runtime?.set({ cursor: "cur-1" });
        return { send: async () => ({}), stop: () => undefined };
      },
      check: async () => ({ account: { id: "bot", name: "测试机器人" } }),
    };
    const { store, savedCount } = fakeStore([conn({ runtime: { cursor: "cur-0", contextTokensJson: "{}" } })]);
    const host = createImHost({
      store, platforms: { test: SPEC }, adapters: { test: adapter }, env: ENV,
      secretValue: async () => "sv", routeInbound: async () => ({ ok: true }),
    });
    await host.boot();
    // 读：适配器看到的是这条连接自己的运行态（不是宿主全局）。
    expect(seen).toEqual({ cursor: "cur-0", contextTokensJson: "{}" });
    // 写：patch 合并回连接记录并落盘（重启后从这条记录续跑，不重放）。
    expect(host.connectionOf("im_t1")?.runtime).toEqual({ cursor: "cur-1", contextTokensJson: "{}" });
    expect(savedCount()).toBeGreaterThan(0);
  });

  it("扫码登录端点：出码→确认建连（密钥落库、扫码人直接配对）；非扫码平台如实拒绝", async () => {
    const puts: { key: string; value: string }[] = [];
    const qrSpec: ImPlatformSpec = { ...SPEC, id: "qr", name: "扫码平台", login: "qr", fields: [] };
    const qrAdapter: ImPlatformAdapter = {
      connect: () => ({ send: async () => ({}), stop: () => undefined }),
      check: async () => ({ account: { id: "bot", name: "扫码机器人" } }),
      loginStart: async () => ({ loginId: "l1", qr: "data:image/png;base64,QQ==", expiresAt: 9_999 }),
      loginWait: async (loginId) => loginId === "l1"
        ? {
            status: "done",
            connection: {
              settings: { baseUrl: "https://ilinkai.weixin.qq.com/" },
              secrets: { token: "tk-1" },
              account: { id: "bot-1", name: "微信" },
            },
            owner: { id: "u-owner", name: "u-owner" },
          }
        : { status: "expired" },
    };
    const plain = captureAdapter().adapter;
    const { store } = fakeStore([]);
    const host = createImHost({
      store, platforms: { test: SPEC, qr: qrSpec }, adapters: { test: plain, qr: qrAdapter }, env: ENV,
      secretValue: async () => "sv", routeInbound: async () => ({ ok: true }),
    });
    await host.boot();
    await expect(host.loginStart("qr")).resolves.toMatchObject({ ok: true, loginId: "l1", qr: "data:image/png;base64,QQ==" });
    await expect(host.loginStart("test")).resolves.toMatchObject({ ok: false });
    const putSecret = async (key: string, value: string): Promise<{ ok: boolean }> => {
      puts.push({ key, value });
      return { ok: true };
    };
    await expect(host.loginWait({ platform: "qr", loginId: "l404", putSecret }))
      .resolves.toMatchObject({ ok: true, status: "expired" });
    const done = await host.loginWait({ platform: "qr", loginId: "l1", putSecret });
    expect(done).toMatchObject({ ok: true, status: "done" });
    const created = host.view().connections.find((c) => c.id === done.id);
    expect(created?.account).toEqual({ id: "bot-1", name: "微信" });
    // 本人扫的码：扫码人直接进配对名单 + 一条私聊，不再走审批。
    expect(created?.paired.map((p) => p.id)).toEqual(["u-owner"]);
    expect(created?.chats["u-owner"]).toEqual({ kind: "direct", key: "u-owner", title: "u-owner" });
    // 密钥只传进 putSecret（落 safeStorage），记录里只有键名。
    expect(puts).toEqual([{ key: `im:${String(done.id)}:token`, value: "tk-1" }]);
    expect(JSON.stringify(created)).not.toContain("tk-1");
  });
});
