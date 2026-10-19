import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SettingsStore } from "../src/main/settings";

const firstRead = vi.hoisted(() => ({
  path: "",
  claimed: false,
  signal: () => {},
  wait: Promise.resolve(),
}));

// 保留真实文件 I/O，仅控制第一笔读取的返回顺序。
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const hold = args[0] === firstRead.path && !firstRead.claimed;
      if (hold) firstRead.claimed = true;
      try {
        return await actual.readFile(...args);
      } finally {
        if (hold) {
          firstRead.signal();
          await firstRead.wait;
        }
      }
    },
  };
});

describe("设置首次读取与写入交错", () => {
  it.each(["existing", "missing", "malformed"] as const)("迟到的首次读取不能撤销已保存的设置（%s）", async (initial) => {
    const workspace = await mkdtemp(join(tmpdir(), "settings-read-race-"));
    const path = join(workspace, "settings.json");
    if (initial !== "missing") {
      await writeFile(path, initial === "malformed" ? "{invalid" : JSON.stringify({ theme: "light" }), "utf8");
    }
    let release = () => {};
    const captured = new Promise<void>((resolve) => { firstRead.signal = resolve; });
    firstRead.path = path;
    firstRead.claimed = false;
    firstRead.wait = new Promise<void>((resolve) => { release = resolve; });
    const store = new SettingsStore(path);
    const delayed = store.get();
    try {
      await captured;
      expect((await store.set({ theme: "dark" })).theme).toBe("dark");
      expect(JSON.parse(await readFile(path, "utf8")).theme).toBe("dark");

      release();
      expect((await delayed).theme).toBe("dark");
      expect((await store.get()).theme).toBe("dark");

      await store.set({ locale: "en-US" });
      expect(await new SettingsStore(path).get()).toMatchObject({ theme: "dark", locale: "en-US" });
    } finally {
      release();
      await delayed;
      firstRead.path = "";
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
