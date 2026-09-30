// 复跑面取料层（scripts/replay/corpus.ts）的单元测试。
//
// 这一层守的是一类很具体的错：**读数为 0 与没有尺长得一模一样**。语料（历史会话 `.jsonl`）不在
// git 里，所以干净 checkout 上两条复跑命令都会打出一片 0（2026-09-23 在 worktree 实踩）。
// 判据保持纯函数为主（`corpusProblem` / `isGatedTool` 双向可断），只有扫描本身触真实盘，用临时目录。
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { corpusProblem, corpusRoots, ENV_TEXT_CUES, envTextRe, firstEnvTextCue, GATED_TOOLS, isGatedTool, NO_SURFACE_COMMAND, readJsonl, scanCorpus } from "../scripts/replay/corpus";

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

describe("真会话根的字面形状：`Application Support` 是一个目录名，不是两级", () => {
  // 2026-09-24 实踩：`corpusRoots()` 写成 join(homedir(),"Library","Application","Support",…)
  // ⇒ 拼出 `…/Application/Support/m0-agent-loop/sessions`，这个目录**永远不存在**，
  // 于是所有 replay 读数的"真会话"那支恒为 missingRoots、语料只剩合成件（本机真会话 1 份，被漏掉）。
  // 缺根这件事被如实打印过，但没人去问"为什么缺"——所以这里钉的是字面形状，不是"扫到了几份"。
  it("根里的 `Application Support` 必须是一个路径段", () => {
    const root = corpusRoots()[1] ?? "";
    expect(root.split("/")).toContain("Application Support");
    expect(root.includes("Application/Support")).toBe(false);
  });

  it("反向：扫描器本身处理带空格的目录名没问题（所以 bug 只在根的字面量上）", () => {
    const home = mkdtempSync(join(tmpdir(), "corpus-root-"));
    try {
      const dir = join(home, "Library", "Application Support", "m0-agent-loop", "sessions");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "会话 x.jsonl"), '{"type":"user_message","content":"hi"}\n', "utf8");
      const scan = scanCorpus([dir]);
      expect(scan.files).toHaveLength(1);
      expect(scan.missingRoots).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("ENV_TEXT_CUES：环境红的人眼线索只有一份，且只认行首", () => {
  it("三支真出口的那一句都认得出（形状取自各出口自己拼的那一行，不是凭记忆写的）", () => {
    expect(firstEnvTextCue("x\n[error: verify 命令超时（2s），已强制终止——命令确实跑完过吗？]")).toBe("timeout");
    expect(firstEnvTextCue("out\n[error: run_shell 超时（60s），已强制终止]")).toBe("timeout");
    expect(firstEnvTextCue("no matches\n[error: glob: rg 超时（60s，已终止——查询面过大）]")).toBe("timeout");
    expect(firstEnvTextCue("npm ERR\n[exit code: 127]")).toBe("toolchain-missing");
    expect(firstEnvTextCue("[verify] 钩子异常（harness 侧原因，不占修复额度）：boom")).toBe("hook-error");
  });

  it("同一串在正文中间或缩进行 ⇒ 一律不算（被度量者自己的正文是第二个注入面）", () => {
    expect(firstEnvTextCue("正文里说：见 [error: run_shell 超时 一节")).toBeNull();
    expect(firstEnvTextCue("  [exit code: 127]")).toBeNull();
    expect(firstEnvTextCue("FAIL: 1 failed")).toBeNull();
  });

  it("表里那条超时要通吃三支出口：只认「工具名紧跟超时」的写法会漏掉 verify 那一句", () => {
    // 收成一份之后最坏的错不是宽一点，而是**表里那条只认识自家出口**：三条真句子里有一条读不到，
    // 剩下的面就各自漂（本条先用现成反例把宽度钉死，正则本身怎么写不在这里复述）。
    expect(/^\[error: \S+ 超时/mu.test("[error: verify 命令超时（2s）")).toBe(false);
    expect(envTextRe("timeout").test("[error: verify 命令超时（2s）")).toBe(true);
  });

  it("哨兵那一格不在表里：它按 command 判，正文里出现同样的字不算它", () => {
    expect(NO_SURFACE_COMMAND).toBe("(none)");
    expect(ENV_TEXT_CUES.map((c) => c.kind)).toEqual(["timeout", "toolchain-missing", "hook-error"]);
    expect(firstEnvTextCue("config printed: (none)")).toBeNull();
  });

  it("envTextRe 认不出的那一类要出声（静默造一条新正则＝又写了一份副本）", () => {
    expect(() => envTextRe("denied-by-gate")).toThrow();
  });
});
