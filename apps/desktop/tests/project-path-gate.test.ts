// 已知工作区那道门：渲染层给的路径能不能当**落点**用（2026-10-19 独立评审追出）。
//
// 缺陷形状：同一个文件里 `setWorkspaceContext` 早就把工作区上下文限死在"已注册"面上
// （不校验的话 `/` 就成了文件窗格/预览的边界），**唯独几条通道绕过了那道门**——
// 同一个信任边界，一半有门一半没有，那一半就是洞：
//  · `previewStart` → 在该目录跑 `pnpm install` + `pnpm exec vite` ⇒ **vite 会加载并执行
//    该目录的 `vite.config.js`**（任意代码执行），且没有审批门；
//  · `projectExport` → 把该目录整份拷到用户选的位置（`~/.ssh` 也拷）。
//
// 判据在 `project-path-gate.ts`（单独成文件：这一面要**能真跑**，而 index.ts 直接
// import electron，判卷里起不来）⇒ 本文件是真跑的行为判据，不是源码断言。
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalKnownProjectPath,
  canonicalKnownRoots,
  resolveKnownProjectTarget,
} from "../src/main/project-path-gate";

const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

describe("已知工作区门（project-path-gate）", () => {
  it("★等于某个根 ⇒ 放行（项目目录本身）", async () => {
    const ws = await tmp("cairn-ws-");
    const roots = canonicalKnownRoots([ws]);
    expect(await resolveKnownProjectTarget(ws, roots)).toBe(await resolveKnownProjectTarget(ws, roots));
    expect(canonicalKnownProjectPath(ws, roots)).not.toBeNull();
  });

  it("★落在根之内 ⇒ 放行（工作区里 agent 交付的单文件交付物也要能预览）", async () => {
    const ws = await tmp("cairn-ws-");
    await mkdir(join(ws, "out"), { recursive: true });
    const html = join(ws, "out", "pelican.html");
    await writeFile(html, "<html></html>", "utf8");
    const roots = canonicalKnownRoots([ws]);
    expect(await resolveKnownProjectTarget(html, roots)).not.toBeNull();
  });

  it("★根之外的目录 ⇒ 拒（`/tmp/attacker` 那种 vite.config.js 执行面）", async () => {
    const ws = await tmp("cairn-ws-");
    const outside = await tmp("cairn-outside-");
    const roots = canonicalKnownRoots([ws]);
    expect(await resolveKnownProjectTarget(outside, roots)).toBeNull();
  });

  it("根之外的**父目录**（`..` 越界）⇒ 拒", async () => {
    const ws = await tmp("cairn-ws-");
    const roots = canonicalKnownRoots([ws]);
    expect(await resolveKnownProjectTarget(join(ws, "..", "elsewhere"), roots)).toBeNull();
  });

  it("严格相等版不含「落在根之内」（setWorkspaceContext 要的是根，不是根里的东西）", async () => {
    const ws = await tmp("cairn-ws-");
    await mkdir(join(ws, "out"), { recursive: true });
    const roots = canonicalKnownRoots([ws]);
    expect(canonicalKnownProjectPath(ws, roots)).not.toBeNull();
    expect(canonicalKnownProjectPath(join(ws, "out"), roots)).toBeNull();
  });

  it("软链指向根外 ⇒ 拒（词法在工作区内、真实落点在根外）", async () => {
    const ws = await tmp("cairn-ws-");
    const outside = await tmp("cairn-outside-");
    await writeFile(join(outside, "vite.config.js"), "export default {};", "utf8");
    const link = join(ws, "linked");
    await symlink(outside, link, "dir");
    const roots = canonicalKnownRoots([ws]);
    expect(await resolveKnownProjectTarget(link, roots)).toBeNull();
  });

  it("没有根 ⇒ 一切都不放行（fail-closed，不因「读不到已知面」就放宽成任意路径）", async () => {
    const anywhere = await tmp("cairn-any-");
    expect(await resolveKnownProjectTarget(anywhere, [])).toBeNull();
    expect(canonicalKnownProjectPath(anywhere, [])).toBeNull();
  });

  it("反向对照：判据不是恒真（换个根就换个结论）", async () => {
    const a = await tmp("cairn-a-");
    const b = await tmp("cairn-b-");
    expect(await resolveKnownProjectTarget(b, canonicalKnownRoots([a]))).toBeNull();
    expect(await resolveKnownProjectTarget(b, canonicalKnownRoots([a, b]))).not.toBeNull();
  });
});

describe("接线：previewStart / projectExport / gitClone 都走这道门", () => {
  const main = readFileSync(fileURLToPath(new URL("../src/main/index.ts", import.meta.url)), "utf8");

  it("previewStart 先判已知工作区，判不过就不起 vite", () => {
    const i = main.indexOf("previewStart:");
    const fn = main.slice(i, i + 900);
    expect(fn).toContain("resolveKnownProjectTarget(p)");
    expect(fn).toContain("未注册的项目路径，已拒绝");
    expect(fn.indexOf("resolveKnownProjectTarget(p)")).toBeLessThan(fn.indexOf("previewRuntime.start"));
  });

  it("projectExport 先判已知工作区，再开目录选择器（判不过连对话框都不弹）", () => {
    const i = main.indexOf("projectExport:");
    const fn = main.slice(i, i + 900);
    expect(fn).toContain("resolveKnownProjectTarget(p)");
    expect(fn.indexOf("resolveKnownProjectTarget(p)")).toBeLessThan(fn.indexOf("showOpenDialog"));
  });

  it("gitClone 的落点只认用户真选过的目录", () => {
    const i = main.indexOf("gitClone: (req)");
    const fn = main.slice(i, i + 900);
    expect(fn).toContain("if (!pickedDirs.has(canonical))");
    expect(fn).toContain("克隆目标目录未经选择，已拒绝");
    expect(fn.indexOf("pickedDirs.has(canonical)")).toBeLessThan(fn.indexOf("gitClone(String(r.url"));
  });
});
