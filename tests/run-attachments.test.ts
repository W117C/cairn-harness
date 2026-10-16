import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseRunAttachment,
  validateRunAttachment,
  validateRunAttachments,
} from "../src/main/run-attachments";

const roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dsh-attachments-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("run attachment boundary", () => {
  it("parses only explicit typed references", () => {
    expect(parseRunAttachment({ path: "src/a.ts", kind: "file", explicit: true })).toEqual({
      ok: true,
      value: { path: "src/a.ts", kind: "file", explicit: true },
    });
    expect(parseRunAttachment({ path: "src/a.ts", kind: "file", explicit: "yes" })).toEqual({
      ok: false,
      error: "附件 explicit 必须是 boolean",
    });
    expect(parseRunAttachment({ path: "", kind: "file", explicit: true })).toEqual({
      ok: false,
      error: "附件 path 必须是非空字符串",
    });
  });

  it("canonicalizes an in-workspace file and does not mark it for external approval", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");
    const result = await validateRunAttachment({ path: "src/a.ts", kind: "file", explicit: true }, root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.realPath).toBe(join(await realPath(root), "src", "a.ts"));
    expect(result.value.withinWorkspace).toBe(true);
    expect(result.value.requiresExternalApproval).toBe(false);
  });

  it("does not confuse a sibling directory with an in-workspace prefix", async () => {
    const root = await tempRoot();
    const sibling = await tempRoot();
    await writeFile(join(sibling, "note.txt"), "note");
    const result = await validateRunAttachment({ path: join(sibling, "note.txt"), kind: "file", explicit: true }, root);
    expect(result).toMatchObject({ ok: true, value: { withinWorkspace: false, requiresExternalApproval: true } });
  });

  it("marks a canonical external path for the existing approval path", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    await writeFile(join(outside, "note.txt"), "note");
    const result = await validateRunAttachment({ path: join(outside, "note.txt"), kind: "file", explicit: true }, root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.withinWorkspace).toBe(false);
    expect(result.value.requiresExternalApproval).toBe(true);
  });

  it("rejects a kind mismatch and missing paths", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "note.txt"), "note");
    expect(await validateRunAttachment({ path: "note.txt", kind: "directory", explicit: true }, root)).toMatchObject({ ok: false });
    expect(await validateRunAttachment({ path: "missing.txt", kind: "file", explicit: true }, root)).toMatchObject({ ok: false });
  });

  it("deduplicates canonical references and bounds the batch", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "note.txt"), "note");
    const one = await validateRunAttachments(
      [
        { path: "note.txt", kind: "file", explicit: true },
        { path: join(root, "note.txt"), kind: "file", explicit: true },
      ],
      root,
    );
    expect(one.ok).toBe(true);
    if (one.ok) expect(one.value).toHaveLength(1);
    expect((await validateRunAttachments(Array.from({ length: 33 }, () => ({ path: "note.txt", kind: "file", explicit: true })), root))).toMatchObject({ ok: false });
    expect((await validateRunAttachments(Array.from({ length: 5 }, () => ({ path: "x".repeat(4096), kind: "file", explicit: true })), root))).toMatchObject({ ok: false });
  });

  // 入口那道闸限的是**路径总字符**（MAX_TOTAL_PATH_CHARS=16384），管不到绕过它的调用方：
  // worker / gym / 脚本 / 单测都直接构造 provider。没有 provider 侧那道闸时，一个超长字符串
  // 会一路走到最终硬闸才炸，报成 `[context_budget_exceeded] final estimated input N`——
  // 把「参数写错了」报成「上下文装不下」，是最难查的一类假象。
  it("provider 层对绕过入口的 attachmentContext fail-closed（不静默截断）", async () => {
    const { ATTACHMENT_CONTEXT_CHAR_LIMIT, createGlmSessionProvider } = await import("../src/agent/session-provider");
    const dir = await mkdtemp(join(process.env.PI_SCRATCH_DIR!, "attn-ctx-"));
    try {
      // 恰好等于帽：放行（边界本身也要有判据，否则「> 还是 >=」是猜的）。
      expect(() => createGlmSessionProvider(join(dir, "ok.jsonl"), {
        map: false, workspace: dir,
        attachmentContext: "x".repeat(ATTACHMENT_CONTEXT_CHAR_LIMIT),
      })).not.toThrow();
      // 超一字符：抛，且错里带得出两个数字。
      let msg = "";
      try {
        createGlmSessionProvider(join(dir, "too-big.jsonl"), {
          map: false, workspace: dir,
          attachmentContext: "x".repeat(ATTACHMENT_CONTEXT_CHAR_LIMIT + 1),
        });
      } catch (e) { msg = e instanceof Error ? e.message : String(e); }
      expect(msg).toContain("attachment_context_too_large");
      expect(msg).toContain(String(ATTACHMENT_CONTEXT_CHAR_LIMIT + 1));
      expect(msg).toContain(String(ATTACHMENT_CONTEXT_CHAR_LIMIT));
      // **不截断**：超限不许变成「安静地少几个附件」——残缺清单与「工作区真没别的附件」同形。
      expect(msg).not.toContain("truncated");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function realPath(path: string): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  return realpath(path);
}
