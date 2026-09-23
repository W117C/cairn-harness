// sandbox:check —— 沙箱生效性验收（四项断言）+ **沙箱不可用时的降级链断言**（M2g §2.1 红线）。
//
// 两条分支（分支选择在输出里显式打印，fail-visible——修掉「真空通过」）：
//   A. 沙箱可用：走原断言 ①工作区内写成功 ②工作区外写被拒 ③敏感目录读取被拒 ④断网
//      ④b 网络审批通道（缺省支连不上 / **批准后 allow 支连得上**，靶子是本进程回环端口，不出网）
//      ④c 断网提示只贴在缺省支 ⑤超限输出留尾部；
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
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
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

/** ④b 的网络靶子：本进程在回环端口上监听，收到请求就回一个一次性哨兵串。
 *  **刻意不出网**——「放行面到底放没放行」必须可在无网络/无外网凭据的宿主上判定，
 *  否则这条断言会在离线时被读成「沙箱有问题」假红，或在有网时被外部可用性污染。 */
async function startLoopbackProbe(): Promise<{ port: number; token: string; close: () => void }> {
  const token = "SBX-LOOPBACK-" + randomBytes(8).toString("hex");
  const server = createServer((_req, res) => {
    res.end(token);
  });
  await new Promise<void>((settle) => server.listen(0, "127.0.0.1", settle));
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  if (port === 0) throw new Error("回环探针起不来（port=0）——④b 无从判定，宁可炸也不假绿");
  return { port, token, close: () => server.close() };
}

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

  console.log("[sandbox:check] ④b 网络审批通道：allow 支连得上本进程回环端口，deny 支连不上（不出网）");
  const probe = await startLoopbackProbe();
  try {
    const getCmd = "node -e \"require('http').get({host:'127.0.0.1',port:" + String(probe.port) +
      "},r=>{let s='';r.on('data',d=>s+=d);r.on('end',()=>console.log('BODY:'+s))}).on('error',e=>console.log('ERR:'+e.code))\"";
    const nDeny = await runInSandbox(getCmd, { cwd: ws, writableRoot, timeoutMs: 15000 });
    const nAllow = await runInSandbox(getCmd, { cwd: ws, writableRoot, timeoutMs: 15000, network: "allow" });
    console.log("    deny  → " + nDeny.output.split("\n").join(" | "));
    console.log("    allow → " + nAllow.output.split("\n").join(" | "));
    assert(applied(nDeny) && applied(nAllow), "④b 沙箱确实 apply（回环连接）",
      APPLY_FAILED.test(nDeny.output + nAllow.output) ? "未验证：sandbox_apply 被拒" : "已 apply");
    // gates:disjunction-ok 合法析取：deny 支下取不到正文有两种合理表现——连接被拒（ERR:EPERM），
    // 或整个请求以非零退出收场；两者任一即证明「没放行」。与 ②④ 同一条口径。
    assert(!nDeny.output.includes(probe.token), "④b 缺省（deny）支拿不到网络", nDeny.output.slice(0, 80));
    assert(nAllow.output.includes(probe.token), "④b **批准后（allow）支确实拿得到**（§11.4 那一行的唯一证据）", nAllow.output.slice(0, 80));
  } finally {
    probe.close();
  }

  console.log("④c 断网提示只贴在缺省支（同一条命令、同一份 OS 原文，两支必须一贴一不贴）");
  // 输入是被拦命令的真实输出原文（本机 sandbox-exec 实测串），不依赖此刻是否真被拦——
  // 这样这条断言量的是**提示合成逻辑**，而不是宿主的网络状态；两支同靶才证明它挂在 network 上。
  const epermShape = "echo \"connect EPERM 1.1.1.1:80 - Local (0.0.0.0:0)\"";
  const noteDeny = await runInSandbox(epermShape, { cwd: ws, writableRoot, timeoutMs: 15000 });
  const noteAllow = await runInSandbox(epermShape, { cwd: ws, writableRoot, timeoutMs: 15000, network: "allow" });
  assert(noteDeny.output.includes("[sandbox]"), "④c 缺省支贴出可行动提示", noteDeny.output.split("\n").pop() ?? "");
  assert(!noteAllow.output.includes("[sandbox]"), "④c 放行支不得再贴「被断网」提示（那是假信号）", noteAllow.output.slice(0, 80));

  // ⑤ 输出截断口径（2026-09-19）：run_shell 与 verify 在**沙箱开着时**都从这里出口，
  // 它若只留头部，「哪条测试失败」那行就到不了模型——这条断言把三处对齐钉在同一个门面上。
  console.log("[sandbox:check] ⑤ 超限输出留尾部结论（与 run_shell / verify 同一只头尾环）");
  const big = await runInSandbox(
    "for i in $(seq 1 6000); do echo \"sandbox-line-$i\"; done; echo 'SANDBOX-TAIL-CONCLUSION'",
    { cwd: ws, writableRoot },
  );
  assert(applied(big), "⑤ 沙箱确实 apply（超限输出）", APPLY_FAILED.test(big.output) ? "未验证：sandbox_apply 被拒" : "已 apply");
  assert(big.output.includes("省略中间"), "⑤ 超限提示报出省略量", String(big.output.length) + " 字符");
  assert(big.output.includes("sandbox-line-1"), "⑤ 头部留住");
  assert(big.output.includes("SANDBOX-TAIL-CONCLUSION"), "⑤ 尾部结论留住（只留头部时这条必红）");
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
