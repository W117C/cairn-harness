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
});

async function realPath(path: string): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  return realpath(path);
}
