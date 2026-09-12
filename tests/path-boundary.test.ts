// H2 加固轮①回归（审查 C-2/C-3/C-11 + E-12）：
//   路径边界从「词法 resolve/relative」升级为「realpath 归属校验」——工作区内软链指向
//   外部的读写必须被拒；.agent/ 系统区对内容工具整体拒写；插件 manifest 路径覆盖不得
//   越出插件根。否定式验证锚点：摘除断言调用后本文件必须变红。
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { read_file } from "../src/tools/read_file";
import { write_file } from "../src/tools/write_file";
import { edit_file } from "../src/tools/edit_file";
import { parsePluginManifest, PluginLoadError } from "../src/agent/plugins/manifest";
import type { ToolContext } from "../src/tools";

let ws = "";
afterEach(async () => { if (ws) await rm(ws, { recursive: true, force: true }); });

async function newCtx(): Promise<ToolContext> {
  ws = await mkdtemp(join(tmpdir(), "h2-boundary-"));
  return { workspace: ws };
}

describe("工具路径边界 · realpath 归属校验（C-2/C-3）", () => {
  it("工作区内软链指向外部：write_file 拒绝（旧实现会穿透写入外部文件）", async () => {
    const ctx = await newCtx();
    const outside = await mkdtemp(join(tmpdir(), "h2-outside-"));
    const victim = join(outside, "victim.txt");
    await writeFile(victim, "original", "utf8");
    await symlink(victim, join(ws, "evil-link"));
    await expect(write_file.run({ path: "evil-link", content: "pwned" }, ctx))
      .rejects.toThrow(/越出 workspace 边界/);
    const { readFile: rd } = await import("node:fs/promises");
    expect(await rd(victim, "utf8")).toBe("original"); // 外部文件未被改写
    await rm(outside, { recursive: true, force: true });
  });

  it("工作区内软链指向外部：read_file 拒绝（旧实现可读出外部内容）", async () => {
    const ctx = await newCtx();
    const outside = await mkdtemp(join(tmpdir(), "h2-outside-"));
    const secret = join(outside, "secret.txt");
    await writeFile(secret, "TOPSECRET", "utf8");
    await symlink(secret, join(ws, "leak-link"));
    await expect(read_file.run({ path: "leak-link" }, ctx))
      .rejects.toThrow(/越出 workspace 边界/);
    await rm(outside, { recursive: true, force: true });
  });

  it("软链目录链上的新建写入同样被拒（现存祖先逃逸）", async () => {
    const ctx = await newCtx();
    const outside = await mkdtemp(join(tmpdir(), "h2-outside-"));
    await symlink(outside, join(ws, "dir-link"));
    await expect(write_file.run({ path: "dir-link/new.txt", content: "x" }, ctx))
      .rejects.toThrow(/越出 workspace 边界/);
    await rm(outside, { recursive: true, force: true });
  });

  it("合法路径零行为变化：workspace 本身是软链（/tmp → /private/tmp）时照常读写", async () => {
    const ctx = await newCtx();
    const res = await write_file.run({ path: "src/ok.txt", content: "hello" }, ctx);
    expect(res.ok).toBe(true);
    const read = await read_file.run({ path: "src/ok.txt" }, ctx);
    expect(read.output).toContain("hello");
  });
});

describe(".agent/ 系统区拒写（C-11）", () => {
  it("write_file 写 .agent/permissions.json 被拒（跨会话提权面）", async () => {
    const ctx = await newCtx();
    await expect(write_file.run({ path: ".agent/permissions.json", content: "{}" }, ctx))
      .rejects.toThrow(/\.agent\/ 是系统区/);
  });

  it("edit_file 写 .agent/lsp.json 被拒（任意 command RCE 面）；read 不受限（系统只禁写）", async () => {
    const ctx = await newCtx();
    await mkdir(join(ws, ".agent"), { recursive: true });
    await writeFile(join(ws, ".agent", "lsp.json"), "{}", "utf8");
    await expect(edit_file.run({ path: ".agent/lsp.json", old_string: "{}", new_string: "x" }, ctx))
      .rejects.toThrow(/\.agent\/ 是系统区/);
    const read = await read_file.run({ path: ".agent/lsp.json" }, ctx);
    expect(read.ok).toBe(true);
  });
});

describe("插件 manifest 路径覆盖包含性（E-12）", () => {
  async function pluginWith(overrides: Record<string, unknown>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "h2-plugin-"));
    await mkdir(join(root, ".claude-plugin"), { recursive: true });
    await writeFile(
      join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "evil-test", ...overrides }),
      "utf8",
    );
    return root;
  }

  it("skills 指向 ../ 时拒载（旧实现会挂载扫描插件根外目录）", async () => {
    const root = await pluginWith({ skills: "../outside" });
    await expect(parsePluginManifest(root)).rejects.toBeInstanceOf(PluginLoadError);
    await rm(root, { recursive: true, force: true });
  });

  it("hooks 文件路径越界拒载；合法覆盖路径不受影响", async () => {
    const root = await pluginWith({ hooks: "../../host-hooks.json" });
    await expect(parsePluginManifest(root)).rejects.toBeInstanceOf(PluginLoadError);
    await rm(root, { recursive: true, force: true });

    const okRoot = await pluginWith({ skills: "custom-skills" });
    const parsed = await parsePluginManifest(okRoot);
    expect(parsed.skillsDir).toBe("custom-skills");
    await rm(okRoot, { recursive: true, force: true });
  });
});
