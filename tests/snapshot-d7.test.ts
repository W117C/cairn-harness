// D7 覆盖前快照（agent-plan §10.4）——这条在方案书里被三处引用（含「Windows/Linux 无沙箱的
// 数据丢失兜底」），却从未实现，也从未进过任何验收表。本文件把它钉成事实：
// ① 覆盖真的留得回原文；② 新建不占快照；③ 被拒的编辑不留脏快照；
// ④ 快照自身炸了不得把成功的写入改成失败；⑤ 字段确实穿过 loop 落进事件流（防「两头断」）。
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEventLog, replay } from "../src/events";
import { runLoop } from "../src/agent/loop";
import type { ModelOutput } from "../src/providers";
import { edit_file } from "../src/tools/edit_file";
import { write_file } from "../src/tools/write_file";
import { snapshotIdOf } from "../src/tools/snapshot";

/** macOS 的 /tmp 实为 /private/tmp：沙箱规则与路径比较都要 realpath 后的串（AGENTS.md 环境注意）。 */
async function freshWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dsh-d7-"));
  return await realpath(dir);
}

const ctxOf = (workspace: string, callId: string) => ({ workspace, callId });

describe("D7 覆盖前快照", () => {
  it("覆盖已有文件：写入成功、正文报出快照路径、快照内容与原件逐字一致", async () => {
    const ws = await freshWorkspace();
    const rel = "src/a.ts";
    await mkdir(join(ws, "src"), { recursive: true });
    const original = "export const a = 1; // 用户未提交的手改\n";
    await writeFile(join(ws, rel), original, "utf8");

    const r = await write_file.run({ path: rel, content: "export const a = 2;\n" }, ctxOf(ws, "call-1"));
    expect(r.ok).toBe(true);
    expect(r.snapshotId, "覆盖已有文件必须落快照").toBeTypeOf("string");
    expect(r.output).toContain("覆盖前原件已存");
    const back = await readFile(join(ws, r.snapshotId as string), "utf8");
    expect(back, "取回的必须是覆盖前的原件，不是新内容").toBe(original);
    expect(await readFile(join(ws, rel), "utf8")).toBe("export const a = 2;\n");
  });

  it("新建文件不占快照；快照路径保留原相对路径（列目录就能读回这一轮覆盖了哪些文件）", async () => {
    const ws = await freshWorkspace();
    const r = await write_file.run({ path: "new/b.ts", content: "x\n" }, ctxOf(ws, "call-2"));
    expect(r.ok).toBe(true);
    expect(r.snapshotId, "没有原件可保 ⇒ 不该有快照").toBeUndefined();
    expect(existsSync(join(ws, ".agent", "snapshots"))).toBe(false);
    expect(snapshotIdOf("src/a.ts", "call/1 ?:x", 1700000000000)).toBe(
      join(".agent/snapshots", "1700000000000--call_1___x", "src/a.ts"),
    );
  });

  it("edit_file 同口径：快照指向替换前的原文", async () => {
    const ws = await freshWorkspace();
    const rel = "c.ts";
    await writeFile(join(ws, rel), "one\ntwo\n", "utf8");
    const r = await edit_file.run({ path: rel, old_string: "two", new_string: "TWO" }, ctxOf(ws, "call-3"));
    expect(r.ok).toBe(true);
    expect(await readFile(join(ws, r.snapshotId as string), "utf8")).toBe("one\ntwo\n");
    expect(await readFile(join(ws, rel), "utf8")).toBe("one\nTWO\n");
  });

  it("被拒的编辑（0 处匹配）不留脏快照", async () => {
    const ws = await freshWorkspace();
    const rel = "d.ts";
    await writeFile(join(ws, rel), "hello\n", "utf8");
    await expect(edit_file.run({ path: rel, old_string: "nope", new_string: "x" }, ctxOf(ws, "call-4"))).rejects.toThrow();
    expect(existsSync(join(ws, ".agent", "snapshots"))).toBe(false);
  });

  it("快照自身失败不得改写盘结果（护栏缺位不能把成功变成失败）", async () => {
    const ws = await freshWorkspace();
    const rel = "e.ts";
    await writeFile(join(ws, rel), "old\n", "utf8");
    // 把快照根做成一个**普通文件**：mkdir/copyFile 必然失败（EEXIST/ENOTDIR）。
    await writeFile(join(ws, ".agent", "snapshots"), "blocking file\n", "utf8").catch(async () => {
      await mkdir(join(ws, ".agent"), { recursive: true });
      await writeFile(join(ws, ".agent", "snapshots"), "blocking file\n", "utf8");
    });
    const r = await write_file.run({ path: rel, content: "new\n" }, ctxOf(ws, "call-5"));
    expect(r.ok, "写入照成功").toBe(true);
    expect(r.snapshotId).toBeUndefined();
    expect(await readFile(join(ws, rel), "utf8")).toBe("new\n");
  });

  it("worker 写侧显式关掉（snapshot:false）——worktree 已是可回滚副本，再抄一份会撑大合并时的脏文件面", async () => {
    const ws = await freshWorkspace();
    const rel = "g.ts";
    await writeFile(join(ws, rel), "old\n", "utf8");
    const r = await write_file.run({ path: rel, content: "new\n" }, { workspace: ws, callId: "call-6", snapshot: false });
    expect(r.ok).toBe(true);
    expect(r.snapshotId).toBeUndefined();
    expect(existsSync(join(ws, ".agent", "snapshots"))).toBe(false);
  });

  it("字段穿过 loop 落进事件流（tool 侧与事件侧不是两套东西）", async () => {
    const ws = await freshWorkspace();
    const rel = "f.ts";
    await writeFile(join(ws, rel), "ORIGINAL\n", "utf8");
    const logPath = join(ws, ".dsh-test-events.jsonl");
    const queue: ModelOutput[] = [
      { type: "assistant_message", content: "改一下" },
      { type: "tool_call", id: "c1", name: "write_file", args: { path: rel, content: "CHANGED\n" } },
    ];
    await runLoop({
      provider: { async next() { return queue.shift() ?? null; } },
      events: createEventLog(logPath),
      workspace: ws,
      // 必须 auto：default + 非交互下写工具按 fail-closed 直接 deny，
      // 那 times快照面根本没被走到，整条断言就成空转（第一次跑就是这么假绿在 ok 那一步）。
      mode: "auto",
      maxSteps: 3,
    });
    const log = await replay(logPath);
    const tr = log.find((e) => e.type === "tool_result");
    expect(tr?.type, "工具执行过 ⇒ 必有 tool_result").toBe("tool_result");
    expect((tr as { ok: boolean }).ok, "写入本身必须成功（否则后面的快照断言全是空转）").toBe(true);
    expect((tr as { snapshotId?: string }).snapshotId, "快照路径必须落进事件流，不然事后无从取证").toBeTypeOf("string");
    expect(await readFile(join(ws, rel), "utf8"), "盘上确实换了新内容").toBe("CHANGED\n");
    expect(await readFile(join(ws, (tr as { snapshotId: string }).snapshotId), "utf8")).toBe("ORIGINAL\n");
  });
});
