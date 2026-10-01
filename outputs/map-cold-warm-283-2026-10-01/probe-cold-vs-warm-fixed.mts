/** 第 283 页：第一次真的做「空 tags 缓存 vs 同一份热缓存」的对照。
 *  为什么要重做：`outputs/map-inject-cost-2026-09-30/probe-cold-vs-warm.mts` 交的是
 *  `createMapBuilder({ cacheDir: dir })`——`BuildMapOptions` 里没有 `cacheDir` 这个键（真名 `tagsCacheDir`，
 *  见 `src/agent/map/build.ts:156` 与它唯一消费点 `:275` 的 `merged.tagsCacheDir ?? defaultTagsCacheDir()`），
 *  tsc 因此报 TS2353。后果不是崩：那个键被**静默丢掉**，两支臂都走缺省缓存目录，
 *  而 `rm(COLD)` 删的是一个从来没人写的目录 ⇒ 第 214 页记的那句「空 tags 缓存建一次 → 同一热缓存再建一次」
 *  量的其实是 warm vs warm，`coldEqualsWarm=true` 从来没有回答过它以为回答的那个问题。
 *  这一支把键改对，并且**把旋钮有没有真的动过印出来**：每支臂都报 `fromTagsCache`／`parsed`／`ok`——
 *  冷臂的 `fromTagsCache` 不比热臂小，就是这次对照自己没成立（配一条硬退出，见文末）。 */
import { createMapBuilder, mapInjectText, scanSourceFilesAll } from "../../src/agent/map/build.js";
import { rm } from "node:fs/promises";

const WS = process.cwd();
const COLD = "/tmp/dsh-cold-cache-283";
const HOT = "/tmp/dsh-hot-cache-283";

const snap = async () => (await scanSourceFilesAll(WS)).map((f) => `${f.rel}@${f.mtimeMs.toFixed(2)}`).join("|");

/** 一次构建：正文与"这一支臂到底命中了多少缓存"一起交出来。 */
async function arm(dir: string, round: number, warmUpFirst: boolean) {
  if (warmUpFirst) await createMapBuilder({ tagsCacheDir: dir }).build({ workspace: WS, nowRound: 0 });
  const res = await createMapBuilder({ tagsCacheDir: dir }).build({
    workspace: WS, mentionedIdents: [], contextFiles: [], maxInputTokens: 128_000, nowRound: round,
  });
  return {
    text: mapInjectText(res) ?? "", fromTagsCache: res.fromTagsCache, parsed: res.parsed,
    ok: res.ok, cap: res.cap, graphFiles: res.graphFiles, candidates: res.candidates, fingerprint: res.fingerprint,
  };
}

await rm(COLD, { recursive: true, force: true });
await rm(HOT, { recursive: true, force: true });

const s0 = await snap();
const cold = await arm(COLD, 0, false);          // 空缓存：一支都没命中才算真冷
const s1 = await snap();
const warm = await arm(COLD, 1, false);          // 同一份仓、同一份缓存目录，第二次
const s2 = await snap();
const hotBuilt = await arm(HOT, 0, true);        // 先暖起来再读，作为"热态长什么样"的对照

const diffAt = (x: string, y: string) => {
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return i;
  return -1;
};
const d = diffAt(cold.text, warm.text);
const brief = (a: typeof cold) => ({ chars: a.text.length, fromTagsCache: a.fromTagsCache, parsed: a.parsed, ok: a.ok, cap: a.cap, graphFiles: a.graphFiles, candidates: a.candidates, fp: a.fingerprint.slice(0, 12) });

console.log(JSON.stringify({
  repoStable: s0 === s1 && s1 === s2,
  cold: brief(cold), warm: brief(warm), hotRef: brief(hotBuilt),
  coldEqualsWarm: cold.text === warm.text, firstDiff: d,
  // 键有没有生效的唯一直接证据：冷臂必须一支都没命中，热臂必须有命中
  knobMoved: cold.fromTagsCache === 0 && warm.fromTagsCache > 0,
}, null, 2));

if (s0 !== s1 || s1 !== s2) {
  console.error("取料面在两次构建之间漂了（共享工作树里有人在写文件）⇒ 这次对照不作数");
  process.exit(1);
}
if (!cold.ok || !warm.ok || !hotBuilt.ok) {
  console.error("有臂走了降级（ok=false ⇒ 正文必为空）⇒ 两臂相同只可能是「都没地图」，不是「冷热无关」");
  process.exit(1);
}
if (cold.fromTagsCache !== 0) {
  console.error(`冷臂命中了 ${String(cold.fromTagsCache)} 个文件的 tags 缓存 ⇒ 键没生效或目录没删掉，这次对照不作数`);
  process.exit(1);
}
