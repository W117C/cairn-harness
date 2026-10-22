// 一次性提交助手：把「HEAD + 本轮改动」合成进索引，避免把同文件里他人的未提交改动一起入库。
// 运行后工作树不变；只改 index。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const repo = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), "cairn-commit-"));

// ---- agent-runner.ts：HEAD + 本轮两处改动 ----
const headRunner = git("show", "HEAD:src/main/agent-runner.ts");
const importLine = 'import { evolutionPromptNote } from "../agent/evolution";';
if (headRunner.split(importLine).length !== 2) throw new Error("HEAD agent-runner: evolutionPromptNote import not unique");
const importBlock = [
  importLine,
  "// 运行面装载：当前 active 的 content-pack（prompt.md / system.md）拼进同一段 system prompt。",
  "// 工作区没有 modules/ 或没有 active 内容包 ⇒ 空串，系统提示词逐字节不变。",
  'import { activeContentPackNote } from "./evolution/activation-host";',
].join("\n");
const oldBlock = [
  '    let evolutionNote = "";',
  "    try {",
  "      evolutionNote = await evolutionPromptNote(opts.workspace);",
  "    } catch {",
  '      evolutionNote = "";',
  "    }",
].join("\n");
const newBlock = [
  oldBlock,
  "    // 运行面装载：active content-pack 的提示词正文，并入同一段演进注记。装载失败出声但保持空串——",
  "    // 与上面策略补丁同一条「零包 = 零行为」回归面；这里不把「读不到」静默成「没有包」。",
  "    try {",
  "      evolutionNote += await activeContentPackNote(opts.workspace);",
  "    } catch (err) {",
  '      console.warn("[evolution-pack] 装载失败（不影响主流程）: " + (err instanceof Error ? err.message : String(err)));',
  "    }",
].join("\n");
let runner = headRunner.replace(importLine, importBlock);
if (runner === headRunner) throw new Error("import replacement did not apply");
if (!runner.includes(oldBlock)) throw new Error("evolutionNote block not found in HEAD");
runner = runner.replace(oldBlock, newBlock);
if (runner.includes("verifySurfaceFingerprint")) throw new Error("synthetic agent-runner unexpectedly contains others' changes");
const runnerPath = join(tmp, "agent-runner.head+ours.ts");
writeFileSync(runnerPath, runner, "utf8");

// ---- PROGRESS.md：HEAD + 第 637/638 页（不带上他人未提交的第 636 页）----
const headProgress = git("show", "HEAD:PROGRESS.md");
const workProgress = readFileSync(join(repo, "PROGRESS.md"), "utf8");
const marker = "## 2026-10-21 · 第 637 页";
const at = workProgress.indexOf(marker);
if (at < 0) throw new Error("working PROGRESS: page 637 marker missing");
const ours = workProgress.slice(at);
if (!ours.includes("## 2026-10-21 · 第 638 页")) throw new Error("working PROGRESS: page 638 missing");
if (ours.includes("第 636 页")) throw new Error("working PROGRESS: our extract unexpectedly includes page 636");
if (headProgress.includes(marker)) throw new Error("HEAD PROGRESS already has page 637");
const combined = headProgress + (headProgress.endsWith("\n") ? "\n" : "\n\n") + ours;
const progressPath = join(tmp, "progress.head+ours.md");
writeFileSync(progressPath, combined, "utf8");

const blob = (path) => git("hash-object", "-w", path).trim();
const runnerBlob = blob(runnerPath);
const progressBlob = blob(progressPath);
git("update-index", "--cacheinfo", "100644," + runnerBlob + ",src/main/agent-runner.ts");
git("update-index", "--cacheinfo", "100644," + progressBlob + ",PROGRESS.md");

console.log(JSON.stringify({
  tmp,
  runnerBlob,
  progressBlob,
  runnerHasOurImport: runner.includes("activeContentPackNote"),
  runnerHasOthersChanges: runner.includes("verifySurfaceFingerprint"),
  progressPages: (combined.match(/第 63[0-9] 页/g) ?? []).slice(-4),
}, null, 2));
