// 平台注册表（2026-11-17 · 通道线）：设置页的表单面与宿主的适配器查找共用这一张表。
import { feishuAdapter, FEISHU_TEXT_LIMIT } from "./platforms/feishu";
import { emailAdapter, EMAIL_PLATFORM } from "./platforms/email";
import { wecomAdapter, WECOM_TEXT_LIMIT } from "./platforms/wecom";
import { weixinAdapter, WEIXIN_TEXT_LIMIT } from "./platforms/weixin";
import type { ImPlatformAdapter, ImPlatformSpec, ImPlatformField } from "./types";

/** 飞书表单字段（appId/appSecret；domain 切国际版 Lark）。 */
const FEISHU_FIELDS: ImPlatformField[] = [
  { key: "appId", label: "App ID", hint: "飞书开放平台 · 企业自建应用" },
  { key: "appSecret", label: "App Secret", secret: true },
  { key: "domain", label: "域名", hint: "留空 = feishu.cn；填 lark = 国际版 Lark" },
];

export const FEISHU_PLATFORM: ImPlatformSpec = {
  id: "feishu",
  name: "飞书（长连接）",
  ws: true,
  fields: FEISHU_FIELDS,
  textLimit: FEISHU_TEXT_LIMIT,
};

/** 企业微信智能机器人表单字段（botId/secret；secret 走 safeStorage）。 */
const WECOM_FIELDS: ImPlatformField[] = [
  { key: "botId", label: "机器人 ID", hint: "企业微信管理台 · 智能机器人" },
  { key: "secret", label: "机器人 Secret", secret: true },
];

export const WECOM_PLATFORM: ImPlatformSpec = {
  id: "wecom",
  name: "企业微信（智能机器人）",
  ws: true,
  fields: WECOM_FIELDS,
  textLimit: WECOM_TEXT_LIMIT,
};

/** 微信 iLink 机器人表单说明（扫码登录：连接材料由确认回包落，不填表单）。 */
const WEIXIN_FIELDS: ImPlatformField[] = [
  // 键名与 connectWeixin/checkWeixin 读的 fields 同名：settings 里的 baseUrl + safeStorage 里的 token。
  { key: "baseUrl", label: "接口地址", hint: "扫码确认后自动落（ilinkai.weixin.qq.com）；手工建连才需要填" },
  { key: "token", label: "Bot Token", secret: true, hint: "扫码确认后自动落（safeStorage）；留空走二维码流" },
];

export const WEIXIN_PLATFORM: ImPlatformSpec = {
  id: "weixin",
  name: "微信（iLink 机器人）",
  ws: false,
  login: "qr",
  fields: WEIXIN_FIELDS,
  textLimit: WEIXIN_TEXT_LIMIT,
};

/** 平台清单（设置页按此渲染；v81 = 飞书 + 邮件 + 企业微信 + 微信）。 */
export const IM_PLATFORMS: ImPlatformSpec[] = [FEISHU_PLATFORM, EMAIL_PLATFORM, WECOM_PLATFORM, WEIXIN_PLATFORM];

/** 适配器查找表。 */
export const IM_ADAPTERS: Record<string, ImPlatformAdapter> = {
  feishu: feishuAdapter,
  email: emailAdapter,
  wecom: wecomAdapter,
  weixin: weixinAdapter,
};
