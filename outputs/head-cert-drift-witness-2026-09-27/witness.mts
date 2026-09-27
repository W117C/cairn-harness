/** 任务 #25 的真路径见证：`收尾复核` 的 **drift 非空那一支**此前只有合成输入在守（第 149 页只跑过 同一笔 那一支）。
 *  这里不常驻进判卷（代价＝每次判卷多等一次 typecheck，还要在共享仓里建树），而是一次性造真并发：
 *  起 `head-cert --skip-test` → 等它印出「已核：TREE=」（切完树、复核还没跑）→ 立刻把那棵树 checkout 到别的一笔 →
 *  断言 exit≠0、印的是「作废」而不是「红」、并且点名两边 sha。
 *  跑法：node --import tsx outputs/head-cert-drift-witness-2026-09-27/witness.mts */
import { spawn, spawnSync } from "node:child_process";

const MAIN = process.cwd();
const TREE = ".worktrees/drift-witness";
/** 反向对照（规则 226）：`--no-switch` 时什么都不切，走 drift===null 那一支 ⇒ 必须 exit 0 且印「同一笔」。
 *  没有这一条，上一支的"红"可能只是 `--skip-test` 本身不绿、或 typecheck 在撞窗下红了。 */
const NO_SWITCH = process.argv.includes("--no-switch");
const run = (args: string[]): string => {
  const r = spawnSync("git", args, { cwd: MAIN, encoding: "utf8" });
  return (r.stdout ?? "") + (r.stderr ?? "");
};

const head = run(["rev-parse", "HEAD"]).trim();
const other = run(["rev-parse", "HEAD~1"]).trim();
if (head === "" || other === "" || head === other) {
  console.error(`取不到两笔不同的提交（HEAD=${head.slice(0, 7)} HEAD~1=${other.slice(0, 7)}）⇒ 没尺`);
  process.exit(2);
}
console.log(`目标（认证那一笔）=${head.slice(0, 7)}　中途切去的那一笔=${other.slice(0, 7)}`);

if (!run(["worktree", "list"]).includes(TREE)) {
  console.log("建 scratch 树…");
  process.stdout.write(run(["worktree", "add", "--detach", TREE, head]).trim().split("\n").slice(0, 2).join("\n") + "\n");
} else {
  console.log(`复用已存在的 ${TREE}`);
}
run(["-C", TREE, "checkout", "--detach", head]);
if (run(["-C", TREE, "status", "--porcelain", "--", "src", "scripts", "tests"]).trim() !== "") {
  console.error("scratch 树判卷四面有在飞改动 ⇒ 不是我造的干净态，停");
  process.exit(2);
}

const child = spawn(process.execPath, [
  "--import", "tsx", "scripts/head-cert.ts",
  "--at=HEAD", `--tree=${TREE}`, "--skip-test",
  "--why=只为造一次真并发切树：要的是 drift 那一支的 exit 码与措辞，不是这棵树的认证",
], { cwd: MAIN, encoding: "utf8" });

let out = "";
let switched = false;
child.stdout.on("data", (chunk: string) => {
  out += chunk;
  if (!switched && !NO_SWITCH && out.includes("已核：TREE=")) {
    switched = true;
    const r = run(["-C", TREE, "checkout", "--detach", other]);
    console.log(`\n>>> 已在判卷期把树切走（${head.slice(0, 7)} → ${other.slice(0, 7)}），git 退出输出：${r.trim().split("\n").pop() ?? "无输出"}`);
  }
});
child.stderr.on("data", (chunk: string) => { out += chunk; });

child.on("close", (code) => {
  const checks: [string, boolean][] = NO_SWITCH
    ? [
      ["对照模式：确实没切树", !switched],
      [`exit=0（实得 ${String(code)}）⇒ 不切树时这道门不该红`, code === 0],
      ["印的是 收尾复核=同一笔", out.includes("收尾复核=同一笔")],
      ["没出现「作废」", !out.includes("作废")],
    ]
    : [
      ["先真的切了树（不是没等到时机）", switched],
      [`exit≠0（实得 ${String(code)}）⇒ 作废要改退出码`, code !== 0 && code !== null],
      ["印的是「作废」", out.includes("作废")],
      ["印了 收尾复核=作废 这一格", out.includes("收尾复核=作废")],
      [`点名切去的那一笔 ${other.slice(0, 7)}`, out.includes(other.slice(0, 7))],
      [`点名认证目标 ${head.slice(0, 7)}`, out.includes(head.slice(0, 7))],
      ["不说成「HEAD 红」（归因方向要错到人身上）", !out.split("\n").some((l) => l.includes("作废") && l.includes("红"))],
      ["没把这次当已认证（等级不写全绿）", !/认证等级[^\n]*全量/.test(out)],
    ];
  console.log(`\n== 断言（${NO_SWITCH ? "反向对照：不切树" : "正例：判卷期切树"}）==`);
  let bad = 0;
  for (const [name, ok] of checks) {
    if (!ok) bad += 1;
    console.log(`${ok ? "✅" : "❌"} ${name}`);
  }
  const pick = (needle: string): string => out.split("\n").find((l) => l.includes(needle))?.trim() ?? `(没有含「${needle}」的行)`;
  console.log(`\n门印出来的原句：\n  ${pick("跑完复核")}\n  ${pick("收尾复核=")}\n  ${pick("并发判卷=")}`);
  console.log(`退出码=${String(code)}　回收：git worktree remove --force ${TREE}`);
  process.exit(bad === 0 ? 0 : 1);
});
