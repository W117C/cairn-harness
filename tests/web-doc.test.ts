// web_doc（20 号工具，2026-11-10 工具层批）判卷面。与 web-fetch.test.ts 同一注入惯例
//（fetchImpl / resolveHost 拆开，判据零网络、传输桩化），docx 夹具借 read-doc.test.ts 的零依赖 zip 写入器。
// 重点钉安全关键路径：SSRF 逐跳重校验（重定向跳私网必须第二跳就拒）、20MB 双帽（声明+流式）、
// 重定向循环上限、HTML 响应给可行动出口、扫描件明说、成功 docx 全链路。
import { describe, expect, it } from "vitest";

import { makeWebDoc } from "../src/tools/web_doc";
import type { HostResolver } from "../src/tools/web-fetch-policy";
import { type ToolContext } from "../src/tools/base";

const publicResolver: HostResolver = async () => ["93.184.216.34"];
const ctx = (): ToolContext => ({ workspace: "/tmp" });

/** 零依赖 zip 写入器（stored 成员）：与 read-doc.test.ts 同一份（各自持有，避免测试间耦合）。 */
function makeZip(files: Record<string, string>): Buffer {
  const nameOf = (s: string): Buffer => Buffer.from(s, "utf8");
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const plain = Buffer.from(content, "utf8");
    const n = nameOf(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(plain.length, 18);
    local.writeUInt32LE(plain.length, 22);
    local.writeUInt16LE(n.length, 26);
    localParts.push(local, n, plain);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(plain.length, 20);
    central.writeUInt32LE(plain.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, n);
    offset += local.length + n.length + plain.length;
  }
  const cd = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, cd, eocd]);
}

const run = async (url: string, impl: unknown, resolver: HostResolver = publicResolver): Promise<{ ok: boolean; output: string }> => {
  const tool = makeWebDoc({ fetchImpl: impl as never, resolveHost: resolver });
  return tool.run({ url }, ctx());
};

describe("web_doc 出网判据", () => {
  it("非 http(s) 协议拒（file:/data: 是本机与内网读取面）", async () => {
    const r = await run("file:///etc/passwd", async () => {
      throw new Error("SHOULD NOT BE REACHED");
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("协议");
  });

  it("loopback 直连拒", async () => {
    const r = await run("http://127.0.0.1:8080/doc.pdf", async () => {
      throw new Error("SHOULD NOT BE REACHED");
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("loopback");
  });

  it("重定向逐跳重校验：302 跳 loopback 第二跳就拒，且不把第二跳真发出去", async () => {
    const seen: string[] = [];
    const r = await run("https://example.com/doc", (async (u: string) => {
      seen.push(u);
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:22/" } }) as unknown as Response;
    }) as never);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("127.0.0.1");
    expect(seen.length).toBe(1);
  });

  it("重定向超过 3 跳停止；第 4 个响应看见了但不跟", async () => {
    const seen: string[] = [];
    let n = 0;
    const r = await run("https://example.com/doc", (async (u: string) => {
      seen.push(u);
      n += 1;
      return new Response(null, { status: 302, headers: { location: `https://example.com/h${String(n)}` } }) as unknown as Response;
    }) as never);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("重定向超过 3 跳");
    expect(seen.length).toBe(4);
  });

  it("私网段直连拒：10.x 也过同一张表", async () => {
    const r = await run("http://10.1.2.3/doc.pdf", async () => {
      throw new Error("SHOULD NOT BE REACHED");
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("私网");
  });
});

describe("web_doc 体帽与判型", () => {
  it("声明 content-length 超帽提前拒（不开始读体）", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("body must not be read"));
      },
    });
    const r = await run("https://example.com/big.pdf", (async () =>
      new Response(stream, { headers: { "content-length": String(21 * 1024 * 1024) } }) as unknown as Response) as never);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("响应体声明");
  });

  it("流式读体超 20MB 帽拒（二进制不截断续读）", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(65);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 21; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const r = await run("https://example.com/big.pdf", (async () =>
      new Response(stream, { headers: { "content-type": "application/pdf" } }) as unknown as Response) as never);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("响应体超过");
  });

  it("HTML 响应给可行动出口：读普通网页用 web_fetch", async () => {
    const r = await run("https://example.com/page", (async () =>
      new Response("<html><body>hi</body></html>", { headers: { "content-type": "text/html" } }) as unknown as Response) as never);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("用 web_fetch");
  });

  it("扫描件 pdf（无文本层）明说，不冒充成功", async () => {
    const pdf = "%PDF-1.4\n1 0 obj\n<< /Length 8 >>\nstream\nrawbytes\nendstream\nendobj\n%%EOF";
    const r = await run("https://example.com/scan.pdf", (async () =>
      new Response(pdf, { headers: { "content-type": "application/pdf" } }) as unknown as Response) as never);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("没有可提取的文本层");
  });

  it("成功 docx：zip 字节 → parseDocumentBuffer → 正文 + 信封", async () => {
    const xml =
      "<?xml version=\"1.0\"?><w:document xmlns:w=\"x\"><w:body>" +
      "<w:p><w:r><w:t>网取第一段</w:t></w:r></w:p>" +
      "</w:body></w:document>";
    const zip = makeZip({ "word/document.xml": xml });
    const r = await run("https://example.com/doc.docx", (async () =>
      new Response(new Uint8Array(zip), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } }) as unknown as Response) as never);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("网取第一段");
    expect(r.output).toContain("example.com");
  });

  it("预取消：ctx.signal 已 abort 时给 [cancelled] 回执", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    const tool = makeWebDoc({ fetchImpl: (async () => {
      throw new Error("SHOULD NOT BE REACHED");
    }) as never, resolveHost: publicResolver });
    const r = await tool.run({ url: "https://example.com/doc" }, { workspace: "/tmp", signal: controller.signal });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("[cancelled]");
  });
});
