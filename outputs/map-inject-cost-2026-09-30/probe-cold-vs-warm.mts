import { createMapBuilder, mapInjectText, scanSourceFilesAll } from "/Users/ze/Downloads/deepseek harness/src/agent/map/build.js";
import { rm } from "node:fs/promises";
const WS = "/Users/ze/Downloads/deepseek harness";
const COLD = "/tmp/dsh-cold-cache";
const snap = async () => (await scanSourceFilesAll(WS)).map((f) => `${f.rel}@${f.mtimeMs.toFixed(2)}`).join("|");
const build = async (dir: string, round: number) => mapInjectText(await createMapBuilder({ cacheDir: dir }).build({ workspace: WS, mentionedIdents: [], contextFiles: [], maxInputTokens: 128_000, nowRound: round })) ?? "";
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
