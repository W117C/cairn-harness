/* 第 283 页更正（键名）：这一支从前交的是 `cacheDir`，而 `BuildMapOptions` 里没有那个键（真名 `tagsCacheDir`），
 *  tsc 报 TS2353 后它被**静默丢掉** ⇒ 实际走的是缺省 tags 缓存目录。
 *  好消息是本探针的结论不依赖缓存在哪儿（两臂同目录、比的是同一份仓隔 95s 的正文），所以第 214 页那次
 *  "95s 内不漂"的读数仍然成立；坏消息是文件名承诺的"我自己的缓存目录"从未生效。
 *  下面把键改对，让文件做它名字里那件事。历史读数留在 `recheck.md` 里不动——改的是工具，不是记录。 */
import { createMapBuilder, mapInjectText, scanSourceFilesAll } from "/Users/ze/Downloads/deepseek harness/src/agent/map/build.js";
import { readdirSync } from "node:fs";
const WS = "/Users/ze/Downloads/deepseek harness";
const b = () => createMapBuilder({ tagsCacheDir: "/tmp/dsh-mapsize-cache" });
const build = async () => mapInjectText(await b().build({ workspace: WS, mentionedIdents: [], contextFiles: [], maxInputTokens: 128_000, nowRound: 0 })) ?? "";
// 自证取料面：把「这一趟期间仓库动没动」印出来，不靠我记得自己没动
const snap = async () => (await scanSourceFilesAll(WS)).map((f) => `${f.rel}@${f.mtimeMs.toFixed(2)}`).join("|");
const s0 = await snap();
await build();                                   // 暖缓存（丢弃）
const a = await build();
const s1 = await snap();
await new Promise((r) => setTimeout(r, 95_000));
const c = await build();
const s2 = await snap();
const diffAt = (x: string, y: string) => { for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return i; return -1; };
const d = diffAt(a, c);
console.log(JSON.stringify({
  repoSnapshotStableDuringWindow: s1 === s2,
  charsA: a.length, charsC: c.length,
  after95s_same: a === c, firstDiff: d,
  aroundA: d < 0 ? "" : a.slice(Math.max(0, d - 50), d + 50),
  aroundC: d < 0 ? "" : c.slice(Math.max(0, d - 50), d + 50),
}));
