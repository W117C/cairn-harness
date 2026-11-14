import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFileBounded } from "../src/fs-safe-read";

async function scratch(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "fs-safe-read-"));
}

describe("readFileBounded：同一句柄上量、读", () => {
  it("正常文件按字节返回", async () => {
    const dir = await scratch();
    try {
      const file = join(dir, "a.txt");
      await writeFile(file, "hello", "utf8");
      const r = await readFileBounded(file, 1024);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.bytes.toString("utf8")).toBe("hello");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("缺席 / 不是常规文件 / 超帽 各有独立原因（超帽带真实大小）", async () => {
    const dir = await scratch();
    try {
      expect(await readFileBounded(join(dir, "nope.txt"), 1024)).toEqual({ ok: false, reason: "missing" });
      await mkdir(join(dir, "sub"), { recursive: true });
      expect(await readFileBounded(join(dir, "sub"), 1024)).toEqual({ ok: false, reason: "not-file" });
      const big = join(dir, "big.txt");
      await writeFile(big, "x".repeat(2048), "utf8");
      expect(await readFileBounded(big, 1024)).toEqual({ ok: false, reason: "too-large", size: 2048 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("帽为 0 也按字节判（空文件通过、非空超帽）", async () => {
    const dir = await scratch();
    try {
      const empty = join(dir, "empty.txt");
      await writeFile(empty, "", "utf8");
      const ok = await readFileBounded(empty, 0);
      expect(ok.ok).toBe(true);
      const one = join(dir, "one.txt");
      await writeFile(one, "x", "utf8");
      expect(await readFileBounded(one, 0)).toEqual({ ok: false, reason: "too-large", size: 1 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
