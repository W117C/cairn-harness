#!/usr/bin/env node
// 桌面 CSP ＋ sandbox 的落地门（照 d61-fix-ready / d57-fix-ready 先例）：
// **先验两支目标文件是否仍在飞，才许 apply**；apply 之后把备妥阶段没跑的三件事补跑。
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const TARGETS = ["apps/desktop/src/renderer/index.html", "apps/desktop/src/main/index.ts"];
const PATCH = join(HERE, "desktop-csp.patch");

const sh = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8" });

// ① 已落地就别再说"可落"
const html = readFileSync(join(ROOT, TARGETS[0]), "utf8");
if (html.includes("Content-Security-Policy")) {
  console.log("✅ 桌面 CSP 已落地（index.html 里已有 Content-Security-Policy）。本门无事可做。");
  process.exit(0);
}
// ② 前置：两支目标文件都不许在飞
const dirty = sh("git", ["status", "--porcelain", "--", ...TARGETS]).trim();
if (dirty !== "") {
  console.error("❌ 拒落：目标文件仍在飞——\n" + dirty);
  console.error("   ≈ 另一会话正持有桌面面。等它让出，别把它的在飞改动卷进你的提交。");
  process.exit(2);
}
if (!process.argv.includes("--apply")) {
  console.log("✅ 前置通过：两支目标文件干净，补丁可落。加 --apply 才会真落。");
  process.exit(0);
}

sh("git", ["apply", PATCH]);
console.log("✅ 补丁已落地");
// ③ 备妥阶段**没跑**的三件事，在这里补跑（失败即非零退出）
const steps = [
  ["桌面端构建 + 类型检查", "pnpm", ["--filter", "cairn-desktop", "build"]],
  ["桌面端判卷", "pnpm", ["--filter", "cairn-desktop", "test"]],
];
for (const [label, cmd, args] of steps) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" });
  const tail = (String(r.stdout) + String(r.stderr)).split("\n").filter((l) => /Test Files|Tests {2}|error|Error|✅|❌/u.test(l)).slice(-6).join("\n");
  console.log("\n== " + label + "（exit=" + String(r.status) + "）==\n" + tail);
  if (r.status !== 0) { console.error("❌ " + label + " 没过 ⇒ 补丁不能收，先查上面那几行"); process.exit(1); }
}
console.log("\n✅ 构建与判卷都过。**冒烟仍要人工跑一次**（它要真开 Electron 窗口）：");
console.log("   CAIRN_SMOKE=1 pnpm --filter cairn-desktop exec electron .   # 或按 desktop 的 smoke 脚本");
console.log('未跑冒烟之前，不要宣布「这条改动验过了」——CSP 与 sandbox 的失败形状是**界面白屏**，');
console.log("而那正是只有真窗口才看得见的东西。");
console.log("\n下一步：git add " + TARGETS.join(" ") + " && git commit");
