// H2 加固轮①回归（审查 C-2/C-3/C-11 + E-12）：
//   路径边界从「词法 resolve/relative」升级为「realpath 归属校验」——工作区内软链指向
//   外部的读写必须被拒；.agent/ 系统区对内容工具整体拒写；插件 manifest 路径覆盖不得
//   越出插件根。否定式验证锚点：摘除断言调用后本文件必须变红。
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { workspaceUsablePath } from "../src/agent/recall-path";
import { read_file } from "../src/tools/read_file";
import { write_file } from "../src/tools/write_file";
import { edit_file } from "../src/tools/edit_file";
import { grep } from "../src/tools/grep";
import { glob } from "../src/tools/glob";
import { lsp } from "../src/tools/lsp";
import { parsePluginManifest, PluginLoadError } from "../src/agent/plugins/manifest";
import type { ToolContext } from "../src/tools";
import { assertContainedPathIdentity, captureContainedPath } from "../src/tools/base";

let ws = "";
afterEach(async () => { if (ws) await rm(ws, { recursive: true, force: true }); });

async function newCtx(): Promise<ToolContext> {
  ws = await mkdtemp(join(tmpdir(), "h2-boundary-"));
  return { workspace: ws };
}

describe("工具路径边界 · realpath 归属校验（C-2/C-3）", () => {
  it("写前身份守卫能发现祖先目录被换成界外软链", async () => {
    const ctx = await newCtx();
    const outside = await mkdtemp(join(tmpdir(), "h2-outside-"));
    const slot = join(ws, "slot");
    await mkdir(slot);
    const before = await captureContainedPath(ctx.workspace, slot, "test");
    await rename(slot, join(ws, "slot-original"));
    await symlink(outside, slot);
    await expect(assertContainedPathIdentity(ctx.workspace, slot, "test", before))
      .rejects.toThrow(/越出 workspace|路径在写入前发生变化/);
    await rm(outside, { recursive: true, force: true });
  });

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

  // 上面三条软链用例的目标**都存在**——所以下面这个形状一直没人写：realpath 要求整条路径
  // 存在，悬空软链让它抛 ENOENT，祖先回溯于是退到词法父目录，把「末段是软链」丢了。门看到的
  // 是「写在 ws 里」，实际写的是软链指向的界外位置。git 保留软链，恶意 clone 就带着它。
  it("悬空软链（目标不存在）写出去仍被拒：这是上一组三条都覆盖不到的形状", async () => {
    const ctx = await newCtx();
    const outside = await mkdtemp(join(tmpdir(), "h2-outside-"));
    await symlink(join(outside, "pwned.txt"), join(ws, "ghost")); // 目标刻意不存在
    await expect(write_file.run({ path: "ghost", content: "pwned" }, ctx))
      .rejects.toThrow(/越出 workspace 边界/);
    const { readFile: rd } = await import("node:fs/promises");
    expect(existsSync(join(outside, "pwned.txt"))).toBe(false); // 界外文件没被创建出来
    await rm(outside, { recursive: true, force: true });
  });

  it("悬空软链读出去同样被拒", async () => {
    const ctx = await newCtx();
    const outside = await mkdtemp(join(tmpdir(), "h2-outside-"));
    await writeFile(join(outside, "secret.txt"), "TOPSECRET", "utf8");
    await symlink(join(outside, "gone.txt"), join(ws, "ghost")); // 目标不存在
    await expect(read_file.run({ path: "ghost" }, ctx))
      .rejects.toThrow(/越出 workspace 边界/);
    await rm(outside, { recursive: true, force: true });
  });

  it("悬空软链指向界内不存在的路径：正常放行（新建语义，零行为变化）", async () => {
    const ctx = await newCtx();
    await mkdir(join(ws, "real"), { recursive: true });
    await symlink(join(ws, "real", "later.txt"), join(ws, "ghost")); // 界内，将来会有
    const res = await write_file.run({ path: "ghost", content: "ok" }, ctx);
    expect(res.ok).toBe(true);
    const { readFile: rd } = await import("node:fs/promises");
    expect(await rd(join(ws, "real", "later.txt"), "utf8")).toBe("ok");
  });

  it("软链环不靠 realpath 收束，靠本仓自己的深度上限收束（a→b→a）", async () => {
    const ctx = await newCtx();
    await symlink(join(ws, "b"), join(ws, "a"));
    await symlink(join(ws, "a"), join(ws, "b"));
    // realpath 在这里会抛 ELOOP；手动 readlink 不会，没有上限就是死循环。
    await expect(write_file.run({ path: "a", content: "x" }, ctx))
      .rejects.toThrow(/软链层数超过/);
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

  // C3（审查 P1-6）的另一半：词法闸只看 rel 里有没有 ".agent" 字样，`link -> .agent` 时两道旧闸
  // 都放行 ⇒ 落点在 .agent 内却写成合法路径。此前 assertNotAgentAreaReal 全仓零判卷（grep tests/ 无一处），
  // 所以这一条是补观测者；它的牙齿由锚点 agent-area-real-recheck-dropped 当场证明（摘闸 ⇒ 本条必须红）。
  it("词法闸看不见的软链落点：`link -> .agent` 时写与改都被拒（C3 复查闸，摘掉它 = RCE 面复活）", async () => {
    const ctx = await newCtx();
    await mkdir(join(ws, ".agent"), { recursive: true });
    await writeFile(join(ws, ".agent", "lsp.json"), "{}", "utf8");
    await symlink(join(ws, ".agent"), join(ws, "notes"));
    await expect(edit_file.run({ path: "notes/lsp.json", old_string: "{}", new_string: "{\"command\":\"pwn\"}" }, ctx))
      .rejects.toThrow(/写入落点在 \.agent\/ 内/);
    await expect(write_file.run({ path: "notes/permissions.json", content: "{\"allow\":\"*\"}" }, ctx))
      .rejects.toThrow(/写入落点在 \.agent\/ 内/);
    const { readFile: rd } = await import("node:fs/promises");
    expect(await rd(join(ws, ".agent", "lsp.json"), "utf8")).toBe("{}"); // 系统区原文未动
  });

  // 第 141 页普查里唯一一条真·变异存活：`agent-area-lexical-dropped` 摘掉词法闸，测试却全绿。
  // 分诊结论不是"闸多余"，而是**这条判卷没量到词法闸独有的那一格**：`.agent/permissions.json` 这种写法，
  // 落点复查同样会拒（realpath 里含 .agent）⇒ 两道闸都拦，摘一道看不出差别。
  // 词法闸的独立贡献是「`.agent` 这个名字本身保留」——借名的软链（`.agent -> staging`）落点在系统区外，
  // 只有词法闸看得见它；而工具打印的承诺句说的是名字，不是落点（模型可见文本要配真探针）。
  it("借名软链：`.agent -> staging` 时写 `.agent/x.json` 仍被词法闸拒（名字本身保留，摘掉词法闸＝承诺句失效）", async () => {
    const ctx = await newCtx();
    await mkdir(join(ws, "staging"), { recursive: true });
    await symlink(join(ws, "staging"), join(ws, ".agent"));
    await expect(write_file.run({ path: ".agent/permissions.json", content: "{\"allow\":\"*\"}" }, ctx))
      .rejects.toThrow(/禁止经内容工具写入/);
    // 反向对照：同一份字节、同一个落点，只要**不借这个名字**就该写得进去——
    // 少了这一句，上面那条红可能来自"路径越界/内容被拦"之类的旁路，词法闸依旧没被量到。
    await expect(write_file.run({ path: "staging/permissions.json", content: "{\"allow\":\"*\"}" }, ctx))
      .resolves.toMatchObject({ ok: true });
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

// grep / glob / lsp 三个工具此前只挂词法闸，同样是「工作区内软链指向外部」这个形状。
// grep 与 lsp 回的是**文件内容**（`Line N: <原文>` / hover 文本），所以和 read_file 同级；
// glob 只回文件名，泄漏的是「界外有什么」——轻一档，但缺口是同一个，一并补上。
describe("grep / glob / lsp 的软链归属（与 read_file 同口径）", () => {
  it("grep 指向界外的软链：拒绝（否则直接读出界外原文）", async () => {
    const ctx = await newCtx();
    const outside = await mkdtemp(join(tmpdir(), "h2-outside-"));
    await writeFile(join(outside, "secret.txt"), "TOPSECRET\n", "utf8");
    await symlink(outside, join(ws, "leak"));
    await expect(grep.run({ pattern: "TOPSECRET", path: "leak" }, ctx))
      .rejects.toThrow(/越出 workspace 边界/);
    await rm(outside, { recursive: true, force: true });
  });

  it("glob 指向界外的软链：拒绝（回的是文件名，泄漏存在性）", async () => {
    const ctx = await newCtx();
    const outside = await mkdtemp(join(tmpdir(), "h2-outside-"));
    await writeFile(join(outside, "secret.txt"), "x", "utf8");
    await symlink(outside, join(ws, "leak"));
    await expect(glob.run({ pattern: "**/*", path: "leak" }, ctx))
      .rejects.toThrow(/越出 workspace 边界/);
    await rm(outside, { recursive: true, force: true });
  });

  it("lsp 指向界外的软链：拒绝（openFile 会把界外文件喂给语言服务器）", async () => {
    const ctx = await newCtx();
    const outside = await mkdtemp(join(tmpdir(), "h2-outside-"));
    await writeFile(join(outside, "secret.ts"), "export const TOPSECRET = 1;\n", "utf8");
    await symlink(join(outside, "secret.ts"), join(ws, "leak.ts"));
    // 闸排在 getLspClient 之前，所以这里根本不需要真的语言服务器——命令写成
    // 一条「一跑就留下痕迹」的哨兵，越界路径若没被拦住就会看见它。
    await mkdir(join(ws, ".agent"), { recursive: true });
    await writeFile(
      join(ws, ".agent", "lsp.json"),
      JSON.stringify({ lsp: { ts: { command: "touch", args: ["SENTINEL_SPAWNED"], extensions: [".ts"] } } }),
      "utf8",
    );
    await expect(lsp.run({ operation: "hover", path: "leak.ts", line: 1, column: 1 }, ctx))
      .rejects.toThrow(/越出 workspace 边界/);
    expect(existsSync(join(ws, "SENTINEL_SPAWNED"))).toBe(false); // 语言服务器没被拉起来
    await rm(outside, { recursive: true, force: true });
  });

  it("界内软链照常可用（三处都没被误伤）", async () => {
    const ctx = await newCtx();
    await mkdir(join(ws, "real"), { recursive: true });
    await writeFile(join(ws, "real", "hit.txt"), "NEEDLE\n", "utf8");
    await symlink(join(ws, "real"), join(ws, "alias"));
    const g = await grep.run({ pattern: "NEEDLE", path: "alias" }, ctx);
    expect(g.output).toContain("NEEDLE");
    const gl = await glob.run({ pattern: "**/*", path: "alias" }, ctx);
    expect(gl.output).toContain("hit.txt");
  });
});
// 它必须与上面那把闸**同口径**——helper 说可用而 read_file 拒收 = 假承诺；反过来 = 白丢能力。
// #33/#47 的收口点：模型侧「回取地址」给不给，由这一支单独回答（两个发射面共用）。
describe("回取地址的落位判定（workspaceUsablePath）", () => {
  let root = "";
  let wsRoot = "";
  async function setup(): Promise<string> {
    root = await mkdtemp(join(tmpdir(), "recall-path-root-"));
    wsRoot = join(root, "ws");
    await mkdir(wsRoot, { recursive: true });
    return wsRoot;
  }
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

  it("区内已存在的文件：给工作区相对路径，且 read_file 用这条路径真读得到（两半同口径）", async () => {
    const w = await setup();
    await writeFile(join(w, "a.txt"), "BODY-A", "utf8");
    const rel = workspaceUsablePath(join(w, "a.txt"), w);
    expect(rel).toBe("a.txt");
    const got = await read_file.run({ path: rel! }, { workspace: w, emit: async () => {} });
    expect(got.ok).toBe(true);
    expect(got.output).toContain("BODY-A");
  });

  it("区内但**还没落盘**（prune 先算投影、后写附件）：按最近的已存在祖先判定，仍给相对路径", async () => {
    const w = await setup();
    const at = join(w, "prune-attachments", "s-1-ab.txt"); // 目录与文件都还不存在
    expect(existsSync(at)).toBe(false);
    expect(workspaceUsablePath(at, w)).toBe(join("prune-attachments", "s-1-ab.txt"));
  });

  it("工作区之外：null（fail-closed，发射处必须改口说读不到）", async () => {
    const w = await setup();
    expect(workspaceUsablePath(join(root, "outside.txt"), w)).toBeNull();
  });

  it("`..` 逃逸与软链逃逸都不算区内（与拒穿透那把闸同口径）", async () => {
    const w = await setup();
    expect(workspaceUsablePath(join(w, "..", "outside.txt"), w)).toBeNull();
    const secret = join(root, "secret.txt");
    await writeFile(secret, "TOPSECRET", "utf8");
    await symlink(secret, join(w, "leak-link"));
    expect(workspaceUsablePath(join(w, "leak-link"), w)).toBeNull();
  });

  it("没登记工作区（调用点还没接上那一跳）：null，不猜一个地址给模型", async () => {
    const w = await setup();
    await writeFile(join(w, "a.txt"), "BODY-A", "utf8");
    expect(workspaceUsablePath(join(w, "a.txt"), undefined)).toBeNull();
  });
});

// 2026-10-19：风险通道按 rel 字面匹配敏感片段，工作区内软链 `docs/hooks -> .git/hooks`
// 的 rel 里没有 `.git/hooks/` ⇒ guided/auto 直接免批写 hooks（持久化代码执行面）。
describe("敏感路径的软链别名（真实落点复查）", () => {
  it("docs/hooks -> .git/hooks：写 pre-commit 被拒，真实目标未落地", async () => {
    const ctx = await newCtx();
    await mkdir(join(ws, ".git", "hooks"), { recursive: true });
    await mkdir(join(ws, "docs"), { recursive: true });
    await symlink(join(ws, ".git", "hooks"), join(ws, "docs", "hooks"));
    await expect(write_file.run({ path: "docs/hooks/pre-commit", content: "#!/bin/sh\n" }, ctx))
      .rejects.toThrow(/敏感路径/);
    expect(existsSync(join(ws, ".git", "hooks", "pre-commit"))).toBe(false);
  });
});
