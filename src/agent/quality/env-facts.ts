// 开工前注入的环境事实（确定性、无模型调用）。
//
// 为什么不是「让模型自己 ls 一遍」：LangChain 的 harness 对照实验里，环境自检是仅次于
// 自验证的第二大单项（把目录结构、可用工具、测试命令直接送进上下文，减少搜索与猜命令的错误面）。
// 这里只收集**稳定、便宜、可验证**的事实，并压到 ~1.5KB：目录两层、脚本名、锁文件、测试面、git 状态。
import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { isRecord } from "../../is-record";

export interface EnvironmentFacts {
  workspaceName: string;
  packageManager: string | null;
  node: string;
  scripts: Record<string, string>;
  topDirs: string[];
  topFiles: string[];
  testFiles: string[];
  testCommand: string | null;
  gitBranch: string | null;
  gitDirty: number | null;
  languages: string[];
}

const MAX_DIRS = 24;
const MAX_FILES = 24;
const MAX_TEST_FILES = 8;

function run(cmd: string, args: readonly string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, [...args], { cwd, timeout: 2_500, maxBuffer: 256 * 1024 }, (err, stdout) => {
      resolve(err ? null : String(stdout).trim());
    });
  });
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 只走两层、只数不读：环境事实不许变成一次全仓库扫描。 */
async function walkTests(root: string, rel: string, depth: number, out: string[]): Promise<void> {
  if (depth > 2 || out.length >= MAX_TEST_FILES) return;
  let entries;
  try {
    entries = await readdir(join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_TEST_FILES) return;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const next = rel === "" ? entry.name : rel + "/" + entry.name;
    if (entry.isDirectory()) {
      await walkTests(root, next, depth + 1, out);
    } else if (/(\.|_)(test|spec)\.[cm]?[jt]sx?$|^test_.*\.py$/.test(entry.name)) {
      out.push(next);
    }
  }
}

export async function probeEnvironment(workspace: string): Promise<EnvironmentFacts> {
  const pkg = await readJson(join(workspace, "package.json"));
  const rawScripts = pkg?.scripts;
  const scripts: Record<string, string> = {};
  if (isRecord(rawScripts)) {
    for (const [name, value] of Object.entries(rawScripts)) {
      if (typeof value === "string" && ["test", "lint", "typecheck", "build", "check"].includes(name)) {
        scripts[name] = value;
      }
    }
  }

  let entries: Dirent[];
  try {
    entries = await readdir(workspace, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const topDirs: string[] = [];
  const topFiles: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
    if (entry.isDirectory()) {
      if (topDirs.length < MAX_DIRS) topDirs.push(entry.name + "/");
    } else if (topFiles.length < MAX_FILES) {
      topFiles.push(entry.name);
    }
  }

  let packageManager: string | null = null;
  for (const [lock, pm] of [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
    ["bun.lockb", "bun"],
  ] as const) {
    try {
      await stat(join(workspace, lock));
      packageManager = pm;
      break;
    } catch {
      // 继续找下一个
    }
  }

  const testFiles: string[] = [];
  await walkTests(workspace, "", 0, testFiles);

  const languages: string[] = [];
  const fileNames = [...topFiles, ...testFiles];
  const has = (re: RegExp): boolean => fileNames.some((f) => re.test(f));
  if (has(/\.tsx?$/)) languages.push("ts");
  if (has(/\.jsx?$/)) languages.push("js");
  if (has(/\.py$/)) languages.push("py");
  if (has(/\.go$/)) languages.push("go");
  if (has(/\.rs$/)) languages.push("rs");

  const branch = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], workspace);
  const dirtyRaw = await run("git", ["status", "--porcelain"], workspace);
  const gitDirty = dirtyRaw === null ? null : dirtyRaw === "" ? 0 : dirtyRaw.split("\n").length;

  return {
    workspaceName: basename(workspace),
    packageManager,
    node: process.version,
    scripts,
    topDirs,
    topFiles,
    testFiles,
    testCommand: testCommandOf(scripts, packageManager, testFiles),
    gitBranch: branch,
    gitDirty,
    languages,
  };
}

function testCommandOf(
  scripts: Record<string, string>,
  packageManager: string | null,
  testFiles: readonly string[],
): string | null {
  if (scripts.test !== undefined) {
    return (packageManager ?? "npm") + (packageManager === "yarn" ? "" : " run") + " test";
  }
  if (testFiles.some((f) => f.endsWith(".py"))) return "pytest -q";
  if (testFiles.some((f) => f.endsWith(".go"))) return "go test ./...";
  if (testFiles.some((f) => f.endsWith(".rs"))) return "cargo test";
  if (testFiles.length > 0) return "node --test";
  return null;
}

/** 渲染成一段确定性的上下文块。同样的盘上事实必须得到逐字相同的文本（便于前缀缓存）。 */
export function renderEnvironmentFacts(f: EnvironmentFacts): string {
  const lines: string[] = [];
  lines.push("[environment] verified facts, gathered before the first model call:");
  lines.push(`workspace: ${f.workspaceName}`);
  lines.push(`runtime: node ${f.node}${f.packageManager === null ? "" : `; package manager: ${f.packageManager}`}`);
  if (f.languages.length > 0) lines.push(`languages: ${f.languages.join(", ")}`);
  if (f.topDirs.length > 0) lines.push(`dirs: ${f.topDirs.join(" ")}`);
  if (f.topFiles.length > 0) lines.push(`files: ${f.topFiles.slice(0, 16).join(" ")}`);
  const scriptNames = Object.keys(f.scripts);
  if (scriptNames.length > 0) lines.push(`package scripts: ${scriptNames.join(", ")}`);
  if (f.testCommand !== null) lines.push(`test command: ${f.testCommand}`);
  if (f.testFiles.length > 0) lines.push(`test files: ${f.testFiles.join(" ")}`);
  if (f.gitBranch !== null) lines.push(`git: ${f.gitBranch}${f.gitDirty === null ? "" : `; dirty entries: ${String(f.gitDirty)}`}`);
  lines.push("rules: use these commands as-is; do not guess a test runner. Verification runs outside your control.");
  return lines.join("\n");
}
