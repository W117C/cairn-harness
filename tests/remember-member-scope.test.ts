// 成员作用域写入判卷（ADR 0015 §五 S1 的写入侧；第 1259 页之后补的那一半）。
//
// 判的是什么：
//   ① `scope=member` 只认**运行期身份**（`ctx.agentId = member:<id>`）；
//      没有身份 ⇒ fail closed，不许把「我是谁」交给模型参数；
//   ② 有身份 ⇒ 落进 `<memory-home>/members/<id>/`，索引同目录（不污染项目层与全局层）；
//   ③ 成员层只收记忆笔记（kind=memory），与全局层同一条纪律；
//   ④ 非法身份（`member`、`members:x`、带点/斜杠）一律拒。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { remember } from "../src/tools/remember";
import { initMemoryHome, globalMemoryDir, MEMORY_INDEX } from "../src/agent/memory/store";
import { MemoryError } from "../src/agent/memory/store";
import type { ToolContext } from "../src/tools";

let ws: string;
let home: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "cairn-member-mem-ws-"));
  home = mkdtempSync(join(tmpdir(), "cairn-member-mem-home-"));
  process.env.M2D_MEMORY_HOME = home;
  initMemoryHome(home);
});
afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

const ctx = (agentId?: string): ToolContext => ({ workspace: ws, ...(agentId === undefined ? {} : { agentId }) });

describe("成员私有记忆写入", () => {
  it("没有运行期身份 ⇒ fail closed（模型不能自己说是谁）", async () => {
    await expect(
      remember.run({ scope: "member", kind: "memory", type: "project", topic: "mine", content: "我的笔记" }, ctx()),
    ).rejects.toBeInstanceOf(MemoryError);
    // 证人面：错误文案必须把「身份只能来自运行期」说出来（promise-recall 判据认这一句）
    await expect(
      remember.run({ scope: "member", kind: "memory", type: "project", topic: "mine", content: "我的笔记" }, ctx()),
    ).rejects.toThrow(/需要运行期身份/);
    await expect(
      remember.run({ scope: "member", kind: "memory", type: "project", topic: "mine", content: "我的笔记" }, ctx("worker-a")),
    ).rejects.toBeInstanceOf(MemoryError);
  });

  it("有成员身份 ⇒ 落进 members/<id>/，索引同目录；项目层与全局层都没被写脏", async () => {
    const result = await remember.run(
      { scope: "member", kind: "memory", type: "project", topic: "mine", content: "成员私有笔记" },
      ctx("member:m1"),
    );
    expect(result.ok).toBe(true);
    const memberDir = join(globalMemoryDir(), "members", "m1");
    expect(existsSync(join(memberDir, "mine.md"))).toBe(true);
    expect(existsSync(join(memberDir, MEMORY_INDEX))).toBe(true);
    // 全局层根目录没有被凭空写出 topic 文件
    expect(existsSync(join(globalMemoryDir(), "mine.md"))).toBe(false);
  });

  it("成员层只收记忆笔记（kind 为架构/决策/偏好一律拒）", async () => {
    for (const kind of ["architecture", "decision", "preference"]) {
      await expect(
        remember.run({ scope: "member", kind, op: "append", content: "x" }, ctx("member:m1")),
      ).rejects.toBeInstanceOf(MemoryError);
    }
  });

  it("非法身份一律拒（前缀必须精确、id 白名单）", async () => {
    for (const agentId of ["member", "members:m1", "member:", "member:a.b", "member:a/b"]) {
      await expect(
        remember.run({ scope: "member", kind: "memory", type: "project", topic: "x", content: "y" }, ctx(agentId)),
      ).rejects.toBeInstanceOf(MemoryError);
    }
  });
});
