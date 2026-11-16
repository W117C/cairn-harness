// 真网络验一次天气源（业主 2026-11-16 批「准外联」）。
//
// 用 **Open-Meteo**（无 key、公开）：证明 `fetchWeather` 在真 HTTPS 上能取回并解析成四档。
// 用法：npx tsx scripts/weather-live.ts [纬度] [经度]
// 退出码：0 = 拿到四档；2 = 网络不可达/解析失败（如实，不冒充）。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchWeather } from "../apps/desktop/src/main/weather-http";

const lat = process.argv[2] ?? "39.9";
const lon = process.argv[3] ?? "116.4";
const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;

const result = await fetchWeather({ url, timeoutMs: 8000 });
const outDir = join(process.cwd(), "outputs", "weather-live");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "reading.json"), JSON.stringify({ at: new Date().toISOString(), url, lat, lon, ...result }, null, 2));

console.log(`weather-live ${JSON.stringify(result)}`);
console.log(`→ ${join(outDir, "reading.json")}`);
process.exit(result.kind === null ? 2 : 0);
