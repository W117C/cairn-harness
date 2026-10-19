// 记忆正文通道判卷（2026-10-16 补，业主「解决问题」单）：
// memorySnapshot 的主题条目必须携带**正文**（frontmatter 已剥）——此前「主题正文」面板是
// 「待接」占位，因为快照只带索引与元信息（§8 #15 显式挂账）。
// 口径：body = parseTopicDoc(raw).body（与写入端 renderTopicDoc 互为往返；索引不进 body）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memorySnapshot } from "../src/main/memory-handlers";
import { setRunWorkspace } from "../src/main/runner-workspace";

const dirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  setRunWorkspace(null);
  vi.unstubAllEnvs();
});

describe("记忆快照携带主题正文（补通道）", () => {
  it("global / project 两层的主题都带 frontmatter 已剥的 body", async () => {
    const g = tmp("memsnap-g-");
    const ws = tmp("memsnap-w-");
    vi.stubEnv("M2D_MEMORY_HOME", g);
    setRunWorkspace(ws);
    writeFileSync(join(g, "topic-alpha.md"), "---\ntype: user\nmodified: 2026-10-16T00:00:00.000Z\n---\n**加粗**首行\n第二行");
    writeFileSync(join(g, "MEMORY.md"), "- topic-alpha · user · 2026-10-16T00:00:00.000Z · 摘要\n");
    mkdirSync(join(ws, ".agent", "memory"), { recursive: true });
    writeFileSync(join(ws, ".agent", "memory", "proj-beta.md"), "---\ntype: project\nmodified: 2026-10-16T00:00:00.000Z\n---\n项目层正文");

    const snap = await memorySnapshot();
    expect(snap.global.topics.find((t) => t.topic === "topic-alpha")?.body).toBe("**加粗**首行\n第二行");
    expect(snap.project.topics.find((t) => t.topic === "proj-beta")?.body).toBe("项目层正文");
    // 元信息面不回归：type/modified/bytes 仍照着原契约出
    const alpha = snap.global.topics.find((t) => t.topic === "topic-alpha");
    expect(alpha?.type).toBe("user");
    expect(alpha?.modified).toBe("2026-10-16T00:00:00.000Z");
    expect(alpha?.bytes).toBeGreaterThan(0);
  });

  it("无 frontmatter 的裸文件：全文即正文（parseTopicDoc 缺省语义直通，不装懂）", async () => {
    const g = tmp("memsnap-g2-");
    vi.stubEnv("M2D_MEMORY_HOME", g);
    setRunWorkspace(null); // 项目层回落 process.cwd()；本用例只看 global
    writeFileSync(join(g, "bare.md"), "没有头部的正文");

    const snap = await memorySnapshot();
    expect(snap.global.topics.find((t) => t.topic === "bare")?.body).toBe("没有头部的正文");
  });
});
