// sandbox:check —— 四项断言：①工作区内写成功 ②工作区外写被拒 ③敏感目录读取被拒 ④断网。
// 用法：pnpm sandbox:check                     正向（必须全绿）
//       pnpm sandbox:check -- --bogus-root     反向验证：可写根换成不存在的路径，断言①必须变红。
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInSandbox } from "../src/main/sandbox";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bogus = process.argv.includes("--bogus-root");
const ws = join(ROOT, ".tmp", "sandbox-check-ws");
const writableRoot = bogus ? "/nonexistent/m0b-bogus-root" : ws;

await mkdir(join(ws, ".tmp"), { recursive: true });
await rm(join(ws, "sandbox-write-ok.txt"), { force: true });

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log("  ✅ " + label);
  } else {
    failures++;
    console.error("  ❌ " + label);
  }
}

if (bogus) {
  console.log("[sandbox:check] 反向验证：profile 可写根 = /nonexistent/m0b-bogus-root（期望 ① 变红）");
} else {
  console.log("[sandbox:check] 可写根 = " + ws);
}

console.log("[sandbox:check] ① 工作区内写");
const w1 = await runInSandbox(
  "node -e \"require('fs').writeFileSync(process.cwd() + '/sandbox-write-ok.txt', 'ok')\"",
  { cwd: ws, writableRoot },
);
console.log("    " + w1.output.split("\n").join(" | "));
assert(w1.ok && existsSync(join(ws, "sandbox-write-ok.txt")), "① 工作区内写成功");

console.log("[sandbox:check] ② 工作区外写（/private/tmp）");
const w2 = await runInSandbox(
  "node -e \"require('fs').writeFileSync('/private/tmp/m0b-sbx-should-deny.txt', 'x')\"",
  { cwd: ws, writableRoot },
);
console.log("    " + w2.output.split("\n").join(" | "));
assert(!w2.ok || /operation not permitted/i.test(w2.output), "② 工作区外写被拒");

console.log("[sandbox:check] ③ 敏感目录读取");
const r1 = await runInSandbox(
  "node -e \"require('fs').readdirSync(process.env.HOME + '/.ssh')\"",
  { cwd: ws, writableRoot },
);
console.log("    ~/.ssh → " + r1.output.split("\n").join(" | "));
assert(!r1.ok, "③ ~/.ssh 读取被拒");
const r2 = await runInSandbox(
  "node -e \"require('fs').readdirSync(process.env.HOME + '/Library/Keychains')\"",
  { cwd: ws, writableRoot },
);
console.log("    Keychains → " + r2.output.split("\n").join(" | "));
assert(!r2.ok, "③ ~/Library/Keychains 读取被拒");

console.log("[sandbox:check] ④ 断网（connect 1.1.1.1:80）");
const n1 = await runInSandbox("node -e \"require('net').connect(80, '1.1.1.1')\"", {
  cwd: ws,
  writableRoot,
  timeoutMs: 15000,
});
console.log("    " + n1.output.split("\n").join(" | "));
assert(!n1.ok || /operation not permitted/i.test(n1.output), "④ 沙箱内无法建立 TCP 连接");

if (failures > 0) {
  console.error(
    "[sandbox:check] " + (bogus ? "反向验证：断言出现红项" : "失败") + "（" + String(failures) + " 项未通过）",
  );
  process.exitCode = 1;
} else {
  console.log("[sandbox:check] 全部断言通过");
}
