import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { grep } from "../src/tools/grep";
import { glob } from "../src/tools/glob";
import { edit_file } from "../src/tools/edit_file";
import type { ToolContext } from "../src/tools";

let ws = "";
afterEach(async () => { if (ws) await rm(ws, { recursive: true, force: true }); });

async function newCtx(): Promise<ToolContext> {
  ws = await mkdtemp(join(tmpdir(), "m2a-tools-"));
  return { workspace: ws };
}

describe("grep（M2a 任务 1）", () => {
  it("按文件分组输出 path: + Line N: text，路径 workspace 相对", async () => {
    const ctx = await newCtx();
    await mkdir(join(ws, "src"), { recursive: true });
    await writeFile(join(ws, "src", "a.ts"), "const alpha = 1;\nalpha + 1;\n", "utf8");
    const res = await grep.run({ pattern: "alpha" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("src/a.ts:");
    expect(res.output).toContain("Line 1: const alpha = 1;");
    expect(res.output).toContain("Line 2: alpha + 1;");
    expect(res.output).not.toMatch(new RegExp(ws.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))); // 无绝对路径
  });

  it("命中超 100 条：只输出 100 条 + 截断提示", async () => {
    const ctx = await newCtx();
    const lines: string[] = [];
    for (let i = 1; i <= 120; i++) lines.push("needle " + String(i));
    await writeFile(join(ws, "many.txt"), lines.join("\n") + "\n", "utf8");
    const res = await grep.run({ pattern: "needle" }, ctx);
    expect(res.ok).toBe(true);
    const matchLines = res.output.split("\n").filter((l) => l.startsWith("Line "));
    expect(matchLines.length).toBe(100);
    expect(res.output).toContain("more matches available");
  });

  it("长行截断到 2000 字符且带提示", async () => {
    const ctx = await newCtx();
    await writeFile(join(ws, "long.txt"), "x".repeat(3000) + " needle", "utf8");
    const res = await grep.run({ pattern: "needle" }, ctx);
    expect(res.ok).toBe(true);
    const line = res.output.split("\n").find((l) => l.startsWith("Line 1:")) ?? "";
    const textPart = line.slice("Line 1:".length).trim();
    expect(textPart.length).toBeLessThanOrEqual(2000 + " …[行截断]".length + 2);
    expect(res.output).toContain("截断");
  });

  it("无命中：首行仍是「无命中」，但必须补一句扫描面；坏 pattern 报错", async () => {
    const ctx = await newCtx();
    await writeFile(join(ws, "a.txt"), "hello", "utf8");
    const res = await grep.run({ pattern: "zzz-not-there" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output.startsWith("无命中")).toBe(true);
    await expect(grep.run({ pattern: "" }, ctx)).rejects.toThrow(/pattern/);
  });
});

describe("零命中的扫描面说明（grep 与 glob 共用一句政策）", () => {
  it("零命中不许只回三个字：补「这不是仓库里没有」+ 逃生口，且字数有帽", async () => {
    const ctx = await newCtx();
    await writeFile(join(ws, "a.txt"), "hello", "utf8");
    const g = await grep.run({ pattern: "zzz-not-there" }, ctx);
    const l = await glob.run({ pattern: "*.zzz" }, ctx);
    for (const r of [g, l]) {
      expect(r.output).toContain("这不是「仓库里没有」");
      // 逃生口要点名：只说"扫不到"不给下一步，等于让模型自己猜要不要换查法
      expect(r.output).toContain("显式路径不受忽略规则挡");
    }
    // 各自说清自己跳过了什么（glob 带 --hidden，不能照抄 grep 那句"隐藏文件"）
    expect(g.output).toContain("隐藏文件");
    expect(l.output).toContain("node_modules");
    expect(l.output).not.toContain("隐藏文件");
    // 说明是固定成本，只能长在阴性结果上：整条输出限长，别让它长成一段教程
    expect(g.output.length).toBeLessThan(300);
    expect(l.output.length).toBeLessThan(300);
  });

  it("说明里那句逃生口是真的：被 .gitignore 挡住的目录，显式给 path 就能搜到", async () => {
    const ctx = await newCtx();
    execFileSync("git", ["init", "-q", ws]); // rg 只在 git 仓库内应用 .gitignore
    await writeFile(join(ws, ".gitignore"), "gen/\n", "utf8");
    await mkdir(join(ws, "gen"), { recursive: true });
    await writeFile(join(ws, "gen", "hay.ts"), "NEEDLE_IN_IGNORED\n", "utf8");
    await writeFile(join(ws, "keep.ts"), "other\n", "utf8");
    // 默认扫描面：看不见（这正是旧文案会被读成"仓库里没有"的那个事实）
    const wide = await grep.run({ pattern: "NEEDLE_IN_IGNORED" }, ctx);
    expect(wide.output.startsWith("无命中")).toBe(true);
    // 显式指进被忽略的目录：同一把工具、同一个 pattern，立刻看得见
    const deep = await grep.run({ pattern: "NEEDLE_IN_IGNORED", path: "gen" }, ctx);
    expect(deep.output).toContain("gen/hay.ts:");
    expect(deep.output).toContain("NEEDLE_IN_IGNORED");
    // glob 同一条路（文件名面也认这个逃生口）
    const files = await glob.run({ pattern: "*.ts", path: "gen" }, ctx);
    expect(files.output).toContain("gen/hay.ts");
    const filesWide = await glob.run({ pattern: "*.ts" }, ctx);
    expect(filesWide.output).not.toContain("hay.ts");
  });

  it("逃生口对 glob **自己排的**噪声目录也成立：显式 path 指进 node_modules 必须列得出文件", async () => {
    const ctx = await newCtx();
    await mkdir(join(ws, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(ws, "node_modules", "pkg", "index.js"), "{}", "utf8");
    await writeFile(join(ws, "src.ts"), "x", "utf8");
    // 默认扫描面确实排掉它——这正是那条说明让模型「把 path 显式指进去」的前提
    const wide = await glob.run({ pattern: "**/*.js" }, ctx);
    expect(wide.output).not.toContain("index.js");
    // 模型照做了：同一把工具、同一个 pattern。看得见才是逃生口，看不见就是说明在教一条走不通的路。
    const deep = await glob.run({ pattern: "**/*.js", path: "node_modules" }, ctx);
    expect(deep.output).toContain("node_modules/pkg/index.js");
    // 指到子目录同一条（说明那句是「那个目录/文件」，不是只指顶层）
    const deeper = await glob.run({ pattern: "**/*.js", path: "./node_modules/pkg" }, ctx);
    expect(deeper.output).toContain("pkg/index.js");
  });

  it("反向：显式 path 在别处时，噪声排除一字不减（撤排除只服务于「点名要进那个目录」）", async () => {
    const ctx = await newCtx();
    await mkdir(join(ws, "src", "node_modules", "vendored"), { recursive: true });
    await mkdir(join(ws, "src", "keep"), { recursive: true });
    await writeFile(join(ws, "src", "node_modules", "vendored", "noise.js"), "{}", "utf8");
    await writeFile(join(ws, "src", "keep", "real.ts"), "x", "utf8");
    const res = await glob.run({ pattern: "**/*", path: "src" }, ctx);
    expect(res.output).toContain("src/keep/real.ts");
    expect(res.output).not.toContain("noise.js");
  });
});

describe("glob（M2a 任务 2）", () => {
  it("列文件相对路径；噪音目录（.git/node_modules/dist）不出现", async () => {
    const ctx = await newCtx();
    await mkdir(join(ws, "src"), { recursive: true });
    await mkdir(join(ws, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(ws, "dist"), { recursive: true });
    await mkdir(join(ws, ".git", "objects"), { recursive: true });
    await writeFile(join(ws, "src", "keep.ts"), "export {}", "utf8");
    await writeFile(join(ws, "node_modules", "pkg", "noise.js"), "{}", "utf8");
    await writeFile(join(ws, "dist", "noise.js"), "{}", "utf8");
    await writeFile(join(ws, ".git", "objects", "noise.js"), "{}", "utf8");
    const res = await glob.run({ pattern: "**/*" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("src/keep.ts");
    expect(res.output).not.toContain("node_modules");
    expect(res.output).not.toContain("dist/");
    expect(res.output).not.toContain(".git/");
  });

  it("上限 100 生效并附提示；尊重 .gitignore", async () => {
    const ctx = await newCtx();
    for (let i = 1; i <= 120; i++) {
      await writeFile(join(ws, "f" + String(i).padStart(3, "0") + ".txt"), "x", "utf8");
    }
    const res = await glob.run({ pattern: "*.txt" }, ctx);
    const fileLines = res.output.split("\n").filter((l) => l.endsWith(".txt"));
    expect(fileLines.length).toBe(100);
    expect(res.output).toContain("more files available");

    // .gitignore 生效：ignored.txt 不出现
    await writeFile(join(ws, ".gitignore"), "ignored.txt\n", "utf8");
    await writeFile(join(ws, "ignored.txt"), "x", "utf8");
    const res2 = await glob.run({ pattern: "*.txt" }, ctx);
    expect(res2.output).not.toContain("ignored.txt");
  });

  it("pattern 不匹配时首行仍是「无匹配文件」", async () => {
    const ctx = await newCtx();
    const res = await glob.run({ pattern: "*.zzz" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output.startsWith("无匹配文件")).toBe(true);
  });
});

describe("edit_file（M2a 任务 4）", () => {
  it("唯一匹配替换成功", async () => {
    const ctx = await newCtx();
    await writeFile(join(ws, "a.ts"), "const a = 1;\nconst b = 2;\n", "utf8");
    const res = await edit_file.run({ path: "a.ts", old_string: "const b = 2;", new_string: "const b = 20;" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("已替换 a.ts（1 处，+1 −1 行）");
    expect(await readFile(join(ws, "a.ts"), "utf8")).toBe("const a = 1;\nconst b = 20;\n");
  });

  it("0 处匹配报错且不改文件", async () => {
    const ctx = await newCtx();
    await writeFile(join(ws, "a.ts"), "hello\n", "utf8");
    await expect(
      edit_file.run({ path: "a.ts", old_string: "nope", new_string: "x" }, ctx),
    ).rejects.toThrow(/0 处匹配/);
    expect(await readFile(join(ws, "a.ts"), "utf8")).toBe("hello\n");
  });

  it("多处匹配报错并给出处数", async () => {
    const ctx = await newCtx();
    await writeFile(join(ws, "a.ts"), "dup\ndup\ndup\n", "utf8");
    await expect(
      edit_file.run({ path: "a.ts", old_string: "dup", new_string: "x" }, ctx),
    ).rejects.toThrow(/匹配 3 处/);
    expect(await readFile(join(ws, "a.ts"), "utf8")).toBe("dup\ndup\ndup\n");
  });

  it("replace_all 才允许批量替换", async () => {
    const ctx = await newCtx();
    await writeFile(join(ws, "a.ts"), "dup\ndup\n", "utf8");
    const res = await edit_file.run({ path: "a.ts", old_string: "dup", new_string: "x", replace_all: true }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("（2 处，+2 −2 行）");
    expect(await readFile(join(ws, "a.ts"), "utf8")).toBe("x\nx\n");
  });
});
