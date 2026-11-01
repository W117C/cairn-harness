import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, readdir: vi.fn(actual.readdir) };
});
import { listSessionIds, listSessions } from "../src/main/sessions";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "cairn-list-errors-")); });
afterEach(async () => {
  vi.mocked(readdir).mockReset().mockImplementation((await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).readdir);
  await rm(root, { recursive: true, force: true });
});

for (const [name, scan] of [["listSessions", listSessions], ["listSessionIds", listSessionIds]] as const) {
  describe(name, () => {
    it("尚未创建的会话目录返回空清单", async () => {
      expect(await scan(join(root, "missing"))).toEqual([]);
    });
    it("根路径是文件时报告 ENOTDIR，不能伪装成没有会话", async () => {
      const path = join(root, "sessions");
      await writeFile(path, "existing data");
      await expect(scan(path)).rejects.toMatchObject({ code: "ENOTDIR", path });
    });
    it("目录读取被拒时保留原始错误与路径", async () => {
      const error = Object.assign(new Error(`EACCES: permission denied, scandir '${root}'`), { code: "EACCES", path: root });
      vi.mocked(readdir).mockRejectedValueOnce(error);
      await expect(scan(root)).rejects.toBe(error);
    });
  });
}
