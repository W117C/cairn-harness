// 一次性取证：`#片段` 到底会不会出现在 HTTP 报文里？——**不由我剥，由 undici 决定**。
//
// 为什么要单独跑这一趟：判卷里那条 fetchImpl 如果写成 `pathname + search`（我第一版就是这么抄的），
// 那么「服务器看不见片段」这个结论就是**我在测试里替传输层做的**，而不是传输层给的——
// 这正是本仓规则 236 那一格（判卷自己再算一遍＝对生产零分辨力）。所以这里只换 authority，
// pathname/search/hash 原样交给真 `fetch`，让 loopback 服务自己报它在报文里看见了什么。
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const seen: string[] = [];
const srv = createServer((req, res) => {
  seen.push(req.url ?? "");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<html><body><p>同一份正文，服务端只认 pathname。</p></body></html>");
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const addr = `127.0.0.1:${String((srv.address() as AddressInfo).port)}`;

const inputs = ["/page", "/page#api", "/page#install", "/page?q=1#api"];
for (const p of inputs) {
  // 只换 authority：路径、查询串、片段一律原样交给真 fetch。
  await fetch(`http://${addr}${p}`);
}
console.log("我交给 fetch 的 URL 路径   →  服务器在报文里看见的 req.url");
inputs.forEach((p, i) => console.log(`  ${p.padEnd(16)}  →  ${String(seen[i]).padEnd(14)} 片段还在吗=${String(seen[i] ?? "").includes("#")}`));
const identical = new Set(seen.map((s) => s.split("#")[0])).size;
console.log(`\n结论：四种写法在服务器上落成 ${String(seen.filter((s) => !s.includes("#")).length)}/${String(inputs.length)} 个无片段请求行`);
console.log("     ⇒ 若 req.url 里都没有 `#`，那『换锚点会取到不同正文』就是不成立的出路（正文由 pathname 决定）。");
await new Promise<void>((r) => srv.close(() => r()));
