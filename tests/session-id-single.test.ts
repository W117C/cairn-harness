/** 第 967 页：同一个「会话 id 能不能当 sidecar 引用」，三个文件各写一份，
 *  `handleSessionPrefsSet` 的 IPC 门又写了一份更松的（不查长度 / 控制字符 / 首尾空白）。
 *
 *  判据钉四件事：
 *   · sidecar 引用层的值域（长度 / 首尾空白 / 前导点 / 路径分隔符 / 控制字符）；
 *   · 文件名寻址是另一层更严的闸（中间的 `.` 也不收）——两层不互相冒充；
 *   · IPC 门对超长 / 控制字符 / 首尾空白 id 直接拒，不落到「会话不存在」；
 *   · 源码里只剩 `src/main/session-id.ts` 一处定义，sidecar 与 IPC 都 import 它。
 */
import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isSessionId, MAX_SESSION_ID_LENGTH } from "../src/main/session-id";
import { isValidSessionName } from "../src/main/sessions";
import { handleSessionCreate, handleSessionPrefsSet, initSessionsDir } from "../src/main/session-handlers";

const ROOT = join(import.meta.dirname, "..");
const CANONICAL = "src/main/session-id.ts";
const ROOTS = ["src", "apps/desktop/src", "scripts"];
const CONSUMERS = [
  "src/main/pins.ts",
  "src/main/feedback.ts",
  "src/main/session-metadata.ts",
  "src/main/session-handlers.ts",
];
const LOCAL_DEFINITION = /(?:function|const)\s+isSessionId\b/u;
const LOCAL_MAX = /MAX_SESSION_ID_LENGTH\s*=\s*80/u;

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

const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("会话 id 引用判定只有一份（第 967 页）", () => {
  it("sidecar 引用层：非空、≤80、无首尾空白/前导点/路径分隔符/控制字符", () => {
    expect(MAX_SESSION_ID_LENGTH).toBe(80);
    for (const ok of ["s1", "会话 1", "a-b_c", "a".repeat(80), "pins"]) {
      expect(isSessionId(ok), ok).toBe(true);
    }
    for (const bad of ["", "a".repeat(81), " a", "a ", ".hidden", "a/b", "a\\b", "a\u0000b", "a\nb", null, 42, {}]) {
      expect(isSessionId(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("引用层与文件名层刻意不同：中间的 `.` 能引用，不能寻址", () => {
    expect(isSessionId("a.b")).toBe(true);
    expect(isValidSessionName("a.b")).toBe(false);
  });

  it("IPC 门用同一份判据：坏 id 当场拒，不落成「会话不存在」", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cairn-session-id-"));
    roots.push(dir);
    initSessionsDir(dir);
    const created = await handleSessionCreate("ok");
    expect(created.id).toBe("ok");

    for (const bad of ["x".repeat(81), "bad\u0000id", " pad", "pad ", ".hidden", "a/b"]) {
      const result = await handleSessionPrefsSet({ sessionId: bad, prefs: { model: "m" } });
      expect(result.ok, JSON.stringify(bad)).toBe(false);
      expect(result.error, JSON.stringify(bad)).toContain("会话名非法");
    }
    expect(await handleSessionPrefsSet({ sessionId: created.id, prefs: { model: "m" } })).toEqual({ ok: true });
  });

  it("源码里只剩共享实现一处定义，sidecar 与 IPC 都 import 同一份", () => {
    const offenders: string[] = [];
    const missing: string[] = [];
    for (const file of ROOTS.flatMap(sourceFiles)) {
      if (file === CANONICAL) continue;
      const source = read(file);
      if (LOCAL_DEFINITION.test(source) || LOCAL_MAX.test(source)) offenders.push(file);
    }
    for (const file of CONSUMERS) {
      if (!/from "\.\/session-id"/u.test(read(file))) missing.push(file);
    }

    expect(offenders).toEqual([]);
    expect(missing).toEqual([]);
    expect(read("src/main/sessions.ts")).toContain('from "./session-id"');
    const canonical = read(CANONICAL);
    expect(canonical).toContain("export const MAX_SESSION_ID_LENGTH = 80");
    expect(canonical).toContain("export function isSessionId");
    expect(relative(ROOT, join(ROOT, CANONICAL))).toBe(CANONICAL);
  });
});
