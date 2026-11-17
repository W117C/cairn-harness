// 平台注册表（2026-11-17 · 通道线）：设置页的表单面与宿主的适配器查找共用这一张表。
import { feishuAdapter, FEISHU_TEXT_LIMIT } from "./platforms/feishu";
import { emailAdapter, EMAIL_PLATFORM } from "./platforms/email";
import { wecomAdapter, WECOM_TEXT_LIMIT } from "./platforms/wecom";
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

/** 平台清单（设置页按此渲染；v80.1 = 飞书 + 邮件 + 企业微信）。 */
export const IM_PLATFORMS: ImPlatformSpec[] = [FEISHU_PLATFORM, EMAIL_PLATFORM, WECOM_PLATFORM];

/** 适配器查找表。 */
export const IM_ADAPTERS: Record<string, ImPlatformAdapter> = {
  feishu: feishuAdapter,
  email: emailAdapter,
  wecom: wecomAdapter,
};
