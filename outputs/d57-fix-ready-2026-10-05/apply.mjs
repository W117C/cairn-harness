#!/usr/bin/env node
// #57 写入端的落地门（照第 351 页 `d61-fix-ready` 的先例）：**先验目标文件是否仍在飞，才许 apply**。
// 为什么要有这一道：这份补丁是在目标文件被另一会话持有期间备出来的。若执行者没先确认它就落地，
// 会把对方未提交的 hunk 一起带进自己的提交（本仓第 366 页记过这条代价）。
//
// 用法：node outputs/d57-fix-ready-2026-10-05/apply.mjs [--apply]
//   不带 --apply ⇒ 只做前置检查（只读）
//   带   --apply ⇒ 前置通过后落补丁，随后跑 typecheck + 两处判卷
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const TARGET = "src/main/agent-runner.ts";
const PATCH = join(HERE, "agent-runner.patch");
const FRAGMENT = join(HERE, "judge-fragment.test.ts");
const FRAGMENT_DEST = "tests/d57-write-face.test.ts";

const sh = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8" });

const dirty = sh("git", ["status", "--porcelain", "--", TARGET]).trim();
if (dirty !== "") {
  console.error(`❌ 拒落：${TARGET} 仍在飞（git status: ${dirty}）`);
  console.error("   ≈ 有人正持有它。等它让出（或先把它入库）再来，别把对方的改动带进你的提交。");
  process.exit(2);
}

if (!existsSync(join(ROOT, FRAGMENT_DEST))) copyFileSync(FRAGMENT, join(ROOT, FRAGMENT_DEST));

// 已落地就别再说"可落"——一份会误导执行者重复 apply 的门，比没有门更坏。
const landed = existsSync(join(ROOT, TARGET)) && sh("grep", ["-c", "alwaysRulesPath(workspace)", TARGET]).trim() !== "0";
if (landed) {
  console.log(`✅ #57 写入端已落地（${TARGET} 已用 alwaysRulesPath）。本门无事可做。`);
  process.exit(0);
}

if (!process.argv.includes("--apply")) {
  console.log(`✅ 前置通过：${TARGET} 干净，补丁可落。加 --apply 才会真落。`);
  console.log("  （本笔已带判卷片段，落地时会一并放到 " + FRAGMENT_DEST + "）");
  process.exit(0);
}

sh("git", ["apply", PATCH]);
console.log("✅ 补丁已落地");
// typecheck 的退出码带 **未跟踪草稿** 的账（本仓口径：未跟踪草稿不属 HEAD 回归）。
// 所以这里**不拿退出码当结论**，只认它自己印的那两行归因——那是本仓定义的"HEAD 态是否干净"。
const tc = spawnSync("node", ["--import", "tsx", "scripts/typecheck.ts"], { cwd: ROOT, encoding: "utf8" });
const tcOut = String(tc.stdout) + String(tc.stderr);
const trackedClean = tcOut.includes("tracked 面没有报错");
console.log(trackedClean ? "✅ typecheck：tracked 面 0 报错（未跟踪草稿的账不算本笔）" : "❌ typecheck：tracked 面有报错");
if (!trackedClean) { console.error(tcOut.slice(-1200)); process.exit(1); }

const j = spawnSync("node", ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", FRAGMENT_DEST, "tests/permissions-always-file.test.ts"], { cwd: ROOT, encoding: "utf8" });
process.stdout.write(String(j.stdout).split("\n").filter((l) => /Test Files|Tests {2}|FAIL/u.test(l)).join("\n") + "\n");
if (j.status !== 0) { console.error("❌ 判卷红"); process.exit(1); }
console.log("✅ 两处判卷通过（写入面 + 读侧面）");
console.log("下一步：把 " + TARGET + " 与 " + FRAGMENT_DEST + " 同笔提交。");
