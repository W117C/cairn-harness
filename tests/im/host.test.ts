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

  // 2026-11-18 审计：图片/文件/无转写语音归一化后 text 是空串（见 ImInboundMessage 只有 text）。
  // 空的入站不许进 routeInbound：那里会「没会话先建一个、再起一次空跑」——白烧一次模型调用，
  // 会话里还多一个空气泡。宿主回一句如实的范围说明（沉默会被读成"坏了"）。
  it("空文本闸：空串不路由，回一句范围说明", async () => {
    const { captured, adapter } = captureAdapter();
    const routes: string[] = [];
    const { store } = fakeStore([conn()]);
    const host = createImHost({ store, platforms: { test: SPEC }, adapters: { test: adapter }, env: ENV, secretValue: async () => "sv", routeInbound: async (_c, m) => { routes.push(m.text); return { ok: true, reply: "不该出现的回信" }; } });
    await host.boot();
    const handlers = captured.handlers;
    if (handlers === null) throw new Error("适配器没有交出 handlers");
    await handlers.onMessage(msgOf("   ", "u1"));
    expect(routes).toEqual([]);
    await new Promise((r) => setTimeout(r, 20));
    // 原句证人（第 311 页那一维：模型可见的能力断言必须有判卷点过）。上面两格是**行为观测者**
    // （不路由、不建会话）；这一行才是把生产那句边界文案逐字钉住——只钉行为会让文案漂走也没人管。
    expect(captured.sends.some((s) => s.includes("这条消息里没有文字。当前只收文本与语音转写，图片/文件还不支持。"))).toBe(true);
    // 反向锚点：有文字的一条照旧路由——闸只挡空串，不吞正常消息。
    await handlers.onMessage(msgOf("看看构建", "u1"));
    expect(routes).toEqual(["看看构建"]);
  });

  // 2026-11-18 审计（架构面）：发送队列有两条会**静默丢消息**的路——
  //   ① 连接窗口期（`await secretValue` 那一段）进队列的回信：drain 见 handle === null 立刻返回，
  //      而「再 kick」只有 enqueue 的「空→非空」那一拍 ⇒ 消息一直躺着，不报错不重试不送达；
  //   ② `retry`（用户点重试）走 stop→sync，stop 连队列一起删 ⇒ 重试等于把待发回信扔掉。
  // 两条都不是「没做功能」，是「功能在，边界上丢」。
  it("建连窗口期排队的回信，连上后自动补发", async () => {
    const { captured, adapter } = captureAdapter();
    const { store } = fakeStore([conn({ chats: { chat1: { kind: "direct", key: "chat1", title: "" } } })]);
    // 用持有对象而不是裸 let：TS 的控制流会把「只在 Promise 执行器里赋值」的裸变量收成 null，
    // 到调用点就成了 not callable（这次真踩了，记一笔）。
    const gate: { release?: () => void } = {};
    const host = createImHost({
      store, platforms: { test: SPEC }, adapters: { test: adapter }, env: ENV,
      // 密钥读取慢一拍 ⇒ 稳稳制造「槽位已占、handle 还是 null」的窗口
      secretValue: () => new Promise<string | undefined>((resolve) => { gate.release = () => { resolve("sv"); }; }),
      routeInbound: async () => ({ ok: true }),
    });
    const booting = host.boot();
    // 等它真的进到「槽位已占、handle 还没给」那一刻（status=connecting 就是那一拍），再投回信
    for (let i = 0; i < 200 && host.statusOf("im_t1")?.state !== "connecting"; i += 1) {
      await new Promise((r) => setTimeout(r, 1));
    }
    expect(host.statusOf("im_t1")?.state).toBe("connecting");
    host.sendTo("im_t1", "chat1", "窗口里发出的回信");
    await new Promise((r) => setTimeout(r, 5));
    expect(captured.sends).toEqual([]);
    gate.release?.();
    await booting;
    await new Promise((r) => setTimeout(r, 20));
    expect(captured.sends).toContain("chat1|窗口里发出的回信");
  });

  it("重试（retry）不丢待发队列：队列停靠后由下一次建连接手补发", async () => {
    const captured = { handlers: null as ImConnectHandlers | null, sends: [] as string[] };
    let failNext = true;
    const adapter: ImPlatformAdapter = {
      connect: (_f, _e, handlers) => {
        captured.handlers = handlers;
        return {
          send: async (chat, text) => {
            if (failNext) { failNext = false; throw Object.assign(new Error("临时失败"), { status: 503 }); }
            captured.sends.push(chat.key + "|" + text);
            return {};
          },
          stop: () => undefined,
        };
      },
      check: async () => ({ account: { id: "bot-1", name: "测试机器人" } }),
    };
    const { store } = fakeStore([conn({ chats: { chat1: { kind: "direct", key: "chat1", title: "" } } })]);
    const host = createImHost({ store, platforms: { test: SPEC }, adapters: { test: adapter }, env: ENV, secretValue: async () => "sv", routeInbound: async () => ({ ok: true }) });
    await host.boot();
    host.sendTo("im_t1", "chat1", "重试后仍要送达");
    await new Promise((r) => setTimeout(r, 10));
    expect(captured.sends).toEqual([]);          // 第一次发失败（503 ⇒ 可重试）
    await host.retry("im_t1");                   // 用户点「重试」＝重连
    await new Promise((r) => setTimeout(r, 30));
    expect(captured.sends).toContain("chat1|重试后仍要送达");
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
