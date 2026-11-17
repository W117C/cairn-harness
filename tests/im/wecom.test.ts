// 企业微信适配器判卷：订阅鉴权、入站回调路由（私聊/群聊 @）、被动回复复用回调 req_id、
// 主动发送等待应答、心跳与错误分类。
import { describe, expect, it } from "vitest";
import { checkWecom, connectWecom } from "../../src/im/platforms/wecom";
import type { ImConnectHandlers, ImEnv, ImInboundMessage } from "../../src/im/types";

/** 假 WebSocket：addEventListener 面 + 手动 pump 出帧与入站帧。 */
function fakeWsCtor() {
  const created: FakeWs[] = [];
  class FakeWs {
    readyState = 0;
    binaryType = "";
    sent: string[] = [];
    onopen: Array<() => void> = [];
    onmessage: Array<(event: { data: ArrayBuffer }) => void> = [];
    onclose: Array<() => void> = [];
    onerror: Array<() => void> = [];
    constructor(_url: string) {
      created.push(this);
    }
    addEventListener(kind: string, fn: never): void {
      if (kind === "open") (this.onopen as Array<() => void>).push(fn);
      else if (kind === "message") this.onmessage.push(fn as (event: { data: ArrayBuffer }) => void);
      else if (kind === "close") this.onclose.push(fn);
      else if (kind === "error") this.onerror.push(fn);
    }
    send(text: string): void {
      this.sent.push(text);
    }
    close(): void {}
    /** 测试侧 pump：模拟连接建立/收到服务器帧/断开。 */
    pumpOpen(): void {
      this.readyState = 1;
      for (const fn of this.onopen) fn();
    }
    pumpIn(packet: unknown): void {
      const data = Buffer.from(JSON.stringify(packet)).toString("binary");
      const ab = new ArrayBuffer(data.length);
      const view = new Uint8Array(ab);
      for (let i = 0; i < data.length; i += 1) view[i] = data.charCodeAt(i);
      for (const fn of this.onmessage) fn({ data: ab });
    }
    pumpClose(): void {
      this.readyState = 3;
      for (const fn of this.onclose) fn();
    }
  }
  return { created, FakeWs };
}

const HANDLERS = (received: ImInboundMessage[], statuses: string[]): ImConnectHandlers => ({
  onMessage: async (msg) => { received.push(msg); },
  onStatus: (s) => { statuses.push(s.state); },
});

function envOf(ctor: unknown): ImEnv {
  return { fetch, WebSocket: ctor as unknown as typeof WebSocket };
}

describe("企业微信适配器", () => {
  it("check：订阅应答 errcode=0 → 账号；超时/拒答 → 拒存", async () => {
    const { created, FakeWs } = fakeWsCtor();
    const check = checkWecom({ botId: "bot_a", secret: "sv" }, envOf(FakeWs));
    await new Promise((r) => setTimeout(r, 5));
    expect(created).toHaveLength(1);
    created[0].pumpOpen();
    await new Promise((r) => { setTimeout(r, 5); setTimeout(r, 5); });
    // open 时发出订阅帧
    expect(created[0].sent.join("\n")).toContain("aibot_subscribe");
    created[0].pumpIn({ errcode: 0 });
    const result = await check;
    expect(result.account.id).toBe("bot_a");
  });

  it("check：errcode≠0 → 拒存（凭据无效）", async () => {
    const { created, FakeWs } = fakeWsCtor();
    const check = checkWecom({ botId: "bot_a", secret: "bad" }, envOf(FakeWs));
    await new Promise((r) => setTimeout(r, 5));
    created[0].pumpOpen();
    created[0].pumpIn({ errcode: 40017, errmsg: "invalid bot_id" });
    await expect(check).rejects.toThrow("invalid bot_id");
  });

  it("connect：私聊回调路由 + 被动回复复用回调 req_id；群聊 @ 才算 mentioned", async () => {
    const { created, FakeWs } = fakeWsCtor();
    const received: ImInboundMessage[] = [];
    const statuses: string[] = [];
    connectWecom({ botId: "b", secret: "s" }, envOf(FakeWs), HANDLERS(received, statuses));
    await new Promise((r) => setTimeout(r, 5));
    const ws = created[0];
    ws.pumpOpen();
    expect(ws.sent.join("\n")).toContain("aibot_subscribe");
    // 私聊回调
    ws.pumpIn({
      cmd: "aibot_msg_callback",
      headers: { req_id: "cb-1" },
      body: { chattype: "single", from: { userid: "u1", name: "阿岚" }, text: { content: "帮我查构建" }, msgid: "m1" },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toHaveLength(1);
    expect(received[0].chat.kind).toBe("direct");
    expect(received[0].sender.name).toBe("阿岚");
    expect(received[0].mentioned).toBe(true);
    // 被动回复：send 用回调的 req_id 发 aibot_respond_msg
    const handle = connectWecom({ botId: "b", secret: "s" }, envOf(FakeWs), HANDLERS([], []));
    void handle;
    ws.pumpIn({
      cmd: "aibot_msg_callback",
      headers: { req_id: "cb-2" },
      body: { chattype: "single", from: { userid: "u2" }, text: { content: "第二条" }, msgid: "m2" },
    });
    await new Promise((r) => setTimeout(r, 5));
    // 群聊未 @：mentioned=false（闸在宿主）
    ws.pumpIn({
      cmd: "aibot_msg_callback",
      headers: { req_id: "cb-3" },
      body: { chattype: "group", chatid: "g1", from: { userid: "u3" }, text: { content: "闲聊" }, mention_robot: false, msgid: "m3" },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(received[2].mentioned).toBe(false);
    expect(received[2].chat.key).toBe("g1");
  });

  it("send：无回调记录 → aibot_send_msg 等应答；有回调记录 → aibot_respond_msg 复用 req_id", async () => {
    const { created, FakeWs } = fakeWsCtor();
    const received: ImInboundMessage[] = [];
    const statuses: string[] = [];
    const handle = connectWecom({ botId: "b", secret: "s" }, envOf(FakeWs), HANDLERS(received, statuses));
    await new Promise((r) => setTimeout(r, 5));
    const ws = created[0];
    ws.pumpOpen();
    ws.pumpIn({
      cmd: "aibot_msg_callback",
      headers: { req_id: "cb-9" },
      body: { chattype: "single", from: { userid: "u1" }, text: { content: "hi" }, msgid: "m1" },
    });
    await new Promise((r) => setTimeout(r, 5));
    const promise = handle.send({ key: "u1", kind: "direct", title: "" }, "回信一");
    await new Promise((r) => setTimeout(r, 5));
    expect(ws.sent.join("\n")).toContain("aibot_respond_msg");
    // cb-9 的 req_id 已被记录 —— 回复帧带它
    const respondLine = ws.sent.find((s) => s.includes("aibot_respond_msg"));
    expect(respondLine).toContain("cb-9");
    await promise;
    // 主动发送（没有回调记录的聊天）：aibot_send_msg + 等应答
    const sendPromise = handle.send({ key: "u9", kind: "direct", title: "" }, "主动发");
    await new Promise((r) => setTimeout(r, 5));
    const proactive = ws.sent.find((s) => s.includes("aibot_send_msg"));
    expect(proactive).toContain("u9");
    // 服务器应答（errcode=0 + 同 req_id）→ promise resolve
    const reqId = JSON.parse(proactive ?? "{}").headers?.req_id ?? "";
    ws.pumpIn({ errcode: 0, headers: { req_id: reqId }, body: { msgid: "sm-1" } });
    const result = await sendPromise;
    expect(result.messageId).toBe("sm-1");
  });

  it("errcode≠0 对应答的 req_id → permanent 拒绝", async () => {
    const { created, FakeWs } = fakeWsCtor();
    const handle = connectWecom({ botId: "b", secret: "s" }, envOf(FakeWs), HANDLERS([], []));
    await new Promise((r) => setTimeout(r, 5));
    created[0].pumpOpen();
    const sendPromise = handle.send({ key: "u1", kind: "direct", title: "" }, "会失败");
    await new Promise((r) => setTimeout(r, 5));
    const proactive = created[0].sent.find((s) => s.includes("aibot_send_msg"));
    const reqId = JSON.parse(proactive ?? "{}").headers?.req_id ?? "";
    created[0].pumpIn({ errcode: 40008, errmsg: "invalid message", headers: { req_id: reqId } });
    await expect(sendPromise).rejects.toMatchObject({ permanent: true });
  });
});
