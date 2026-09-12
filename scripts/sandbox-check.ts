// sandbox:check —— 沙箱生效性验收（四项断言）+ **沙箱不可用时的降级链断言**（M2g §2.1 红线）。
//
// 两条分支（分支选择在输出里显式打印，fail-visible——修掉「真空通过」）：
//   A. 沙箱可用：走原断言 ①工作区内写成功 ②工作区外写被拒 ③敏感目录读取被拒 ④断网；
//      **不得放宽**；且 ②③④ 必须能区分「沙箱拒绝」与「沙箱压根没 apply」——后者标「未验证」并计失败
//      （M2g §1.4-1：旧版把 exit 71「sandbox_apply: Operation not permitted」当绿，绿 ≠ 测到了）。
//   B. 沙箱不可用：断言的是**降级链正确**而非沙箱生效：
//      checkSandbox()=false → sandboxRisk 判写工具 high → auto 档送审 → 非交互 AskGate fail-closed 拒绝且不落盘。
//
// 用法：pnpm sandbox:check                        正向（按宿主自动选分支）
//       pnpm sandbox:check -- --force-available   反向验证：强制走分支 A（沙箱实际不可用 → 断言必须红）
//       pnpm sandbox:check -- --bogus-root        反向验证：可写根换成不存在路径（分支 A，断言①必须红）
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSandbox, runInSandbox } from "../src/main/sandbox";
import { evaluate, newAutonomySession, checkPermission, sandboxRisk } from "../src/permissions";
import { AskGate } from "../src/main/ask-gate";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bogus = process.argv.includes("--bogus-root");
const forceAvailable = process.argv.includes("--force-available") || bogus;
const ws = join(ROOT, ".tmp", "sandbox-check-ws");
const writableRoot = bogus ? "/nonexistent/m0b-bogus-root" : ws;
const target = join(ws, "sandbox-write-ok.txt");

await mkdir(join(ws, ".tmp"), { recursive: true });
await rm(target, { force: true });

let failures = 0;
function assert(cond: boolean, label: string, detail = ""): void {
  if (cond) {
    console.log("  ✅ " + label + (detail ? "（" + detail + "）" : ""));
  } else {
    failures++;
    console.error("  ❌ " + label + (detail ? "（" + detail + "）" : ""));
  }
}

/** 「沙箱没 apply」的指纹：sandbox-exec 起不来（宿主策略拒载），不是沙箱规则在生效。 */
const APPLY_FAILED = /sandbox_apply:|exit code: 71/;
const applied = (r: { ok: boolean; output: string }): boolean => !APPLY_FAILED.test(r.output);

const status = await checkSandbox();
const degraded = !forceAvailable && !status.available;

if (bogus) {
  console.log("[sandbox:check] 反向验证：profile 可写根 = /nonexistent/m0b-bogus-root（期望 ① 变红）");
} else {
  console.log("[sandbox:check] 可写根 = " + ws);
}
console.log(
  "[sandbox:check] 沙箱自检：available=" + String(status.available) +
    (status.reason ? "（" + status.reason.slice(0, 80) + "）" : "") +
    (forceAvailable ? "；--force-available 强制走分支 A" : ""),
);
console.log(
  "[sandbox:check] 本轮走 " +
    (degraded ? "**降级分支 B**（沙箱不可用 → 断言降级链正确）" : "**分支 A**（沙箱可用 → 断言沙箱生效）"),
);

if (!degraded) {
  // ---------------- 分支 A：沙箱可用（原断言强度，不放宽） ----------------
  console.log("[sandbox:check] ① 工作区内写");
  const w1 = await runInSandbox(
    "node -e \"require('fs').writeFileSync(process.cwd() + '/sandbox-write-ok.txt', 'ok')\"",
    { cwd: ws, writableRoot },
  );
  console.log("    " + w1.output.split("\n").join(" | "));
  assert(w1.ok && existsSync(target), "① 工作区内写成功");

  console.log("[sandbox:check] ② 工作区外写（/private/tmp）");
  const w2 = await runInSandbox(
    "node -e \"require('fs').writeFileSync('/private/tmp/m0b-sbx-should-deny.txt', 'x')\"",
    { cwd: ws, writableRoot },
  );
  console.log("    " + w2.output.split("\n").join(" | "));
  assert(applied(w2), "② 沙箱确实 apply", APPLY_FAILED.test(w2.output) ? "未验证：sandbox_apply 被拒（绿 ≠ 测到了）" : "已 apply");
  // gates:disjunction-ok 合法析取：「被拒」有两种合理表现——非零退出，或 stderr 报 operation not permitted 而退出码仍为 0（取决于 EPERM 如何上报）；两者任一即证明被拦。
  assert(!w2.ok || /operation not permitted/i.test(w2.output), "② 工作区外写被拒");

  console.log("[sandbox:check] ③ 敏感目录读取");
  const r1 = await runInSandbox("node -e \"require('fs').readdirSync(process.env.HOME + '/.ssh')\"", { cwd: ws, writableRoot });
  console.log("    ~/.ssh → " + r1.output.split("\n").join(" | "));
  assert(applied(r1), "③ 沙箱确实 apply（~/.ssh）", APPLY_FAILED.test(r1.output) ? "未验证：sandbox_apply 被拒" : "已 apply");
  assert(!r1.ok, "③ ~/.ssh 读取被拒");
  const r2 = await runInSandbox("node -e \"require('fs').readdirSync(process.env.HOME + '/Library/Keychains')\"", { cwd: ws, writableRoot });
  console.log("    Keychains → " + r2.output.split("\n").join(" | "));
  assert(applied(r2), "③ 沙箱确实 apply（Keychains）", APPLY_FAILED.test(r2.output) ? "未验证：sandbox_apply 被拒" : "已 apply");
  assert(!r2.ok, "③ ~/Library/Keychains 读取被拒");

  console.log("[sandbox:check] ④ 断网（connect 1.1.1.1:80）");
  const n1 = await runInSandbox("node -e \"require('net').connect(80, '1.1.1.1')\"", { cwd: ws, writableRoot, timeoutMs: 15000 });
  console.log("    " + n1.output.split("\n").join(" | "));
  assert(applied(n1), "④ 沙箱确实 apply（断网）", APPLY_FAILED.test(n1.output) ? "未验证：sandbox_apply 被拒" : "已 apply");
  // gates:disjunction-ok 合法析取：同上——断网可表现为非零退出，或 stderr 报 operation not permitted 而退出码为 0。
  assert(!n1.ok || /operation not permitted/i.test(n1.output), "④ 沙箱内无法建立 TCP 连接");
} else {
  // ---------------- 分支 B：沙箱不可用 → 断言降级链正确（§2.1 红线） ----------------
  // 链：checkSandbox()=false → sandboxRisk 判写工具 high → auto 档送审 → 非交互 fail-closed 拒绝且不落盘。
  assert(!status.available, "B1 沙箱自检结论 = 不可用（降级分支的前提成立）");

  const sr = sandboxRisk(false, "write_file", true);
  assert(sr.level === "high", "B2 sandboxRisk(不可用, 写工具) = high", "实际 " + sr.level);

  // 档位层本身不拦（auto → allow）；送审来自**风险层**——证明 ask 是沙箱降级导致的，不是档位策略
  assert(checkPermission("auto", "write_file") === "allow", "B3 档位层 auto 对写工具 = allow（ask 不是档位层给的）");
  const s = newAutonomySession("auto", { sandboxAvailable: false });
  const d = evaluate("write_file", { path: "sandbox-write-ok.txt", content: "x" }, s);
  assert(
    d.verdict === "ask",
    "B4 auto 档 + 沙箱不可用 → 写工具送审（风险层 high）",
    "实际 " + d.verdict + (d.verdict === "ask" ? "（" + d.reason + "）" : ""),
  );

  // 非交互 fail-closed：无 UI 通知的 AskGate（超时 50ms 按拒绝）→ 拒绝；且**不落盘**
  const gate = new AskGate({ timeoutMs: 50 });
  const r = await gate.request("write_file", { path: "sandbox-write-ok.txt", content: "x" }, { reason: d.verdict === "ask" ? d.reason : "" });
  assert(r.outcome === "rejected", "B5 非交互 AskGate fail-closed 拒绝（无 UI 响应 → 超时拒绝）", "实际 " + r.outcome);
  assert(!existsSync(target), "B6 未获批准的写动作不落盘（目标文件不存在）");
}

if (failures > 0) {
  console.error(
    "[sandbox:check] " + (bogus ? "反向验证：断言出现红项" : "失败") + "（" + String(failures) + " 项未通过）",
  );
  process.exitCode = 1;
} else {
  console.log("[sandbox:check] 全部断言通过（分支 " + (degraded ? "B 降级链" : "A 沙箱生效") + "）");
}
