// 通道分区判卷（v80 IM 通道线的设置面）：连接清单、状态点名、待审请求、平台表单。
// 手法同 team-section 判卷：SSR 注入读数（生产走 imList IPC）。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChannelsSection } from "../src/renderer/components/settings/ChannelsSection";
import type { ImConnectionViewPayload } from "../../../src/main/ipc-protocol";

const PLATFORMS = [
  {
    id: "feishu", name: "飞书（长连接）", ws: true, textLimit: 4000,
    fields: [
      { key: "appId", label: "App ID" },
      { key: "appSecret", label: "App Secret", secret: true },
    ],
  },
  {
    id: "email", name: "邮件（IMAP/SMTP）", ws: false, textLimit: 3500,
    fields: [
      { key: "address", label: "邮箱地址" },
      { key: "password", label: "授权码", secret: true },
    ],
  },
];

const CONN = (over: Partial<ImConnectionViewPayload> = {}): ImConnectionViewPayload => ({
  id: "im_a1",
  platform: "feishu",
  account: { id: "bot-1", name: "卡恩助手" },
  sessionId: "s1",
  settings: {},
  secretKeys: { appSecret: "im:a1:appSecret" },
  enabled: true,
  paired: [{ id: "u1", name: "阿岚", at: 1 }],
  requests: [],
  chats: {},
  createdAt: 1,
  status: { state: "ready" },
  ...over,
});

describe("通道分区", () => {
  it("平台选择器 + 表单（密钥字段是密码框）", () => {
    const html = renderToStaticMarkup(<ChannelsSection initialConnections={[]} initialPlatforms={PLATFORMS} />);
    expect(html).toContain("飞书（长连接）");
    expect(html).toContain("邮件（IMAP/SMTP）");
    // 表单只渲染选中平台的字段（缺省选第一个平台）——飞书 1 个密钥框。
    expect((html.match(/type="password"/g) ?? []).length).toBe(1);
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
  });

  it("连接清单：状态、绑定会话、启停/重连/移除都在；空清单给「为什么是空的」", () => {
    const html = renderToStaticMarkup(<ChannelsSection initialConnections={[CONN()]} initialPlatforms={PLATFORMS} />);
    expect(html).toContain("卡恩助手");
    expect(html).toContain("已连接");
    expect(html).toContain("绑定会话 s1");
    expect(html).toContain("重连");
    expect(html).toContain("移除");
    const empty = renderToStaticMarkup(<ChannelsSection initialConnections={[]} initialPlatforms={PLATFORMS} />);
    expect(empty).toContain("还没有通道");
  });

  it("待审批请求点名显示，允许/拒绝都在", () => {
    const html = renderToStaticMarkup(
      <ChannelsSection
        initialConnections={[CONN({ requests: [{ id: "u9", name: "路人甲", chat: { key: "c1", kind: "direct", title: "" }, at: 2 }] })]}
        initialPlatforms={PLATFORMS}
      />,
    );
    expect(html).toContain("路人甲");
    expect(html).toContain("允许");
    expect(html).toContain("拒绝");
  });

  it("出错状态如实点名（不糊成一句失败）", () => {
    const html = renderToStaticMarkup(
      <ChannelsSection initialConnections={[CONN({ status: { state: "error", error: "飞书拒绝了这组凭据" } })]} initialPlatforms={PLATFORMS} />,
    );
    expect(html).toContain("出错：飞书拒绝了这组凭据");
  });
});
