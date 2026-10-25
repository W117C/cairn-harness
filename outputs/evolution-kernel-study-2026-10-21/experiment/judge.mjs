// 独立判据：只看任务输入与产物，不读候选的 recipe，也不读账本。
// 退出码 0 = 正确；非 0 = 不正确。输出 JSON 里带 producerVersion，用于从行为上辨认当前生效版本。
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const ws = process.argv[2];
const label = process.argv[3];
if (ws === undefined || label === undefined) {
  console.error("usage: judge.mjs <workspace> <label>");
  process.exit(2);
}

const input = JSON.parse(await readFile(join(ws, "input.json"), "utf8"));
const raw = await readFile(join(ws, "artifacts", label + ".json"), "utf8");
const artifact = JSON.parse(raw);

const expectedCitations = input.sources.map((s) => s.id).sort();
const checks = {
  summary: artifact.summary === input.title,
  citations: JSON.stringify(artifact.citations) === JSON.stringify(expectedCitations),
  status: artifact.status === "ok",
};
const ok = Object.values(checks).every(Boolean);
const artifactDigest = "sha256:" + createHash("sha256").update(raw).digest("hex");
console.log(JSON.stringify({ ok, checks, producerVersion: artifact.producerVersion, artifactDigest }));
process.exit(ok ? 0 : 1);
