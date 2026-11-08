/** 第 966 页：同一句「进程还在吗」，7 个文件各写一遍，其中一处把 EPERM 当死。
 *
 *  `kill(pid, 0)` 只问存在，不发信号。返回值只有三种有意义的结果：
 *   · 调用成功 ⇒ 活着；
 *   · ESRCH ⇒ 已退出（唯一能证明死亡的回执）；
 *   · EPERM ⇒ 活着，只是不归我管。
 *  其余 errno / pid 形状不对都是「不知道」。把「不知道」压进 `false`，锁就会把活人的
 *  临界区当崩溃残留回收；`session-mutation-lock.ts` 的 EPERM 分支正是这么写的。
 *  判据钉四件事：
 *   · 三态值域（成功 / ESRCH / EPERM / 其它 errno / 坏 pid）；
 *   · EPERM 的会话根锁按「占用」等待，不按「崩溃遗留」报错；
 *   · EPERM 的 orchestration writer lock 不被回收，pid 不可判定时 fail closed；
 *   · 核心/主进程只剩 `src/process-liveness.ts` 一处探活；`scripts/lib/tool-lock.ts` 因树闸
 *     靶子树只搬 `scripts/`，保留一份同口径的独立适配，判据单独钉它不许反向 import。
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { processLiveness } from "../src/process-liveness";
import { parseMutationLockPid, withSessionMutation } from "../src/main/session-mutation-lock";
import { OrchestrationStore } from "../src/orchestration/store";
import { readFileSync, readdirSync } from "node:fs";
import { relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const CANONICAL = "src/process-liveness.ts";
const ROOTS = ["src", "apps/desktop/src", "scripts"];
/** `scripts/lib/tool-lock.ts` 会被树闸判卷单独拷进只含 `scripts/` 的靶子树，
 *  不能 import `src/`；它保留一份同口径的保守适配，见下一组断言。 */
const STANDALONE = "scripts/lib/tool-lock.ts";
const CONSUMERS = [
  "src/main/session-lock.ts",
  "src/main/session-mutation-lock.ts",
  "src/main/evolution/canary.ts",
  "src/orchestration/local-backend.ts",
  "src/orchestration/store.ts",
  "src/permissions/rules.ts",
  "src/agent/plugins/mcp.ts",
];
const DIRECT_PROBE = /process\.kill\([^,\n]+,\s*0\s*\)/u;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "dist-electron") continue;
      out.push(...sourceFiles(rel));
    } else if (/\.(ts|tsx)$/u.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(rel);
    }
  }
  return out;
}

/** 注释里会引用 `process.kill(pid, 0)` 作说明；判据只看代码行。 */
function codeOnly(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const text = line.trim();
      return !text.startsWith("//") && !text.startsWith("*") && !text.startsWith("/*");
    })
    .join("\n");
}

const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

describe("进程探活只有一份、且分得清「死了」与「不知道」（第 966 页）", () => {
  it("成功 = alive；ESRCH = dead；EPERM = alive；其它 = unknown", () => {
    expect(processLiveness(42, () => undefined)).toBe("alive");
    expect(processLiveness(42, () => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); })).toBe("dead");
    expect(processLiveness(42, () => { throw Object.assign(new Error("not mine"), { code: "EPERM" }); })).toBe("alive");
    expect(processLiveness(42, () => { throw Object.assign(new Error("bad"), { code: "EINVAL" }); })).toBe("unknown");
    for (const pid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "42", null, undefined]) {
      expect(processLiveness(pid, () => { throw new Error("不该探活坏 pid"); })).toBe("unknown");
    }
  });

  it("锁文件只认完整十进制 pid：`12abc` 不能被截成 12 去探活别人", () => {
    expect(parseMutationLockPid(" 42\n")).toBe(42);
    expect(parseMutationLockPid("12abc")).toBeNull();
    expect(parseMutationLockPid("-1")).toBeNull();
    expect(parseMutationLockPid("0")).toBeNull();
    expect(parseMutationLockPid("99999999999999999999")).toBeNull();
    expect(parseMutationLockPid("")).toBeNull();
  });

  it("EPERM 的会话根锁按「占用」等待，不按「崩溃遗留」报错", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cairn-liveness-"));
    const holder = 2_147_483_647;
    const kill = process.kill.bind(process);
    const spy = vi.spyOn(process, "kill").mockImplementation((target, signal) => {
      if (target === holder && signal === 0) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      return kill(target, signal);
    });
    try {
      await writeFile(join(dir, ".session-mutation.lock"), `${String(holder)}\n`, "utf8");
      const error = await withSessionMutation(dir, async () => "ok").then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("正被另一个进程占用");
      expect((error as Error).message).toContain(String(holder));
      expect((error as Error).message).not.toContain("崩溃遗留");
    } finally {
      spy.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  }, 10_000);

  it("EPERM / 坏 pid 的 orchestration writer lock 不回收；只有 ESRCH 才回收", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cairn-liveness-store-"));
    const path = join(dir, "journal.jsonl");
    const lock = `${path}.writer.lock`;
    const holder = 2_147_483_647;
    const kill = process.kill.bind(process);
    const spy = vi.spyOn(process, "kill").mockImplementation((target, signal) => {
      if (target === holder && signal === 0) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      return kill(target, signal);
    });
    try {
      await writeFile(lock, JSON.stringify({ pid: holder }), "utf8");
      await expect(OrchestrationStore.open(path)).rejects.toThrow("writer lock exists");
      expect(await readFile(lock, "utf8")).toContain(String(holder));
    } finally {
      spy.mockRestore();
    }
    try {
      await writeFile(lock, JSON.stringify({ pid: 1.5 }), "utf8");
      await expect(OrchestrationStore.open(path)).rejects.toThrow("writer lock exists");
      expect(await readFile(lock, "utf8")).toContain("1.5");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("核心/主进程只剩共享实现一处探活，scripts 的独立适配保持同口径", () => {
    const offenders: string[] = [];
    const missing: string[] = [];
    for (const file of ROOTS.flatMap(sourceFiles)) {
      if (file === CANONICAL || file === STANDALONE) continue;
      if (DIRECT_PROBE.test(codeOnly(read(file)))) offenders.push(file);
    }
    for (const file of CONSUMERS) {
      if (!/from "[^"]*process-liveness"/u.test(read(file))) missing.push(file);
    }

    expect(offenders).toEqual([]);
    expect(missing).toEqual([]);
    const standalone = read(STANDALONE);
    expect(standalone, "独立适配不能反过来 import 共享实现").not.toMatch(/from "[^"]*process-liveness"/u);
    expect(standalone, "独立适配必须只有 ESRCH 算死，其它 errno 按可能还活着").toContain('!== "ESRCH"');
    const canonical = read(CANONICAL);
    expect(canonical).toContain("export function processLiveness");
    expect(canonical).toContain('code === "ESRCH"');
    expect(canonical).toContain('code === "EPERM"');
    expect(relative(ROOT, join(ROOT, CANONICAL))).toBe(CANONICAL);
  });
});
