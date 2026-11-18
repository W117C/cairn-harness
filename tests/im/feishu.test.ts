// 飞书适配器与平台注册表判卷：pbbp2 编解码回环、凭据检查的 permanent 分类、注册表形状。
// 这份判卷同时是 src-execution-path 的执行路径供给（platforms/feishu.ts、platforms.ts）。
import { describe, expect, it } from "vitest";
import { decodeFrame, encodeFrame, checkFeishu, feishuAdapter, FEISHU_TEXT_LIMIT } from "../../src/im/platforms/feishu";
import { IM_PLATFORMS, IM_ADAPTERS, FEISHU_PLATFORM, WEIXIN_PLATFORM } from "../../src/im/platforms";
import type { ImEnv } from "../../src/im/types";

/** pbbp2 帧编解码回环：SeqID/method/headers/payload 全字段。 */
describe("飞书 pbbp2 编解码", () => {
  it("编→解逐字段还原", () => {
    const frame = {
      SeqID: 42,
      method: 1,
      headers: [{ key: "type", value: "event" }, { key: "message_id", value: "mid-1" }],
      payload: Buffer.from("载荷文本", "utf8"),
      payloadType: "json",
    };
    const decoded = decodeFrame(encodeFrame(frame));
    expect(decoded).not.toBeNull();
    expect(decoded?.SeqID).toBe(42);
    expect(decoded?.method).toBe(1);
    expect(decoded?.headers).toEqual(frame.headers);
    expect(Buffer.from(decoded?.payload ?? new Uint8Array()).toString("utf8")).toBe("载荷文本");
    expect(decoded?.payloadType).toBe("json");
  });

  it("坏字节如实返回 null（脏帧不崩宿主）", () => {
    // 0x0f = field 1 wire 7 —— 非法线型。
    expect(decodeFrame(Buffer.from([0x0f]))).toBeNull();
  });
});

/** checkFeishu：凭据拒绝时 permanent 分类（4xx 拒存不重试；5xx/429 留在重试档）。 */
describe("飞书凭据检查", () => {
  const envWith = (status: number, body: unknown): ImEnv => ({
    fetch: (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch,
  });

  it("凭据拒绝 → permanent（拒存）", async () => {
    await expect(checkFeishu({ appId: "a", appSecret: "bad" }, envWith(200, { code: 99991663, msg: "invalid app_secret" })))
      .rejects.toThrow("invalid app_secret");
  });

  it("服务端故障（500）→ 非 permanent（留在重试档）", async () => {
    await expect(checkFeishu({ appId: "a", appSecret: "x" }, envWith(500, { msg: "boom" })))
      .rejects.toMatchObject({ permanent: false });
  });

  it("注册表：四平台、适配器齐、字段含密钥位；微信走扫码", () => {
    expect(IM_PLATFORMS.map((p) => p.id)).toEqual(["feishu", "email", "wecom", "weixin"]);
    expect(IM_ADAPTERS.feishu).toBe(feishuAdapter);
    expect(IM_ADAPTERS.email).toBeDefined();
    expect(IM_ADAPTERS.wecom).toBeDefined();
    expect(IM_ADAPTERS.weixin).toBeDefined();
    expect(FEISHU_PLATFORM.ws).toBe(true);
    expect(FEISHU_PLATFORM.fields.some((f) => f.key === "appSecret" && f.secret === true)).toBe(true);
    expect(WEIXIN_PLATFORM.login).toBe("qr");
    expect(FEISHU_TEXT_LIMIT).toBeGreaterThan(0);
  });
});
