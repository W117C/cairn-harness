// 实验本地预装门：只查包的静态形状（manifest 可解析、recipe 可解析、字段齐）。
// 它故意不看任务产物——退化候选必须能过这门，才能被运行期 canary 抓到。
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const dir = process.argv[2];
if (dir === undefined) {
  console.error("usage: check-pack.mjs <stagingDir>");
  process.exit(2);
}
try {
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  if (manifest.kind !== "content-pack") throw new Error("kind not content-pack");
  const recipe = JSON.parse(await readFile(join(dir, "recipe.json"), "utf8"));
  if (typeof recipe.producerVersion !== "string") throw new Error("recipe.producerVersion missing");
  if (!["baseline", "good", "bad"].includes(recipe.transform)) throw new Error("recipe.transform invalid");
  console.log("pack-check ok: " + manifest.id + "@" + manifest.version);
  process.exit(0);
} catch (err) {
  console.error("pack-check failed: " + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
}
