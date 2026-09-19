import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { remember, REMEMBER_DESCRIPTION } from "../src/tools/remember";
import { MemoryError, initMemoryHome, projectMemoryDir, globalMemoryDir, rootFilePath, ROOT_FILES } from "../src/agent/memory/store";
import { createGatedRemember } from "../src/main/agent-runner";
import type { ToolContext } from "../src/tools";

let ws: string;
let home: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "m2d-remember-ws-"));
  home = mkdtempSync(join(tmpdir(), "m2d-remember-home-"));
  process.env.M2D_MEMORY_HOME = home;
  initMemoryHome(home);
});
afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});
const ctx = (): ToolContext => ({ workspace: ws });
const read = (p: string): string => readFileSync(p, "utf8");

describe("remember：三种 kind 各写对文件（任务2）", () => {
  it("architecture/decision/preference 映射 .agent/ 根三文件", async () => {
    await remember.run({ scope: "project", kind: "architecture", op: "append", content: "A" }, ctx());
    await remember.run({ scope: "project", kind: "decision", content: "D" }, ctx());
    await remember.run({ scope: "project", kind: "preference", op: "append", content: "P" }, ctx());
    expect(read(join(ws, ".agent", ROOT_FILES.architecture))).toContain("A");
    expect(read(join(ws, ".agent", ROOT_FILES.decision))).toContain("D");
    expect(read(join(ws, ".agent", ROOT_FILES.preference))).toContain("P");
    expect(rootFilePath(ws, "decision").endsWith("DECISIONS.md")).toBe(true);
  });

  it("memory kind 按 scope 写对应目录 + 索引 upsert", async () => {
    await remember.run({ scope: "project", kind: "memory", type: "project", topic: "note", content: "N1" }, ctx());
    await remember.run({ scope: "global", kind: "memory", type: "user", topic: "pref", content: "U1" }, ctx());
    expect(read(join(ws, ".agent", "memory", "note.md"))).toContain("N1");
    expect(read(join(ws, ".agent", "memory", "MEMORY.md"))).toContain("note");
    expect(read(join(globalMemoryDir(), "pref.md"))).toContain("U1");
    expect(read(join(globalMemoryDir(), "MEMORY.md"))).toContain("pref");
    expect(projectMemoryDir(ws).endsWith(join(".agent", "memory"))).toBe(true);
  });
});

describe("remember：scope 只认顶层参数（任务2，mem0 三次越权同构）", () => {
  it("metadata 里的 scope 被忽略", async () => {
    await remember.run({ scope: "project", kind: "memory", type: "user", topic: "hijack", content: "探针", metadata: { scope: "global" } } as Record<string, unknown>, ctx());
    expect(read(join(ws, ".agent", "memory", "hijack.md"))).toContain("探针");
    expect(existsSync(join(home, "hijack.md"))).toBe(false);
  });
  it("缺 scope / 非法 scope → call_failed", async () => {
    await expect(remember.run({ kind: "memory", type: "user", topic: "x", content: "c" }, ctx())).rejects.toThrow("顶层参数");
    await expect(remember.run({ scope: "workspace", kind: "memory", type: "user", topic: "x", content: "c" }, ctx())).rejects.toThrow("顶层参数");
  });
});

describe("remember：权限门（任务2 无权限不落盘）", () => {
  it("default 档审批拒绝 → ok:false 且不落盘", async () => {
    const gated = createGatedRemember({ getMode: () => "default", isPlanBlocked: () => false, getAsk: () => async () => false });
    const r = await gated.run({ scope: "project", kind: "memory", type: "user", topic: "denied", content: "x" }, ctx());
    expect(r.ok).toBe(false);
    expect(existsSync(join(ws, ".agent", "memory", "denied.md"))).toBe(false);
  });
  it("read-only 档一律拒；auto 档放行", async () => {
    const ro = createGatedRemember({ getMode: () => "read-only", isPlanBlocked: () => false, getAsk: () => undefined });
    const r1 = await ro.run({ scope: "project", kind: "memory", type: "user", topic: "ro", content: "x" }, ctx());
    expect(r1.ok).toBe(false);
    const auto = createGatedRemember({ getMode: () => "auto", isPlanBlocked: () => false, getAsk: () => undefined });
    const r2 = await auto.run({ scope: "project", kind: "memory", type: "user", topic: "auto-ok", content: "x" }, ctx());
    expect(r2.ok).toBe(true);
  });
  it("方案门写禁（plan 未批准）", async () => {
    const gated = createGatedRemember({ getMode: () => "auto", isPlanBlocked: () => true, getAsk: () => undefined });
    const r = await gated.run({ scope: "project", kind: "memory", type: "user", topic: "plan-blocked", content: "x" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("方案门");
  });
});

describe("remember：操作集与分型（任务3）", () => {
  it("append 正常 / replace 精确命中改写", async () => {
    await remember.run({ scope: "project", kind: "memory", type: "reference", topic: "s", content: "v1" }, ctx());
    const body = readFileSync(join(ws, ".agent", "memory", "s.md"), "utf8");
    const fm = /^---\n[\s\S]*?\n---\n([\s\S]*)$/.exec(body);
    const r = await remember.run({ scope: "project", kind: "memory", type: "reference", topic: "s", op: "replace", old_content: fm![1], content: "v2" }, ctx());
    expect(r.ok).toBe(true);
    expect(read(join(ws, ".agent", "memory", "s.md"))).toContain("v2");
  });
  it("replace 不命中 → old_content_mismatch（消息可区分）", async () => {
    await remember.run({ scope: "project", kind: "memory", type: "reference", topic: "s", content: "v1" }, ctx());
    const err = await remember.run({ scope: "project", kind: "memory", type: "reference", topic: "s", op: "replace", old_content: "不存在", content: "v2" }, ctx()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MemoryError);
    expect((err as MemoryError).code).toBe("old_content_mismatch");
    expect((err as Error).message).toContain("不精确匹配");
  });
  it("空变更：空白 content 与 old_content===content 都报 empty_change（无内容可沉淀）", async () => {
    const e1 = await remember.run({ scope: "project", kind: "memory", type: "user", topic: "e", content: "  \n  " }, ctx()).catch((e: unknown) => e);
    expect((e1 as MemoryError).code).toBe("empty_change");
    expect((e1 as Error).message).toContain("无内容可沉淀");
    await remember.run({ scope: "project", kind: "memory", type: "user", topic: "e", content: "same" }, ctx());
    const e2 = await remember.run({ scope: "project", kind: "memory", type: "user", topic: "e", op: "replace", old_content: "same", content: "same" }, ctx()).catch((e: unknown) => e);
    expect((e2 as MemoryError).code).toBe("empty_change");
  });
  it("调用失败与无内容可沉淀错误码可区分", async () => {
    const e1 = await remember.run({ kind: "memory" } as Record<string, unknown>, ctx()).catch((e: unknown) => e);
    expect((e1 as MemoryError).code).toBe("call_failed");
    const e2 = await remember.run({ scope: "project", kind: "memory", type: "user", topic: "e", content: " " }, ctx()).catch((e: unknown) => e);
    expect((e2 as MemoryError).code).toBe("empty_change");
    expect((e1 as MemoryError).code).not.toBe((e2 as MemoryError).code);
  });
  it("DECISIONS 追加式：replace 被拒（修订=新条目「取代」）", async () => {
    const e = await remember.run({ scope: "project", kind: "decision", op: "replace", old_content: "x", content: "y" }, ctx()).catch((e: unknown) => e);
    expect((e as Error).message).toContain("追加式");
  });
});

describe("remember：生命周期与删除权（任务7）", () => {
  it("kind/操作集里不存在 delete", async () => {
    expect("delete" in remember).toBe(false);
    expect(typeof (remember as unknown as Record<string, unknown>).delete).toBe("undefined");
    const e = await remember.run({ scope: "project", kind: "memory", type: "user", topic: "d", content: "x", op: "delete" }, ctx()).catch((e: unknown) => e);
    expect((e as Error).message).toContain("op 必须是 append|replace");
  });
  it("修订=新条目「取代 <旧条引用>」，旧条保留且取代关系可查", async () => {
    await remember.run({ scope: "project", kind: "decision", content: "决策1：选 A 方案" }, ctx());
    await remember.run({ scope: "project", kind: "decision", content: "决策2：取代 决策1（选 A 方案），改选 B 方案" }, ctx());
    const doc = read(join(ws, ".agent", "DECISIONS.md"));
    expect(doc).toContain("选 A 方案"); // 旧条保留
    expect(doc).toContain("取代 决策1"); // 取代关系可查（grep-able）
  });
  it("topic 更新走 replace + modified 落账更新", async () => {
    await remember.run({ scope: "project", kind: "memory", type: "project", topic: "t", content: "v1" }, ctx());
    const raw1 = read(join(ws, ".agent", "memory", "t.md"));
    const m1 = /modified: (.+)/.exec(raw1)![1];
    await remember.run({ scope: "project", kind: "memory", type: "project", topic: "t", op: "replace", old_content: "v1", content: "v2" }, ctx());
    const raw2 = read(join(ws, ".agent", "memory", "t.md"));
    expect(/modified: (.+)/.exec(raw2)![1] >= m1).toBe(true);
    expect(raw2).toContain("v2");
  });
});

describe("remember：卫生与索引（任务5/8）", () => {
  it("描述明文：密钥入库禁止 + skip 纪律 + 唯一写入口", () => {
    expect(REMEMBER_DESCRIPTION).toContain("密钥");
    expect(REMEMBER_DESCRIPTION).toContain("skip");
    expect(REMEMBER_DESCRIPTION).toContain("唯一写入口");
  });
  it("索引硬上限：超限写入被拒且提示改写（不静默截断）", async () => {
    const { checkIndexLimit } = await import("../src/agent/memory/store");
    const big = Array.from({ length: 201 }, (_, i) => "- t" + String(i)).join("\n");
    expect(() => checkIndexLimit(big)).toThrow(/索引超硬上限[\s\S]*改写索引/);
    expect(() => checkIndexLimit("- a\n- b")).not.toThrow();
  });
  it("全局层 + 根三文件 kind → 拒绝；非法 topic → 拒绝", async () => {
    await expect(remember.run({ scope: "global", kind: "architecture", content: "x" }, ctx())).rejects.toThrow("全局层只有记忆笔记");
    await expect(remember.run({ scope: "project", kind: "memory", type: "user", topic: "../x", content: "x" }, ctx())).rejects.toThrow("topic 必须是");
    await expect(remember.run({ scope: "project", kind: "memory", topic: "x", content: "x" }, ctx())).rejects.toThrow("type");
  });
});

describe("remember：根三文件 replace 守卫（补齐）", () => {
  it("topic 空串/非串由工具层先拦（必带 topic，先于 store 层格式校验）", async () => {
    const e1 = await remember.run({ scope: "project", kind: "memory", type: "user", topic: "", content: "x" }, ctx()).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(MemoryError);
    expect((e1 as Error).message).toContain("必带 topic");
    const e2 = await remember.run({ scope: "project", kind: "memory", type: "user", topic: 42, content: "x" } as Record<string, unknown>, ctx()).catch((e: unknown) => e);
    expect((e2 as Error).message).toContain("必带 topic");
  });
  it("根三文件 replace 不命中 → old_content_mismatch，原文不被静默改写", async () => {
    await remember.run({ scope: "project", kind: "architecture", op: "append", content: "v1" }, ctx());
    const e = await remember.run({ scope: "project", kind: "architecture", op: "replace", old_content: "不存在", content: "v2" }, ctx()).catch((e: unknown) => e);
    expect(e).toBeInstanceOf(MemoryError);
    expect((e as MemoryError).code).toBe("old_content_mismatch");
    expect(read(join(ws, ".agent", ROOT_FILES.architecture))).toContain("v1"); // 未被改写
  });
  it("根三文件 replace 的空变更同样报 empty_change（与 topic 分支是两道独立闸）", async () => {
    await remember.run({ scope: "project", kind: "architecture", op: "append", content: "v1" }, ctx());
    const cur = read(join(ws, ".agent", ROOT_FILES.architecture));
    const e = await remember.run({ scope: "project", kind: "architecture", op: "replace", old_content: cur, content: cur }, ctx()).catch((e: unknown) => e);
    expect((e as MemoryError).code).toBe("empty_change");
  });
});
