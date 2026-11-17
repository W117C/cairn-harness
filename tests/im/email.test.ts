// 邮件适配器判卷：RFC822 拆解、SMTP 对话（假线）、IMAP 轮询对话（假线）。
import { describe, expect, it } from "vitest";
import { parseRfc822, smtpSend, imapPollOnce } from "../../src/im/platforms/email";
import type { ImLineSocket } from "../../src/im/types";

/** 内存行线：write 逐条进输出桶；readLine 逐条消费脚本。 */
function fakeLine(script: string[]): ImLineSocket & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    readLine: async () => (script.length > 0 ? (script.shift() ?? null) : null),
    write: async (line: string) => { written.push(line); },
    writeRaw: async (chunk: string) => { written.push(chunk); },
    end: async () => undefined,
  };
}

describe("RFC822 拆解", () => {
  it("头解码 + 正文提取", () => {
    const raw = "From: Zhang San <zhang@x.com>\r\nSubject: =?UTF-8?B?" + Buffer.from("你好世界").toString("base64") + "?=\r\n\r\n第一行\r\n第二行";
    const m = parseRfc822(raw);
    if (m === null) throw new Error("应解析出邮件");
    expect(m.from).toBe("zhang@x.com");
    expect(m.subject).toBe("你好世界");
    expect(m.text).toContain("第一行");
  });
});

describe("SMTP 对话", () => {
  it("AUTH LOGIN → MAIL/RCPT/DATA → QUIT 全对话", async () => {
    const socket = fakeLine([
      "220 ready",
      "250-A", "250 AUTH LOGIN",
      "334",
      "334",
      "235 ok",
      "250 from ok",
      "250 rcpt ok",
      "354 go",
      "250 accepted",
      "221 bye",
    ]);
    await smtpSend(
      { host: "smtp.x", port: 465, address: "bot@x.com", password: "pw" },
      { fetch, tlsConnect: async () => socket },
      ["user@y.com"],
      "主题",
      "第一行\n.点行\n尾行",
    );
    const w = socket.written;
    expect(w[0]).toBe("EHLO cairn.local");
    expect(w[1]).toBe("AUTH LOGIN");
    expect(w[2]).toBe(Buffer.from("bot@x.com").toString("base64"));
    expect(w[3]).toBe(Buffer.from("pw").toString("base64"));
    expect(w[4]).toBe("MAIL FROM:<bot@x.com>");
    expect(w[5]).toBe("RCPT TO:<user@y.com>");
    expect(w.join("\n")).toContain("DATA");
    expect(w.join("\n")).toContain("..点行");
    expect(w.join("\n")).toContain("QUIT");
  });
});

describe("IMAP 对话", () => {
  it("LOGIN → EXAMINE → SEARCH → FETCH(literal) → STORE → LOGOUT", async () => {
    const mail = "From: zhang@x.com\r\nSubject: hi\r\n\r\n第一行";
    const mail2 = "From: zhang@x.com\r\nSubject: 第二封\r\n\r\n内容二";
    const socket = fakeLine([
      "* OK ready",
      "A1 OK",
      "A2 OK",
      "* SEARCH 101 102",
      "A3 OK",
      `* 1 FETCH (UID 101 BODY[] {${String(Buffer.byteLength(mail))}})`,
      mail,
      "A4 OK",
      "A5 OK",
      `* 2 FETCH (UID 102 BODY[] {${String(Buffer.byteLength(mail2))}})`,
      mail2,
      "A6 OK",
      "A7 OK",
      "A8 OK",
    ]);
    const got: string[] = [];
    const handled = await imapPollOnce(
      { host: "imap.x", port: 993, address: "bot@x.com", password: "pw" },
      { fetch, tlsConnect: async () => socket },
      async (m) => { got.push(m.from + "|" + m.subject); },
    );
    expect(handled).toBe(2);
    expect(got).toEqual(["zhang@x.com|hi", "zhang@x.com|第二封"]);
    const w = socket.written.join("\n");
    expect(w).toContain("LOGIN");
    expect(w).toContain("EXAMINE INBOX");
    expect(w).toContain("UID SEARCH UNSEEN");
    expect(w).toContain("UID FETCH 101");
    expect(w).toContain("UID FETCH 102");
    expect(w).toContain("\\Seen");
    expect(w).toContain("LOGOUT");
  });
});
