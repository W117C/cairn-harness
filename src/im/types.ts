// IM 通道核心类型（2026-11-17 · 通道线）。
//
// 连接 = 一个外部 IM 机器人账号 ↔ 一个 Cairn 会话的绑定。平台适配器拥有线协议
// （连接/断线重连/收发格式），宿主（host.ts）拥有配对、路由、发送队列与生命周期；
// 两者只经本文件的接口相接 ⇒ 适配器可注入假实现做验收。
//
// 依赖纪律：本目录 electron-free、无新 npm 依赖——fetch / WebSocket / TLS 套接字
// 全部走注入面（生产 = 全局对象与 node:tls，判卷 = 假实现）。

/** 平台表单字段描述。`secret` 字段只存「密钥名」，值运行期从环境变量读（不落盘）。 */
export interface ImPlatformField {
  key: string;
  label: string;
  /** 密钥字段：值不进连接记录，只记名字（`CAIRN_IM_*` 环境变量）。 */
  secret?: boolean;
  /** 表单占位说明（渲染层直接展示）。 */
  hint?: string;
}

/** 平台注册条目：设置页据此渲染表单，宿主据此找适配器。
 *  `login: "qr"` = 扫码登录（微信 iLink）：设置面走二维码流而不是表单。 */
export interface ImPlatformSpec {
  id: string;
  name: string;
  /** 该平台是否需要 WebSocket（无全局 WebSocket 的环境如实报错）。 */
  ws: boolean;
  /** 登录形态：缺省 = 表单（fields）；"qr" = 扫码（loginStart/loginWait）。 */
  login?: "fields" | "qr";
  fields: ImPlatformField[];
  /** 该平台侧的文字长度上限（发送前截断/分片）。 */
  textLimit: number;
}

/** 聊天（对话）：direct = 私聊，group = 群聊。key 是平台侧的稳定 id。 */
export interface ImChat {
  key: string;
  kind: "direct" | "group";
  title: string;
}

export interface ImSender {
  id: string;
  name: string;
}

/** 归一化入站消息：适配器把各家线协议折成这一种形状给宿主。 */
export interface ImInboundMessage {
  chat: ImChat;
  sender: ImSender;
  text: string;
  /** 群里是否 @ 了机器人（direct 恒真；group 消息没 @ 则宿主忽略）。 */
  mentioned: boolean;
  messageId: string;
}

/** 连接状态：宿主如实在设置页点名（error 带平台回话，不吞）。 */
export interface ImStatus {
  state: "off" | "connecting" | "ready" | "retrying" | "error";
  error?: string;
  at?: number;
}

/** 适配器运行句柄：宿主只经它发消息与停止。 */
export interface ImAdapterHandle {
  send: (chat: ImChat, text: string) => Promise<{ messageId?: string }>;
  stop: () => Promise<void> | void;
}

export interface ImConnectHandlers {
  onMessage: (msg: ImInboundMessage) => Promise<void> | void;
  onStatus: (status: ImStatus) => void;
}

/** 行式套接字（IMAP/SMTP 这类行协议用；生产 = node:tls，判卷 = 内存假线）。 */
export interface ImLineSocket {
  /** 读一行（不含行尾 CRLF）；连接关闭返回 null。 */
  readLine: () => Promise<string | null>;
  write: (line: string) => Promise<void>;
  writeRaw: (chunk: string) => Promise<void>;
  end: () => Promise<void> | void;
}

/** 连接环境：注入面（生产 = 全局 fetch/WebSocket + node:tls；判卷 = 假实现）。 */
export interface ImEnv {
  fetch: typeof fetch;
  WebSocket?: typeof WebSocket;
  /** TLS 行套接字工厂（邮件适配器用；缺省 = 邮件适配器如实报错）。 */
  tlsConnect?: (opts: { host: string; port: number }) => Promise<ImLineSocket>;
  /** 逐连接运行态（游标/context_token 等；宿主按连接注入，值随连接记录持久化）。 */
  runtime?: { get: () => Record<string, string>; set: (patch: Record<string, string>) => void };
  log?: { warn: (template: string, ...args: unknown[]) => void };
}

/** 平台适配器：拥有线协议。connect 返回运行句柄；check 验凭据并取机器人身份。
 *  扫码平台（login:"qr"）另给 loginStart/loginWait（设置面的二维码流驱动）。 */
export interface ImPlatformAdapter {
  connect: (
    fields: Record<string, string>,
    env: ImEnv,
    handlers: ImConnectHandlers,
  ) => ImAdapterHandle;
  check: (
    fields: Record<string, string>,
    env: ImEnv,
  ) => Promise<{ account: { id: string; name: string } }>;
  /** 生成登录二维码（loginId 由适配器自管，loginWait 按它取状态）。 */
  loginStart?: (env: ImEnv) => Promise<{ loginId: string; qr: string; expiresAt: number }>;
  /** 查一次二维码状态：waiting/scanned/expired；confirmed → 连接材料+扫码人。 */
  loginWait?: (
    loginId: string,
    env: ImEnv,
  ) => Promise<{
    status: "waiting" | "scanned" | "expired" | "done";
    connection?: { settings: Record<string, string>; secrets: Record<string, string>; account: { id: string; name: string } };
    owner?: { id: string; name: string };
  }>;
}

/** 一条连接的持久化形状（connections.json 单条）。密钥只存 safeStorage 键名。 */
export interface ImConnection {
  id: string;
  platform: string;
  /** 机器人显示身份（check 成功时落，只读展示）。 */
  account: { id: string; name: string } | null;
  /** 绑定的会话 id（消息与回复都走它；空 = 未绑定，首条消息时由主进程新建）。 */
  sessionId: string;
  /** 工作区（缺省 = 主工作区解析）。 */
  workspace?: string;
  /** 非密钥表单值。 */
  settings: Record<string, string>;
  /** 密钥字段 → safeStorage 键名（值不落盘，只在加密存储里）。 */
  secretKeys: Record<string, string>;
  enabled: boolean;
  /** 已配对的发件人（外部账号白名单；未配对发件人的首条消息落 requests 等人批）。 */
  paired: { id: string; name: string; at: number }[];
  /** 待审的连接请求（等人批；批准后进 paired）。 */
  requests: { id: string; name: string; chat: ImChat; at: number }[];
  /** 见过的聊天（chatKey → 归一化聊天），用于回信寻址。 */
  chats: Record<string, ImChat>;
  /** 逐连接运行态（游标/context_token；路由状态不是凭据，随连接记录持久化）。 */
  runtime?: Record<string, string>;
  createdAt: number;
}
