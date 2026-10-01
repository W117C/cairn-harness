import { scanRepo } from "../../scripts/prose-needle-scan.js";
const t0 = performance.now();
const r = scanRepo(process.cwd());
const t1 = performance.now();
console.log(`真仓 scanRepo：${((t1 - t0) / 1000).toFixed(2)}s｜needles=${r.needles.length}`);
const t2 = performance.now();
const r2 = scanRepo(process.cwd());
const t3 = performance.now();
console.log(`真仓 scanRepo 第二次：${((t3 - t2) / 1000).toFixed(2)}s`);
