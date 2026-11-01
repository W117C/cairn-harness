// 探针：清理临时目录时子进程还在写 ⇒ 裸 rmSync 会 ENOTEMPTY；带重试 + 咽下则不会。
// 形状照着 terminal-login-shell.test.ts 的现场（隔离 HOME + 登录 shell 收尾写入）。
import { mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

function busyWait(ms) { const t = Date.now(); while (Date.now() - t < ms) {} }

function trial(guarded, files) {
  const dir = mkdtempSync(join(tmpdir(), "cairn-race-"));
  const child = spawn("/bin/sh", ["-c", `i=0; while [ $i -lt ${files} ]; do : > ${dir}/f$i; i=$((i+1)); done`], { stdio: "ignore" });
  busyWait(10);
  let code = null;
  const clean = () => {
    if (guarded) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* 咽下 */ } }
    else rmSync(dir, { recursive: true, force: true });
  };
  try { clean(); } catch (e) { code = e.code; }
  child.kill("SIGKILL");
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {}
  return code;
}

for (const files of [200, 400]) {
  let bare = 0, guarded = 0;
  for (let i = 0; i < 15; i++) if (trial(false, files) !== null) bare++;
  for (let i = 0; i < 15; i++) if (trial(true, files) !== null) guarded++;
  console.log(`写入量 ${files} 文件：裸 rmSync 失败 ${bare}/15；重试+咽下 失败 ${guarded}/15（抛出的都算失败）`);
}
