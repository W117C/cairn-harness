// 复跑面取料层（scripts/replay/corpus.ts）的单元测试。
//
// 这一层守的是一类很具体的错：**读数为 0 与没有尺长得一模一样**。语料（历史会话 `.jsonl`）不在
// git 里，所以干净 checkout 上两条复跑命令都会打出一片 0（2026-09-23 在 worktree 实踩）。
// 判据保持纯函数为主（`corpusProblem` / `isGatedTool` 双向可断），只有扫描本身触真实盘，用临时目录。
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { corpusProblem, GATED_TOOLS, isGatedTool, readJsonl, scanCorpus } from "../scripts/replay/corpus";

describe("零语料体检：读到 0 不是读数，是没尺", () => {
  it("一个 .jsonl 也没扫到 ⇒ 报，且那句话点名扫描根与不存在的那一支", () => {
    const p = corpusProblem({ files: [], missingRoots: ["outputs"] }, 0);
    expect(p).not.toBeNull();
    expect(p).toContain("零语料");
    expect(p).toContain("outputs");
    expect(p).toContain("sessions");
  });

  it("扫到了文件却一条 tool_call 也没有 ⇒ 报（认不出不等于没有，正是 09-21 那片零的形状）", () => {
    const p = corpusProblem({ files: ["a.jsonl", "b.jsonl"], missingRoots: [] }, 0);
    expect(p).not.toBeNull();
    expect(p).toContain("tool_call");
    expect(p).toContain("2");
  });

  it("反向：有料 ⇒ 不报（判据不能只认红）", () => {
    expect(corpusProblem({ files: ["a.jsonl"], missingRoots: [] }, 12)).toBeNull();
  });
});

describe("受管面：派生自产品的 SHELL_FAMILY，不抄第二份字面名", () => {
  it("口径 = 五个工具名，多一名少一名都红（变了就与 2026-09-21 那次读数不可比，必须先知道）", () => {
    expect([...GATED_TOOLS].sort()).toEqual(["edit_file", "run_shell", "shell_ro", "shell_rw", "write_file"]);
  });

  it("五个副作用工具与 mcp 前缀算受管；只读工具、编排工具、空名都不算", () => {
    expect(isGatedTool("write_file")).toBe(true);
    expect(isGatedTool("shell_ro")).toBe(true);
    expect(isGatedTool("mcp__github__create_issue")).toBe(true);
    expect(isGatedTool("read_file")).toBe(false);
    expect(isGatedTool("spawn_agent")).toBe(false);
    expect(isGatedTool("")).toBe(false);
  });
});

describe("扫描与逐行读盘（临时目录，不碰真语料）", () => {
  it("根不存在 ⇒ 记进 missingRoots 而不崩；存在的根只收 .jsonl", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-corpus-"));
    try {
      mkdirSync(join(dir, "sub", "deeper"), { recursive: true });
      writeFileSync(join(dir, "a.jsonl"), '{"type":"tool_call"}\n');
      writeFileSync(join(dir, "sub", "deeper", "b.jsonl"), '{"type":"tool_result"}\n');
      writeFileSync(join(dir, "notes.txt"), "不是 jsonl");
      const missing = join(dir, "nope");
      const scan = scanCorpus([dir, missing]);
      expect(scan.files).toHaveLength(2);
      expect(scan.missingRoots).toEqual([missing]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("空行与脏行跳过，但合法行一条不丢（与两个复跑脚本同一条口径）", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-corpus-"));
    try {
      const file = join(dir, "s.jsonl");
      writeFileSync(file, '{"a":1}\n\n   \n坏行不是json\n{"b":2}\n');
      expect(readJsonl(file)).toEqual([{ a: 1 }, { b: 2 }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
