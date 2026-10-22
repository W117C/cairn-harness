// 脚本化任务执行器：真实走 RuntimeLoader 装载当前 active content-pack，再按 recipe 产出报告。
// 它不是模型；只证明「生效的包真的改变了下一轮产物」。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RuntimeLoader } from "../../../src/main/evolution/canary";
import { ModuleRegistry } from "../../../src/main/evolution/registry";

const ws = process.argv[2];
const label = process.argv[3];
if (ws === undefined || label === undefined) {
  console.error("usage: consumer.ts <workspace> <label>");
  process.exit(2);
}

const registry = new ModuleRegistry(ws, { knownGates: new Set(["pack-check"]) });
const bundle = await new RuntimeLoader(registry).load("content-pack.report-recipe");
if (bundle.kind !== "content-pack") throw new Error("expected content-pack, got " + bundle.kind);
const recipeFile = bundle.files.find((f) => f.rel === "recipe.json");
if (recipeFile === undefined) throw new Error("recipe.json missing");
const recipe = JSON.parse(recipeFile.text) as { producerVersion: string; transform: "baseline" | "good" | "bad" };
const input = JSON.parse(await readFile(join(ws, "input.json"), "utf8")) as {
  title: string;
  sources: { id: string }[];
};

const artifact =
  recipe.transform === "bad"
    ? { summary: "WRONG", citations: [], status: "ok", producerVersion: recipe.producerVersion }
    : {
        summary: input.title,
        citations: input.sources.map((s) => s.id).sort(),
        status: "ok",
        producerVersion: recipe.producerVersion,
        ...(recipe.transform === "good" ? { notes: "deduped" } : {}),
      };

await mkdir(join(ws, "artifacts"), { recursive: true });
await writeFile(join(ws, "artifacts", label + ".json"), JSON.stringify(artifact, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ label, producerVersion: recipe.producerVersion, artifact }));
