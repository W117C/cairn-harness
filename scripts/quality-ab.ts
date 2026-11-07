// 质量档 A/B：同一模型剧本、同一任务、同一判定，只换 harness。
//
// 这不是"模型能力读数"——剧本是确定性的，用来证明**结构性差异**：
//   baseline：模型自己说"做完了"就收束（是否验证全靠自觉）；
//   quality ：写过盘 ⇒ harness 补一拍验证 ⇒ 红则返修 ⇒ 仍红则拒绝成功收束。
// 真实模型读数需要凭据：CAIRN_API_KEY / CAIRN_ENDPOINT / CAIRN_MODEL（见 README 的质量档一节）。
//
// 用法：node --import tsx scripts/quality-ab.ts [--keep]
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createEventLog, replay } from "../src/events";
import { QualityGateError, runLoop } from "../src/agent/loop";
import { createVerifyHook } from "../src/agent/verify";
import { planVerification, runVerificationPlan } from "../src/agent/quality/verifiers";
import { QUALITY_MINIMAL_TOOLS, qualityCompactionConfig } from "../src/agent/quality/policy";
import { qualityToolTable } from "../src/agent/quality/tools";
import { TOOLS } from "../src/tools";
import type { ModelOutput, Provider, ProviderMessage } from "../src/providers";

interface Task {
  id: string;
  prompt: string;
  verifyCommand: string;
  verifyKey: "test" | "typecheck";
  seed: Record<string, string>;
  bad: { path: string; content: string };
  good: { path: string; content: string };
}

const TASKS: readonly Task[] = [
  {
    id: "T1-bugfix-add",
    prompt: "Fix the failing test in tests/math.test.js. The add() helper returns the wrong value.",
    verifyCommand: "node --test tests/math.test.js",
    verifyKey: "test",
    seed: {
      "src/math.js": "export function add(a, b) {\n  return a - b;\n}\n",
      "tests/math.test.js":
        "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/math.js';\n\ntest('adds two numbers', () => {\n  assert.equal(add(2, 3), 5);\n});\n",
    },
    bad: { path: "src/math.js", content: "export function add(a, b) {\n  return a - b;\n}\n" },
    good: { path: "src/math.js", content: "export function add(a, b) {\n  return a + b;\n}\n" },
  },
  {
    id: "T2-feature-slug",
    prompt: "Implement slugify() in src/text.js so tests/text.test.js passes, including the edge case.",
    verifyCommand: "node --test tests/text.test.js",
    verifyKey: "test",
    seed: {
      "src/text.js": "export function slugify(value) {\n  return value.toLowerCase().split(' ').join('-');\n}\n",
      "tests/text.test.js":
        "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { slugify } from '../src/text.js';\n\ntest('slugifies punctuation and padding', () => {\n  assert.equal(slugify('  Hello, World  '), 'hello-world');\n});\n",
    },
    bad: { path: "src/text.js", content: "export function slugify(value) {\n  return value.toLowerCase().split(' ').join('-');\n}\n" },
    good: {
      path: "src/text.js",
      content:
        "export function slugify(value) {\n  return value\n    .trim()\n    .toLowerCase()\n    .replace(/[^a-z0-9]+/g, '-')\n    .replace(/^-+|-+$/g, '');\n}\n",
    },
  },
  {
    id: "T3-static-syntax",
    prompt: "Fix src/app.js so it parses. The file currently has a syntax error.",
    verifyCommand: "node --check src/app.js",
    verifyKey: "typecheck",
    seed: { "src/app.js": "export const ok = true;\n" },
    bad: { path: "src/app.js", content: "export function main( {\n  return 1;\n}\n" },
    good: { path: "src/app.js", content: "export function main() {\n  return 1;\n}\n" },
  },
];

const KEEP = process.argv.includes("--keep");

/** 确定性剧本：第一轮写"坏"版本并宣称完成；看到 harness 的自动验证红字后写"好"版本。 */
function scriptedProvider(task: Task): Provider {
  let calls = 0;
  let repaired = false;
  return {
    async *stream(messages: ProviderMessage[]): AsyncIterable<ModelOutput> {
      calls += 1;
      const sawVerificationRed = messages.some(
        (m) => typeof m.content === "string" && m.content.includes("harness 自动验证"),
      );
      if (sawVerificationRed && !repaired) {
        repaired = true;
        yield { type: "tool_call", id: `call-${String(calls)}-fix`, name: "write_file", args: { path: task.good.path, content: task.good.content } };
        yield { type: "usage", inputTokens: 1_200, outputTokens: 120 };
        return;
      }
      // 每个请求只做一件事：先写，再收尾。写坏了也照样宣称完成——正是要拦的那一类。
      const writeDone = messages.some((m) => m.role === "assistant" && m.tool_calls !== undefined && m.tool_calls.length > 0);
      if (!writeDone) {
        yield { type: "tool_call", id: `call-${String(calls)}-write`, name: "write_file", args: { path: task.bad.path, content: task.bad.content } };
        yield { type: "usage", inputTokens: 1_800, outputTokens: 160 };
        return;
      }
      yield { type: "assistant_message", content: "Done. The tests pass now." };
      yield { type: "usage", inputTokens: 900, outputTokens: 80 };
    },
  };
}

interface Reading {
  task: string;
  arm: "baseline" | "quality";
  passed: boolean;
  claimedDone: boolean;
  gateBlocked: boolean;
  tokens: number;
  wallMs: number;
  verifyCommand: string;
}

async function runArm(task: Task, arm: "baseline" | "quality"): Promise<Reading> {
  const workspace = await mkdtemp(join(tmpdir(), `cairn-quality-${arm}-`));
  await mkdir(join(workspace, ".agent"), { recursive: true });
  for (const [path, content] of Object.entries(task.seed)) {
    await mkdir(join(workspace, path, ".."), { recursive: true });
    await writeFile(join(workspace, path), content, "utf8");
  }
  await writeFile(
    join(workspace, ".agent", "config.json"),
    JSON.stringify({ verify: { [task.verifyKey]: [task.verifyCommand] } }, null, 2),
    "utf8",
  );
  const logPath = join(workspace, ".agent", "events.jsonl");
  const started = Date.now();
  let gateBlocked = false;
  try {
    await runLoop({
      provider: scriptedProvider(task),
      events: createEventLog(logPath),
      workspace,
      mode: "full-access",
      interactive: false,
      maxSteps: 10,
      userMessage: task.prompt,
      ...(arm === "quality"
        ? {
            tools: qualityToolTable(QUALITY_MINIMAL_TOOLS),
            verify: createVerifyHook(workspace, { trustedRepo: true, maxAttempts: 3 }),
            autoVerify: true,
            autoVerifyRepair: true,
            requireGreenVerify: true,
            deliveryRepair: true,
          }
        : {}),
    });
  } catch (err) {
    gateBlocked = err instanceof QualityGateError;
    if (!gateBlocked) throw err;
  }
  const wallMs = Date.now() - started;

  const events = await replay(logPath);
  const tokens = events.reduce((sum, e) => (e.type === "usage" ? sum + e.inputTokens + e.outputTokens : sum), 0);
  const claimedDone = events.some((e) => e.type === "assistant_message" && /tests pass now/i.test(e.content));

  const plan = await planVerification({ workspace });
  const outcome = await runVerificationPlan(plan, workspace);
  const passed = outcome.ok;

  if (!KEEP) await rm(workspace, { recursive: true, force: true });
  return { task: task.id, arm, passed, claimedDone, gateBlocked, tokens, wallMs, verifyCommand: task.verifyCommand };
}

async function main(): Promise<void> {
  const rows: Reading[] = [];
  for (const task of TASKS) {
    for (const arm of ["baseline", "quality"] as const) {
      rows.push(await runArm(task, arm));
      process.stderr.write(`[quality-ab] ${task.id} ${arm} done\n`);
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = resolve("outputs", "quality-ab", stamp);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "readings.json"), JSON.stringify(rows, null, 2) + "\n", "utf8");

  const line = (r: Reading): string =>
    `| ${r.task} | ${r.arm} | ${r.passed ? "pass" : "fail"} | ${r.claimedDone ? "yes" : "no"} | ${r.tokens} | ${r.wallMs} |`;
  const md = [
    "# Quality gate A/B (deterministic scripted model)",
    "",
    "Same scripted model, same tasks, same judge; only the harness differs.",
    "",
    "| task | arm | final tests | claimed done | tokens | wall ms |",
    "|---|---|---|---|---|---|",
    ...rows.map(line),
    "",
    "`claimed done` = the model said the tests pass. `final tests` = the verifier's verdict on the final workspace.",
  ].join("\n");
  await writeFile(join(outDir, "report.md"), md + "\n", "utf8");
  process.stdout.write(md + "\n\n→ " + outDir + "\n");
}

await main();
