import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { read_file } from "../src/tools/read_file";
import { read_image } from "../src/tools/read_image";
import type { ExternalReadGrant, ToolContext } from "../src/tools/base";

const roots: string[] = [];
async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function ctx(workspace: string, grants?: readonly ExternalReadGrant[]): ToolContext {
  return {
    workspace,
    ...(grants !== undefined ? { externalReadGrants: grants } : {}),
  };
}

describe("read_file external attachment grants", () => {
  it("rejects an absolute path without a run-time grant", async () => {
    const workspace = await tempRoot("dsh-ws-");
    const outside = await tempRoot("dsh-out-");
    const file = join(outside, "note.txt");
    await writeFile(file, "outside", "utf8");

    await expect(read_file.run({ path: file }, ctx(workspace))).rejects.toThrow(/只允许 workspace 相对路径/);
  });

  it("reads exactly the approved file and not its sibling", async () => {
    const workspace = await tempRoot("dsh-ws-");
    const outside = await tempRoot("dsh-out-");
    const approved = join(outside, "approved.txt");
    const sibling = join(outside, "sibling.txt");
    await writeFile(approved, "approved-content", "utf8");
    await writeFile(sibling, "sibling-content", "utf8");

    const grant: ExternalReadGrant = { path: await realpath(approved), kind: "file" };
    const ok = await read_file.run({ path: approved }, ctx(workspace, [grant]));
    expect(ok.ok).toBe(true);
    expect(ok.output).toContain("approved-content");

    await expect(read_file.run({ path: sibling }, ctx(workspace, [grant])))
      .rejects.toThrow(/不在本轮已批准的项目外附件清单内/);
  });

  it("allows a subtree for a directory grant but rejects an escape and a symlink pointing out", async () => {
    const workspace = await tempRoot("dsh-ws-");
    const outside = await tempRoot("dsh-out-");
    const secretRoot = await tempRoot("dsh-secret-");
    await mkdir(join(outside, "sub"));
    const nested = join(outside, "sub", "nested.txt");
    await writeFile(nested, "nested-content", "utf8");
    const secret = join(secretRoot, "secret.txt");
    await writeFile(secret, "secret-content", "utf8");
    const link = join(outside, "sub", "escape.txt");
    await symlink(secret, link);

    const grant: ExternalReadGrant = { path: await realpath(outside), kind: "directory" };
    const ok = await read_file.run({ path: nested }, ctx(workspace, [grant]));
    expect(ok.output).toContain("nested-content");

    await expect(read_file.run({ path: join(outside, "..", "outside-absent.txt") }, ctx(workspace, [grant])))
      .rejects.toThrow(/不在本轮已批准的项目外附件清单内/);
    await expect(read_file.run({ path: link }, ctx(workspace, [grant])))
      .rejects.toThrow(/不在本轮已批准的项目外附件清单内/);
  });

  it("does not change ordinary in-workspace reads", async () => {
    const workspace = await tempRoot("dsh-ws-");
    await writeFile(join(workspace, "inside.txt"), "inside-content", "utf8");
    const ok = await read_file.run({ path: "inside.txt" }, ctx(workspace));
    expect(ok.ok).toBe(true);
    expect(ok.output).toContain("inside-content");
  });
});

describe("read_image external attachment grants", () => {
  // 1×1 transparent PNG：只用来验 magic number + grant 接线，不验图像内容。
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nS8AAAAASUVORK5CYII=",
    "base64",
  );

  it("reads an approved external image but omits the workspace-only artifact reference", async () => {
    const workspace = await tempRoot("dsh-ws-");
    const outside = await tempRoot("dsh-out-");
    const file = join(outside, "pixel.png");
    await writeFile(file, PNG);

    const grant: ExternalReadGrant = { path: await realpath(file), kind: "file" };
    const ok = await read_image.run({ path: file }, ctx(workspace, [grant]));
    expect(ok.ok).toBe(true);
    expect(ok.images).toHaveLength(1);
    expect(ok.artifact).toBeUndefined();
  });

  it("rejects the same image without a grant", async () => {
    const workspace = await tempRoot("dsh-ws-");
    const outside = await tempRoot("dsh-out-");
    const file = join(outside, "pixel.png");
    await writeFile(file, PNG);

    await expect(read_image.run({ path: file }, ctx(workspace))).rejects.toThrow(/只允许 workspace 相对路径/);
  });
});
