/* 第 283 页更正（键名）：这一支从前交 `cacheDir`，而 `BuildMapOptions` 里没有这个键（真名 `tagsCacheDir`），
 *  tsc 报 TS2353 后它被**静默丢掉** ⇒ 所谓"空 tags 缓存那一臂"其实和热臂用同一个缺省目录，
 *  `rm(COLD)` 删的是一个从来没人写的目录。⇒ 第 214 页 `recheck.md` 记的那句「空 tags 缓存建一次 → 同一热缓存再建一次」
 *  量的不是它承诺的那件事，`coldEqualsWarm=true` 当时不构成"冷热无关"的证据。
 *  真正的对照与读数是第 283 页的 `outputs/map-cold-warm-283-2026-10-01/probe-run.log`（键改对、并自证旋钮动过）。
 *  历史读数留在 `recheck.md` 不动——这里改的是工具，不是记录；把键改对只是为了让这个文件以后做它名字里那件事。 */
import { createMapBuilder, mapInjectText, scanSourceFilesAll } from "/Users/ze/Downloads/deepseek harness/src/agent/map/build.js";
import { rm } from "node:fs/promises";
const WS = "/Users/ze/Downloads/deepseek harness";
const COLD = "/tmp/dsh-cold-cache";
const snap = async () => (await scanSourceFilesAll(WS)).map((f) => `${f.rel}@${f.mtimeMs.toFixed(2)}`).join("|");
const build = async (dir: string, round: number) => mapInjectText(await createMapBuilder({ tagsCacheDir: dir }).build({ workspace: WS, mentionedIdents: [], contextFiles: [], maxInputTokens: 128_000, nowRound: round })) ?? "";
await rm(COLD, { recursive: true, force: true });
const s0 = await snap();
const cold = await build(COLD, 0);          // 全新 tags 缓存
const s1 = await snap();
const warm = await build(COLD, 1);          // 同一份仓，缓存已热
const s2 = await snap();
const diffAt = (x: string, y: string) => { for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return i; return -1; };
const d = diffAt(cold, warm);
console.log(JSON.stringify({
  repoStable: s0 === s1 && s1 === s2, coldChars: cold.length, warmChars: warm.length,
  coldEqualsWarm: cold === warm, firstDiff: d,
  aroundCold: d < 0 ? "" : cold.slice(Math.max(0, d - 60), d + 60),
  aroundWarm: d < 0 ? "" : warm.slice(Math.max(0, d - 60), d + 60),
}));
