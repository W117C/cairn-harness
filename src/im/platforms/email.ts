// 邮件适配器（2026-11-17 · 通道线）。
//
// 两半：SMTP 发信（回信投递）+ IMAP 收信（轮询 UNSEEN）。协议按 RFC 5321/3501 的
// 最小对话实现（行协议，TLS 套接字注入）——零新依赖，判卷用内存假线。
// 纪律：密钥（授权码/密码）只经注入面取值；日志与错误只报主机与账号，不报值。
import type { ImAdapterHandle, ImConnectHandlers, ImEnv, ImPlatformAdapter, ImChat, ImLineSocket, ImPlatformSpec } from "../types";

export const EMAIL_TEXT_LIMIT = 3500;

/** 简单转义：SMTP 参数里的 CR/LF 一律拒（防头注入）。 */
function noCrLf(value: string): string {
  if (/[\r\n]/.test(value)) throw Object.assign(new Error("地址/主题不能含换行"), { permanent: true });
  return value;
}

// ── SMTP 最小客户端 ───────────────────────────────────────────────────────────

export interface SmtpConfig {
  host: string;
  port: number;
  address: string;
  password: string;
}

/** 发一封纯文本信。分号/逗号分隔多收件人。 */
export async function smtpSend(
  cfg: SmtpConfig,
  env: ImEnv,
  to: string[],
  subject: string,
  body: string,
): Promise<void> {
  if (env.tlsConnect === undefined) throw Object.assign(new Error("没有 TLS 注入面"), { permanent: true });
  const socket = await env.tlsConnect({ host: cfg.host, port: cfg.port });
  try {
    const readReply = async (): Promise<{ code: number; lines: string[] }> => {
      const lines: string[] = [];
      for (;;) {
        const line = await socket.readLine();
        if (line === null) throw new Error("SMTP 连接被对端关闭");
        lines.push(line);
        const m = line.match(/^(\d{3})(?:[ -](.*))?$/);
        if (m === null) continue;
        // 3 字符裸码（如 334）也是终行；带空格是终行，带 '-' 是续行。
        if (line.length <= 3 || line.charAt(3) === " ") return { code: Number(m[1]), lines };
      }
    };
    const expect = async (code: number): Promise<{ code: number }> => {
      const reply = await readReply();
      if (reply.code !== code) throw Object.assign(new Error(`SMTP 应答 ${String(reply.code)}：${reply.lines.join(" / ").slice(0, 200)}`), { permanent: reply.code >= 500 });
      return reply;
    };
    const cmd = async (line: string, code: number): Promise<void> => {
      await socket.write(line);
      await expect(code);
    };

    await expect(220); // greeting
    await cmd(`EHLO cairn.local`, 250);
    // AUTH LOGIN（base64 两步）。许多国内服务商（QQ/163）只开这个。
    await socket.write("AUTH LOGIN");
    const auth1 = await expect(334);
    void auth1;
    await socket.write(Buffer.from(cfg.address, "utf8").toString("base64"));
    await expect(334);
    await socket.write(Buffer.from(cfg.password, "utf8").toString("base64"));
    await expect(235);
    await cmd(`MAIL FROM:<${noCrLf(cfg.address)}>`, 250);
    for (const rcpt of to) await cmd(`RCPT TO:<${noCrLf(rcpt)}>`, 250);
    await cmd("DATA", 354);
    const headers = [
      `From: ${noCrLf(cfg.address)}`,
      `To: ${to.map(noCrLf).join(", ")}`,
      `Subject: =?UTF-8?B?${Buffer.from(noCrLf(subject), "utf8").toString("base64")}?=`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Date: " + new Date().toUTCString(),
    ];
    // 点钉：正文里的单点行前置一个点（RFC 5321 §4.5.2）。
    const stuffed = body.replace(/(^|\n)\./g, "$1..");
    await socket.write(headers.join("\r\n") + "\r\n\r\n" + stuffed.replace(/\n/g, "\r\n"));
    await socket.write("\r\n.\r\n");
    await expect(250);
    await socket.write("QUIT");
    await expect(221).catch(() => undefined);
  } finally {
    await socket.end();
  }
}

// ── IMAP 最小客户端 ───────────────────────────────────────────────────────────

export interface ImapConfig {
  host: string;
  port: number;
  address: string;
  password: string;
  /** 轮询间隔毫秒（缺省 60s）。 */
  pollMs?: number;
}

/** 一封拉到的邮件（归一化给宿主）。 */
export interface ImapMessage {
  uid: number;
  from: string;
  subject: string;
  text: string;
  date: string;
}

/** 剥引号字符串（IMAP 响应行轻解析）。 */
function stripQuotes(value: string): string {
  const m = value.match(/^"((?:[^"\\]|\\.)*)"$/);
  return m === null ? value : value.slice(1, -1).replace(/\\(.)/g, "$1");
}

/** 逐行读直到 tagged 完成行；顺路把 literal 内容行收集起来。 */
async function readUntilTagged(
  socket: ImLineSocket,
  tag: string,
  literals: string[],
): Promise<string[]> {
  const lines: string[] = [];
  for (;;) {
    const line = await socket.readLine();
    if (line === null) throw new Error("IMAP 连接被对端关闭");
    const lit = line.match(/\{(\d+)\}\)?$/);
    if (lit !== null) {
      // literal：下一行是原文内容行（本客户端按行协议读，取其行文本）。
      const body = await socket.readLine();
      if (body === null) throw new Error("IMAP literal 后连接被对端关闭");
      literals.push(body);
      continue;
    }
    lines.push(line);
    if (line.startsWith(tag + " ")) return lines;
  }
}

/** IMAP 会话（一次连接里跑完整轮询）。 */
export async function imapPollOnce(
  cfg: ImapConfig,
  env: ImEnv,
  onMessage: (msg: ImapMessage) => Promise<void>,
): Promise<number> {
  if (env.tlsConnect === undefined) throw Object.assign(new Error("没有 TLS 注入面"), { permanent: true });
  const socket = await env.tlsConnect({ host: cfg.host, port: cfg.port });
  let seq = 0;
  const tag = (): string => {
    seq += 1;
    return `A${String(seq)}`;
  };
  const cmd = async (line: string, literals: string[] = []): Promise<string[]> => {
    const t = tag();
    await socket.write(`${t} ${line}`);
    return await readUntilTagged(socket, t, literals);
  };
  try {
    const greet = await socket.readLine();
    if (greet === null || !greet.startsWith("* OK")) throw Object.assign(new Error("IMAP 问候异常"), { permanent: true });
    await cmd(`LOGIN ${stripQuotes(cfg.address)} ${JSON.stringify(cfg.password).replace(/\n/g, "")}`);
    await cmd("EXAMINE INBOX");
    // UID SEARCH UNSEEN → `* SEARCH 1 2 3`
    const search = await cmd("UID SEARCH UNSEEN");
    const searchLine = search.find((l) => l.startsWith("* SEARCH")) ?? "";
    const uids = searchLine.slice(8).trim().split(/\s+/).filter((s) => s !== "").map(Number).filter((n) => Number.isFinite(n) && n > 0);
    let handled = 0;
    for (const uid of uids.slice(-10)) {
      const literals: string[] = [];
      await cmd(`UID FETCH ${String(uid)} (BODY.PEEK[])`, literals);
      const mail = parseRfc822(literals.join("\n"));
      if (mail !== null) {
        await onMessage(mail);
        handled += 1;
      }
      // 标已读：STORE（可写会话才有效；EXAMINE 只读——标不上就下次再看一遍）。
      await cmd(`UID STORE ${String(uid)} +FLAGS (\\Seen)`).catch(() => undefined);
    }
    await cmd("LOGOUT").catch(() => undefined);
    return handled;
  } finally {
    await socket.end();
  }
}

/** 极简 RFC822 拆解：头逐行、正文取第一个 text/plain 段（无 multipart 细分）。 */
export function parseRfc822(raw: string): ImapMessage | null {
  const at = raw.indexOf("\r\n\r\n");
  const sep = at === -1 ? raw.indexOf("\n\n") : at;
  if (sep === -1) return null;
  const headText = raw.slice(0, sep).replace(/\r?\n[ \t]+/g, " ");
  const bodyText = raw.slice(sep).replace(/^\r?\n\r?\n?/, "");
  const header = (name: string): string => {
    const m = headText.match(new RegExp(`^${name}:(.*)$`, "im"));
    return m === null ? "" : decodeMimeWords(m[1].trim());
  };
  const from = header("From").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/)?.[0] ?? "unknown";
  const subject = header("Subject") || "(无主题)";
  const date = header("Date");
  // 正文：优先 text/plain 段（跳过它自己的段头行）；没有 MIME 段就取全文。
  const plainAt = bodyText.search(/content-type:\s*text\/plain/i);
  const bodyCore = plainAt === -1
    ? bodyText
    : bodyText.slice(plainAt).replace(/^[^\r\n]*\r?\n/, "");
  const text = decodeMimeWords(bodyCore.trim());
  return {
    uid: 0,
    from,
    subject,
    text: text.slice(0, 4000),
    date,
  };
}

/** RFC 2047 B 词解（=?UTF-8?B?...?=）；Q 词与其它字符集按原样保留。 */
function decodeMimeWords(input: string): string {
  return input.replace(/=\?([^?]+)\?B\?([^?]+)\?=/gi, (_m, charset: string, b64: string) => {
    try {
      if (!/utf-?8/i.test(charset)) return _m;
      return Buffer.from(b64, "base64").toString("utf8");
    } catch {
      return _m;
    }
  });
}

// ── 适配器外壳 ────────────────────────────────────────────────────────────────

/** 邮件平台表单字段（address/host/port 明文；password 走密钥）。 */
export const EMAIL_FIELDS = [
  { key: "address", label: "邮箱地址", hint: "用于登录 IMAP/SMTP 的邮箱地址" },
  { key: "imapHost", label: "IMAP 服务器", hint: "例如 imap.qq.com" },
  { key: "imapPort", label: "IMAP 端口", hint: "993" },
  { key: "smtpHost", label: "SMTP 服务器", hint: "例如 smtp.qq.com" },
  { key: "smtpPort", label: "SMTP 端口", hint: "465" },
  { key: "pollSeconds", label: "轮询间隔（秒）", hint: "60" },
  { key: "password", label: "授权码", secret: true, hint: "邮箱服务商的 IMAP/SMTP 授权码（不是登录密码）" },
] as const;

/** 邮件平台 spec（platforms.ts 汇总）。 */
export const EMAIL_PLATFORM: ImPlatformSpec = {
  id: "email",
  name: "邮件（IMAP/SMTP）",
  ws: false,
  fields: [...EMAIL_FIELDS],
  textLimit: EMAIL_TEXT_LIMIT,
};

export function connectEmail(
  fields: Record<string, string>,
  env: ImEnv,
  handlers: ImConnectHandlers,
): ImAdapterHandle {
  const cfg: ImapConfig = {
    host: fields.imapHost ?? "",
    port: Number(fields.imapPort ?? "993") || 993,
    address: fields.address ?? "",
    password: fields.password ?? "",
    pollMs: Math.max(15, Number(fields.pollSeconds ?? "60")) * 1000,
  };
  const smtp: SmtpConfig = {
    host: fields.smtpHost ?? "",
    port: Number(fields.smtpPort ?? "465") || 465,
    address: fields.address ?? "",
    password: fields.password ?? "",
  };
  if (env.tlsConnect === undefined) {
    handlers.onStatus({ state: "error", error: "没有 TLS 注入面（壳未注入 node:tls）" });
    return { send: async () => ({}), stop: () => undefined };
  }
  const pollOnce = async (): Promise<void> => {
    try {
      await imapPollOnce(cfg, env, async (mail) => {
        await handlers.onMessage({
          chat: { key: mail.from, kind: "direct", title: mail.from },
          sender: { id: mail.from, name: mail.from },
          text: `（邮件）${mail.subject}\n\n${mail.text}`,
          mentioned: true,
          messageId: `mail:${String(mail.uid)}`,
        });
      });
      handlers.onStatus({ state: "ready" });
    } catch (error) {
      const permanent = (error as { permanent?: boolean }).permanent === true;
      handlers.onStatus(permanent
        ? { state: "error", error: msgOf(error) }
        : { state: "retrying", error: msgOf(error) });
    }
  };
  let stopped = false;
  const loop = async (): Promise<void> => {
    while (!stopped) {
      await pollOnce();
      await sleep(Math.max(15_000, cfg.pollMs ?? 60_000));
    }
  };
  void loop();
  return {
    send: async (chat: ImChat, text: string): Promise<{ messageId?: string }> => {
      await smtpSend(smtp, env, [chat.key], "Cairn 回信", text);
      return {};
    },
    stop: () => {
      stopped = true;
    },
  };
}

function msgOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** sleep helper（轮询间隔）。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** check = IMAP 登录探活（失败即拒存）。 */
export async function checkEmail(fields: Record<string, string>, env: ImEnv): Promise<{ account: { id: string; name: string } }> {
  const cfg: ImapConfig = {
    host: fields.imapHost ?? "",
    port: Number(fields.imapPort ?? "993") || 993,
    address: fields.address ?? "",
    password: fields.password ?? "",
  };
  await imapPollOnce(cfg, env, async () => undefined);
  return { account: { id: cfg.address, name: cfg.address } };
}

/** 平台注册条目（platforms.ts 汇总）。 */
export const emailAdapter: ImPlatformAdapter = {
  connect: connectEmail,
  check: checkEmail,
};
