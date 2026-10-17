// 复现器（**判据只住这一份**）：`web_fetch` 截断提示给的出路，照做一遍真做得到吗？
//
// 为什么要单独一个脚本而不是在判卷里再写一遍：`scripts/probe-promise-recall.ts` 的 `hopPruneStub`
// 已经定过这个形状——**复现器归复现器，探针与判卷都去 exec 它**，谁都不许重抄判据
// （同一判据两份副本宽度不同＝本仓第十三族）。本脚本被两处 exec：
//   · `tests/web-fetch.test.ts` 里那条（进全量判卷，门会跑到）
//   · `scripts/probe-promise-recall.ts` 的 `hopWebAnchorClaim`（面登记表里那一格的判定归属）
//
// 三件事按顺序量，任何一件不成立就退 1：
//   ① 片段上不上线：四种 URL 写法交给**真 fetch**（脚本只换 authority，不替传输层剥片段），
//      由 loopback 服务自己报 `req.url`；
//   ② 换锚点取回的正文是否逐字相同（①的直接后果——如果片段真的没上线，正文必然相同）；
//   ③ 正控：换一个 **path** 必须取回不同正文，否则 ② 的"相同"是桩打出来的。
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { makeWebFetch } from "../src/tools/web_fetch.js";
import type { HostResolver } from "../src/tools/web-fetch-policy.js";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
void ROOT; // 复现器不读盘上别的文件；留着是为了与同族脚本同一形状。

/** 解析器桩给一个**确实不该被拦**的公网 IP：于是判据放行它时，我们知道是判据判的，而不是桩替它放行。 */
const publicResolver: HostResolver = async () => ["93.184.216.34"];

const longBody = "<html><body>" +
  Array.from({ length: 700 }, (_unused, i) => `<p>第 ${String(i)} 行正文，够长才会走到截断那一支。</p>`).join("") +
  "</body></html>";
const otherBody = "<html><body><p>另一页，内容刻意与 /page 不同。</p></body></html>";

const seen: string[] = [];
const srv = createServer((req, res) => {
  seen.push(req.url ?? "");
  const body = (req.url ?? "").startsWith("/other") ? otherBody : longBody;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const addr = `127.0.0.1:${String((srv.address() as AddressInfo).port)}`;

const tool = makeWebFetch({
  // 只换 authority：pathname / search / hash **原样**交给真 fetch。
  // 刻意不在这里剥片段——那等于由测试替传输层下结论，对生产零分辨力。
  fetchImpl: ((u: string, init: RequestInit) => {
    const parsed = new URL(u);
    return fetch(`http://${addr}${parsed.pathname}${parsed.search}${parsed.hash}`, init);
  }) as unknown as typeof fetch,
  resolveHost: publicResolver,
});

const bodyOf = (out: string): string => out.split("\n").slice(1).join("\n");
const forms = ["/page", "/page#api", "/page#install", "/page?q=1#api"];
const outs: string[] = [];
for (const f of forms) {
  const r = await tool.run({ url: `http://example.com${f}` }, { workspace: "/tmp", emit: async () => {} });
  if (!r.ok) { console.log(`❌ ${f} 这一趟没跑到：${String(r.output).slice(0, 120)}`); process.exit(1); }
  outs.push(String(r.output));
}
const other = await tool.run({ url: "http://example.com/other#anything" }, { workspace: "/tmp", emit: async () => {} });
if (!other.ok) { console.log("❌ 正控那一趟没跑到"); process.exit(1); }

console.log("我交给 fetch 的写法            →  服务器在报文里看见的 req.url");
forms.forEach((f, i) => console.log(`  ${f.padEnd(20)}  →  ${String(seen[i]).padEnd(12)} 含片段=${String((seen[i] ?? "").includes("#"))}`));

let red = 0;
const withHash = seen.slice(0, forms.length).filter((s) => s.includes("#")).length;
if (withHash > 0) { console.log(`❌ ①：${String(withHash)} 个请求把片段带上线了 ⇒ 换锚点确实能改变取到的东西，那句文案没错`); red++; }
else console.log("✅ ①：四种写法上线的请求行里都没有 `#`（片段不上 HTTP 报文）");

// ②：同一路径换片段 ⇒ 正文（去掉信封首行后）必须逐字相同
const baseBody = bodyOf(outs[0]);
const differs = outs.slice(1).map((o, i) => (bodyOf(o) === baseBody ? null : i + 2)).filter((x) => x !== null);
if (differs.length > 0) { console.log(`❌ ②：第 ${differs.join("、")} 趟正文与基准不同 ⇒ 换锚点不是假路，那句文案要留`); red++; }
else console.log("✅ ②：三次换锚点取回的正文与基准**逐字相同** ⇒ 提示里把锚点列成出路＝让模型白跑一轮");

// ③：正控——换 path 必须不同，否则上面那个"相同"没有意义
if (bodyOf(String(other.output)) === baseBody) { console.log("❌ ③：换 path 也拿到同一份正文 ⇒ 取料坏了，② 的相同不能当证据"); red++; }
else console.log("✅ ③：换 path 取回不同正文 ⇒ 取料真在按 URL 走，②的『相同』是片段无效造成的");

// 三件事都成立 = 锚点确实不是出路。**这不等于文案有缺陷**：第 309 页已把「锚点」从候选里摘掉，
// 并让那句自己否定这条路。所以这一支只证明事实；文案是否消费了这个事实由判卷侧断言
// （`tests/web-fetch.test.ts`：括号里不许出现锚点、真出路要留着、否定式解释必须在场）。
// 结论句据此改写——它还印着被摘掉的旧文案，会把下一个人引去修一个已经修好的东西。
console.log(red === 0
  ? "[probe web-anchor-claim] 三件事都成立 ⇒ 锚点确实不是出路（文案侧第 309 页已摘掉它，判据在 tests/web-fetch.test.ts）"
  : `[probe web-anchor-claim] 红 ${String(red)} 条`);
await new Promise<void>((r) => srv.close(() => r()));
process.exit(red === 0 ? 0 : 1);
