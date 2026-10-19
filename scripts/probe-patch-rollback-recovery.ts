// 复现器（**判据只住这一份**）：多文件 `apply_patch` 第二阶段失败时，回执给的恢复指引
// 指的是不是一条真存在的路。
//
// 为什么这个脚本只 exec 别人、不自己量：那一格的判据要**注入 fs 失败**（rename 到第二个文件失败 +
// 回滚第一个也失败），而 ESM 的 `node:fs/promises` 命名空间是只读的，普通脚本 patch 不到
// `apply_patch` 真正调用的那个对象（实测：CJS 那份在 tsx 下与 ESM 那份不是同一个对象，注入静默失效）。
// `vi.mock` 能做这件事，所以判据住在 `tests/apply-patch.test.ts` 的原子性那一族里。
//
// 本脚本被 `scripts/probe-promise-recall.ts` 的 `hopPatchRollbackRecovery` exec，作用是
// **确认那一格现在还是绿的**（登记表不许挂着一条已经红掉/消失的判据）。判据本身不在这里重抄——
// 同一判据两份副本宽度不同＝本仓第十三族。
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const r = spawnSync(
  process.execPath,
  ["--import", "tsx", join(ROOT, "node_modules", "vitest", "vitest.mjs"), "run",
    "--config", "tests/vitest.config.ts",
    "tests/apply-patch.test.ts", "-t", "回滚也失败时：没有快照就不拿快照指路"],
  { cwd: ROOT, encoding: "utf8" },
);

const tail = String(r.stdout ?? "").trim().split("\n").slice(-4).join(" / ");
const ok = r.status === 0;
console.log((ok ? "✅" : "❌") + " 判据（tests/apply-patch.test.ts · 回滚也失败时）现在" + (ok ? "绿" : "红"));
console.log("  exit=" + String(r.status) + "｜" + tail.slice(0, 240));
process.exit(ok ? 0 : 1);
