// 记忆面板服务端一半：主题数不含索引、目录不存在算 0、缺层点名。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dirStat, memoryPanelFor } from "../src/main/memory-panel";

const made: string[] = [];
const mk = async (): Promise<string> => { const d = await mkdtemp(join(tmpdir(), "mem-panel-")); made.push(d); return d; };
afterEach(async () => { await Promise.all(made.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

describe("记忆面板（服务端）", () => {
  it("主题数不含 MEMORY_INDEX.md；字节按主题文件累加", async () => {
    const dir = await mk();
    await writeFile(join(dir, "MEMORY_INDEX.md"), "x".repeat(10));
    await writeFile(join(dir, "topic-a.md"), "aaaa");
    await writeFile(join(dir, "topic-b.md"), "bb");
    expect(await dirStat(dir)).toEqual({ dir, topics: 2, bytes: 6 });
  });

  it("目录不存在 ⇒ 0（不抛、不猜）", async () => {
    const missing = join(await mk(), "nope");
    expect(await dirStat(missing)).toEqual({ dir: missing, topics: 0, bytes: 0 });
  });

  it("三层一起数：成员按名单来，没记忆的成员也出一行 0", async () => {
    const root = await mk();
    const team = join(root, "team");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(team, { recursive: true });
    await mkdir(join(team, "members", "m1"), { recursive: true });
    await writeFile(join(team, "topic.md"), "z");
    await writeFile(join(team, "members", "m1", "note.md"), "zz");
    const view = await memoryPanelFor({
      projectDir: join(root, "proj"),
      teamDir: team,
      memberIds: ["m1", "m2"],
      memberDirOf: (id) => join(team, "members", id),
    });
    expect(view.rows.map((r) => [r.scope, r.memberId ?? "", r.topics])).toEqual([
      ["project", "", 0],
      ["team", "", 1],
      ["member", "m1", 1],
      ["member", "m2", 0],
    ]);
    expect(view.total.topics).toBe(2);
  });
});
