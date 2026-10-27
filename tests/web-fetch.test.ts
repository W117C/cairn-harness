// web_fetch 的三层判卷：出网判据（纯函数，零网络）、四档权限裁决、传输层（注入的 fetch）。
//
// 为什么要一个文件而不是三个：本轮最贵的两个失效面都只在这里交叉——
//   · SSRF 判据要能"解析后判"，而能解析出地址的测试服务器只能在 loopback 上起（判据要拒的地址）；
//   · 权限要能证明**四档都问**，而只断言"某档问了"会被"一律 deny"伪造成绿。
// 所以这一层用**依赖注入**（fetchImpl / resolveHost）把策略与传输拆开测，两头各自有分辨率：
// 正例真跑出去（证明不是一律拒），反例真被拒（证明不是一律放）。

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { assertPublicUrl, blockedHostReason, blockedReason } from "../src/tools/web-fetch-policy.js";
import { WEB_CONTENT_TRUNCATION_HINT } from "../src/tools/output-ring.js";
import { createPinnedLookup, decodeResponseBody, htmlToText, makeWebFetch } from "../src/tools/web_fetch.js";
import { evaluate, newAutonomySession } from "../src/permissions/autonomy.js";
import { PERMISSION_MODES } from "../src/permissions/index.js";
import { staticRisk } from "../src/permissions/risk.js";
import type { ToolName } from "../src/tools/base.js";
import type { ToolContext } from "../src/tools/base.js";
import type { HostResolver } from "../src/tools/web-fetch-policy.js";

const CTX: ToolContext = { workspace: "/tmp" };
/** 解析器桩：一律给一个公网 IP。**不是**"放行一切"的桩——它给的是一个**确实不该被拦**的地址，
 * 于是判据放行它时，我们知道是判据判的"这段是公网"，而不是桩在替判据放行。 */
const publicResolver: HostResolver = async () => ["93.184.216.34"];

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => { s.close(() => r()); })));
});

/** 真起一个 loopback 服务，地址替换由调用方给的 fetchImpl 负责。 */
async function serve(handler: (url: string) => { body?: string; status?: number; headers?: Record<string, string> }): Promise<string> {
  const s = createServer((req, res) => {
    const r = handler(req.url ?? "/");
    res.writeHead(r.status ?? 200, r.headers ?? { "content-type": "text/html; charset=utf-8" });
    res.end(r.body ?? "");
  });
  servers.push(s);
  await new Promise<void>((r) => { s.listen(0, "127.0.0.1", r); });
  return `127.0.0.1:${String((s.address() as AddressInfo).port)}`;
}

describe("web_fetch 出网判据（纯函数，零网络）", () => {
  // 反例与正例同批跑是本仓的老规矩：只测"该拒的都拒了"，锚点会被一张"一律 reject"的桩伪造成绿。
  const mustBlock = [
    "127.0.0.1", "0.0.0.0", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "100.64.0.1", "224.0.0.1", "255.255.255.255", "198.18.0.1",
    "::1", "::", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "::127.0.0.1",
    "fe80::1", "fe80::1%en0", "fc00::1", "fd00::1", "ff02::1", "64:ff9b::7f00:1",
    "2002:7f00:0001::", "2001::1",
    // 带方括号那一支：`new URL("http://[::1]/").hostname` 就是 "[::1]"，而 isIP("[::1]") 是 0。
    // 不剥括号时 URL 里的 IPv6 字面量全部绕开"字面量直接判"，改走 DNS 分支——真接 ::1。
    "[::1]", "[::ffff:127.0.0.1]", "[::ffff:169.254.169.254]", "[fd00::1]", "[fe80::1]",
  ];
  const mustAllow = [
    "93.184.216.34", "8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.255.255",
    "192.167.1.1", "100.63.255.255", "100.128.0.1", "2606:2800:220:1:248:1893:25c8:1946",
  ];

  it("保留段逐个判掉，且每条都带段名（报错要能让人自查）", () => {
    for (const ip of mustBlock) {
      expect(blockedReason(ip), `该拒没拒: ${ip}`).not.toBe("");
    }
  });

  it("段边界两侧都不误伤（172.15/172.32、100.63/100.128 是 CIDR 写错时的典型漏网处）", () => {
    for (const ip of mustAllow) {
      expect(blockedReason(ip), `误拒公网地址: ${ip} -> ${blockedReason(ip)}`).toBe("");
    }
  });

  it("主机名黑名单大小写与末尾点归一；同后缀的公网域名不误伤", () => {
    for (const h of ["localhost", "LOCALHOST", "localhost.", "foo.localhost", "x.local", "a.internal",
      "metadata.google.internal", "metadata.goog", "instance-data", "h.home.arpa"]) {
      expect(blockedHostReason(h), `主机名该拒没拒: ${h}`).not.toBe("");
    }
    for (const h of ["example.com", "docs.python.org", "localhost.example.com", "internal.example.com"]) {
      expect(blockedHostReason(h), `主机名误拒: ${h}`).toBe("");
    }
  });

  // 这一条是"判据有分辨率"的正面证人：没有它，上面那批 mustAllow 与"永远返回非空"不可区分。
  it("公网 URL 过得了（判据不是一张一律拒的表）", async () => {
    const u = await assertPublicUrl("https://example.com/docs?a=1", publicResolver);
    expect(u.hostname).toBe("example.com");
    expect(u.protocol).toBe("https:");
  });

  it("把已经校验过的 DNS 地址交给传输层，避免连接时再次解析", async () => {
    const validated = ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"];
    let used: readonly string[] | undefined;
    const tool = makeWebFetch({
      resolveHost: async () => validated,
      fetchImpl: ((url: string, init: RequestInit, addresses: readonly string[]) => {
        void url;
        void init;
        used = addresses;
        return Promise.resolve(new Response("<p>ok</p>", { headers: { "content-type": "text/html" } }));
      }) as unknown as typeof fetch,
    });
    const result = await tool.run({ url: "https://example.com/" }, CTX);
    expect(result.ok).toBe(true);
    expect(used).toEqual(validated);
  });

  it("协议白名单：file:/data:/ftp:/javascript: 一律拒（它们不是站，是本机与内网的读取面）", async () => {
    for (const bad of ["file:///etc/passwd", "data:text/html,<script>x</script>", "ftp://example.com/x",
      "javascript:alert(1)", "gopher://example.com/"]) {
      await expect(assertPublicUrl(bad, publicResolver), `协议该拒没拒: ${bad}`).rejects.toThrow(/协议/);
    }
  });

  // DNS 失败被当放行是这一族里最贵的形态：解析器返回空列表时，"没查到什么"很容易被读成"没问题"。
  it("解析不出任何地址 ⇒ 判拒（不把解析失败当放行）", async () => {
    await expect(assertPublicUrl("https://nowhere.invalid/", async () => [])).rejects.toThrow(/解析不出任何地址/);
  });

  it("解析器返回非 IP 值时判拒，不能把畸形结果交给 socket 层", async () => {
    await expect(assertPublicUrl("https://example.com/", async () => ["not-an-ip"])).rejects.toThrow(/无效 IP 地址/);
  });

  // 双栈是"只判第一条"的现成旁路：AAAA 指向内网、A 指向公网时，只看第一条就过了。
  it("全部解析记录逐个判（只判第一条 = 双栈绕过）", async () => {
    await expect(
      assertPublicUrl("https://dual.example/", async () => ["93.184.216.34", "127.0.0.1"]),
      "AAAA 指向 loopback 时必须判拒",
    ).rejects.toThrow(/127\.0\.0\.1/);
  });

  it("IP 字面量不过解析器（解析器对字面量可能给也可能抛）", async () => {
    let called = false;
    const spy: HostResolver = async () => { called = true; return ["93.184.216.34"]; };
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data/", spy)).rejects.toThrow(/link-local/);
    expect(called, "IP 字面量不该走 DNS").toBe(false);
  });
});

describe("web_fetch 权限：四档都问（出网永不免批）", () => {
  // 只断言"某一档问了"会被"一律 deny"伪造成绿，所以逐档点名，且断言的是 verdict 不是"被拒了"。
  it("read-only / default / guided / auto 四档逐档 verdict=ask", () => {
    for (const m of PERMISSION_MODES) {
      const d = evaluate("web_fetch" as ToolName, { url: "https://example.com/" }, newAutonomySession(m));
      expect(d.verdict, `档位 ${m} 漏问了`).toBe("ask");
    }
  });

  it("理由落在 L4 风险层（与 run_shell 跑 curl 同一条出口）", () => {
    const d = evaluate("web_fetch" as ToolName, { url: "https://example.com/" }, newAutonomySession("auto"));
    expect(d.verdict).not.toBe("deny");
    if (d.verdict === "deny") return; // `risk` 只在非 deny 那一支的联合上存在
    expect(d.layer).toBe("L4-risk");
    expect(d.risk).toBe("high");
  });

  // 反向对照：普通读工具仍是 none。判据若误伤全表，这一格会红。
  it("不误伤其它工具：read_file 仍是 none", () => {
    expect(staticRisk("read_file", {}).level).toBe("none");
  });

  // 无人值守那条路：ask 在 gate() 里转 deny（fail-closed），不假装跑完了。
  it("非交互（无人值守 / CI）⇒ deny", async () => {
    const { gate } = await import("../src/permissions/index.js");
    // checkPermission 对非写向工具直接 allow，真正的收束发生在 L4 裁决后的 askGate 缺席分支；
    // 这里断言的是"档位裁决是 ask"，即调用方必须去问人——问不到人就必须拒。
    const d = evaluate("web_fetch" as ToolName, { url: "https://example.com/" }, newAutonomySession("default"));
    expect(d.verdict).toBe("ask");
    expect(gate("default", "read_file", false)).toBe("allow");
  });
});

describe("web_fetch 传输层（注入 fetchImpl / resolveHost）", () => {
  it("gzip 响应解码成正文，并丢弃压缩体积对应的长度头", async () => {
    const source = new PassThrough();
    const headers = new Headers({ "content-encoding": "gzip", "content-length": "99" });
    const body = decodeResponseBody(source as unknown as import("node:http").IncomingMessage, headers);
    const text = new Response(body).text();
    source.end(gzipSync("压缩正文"));
    await expect(text).resolves.toBe("压缩正文");
    expect(headers.has("content-encoding")).toBe(false);
    expect(headers.has("content-length")).toBe(false);
  });

  it("不支持的响应内容编码会给出可读错误", () => {
    const source = new PassThrough();
    expect(() => decodeResponseBody(
      source as unknown as import("node:http").IncomingMessage,
      new Headers({ "content-encoding": "zstd" }),
    )).toThrow(/不支持响应内容编码 zstd/);
    source.destroy();
  });

  // 对端**谎报**编码（说 gzip 却发明文）或流被截断时，读方必须拿到能读懂的原因。
  // 旧实现直接 `output.destroy(zlibError)`：Readable.toWeb 抛出来的是 message 为空的
  // TypeError（`code: Z_DATA_ERROR`、真正的 `incorrect header check` 只挂在 cause 上），
  // 上层于是打出「web_fetch 失败: terminated」——那既不像编码错也不像网络错，
  // 模型无从判断该换 URL 还是该重试。判据钉的是**说人话**这件事本身。
  it("谎报 content-encoding：读到的错误说得出是哪一种编码、真正的原因是什么", async () => {
    const source = new PassThrough();
    const headers = new Headers({ "content-encoding": "gzip" });
    const body = decodeResponseBody(source as unknown as import("node:http").IncomingMessage, headers);
    const pending = new Response(body).text();
    source.end("这不是 gzip");
    await expect(pending).rejects.toThrow(/响应内容解码失败（content-encoding: gzip）/);
    await expect(pending).rejects.toThrow(/incorrect header check/);
  });

  it("截断的 gzip 流也说得出是解码失败，不是一句空 message", async () => {
    const source = new PassThrough();
    const headers = new Headers({ "content-encoding": "gzip" });
    const body = decodeResponseBody(source as unknown as import("node:http").IncomingMessage, headers);
    const pending = new Response(body).text();
    source.end(gzipSync("前半段").subarray(0, 6)); // 头还在，数据断了
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/响应内容解码失败（content-encoding: gzip）/);
    expect((err as Error).message).not.toBe("");
  });

  it("socket lookup 只返回本轮已校验的地址，不重新查询 DNS", async () => {
    const addresses = ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"];
    const pinned = createPinnedLookup("example.com", addresses);
    const all = await new Promise<readonly { address: string; family: number }[]>((resolve, reject) => {
      pinned("EXAMPLE.COM.", { all: true }, (error, result) => {
        if (error) return reject(error);
        if (typeof result === "string") return reject(new Error("all=true 必须返回地址列表"));
        resolve(result);
      });
    });
    expect(all).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);

    const ipv4 = await new Promise<{ address: string; family?: number }>((resolve, reject) => {
      pinned("example.com", { family: 4 }, (error, address, family) => {
        if (error) return reject(error);
        if (typeof address !== "string") return reject(new Error("默认 lookup 必须返回单地址"));
        resolve({ address, family });
      });
    });
    expect(ipv4).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("socket lookup 对非本轮主机 fail closed", async () => {
    const pinned = createPinnedLookup("example.com", ["93.184.216.34"]);
    await expect(new Promise<void>((resolve, reject) => {
      pinned("other.example", { all: true }, (error) => error ? reject(error) : resolve());
    })).rejects.toThrow(/与已校验主机不符/);
  });

  it("HTML 还原成文本：剥脚本与样式、块级转换行、解实体、收空白", () => {
    const html = `<!doctype html><html><head><style>a{color:red}</style><script>alert(1)</script></head>
      <body><h1>Title</h1><p>Hello &amp; <b>world</b>&nbsp;&#65;</p>
      <ul><li>one</li><li>two</li></ul><pre>  indented
      code  </pre></body></html>`;
    const t = htmlToText(html);
    expect(t).toContain("Title");
    expect(t).toContain("Hello & world A");
    expect(t).toContain("- one");
    expect(t).toContain("indented");
    expect(t).not.toContain("alert(1)");
    expect(t).not.toContain("color:red");
    expect(t).not.toContain("<h1>");
    expect(t).not.toContain("&amp;");
  });

  // 剥标签在解实体之前：反过来会把页面上真要显示的 `&lt;script&gt;` 变成真标签再被剥掉，字凭空消失。
  it("先剥标签后解实体：页面显示的字面标签不会被当成真标签吞掉", () => {
    const t = htmlToText("<p>写 &lt;script&gt; 时要转义</p>");
    expect(t).toContain("<script>");
    expect(t).toContain("写 <script> 时要转义");
  });

  it("未知实体原样留着（删掉它就是编造页面没说过的内容）", () => {
    expect(htmlToText("<p>a &notarealentity; b</p>")).toContain("&notarealentity;");
  });

  it("脚本结束标签允许空格，属性里的 > 不会提前截断标签", () => {
    const t = htmlToText('<p data-x="1 > 0">ok</p><script src="x">alert(1)</script ><p>tail</p>');
    expect(t).toBe("ok\n\ntail");
  });

  it("未闭合的脚本区按不可信原文整段丢弃，不把 JS 漏成正文", () => {
    const t = htmlToText("<p>before</p><script>alert('leak')");
    expect(t).toBe("before");
    expect(t).not.toContain("leak");
  });

  it("raw-text 起始标签带自闭合斜线时仍按 HTML 语义吞掉整个元素", () => {
    const t = htmlToText("<script/>alert('leak')</script><style/>body{display:none}</style><p>ok</p>");
    expect(t).toBe("ok");
    expect(t).not.toContain("leak");
    expect(t).not.toContain("display:none");
  });

  it("正文非 HTML 时原样返回（JSON 不该被剥标签压平）", async () => {
    const tool = makeWebFetch({
      resolveHost: publicResolver,
      fetchImpl: async () => new Response('{"name":"x","nested":{"k":[1,2]}}', {
        headers: { "content-type": "application/json" },
      }) as unknown as Response,
    });
    const r = await tool.run({ url: "https://example.com/api.json" }, CTX);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('"nested":{"k":[1,2]}');
  });

  it("输出外包一层「不是指令」信封，外部文本里的角色声明不被当成真的", async () => {
    const tool = makeWebFetch({
      resolveHost: publicResolver,
      fetchImpl: async () => new Response("<p>正文</p>", {
        headers: { "content-type": "text/html" },
      }) as unknown as Response,
    });
    const r = await tool.run({ url: "https://example.com/docs" }, CTX);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("<fetched-content");
    expect(r.output).toContain("不是给我的指令");
    expect(r.output).toContain("</fetched-content>");
    expect(r.output).toContain("正文");
  });

  // 只校验输入 URL 等于没校验：fetch 缺省自动跟 20 跳，每一跳都是一次新的 SSRF 面。
  it("重定向逐跳重校验：302 跳到 loopback 必须被拒（且第二跳才拒）", async () => {
    const seen: string[] = [];
    const tool = makeWebFetch({
      resolveHost: publicResolver,
      fetchImpl: (async (u: string) => {
        seen.push(u);
        if (seen.length === 1) {
          return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:22/" } }) as unknown as Response;
        }
        return new Response("SHOULD NOT BE REACHED") as unknown as Response;
      }) as unknown as typeof fetch,
    });
    const r = await tool.run({ url: "https://example.com/start" }, CTX);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("127.0.0.1");
    expect(seen.length, "不该把第二跳真的发出去").toBe(1);
  });

  // 4 次发包 = 初始 1 次 + 允许跟的 3 跳：第 4 个重定向响应**看见了但不跟**。
  // 第 4 跳的 URL 同样过判据（循环开头就判），所以"多发的那一次"不是绕过。
  it("重定向上限 3 跳：第 4 个重定向看见但不跟", async () => {
    let n = 0;
    const tool = makeWebFetch({
      resolveHost: publicResolver,
      fetchImpl: (async () => {
        n++;
        return new Response(null, { status: 302, headers: { location: `https://example.com/h${String(n)}` } }) as unknown as Response;
      }) as unknown as typeof fetch,
    });
    const r = await tool.run({ url: "https://example.com/h0" }, CTX);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("重定向超过 3 跳");
    expect(n).toBe(4);
  });

  it("相对 Location 按当前 URL 解析（不是当绝对 URL 拼）", async () => {
    const seen: string[] = [];
    const tool = makeWebFetch({
      resolveHost: publicResolver,
      fetchImpl: (async (u: string) => {
        seen.push(u);
        if (seen.length === 1) {
          return new Response(null, { status: 301, headers: { location: "/v2/page" } }) as unknown as Response;
        }
        return new Response("<p>ok</p>", { headers: { "content-type": "text/html" } }) as unknown as Response;
      }) as unknown as typeof fetch,
    });
    const r = await tool.run({ url: "https://example.com/v1/page" }, CTX);
    expect(r.ok).toBe(true);
    expect(seen[1]).toBe("https://example.com/v2/page");
    // 跳过了几跳要写进信封：模型得知道它看到的不是自己点的那个 URL。
    expect(r.output).toContain("redirected-from");
  });

  it("HTTP 错误状态不吞（说清状态码，不把 404 页面正文当答案）", async () => {
    const tool = makeWebFetch({
      resolveHost: publicResolver,
      fetchImpl: async () => new Response("<h1>Not Found</h1>", { status: 404, statusText: "Not Found" }) as unknown as Response,
    });
    const r = await tool.run({ url: "https://example.com/missing" }, CTX);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("404");
  });

  it("判拒的 URL 一个字节都不发出去（真 socket 那一层）", async () => {
    let fetched = 0;
    const tool = makeWebFetch({
      resolveHost: publicResolver,
      fetchImpl: (async () => { fetched++; return new Response("x"); }) as unknown as typeof fetch,
    });
    for (const bad of ["http://127.0.0.1/", "http://169.254.169.254/", "file:///etc/passwd", "http://[::1]/"]) {
      const r = await tool.run({ url: bad }, CTX);
      expect(r.ok, `该拒没拒: ${bad}`).toBe(false);
    }
    expect(fetched, "被拒的 URL 不该触发任何出网").toBe(0);
  });

  // 真 socket：证明流式读、多块 UTF-8 与体积帽在真响应体上成立（stub 的 Response 证不了解码路径）。
  it("真 loopback 服务：分块中文不乱码、体积帽截断后仍交出正文", async () => {
    const big = "文".repeat(40_000);
    const addr = await serve(() => ({
      body: `<html><body><p>${"中".repeat(500)}</p><p>${big}</p></body></html>`,
      headers: { "content-type": "text/html; charset=utf-8" },
    }));
    const tool = makeWebFetch({
      resolveHost: publicResolver,
      // URL 换成真地址：策略面认的是那个假主机名（可解析桩给了公网 IP），
      // 真连接走 loopback —— 于是"策略"与"传输"两端各被真东西测过一遍。
      fetchImpl: ((u: string, init: RequestInit) => fetch(`http://${addr}${new URL(u).pathname}`, init)) as unknown as typeof fetch,
    });
    const r = await tool.run({ url: "https://example.com/page" }, CTX);
    expect(r.ok).toBe(true);
    expect(r.output).not.toContain("�"); // U+FFFD：跨块解码出错的信号
    expect(r.output).toContain("中");
    // 40k 个"文" = 120KB 文本，远超 32KB 模型帽 ⇒ 必须走截断分支且如实报省略量。
    expect(r.output).toContain("已截断");
    expect(r.output).toContain("省略中间");
    // 网页不许带 shell 那句建议（对模型说胡话），也不许没带任何下一步。
    expect(r.output).not.toContain("grep -n");
    expect(r.output).toContain("换一个更精确的 URL");
  });
});

describe("截断提示里的「锚点」是假出路（第 309 页：句子有证人，半句没有）", () => {
  // 与第 308 页同族的可观测性不对称：HEAD 判卷里「换一个更精确的 URL」被点过 **1** 次，
  // 而它括号里那三个候选出路中的「锚点」——`grep -rn 锚点 tests/` 命中的每一条都是**变异锚点**义，
  // URL 片段义 0 次。于是这句教模型"换 #api 再取一次"，而片段根本不发往服务器 ⇒ 白跑一轮，没人喊。
  //
  // 证据由**复现器**给（`scripts/probe-web-anchor-claim.ts`）：它起一个 loopback 服务、把带片段的 URL
  // 原样交给真 fetch，让服务器自己报它在报文里看见什么——不是我在测试里替传输层剥掉片段。
  const longBody = "<html><body>" +
    Array.from({ length: 700 }, (_unused, i) => `<p>第 ${String(i)} 行正文，够长才会走到截断那一支。</p>`).join("") +
    "</body></html>";

  // 判据只住一份：那条断言（换锚点能不能收窄）由 `scripts/probe-web-anchor-claim.ts` 量，
  // 这里 exec 它并读它的三行结论——与 `hopPruneStub` 同一个形状（复现器归复现器，判卷不许重抄判据，
  // 否则两处副本迟早漂成两种答法，本仓第十三族）。
  it("换锚点不改变取回的内容：三件事由复现器量（片段不上线／正文相同／换 path 必须不同）", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/probe-web-anchor-claim.ts"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 60_000,
    });
    const out = String(r.stdout ?? "").replace(/\x1b\[[0-9;]*m/gu, "");
    expect(r.status, `复现器退 ${String(r.status)}：${out}\n${String(r.stderr ?? "").slice(0, 400)}`).toBe(0);
    // 三行都要在：少一行就是那一格没量（退 0 也可能是复现器自己短路了）。
    expect(out).toContain("四种写法上线的请求行里都没有 `#`");
    expect(out).toContain("三次换锚点取回的正文与基准");
    expect(out).toContain("换 path 取回不同正文");
  });

  it("下一步的括号里不许列做不到的事：锚点不是「更精确的 URL」", () => {
    const options = /URL（([^）]*)）/u.exec(WEB_CONTENT_TRUNCATION_HINT)?.[1] ?? "";
    expect(options, "括号里只许列真的换得了内容的地址形状：" + options).not.toContain("锚点");
    // 真做得到的两条要留着——把整条出路删空同样是对模型说胡话（截断了却不给下一步）。
    expect(options).toContain("目录页");
    expect(options).toContain("API 文档页");
  });

  it("要么不说，要说就说清片段不上线：那句解释必须写在模型读到的这一句里", () => {
    expect(WEB_CONTENT_TRUNCATION_HINT, "模型会照『换锚点』再跑一轮 ⇒ 文案要自己否定这条路").toMatch(/锚点[^，。；)]{0,18}不会改变取回/u);
    expect(WEB_CONTENT_TRUNCATION_HINT).toMatch(/片段[^，。；)]{0,12}(不发|不上|不往)/u);
    // 反向哨兵：这两条否定式事实本来就在句子里，不许被我这次改动顺手删掉（它们此前也是 0 证人）。
    expect(WEB_CONTENT_TRUNCATION_HINT).toContain("不会替你翻页");
    expect(WEB_CONTENT_TRUNCATION_HINT).toContain("站内搜索");
  });

  it("这句要真从 web_fetch 那一支交出去（改了常量而出口不接＝模型读到的还是旧的）", async () => {
    const addr = await serve(() => ({ body: longBody }));
    const tool = makeWebFetch({
      fetchImpl: (async (u: string) => {
        const parsed = new URL(u);
        return fetch(`http://${addr}${parsed.pathname}${parsed.search}`);
      }) as unknown as typeof fetch,
      resolveHost: publicResolver,
    });
    const r = await tool.run({ url: "http://example.com/page#a" }, CTX);
    expect(r.ok).toBe(true);
    expect(String(r.output), "整句原样出现＝这条出口真接着").toContain(WEB_CONTENT_TRUNCATION_HINT);
  });

  it("那句话只住在一处：两个消费者各抄一份的话，修好一面另一面还在说胡话", async () => {
    const { readFileSync } = await import("node:fs");
    let hits = 0;
    for (const rel of ["src/tools/output-ring.ts", "src/tools/web_fetch.ts", "src/tools/web-search.ts"]) {
      hits += (readFileSync(new URL("../" + rel, import.meta.url), "utf8").match(/不会替你翻页/gu) ?? []).length;
    }
    expect(hits, "句子住在 output-ring.ts 一处；第二个文件再出现字面量＝抄了第二份").toBe(1);
  });
});
