// 敏感落点片段表**全仓只有一份**（2026-10-20「给 harness 做薄、做标准」）。
//
// 这张表此前**抄了两份**：
//  · `src/permissions/risk.ts` 的 `SENSITIVE_PATH_SEGMENTS`（权限层：路径命中 ⇒ 抬到 high ⇒ 送审）；
//  · `src/tools/base.ts` 的 `SENSITIVE_REAL_SEGMENTS`（工具层：软链落点复查 ⇒ 硬拒）。
// 两份**已经漂了**：工具层那份少了 `.agent/lsp.json` 与 `.agent/config.json` 两项——
// 那是宿主配置面（内容是待 spawn 的命令 / 待执行的 verify 命令）。
//
// 后果不是"多写了几行"，而是**同一个落点在两层各有一份真相**："这一格算不算敏感"要看
// 调用到哪一层。软链那一支尤其明显：词法路径里没有敏感片段（`docs/x`）⇒ 权限层放行，
// 真正要落在 `.agent/lsp.json` 上 ⇒ 得由工具层那份表兜住——而那份表当时**没有这一项**。
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { assertNotSensitivePathReal } from "../src/tools/base";
import { SENSITIVE_PATH_SEGMENTS, SENSITIVE_SCAN_ROOTS } from "../src/sensitive-paths";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }).catch(() => {});
});

describe("敏感落点表：一份，两个消费者", () => {
  it("两层共用同一份（工具层不再自己抄一份）", async () => {
    const baseSrc = readFileSync(fileURLToPath(new URL("../src/tools/base.ts", import.meta.url)), "utf8");
    expect(baseSrc, "工具层又抄了一份敏感表 ⇒ 两层迟早分家").toContain("SENSITIVE_PATH_SEGMENTS");
    expect(baseSrc).not.toContain('".agent/lsp.json", ".agent/config.json"'); // 不再自带一份
  });

  it("★软链落到 .agent/lsp.json ⇒ 工具层硬拒（两份表漂移时这一格是漏的）", async () => {
    const ws = await mkdtemp(join(tmpdir(), "sens-oneshared-"));
    dirs.push(ws);
    await mkdir(join(ws, ".agent"), { recursive: true });
    await mkdir(join(ws, "docs"), { recursive: true });
    await writeFile(join(ws, ".agent", "lsp.json"), JSON.stringify({ servers: {} }), "utf8");
    // 工作区内的软链：词法路径 `docs/x` 看着无害，真实落点是 .agent/lsp.json（宿主配置面）
    await symlink(join(ws, ".agent", "lsp.json"), join(ws, "docs", "x"));
    await expect(
      assertNotSensitivePathReal(ws, join(ws, "docs", "x"), "sensitive-path"),
    ).rejects.toThrow();
  });

  it("对照：软链落到普通文件 ⇒ 不拒（这张表不许变成「什么都拒」）", async () => {
    const ws = await mkdtemp(join(tmpdir(), "sens-oneshared-"));
    dirs.push(ws);
    await mkdir(join(ws, "docs"), { recursive: true });
    await writeFile(join(ws, "ok.txt"), "普通\n", "utf8");
    await symlink(join(ws, "ok.txt"), join(ws, "docs", "x"));
    await expect(assertNotSensitivePathReal(ws, join(ws, "docs", "x"), "sensitive-path")).resolves.toBeUndefined();
  });

  it("扫描根是从表里推出来的（不另抄一份）", () => {
    expect(SENSITIVE_SCAN_ROOTS).toContain(".git");
    expect(SENSITIVE_SCAN_ROOTS).toContain(".agent");
    // 裸文件名条目不是根（它们是文件，不是目录）
    expect(SENSITIVE_SCAN_ROOTS).not.toContain(".env");
    expect(SENSITIVE_PATH_SEGMENTS).toContain(".agent/lsp.json");
  });
});
