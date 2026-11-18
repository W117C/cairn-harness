// 微信 iLink 适配器判卷：出站域校验、扫码登录三态、check 令牌探活、开会话→长轮询→
// 游标推进→context_token 记忆→发送；会话过期如实点名。
import { describe, expect, it } from "vitest";
import { assertIlinkEndpoint, checkWeixin, connectWeixin, loginStartWeixin, loginWaitWeixin } from "../../src/im/platforms/weixin";
import type { ImConnectHandlers, ImEnv, ImInboundMessage } from "../../src/im/types";

/** 假 fetch：按脚本出 Response，并记录每次请求。
 *  `hold: true` = 模拟长轮询挂住（不 resolve，直到测试结束）——否则空应答会让轮询
 *  立刻再发下一问，把脚本里后面的「发送」条目抢走。 */
function fakeFetch(script: Array<{ url: string; body?: unknown; status?: number; hold?: boolean }>) {
  const requests: Array<{ url: string; body: string }> = [];
  const fetchMock = (async (url: string | URL, init?: RequestInit) => {
    const urlText = String(url);
    const bodyText = typeof init?.body === "string" ? init.body : "";
    requests.push({ url: urlText, body: bodyText });
    const next = script.shift();
    if (next === undefined) throw new Error("假 fetch 脚本用尽");
    if (next.hold === true) return await new Promise<Response>(() => { /* 挂住 */ });
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status ?? 200 });
  }) as unknown as typeof fetch;
  return { requests, fetchMock };
}

const HANDLERS = (received: ImInboundMessage[], statuses: string[]): ImConnectHandlers => ({
  onMessage: async (msg) => { received.push(msg); },
  onStatus: (s) => { statuses.push(s.state); },
});

describe("出站域校验", () => {
  it("官方域放行并归一斜杠；localhost/私有/非官方域一律拒绝", () => {
    expect(assertIlinkEndpoint("https://ilinkai.weixin.qq.com")).toBe("https://ilinkai.weixin.qq.com/");
    expect(() => assertIlinkEndpoint("https://127.0.0.1/x")).toThrow(/不可信/);
    expect(() => assertIlinkEndpoint("http://ilinkai.weixin.qq.com")).toThrow(/https/);
    expect(() => assertIlinkEndpoint("https://evil.example.com")).toThrow(/官方域/);
    expect(() => assertIlinkEndpoint("https://192.168.1.1")).toThrow(/不可信/);
  });
});

describe("扫码登录", () => {
  it("loginStart 出码；loginWait waiting→scanned→done（连接材料+扫码人）", async () => {
    const { fetchMock } = fakeFetch([
      { url: "get_bot_qrcode", body: { qrcode: "qr-abc", qrcode_img_content: "data:image/png;base64,QUJD" } },
      { url: "get_qrcode_status", body: { status: "wait" } },
      { url: "get_qrcode_status", body: { status: "scaned" } },
      {
        url: "get_qrcode_status",
        body: {
          status: "confirmed", baseurl: "https://ilinkai.weixin.qq.com", bot_token: "tk-1",
          ilink_bot_id: "ibot-1", ilink_user_id: "u-owner",
        },
      },
    ]);
    const env: ImEnv = { fetch: fetchMock };
    const started = await loginStartWeixin(env);
    expect(started.loginId).toMatch(/^wx_/);
    expect(started.qr).toContain("data:image/png");
    expect((await loginWaitWeixin(started.loginId, env)).status).toBe("waiting");
    expect((await loginWaitWeixin(started.loginId, env)).status).toBe("scanned");
    const done = await loginWaitWeixin(started.loginId, env);
    expect(done.status).toBe("done");
    expect(done.connection?.secrets.token).toBe("tk-1");
    expect(done.owner?.id).toBe("u-owner");
    // done 后 loginId 已消费：再查 = expired
    expect((await loginWaitWeixin(started.loginId, env)).status).toBe("expired");
  });
});

describe("check 与 connect", () => {
  it("check：自证形状的 getupdates 应答 → 有效；ret≠0 → 拒存", async () => {
    const ok = fakeFetch([{ url: "getupdates", body: { msgs: [], get_updates_buf: "" } }]);
    const good = await checkWeixin({ token: "tk", baseUrl: "https://ilinkai.weixin.qq.com" }, { fetch: ok.fetchMock });
    expect(good.account.name).toBe("WeChat");
    const bad = fakeFetch([{ url: "getupdates", body: { ret: -14 } }]);
    await expect(checkWeixin({ token: "tk", baseUrl: "https://ilinkai.weixin.qq.com" }, { fetch: bad.fetchMock }))
      .rejects.toThrow(/微信应答/);
  });

  it("开会话→长轮询送消息→游标推进→发送带 context_token", async () => {
    const { requests, fetchMock } = fakeFetch([
      { url: "msg/notifystart", body: {} },
      { url: "getupdates", body: { msgs: [{ from_user_id: "u1", context_token: "ct-1", item_list: [{ type: 1, text_item: { text: "帮我查" } }] }], get_updates_buf: "cur-1" } },
      { url: "getupdates", body: { msgs: [], get_updates_buf: "cur-1" } },
      { url: "getupdates", hold: true },
      { url: "sendmessage", body: { ret: 0 } },
    ]);
    const runtimeStore: Record<string, string> = {};
    const received: ImInboundMessage[] = [];
    const statuses: string[] = [];
    const env: ImEnv = {
      fetch: fetchMock,
      runtime: {
        get: () => runtimeStore,
        set: (patch) => { Object.assign(runtimeStore, patch); },
      },
    };
    const handle = connectWeixin({ token: "tk", baseUrl: "https://ilinkai.weixin.qq.com" }, env, HANDLERS(received, statuses));
    await new Promise((r) => setTimeout(r, 30));
    expect(received).toHaveLength(1);
    expect(received[0].text).toBe("帮我查");
    expect(runtimeStore.cursor).toBe("cur-1");
    await handle.send({ key: "u1", kind: "direct", title: "" }, "回信");
    const sendReq = requests.find((r) => r.url.includes("sendmessage"));
    expect(sendReq?.body).toContain("context_token");
    expect(sendReq?.body).toContain("回信");
    handle.stop();
    await new Promise((r) => setTimeout(r, 10));
  });

  it("会话过期（-14）如实点名并停轮询", async () => {
    const { fetchMock } = fakeFetch([
      { url: "msg/notifystart", body: {} },
      { url: "getupdates", body: { ret: -14 } },
    ]);
    const statuses: string[] = [];
    const env: ImEnv = { fetch: fetchMock };
    const handle = connectWeixin({ token: "tk", baseUrl: "https://ilinkai.weixin.qq.com" }, env, HANDLERS([], statuses));
    await new Promise((r) => setTimeout(r, 30));
    expect(statuses).toContain("error");
    handle.stop();
  });
});
