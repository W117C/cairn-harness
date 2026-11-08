// apply_patch：读不到的目标文件**不许**被当成「不存在」（判卷）。
//
// 病灶现读（2026-10-22 复核）：补丁面的读失败分支是 `catch { raw = null; }` ——
// **任何**读失败（EACCES / EISDIR / EIO …）都被折成「文件不存在」。
// 后果不是「补丁报错」而是**静默丢数据**：`op=create`（`--- /dev/null`）把一个
// 「存在但读不到」的文件当成新建 ⇒ 写临时文件 + rename 覆盖 ⇒ 原内容没了。
//
// 写侧同一纪律早已落地（`src/tools/write_file.ts`：existed = true / false / null 三态，
// **只有 ENOENT 才等于「不存在」**，其它 stat 失败标 unknown）。这一格是同一条纪律在补丁面上的缺口。
//
// 判卷三格：
//   ① 读失败 ⇒ 必须 fail-visible（说清「读不到」而不是「不存在」），且**盘面不被改动**；
//   ② 正控：真的不存在 ⇒ 新建照旧成功（不许把这一格修成「一律拒绝」）；
//   ③ 反向守卫：已存在的文件 + create 补丁 ⇒ 仍报「已经存在」（这一格一个字都不许变）。
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apply_patch } from "../src/tools/apply_patch";
import type { ToolContext } from "../src/tools/base";

/** 一条「新建某文件」的补丁（`--- /dev/null` ⇒ op=create）。 */
const createPatch = (path: string, body: string): string =>
  [
    `diff --git a/${path} b/${path}`,
    "--- /dev/null",
    `+++ b/${path}`,
    "@@ -0,0 +1,1 @@",
    `+${body}`,
  ].join("\n");

describe("apply_patch：读失败 ≠ 不存在", () => {
  let dir: string;
  const ctx = (): ToolContext => ({ workspace: dir, emit: async () => {}, snapshot: false });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "apply-patch-unreadable-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("① 目标是个目录（readFile 报 EISDIR）⇒ 干净拒绝，盘面一个字节都不动", async () => {
    await mkdir(join(dir, "target"), { recursive: true });
    await writeFile(join(dir, "target", "keep.txt"), "keep me\n", "utf8");

    await expect(apply_patch.run({ patch: createPatch("target", "clobbered") }, ctx())).rejects.toThrow(/读取失败/);

    // 目录仍是目录、里面的文件仍在 —— 没有被「当成不存在」而写穿。
    expect((await stat(join(dir, "target"))).isDirectory()).toBe(true);
    expect(await readFile(join(dir, "target", "keep.txt"), "utf8")).toBe("keep me\n");
  });

  // root 会绕过权限位（chmod 000 仍可读）⇒ 这一格在 root 下不成立，显式跳过而不是假装绿。
  it.skipIf(process.getuid?.() === 0)(
    "①b 目标文件存在但读不到（EACCES）⇒ 拒绝，且**原内容仍在盘上**（不静默丢数据）",
    async () => {
      const target = join(dir, "secret.txt");
      await writeFile(target, "ORIGINAL-CONTENT\n", "utf8");
      await chmod(target, 0o000);

      await expect(apply_patch.run({ patch: createPatch("secret.txt", "clobbered") }, ctx())).rejects.toThrow(/读取失败/);

      // 这一条是本判卷的**承重**断言：旧写法（读失败＝不存在）会把原文件 rename 覆盖掉。
      await chmod(target, 0o600);
      expect(await readFile(target, "utf8")).toBe("ORIGINAL-CONTENT\n");
    },
  );

  it("② 正控：真的不存在 ⇒ 新建照旧成功（这一格不许被修成「一律拒绝」）", async () => {
    const r = await apply_patch.run({ patch: createPatch("fresh.txt", "hello") }, ctx());
    expect(r.ok).toBe(true);
    expect(await readFile(join(dir, "fresh.txt"), "utf8")).toBe("hello\n");
  });

  it("③ 反向守卫：已存在的文件 + create 补丁 ⇒ 仍报「已经存在」（这一格一个字都不许变）", async () => {
    await writeFile(join(dir, "there.txt"), "old\n", "utf8");
    await expect(apply_patch.run({ patch: createPatch("there.txt", "new") }, ctx())).rejects.toThrow(/已经存在/);
    expect(await readFile(join(dir, "there.txt"), "utf8")).toBe("old\n");
  });
});
