// 发送队列的键一致性（2026-10-28 · 第 750 页）：队列表**按工作区限定键**写，
// 消费者**按裸会话 id**读 ⇒ 读到 undefined ⇒ 按空表算 ⇒ 写回空表 ⇒ **整条队列被静默清空**。
//
// 缺陷本体（真机复现前先有源码证据）：
//   · 写：`setQueueFor`（state/run-queue.ts:66-81）用 `runKey(workspace, sid)`；
//     `setQueueLocal`（state/workbench.ts:108-110）也按同一个 key 存/删。
//   · 读（错）：WorkbenchView 的「打断并发送」「移出队列」用 `sendQueue.current.get(sid)`（裸 id）。
//   · 后果：`get(sid)` ⇒ undefined ⇒ `?? []` ⇒ `promoteQueued([], i)`/`dropQueued([], i)` ⇒ `[]`
//     ⇒ `setQueueFor(sid, [])` ⇒ `setQueueLocal(key, [])` ⇒ `delete(key)` ⇒ **队列消失**。
//     用户已排队的消息既没发出去、也没被移出，只是**不见了**（草稿早已在提交时清空）。
//
// 判据（两层）：
//   ① 纯函数层：键函数的行为（有工作区 ⇒ 限定键；无工作区 ⇒ 裸 id 回落）。
//   ② 接线层：**每个**消费队列表的地方都按同一个键读——不许出现裸 id 读。
//      判据读**面**（整渲染层），不是单文件；只读一个文件会让否定断言空过。
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runKey, sessionKeyOf } from "../src/renderer/state/session-identity";
import { appSurfaceFiles, readRendererFile } from "./helpers/app-surface";

/** 找出所有「按裸 id 读队列表」的调用点。 */
function bareIdQueueReads(): { file: string; line: number; text: string }[] {
  const out: { file: string; line: number; text: string }[] = [];
  for (const rel of appSurfaceFiles()) {
    const src = readRendererFile(rel);
    const lines = src.split("\n");
    lines.forEach((text, i) => {
      // sendQueue.current.get(<裸 id>)：get 的参数不是 runKey( / sessionKeyOf( / 变量表达式。
      const m = /sendQueue\.current\.get\(\s*([A-Za-z_$][\w$]*)\s*\)/.exec(text);
      if (m === null) return;
      const arg = m[1]!;
      // 复合键写法（runKey(...) / sessionKeyOf(...)）不是裸 id —— 但那两个名字本身
      // 就是函数调用，正则里 `get(runKey(` 带括号，匹配不到裸 id 形态。
      if (arg === "sid" || arg === "sessionId" || arg === "id" || arg === "activeId" || arg === "s.id") {
        out.push({ file: rel, line: i + 1, text: text.trim() });
      }
    });
  }
  return out;
}

describe("发送队列键一致性 · 纯函数层", () => {
  it("有工作区 ⇒ 限定键；无工作区 ⇒ 回落裸 id（不生成半截键）", () => {
    expect(runKey("/ws/a", "s1")).not.toBe("s1");
    expect(runKey("/ws/a", "s1")).toBe(sessionKeyOf("/ws/a", "s1"));
    expect(runKey(null, "s1")).toBe("s1");
    expect(runKey("", "s1")).toBe("s1");
    expect(sessionKeyOf(null, "s1")).toBeNull();
  });

  it("不同工作区的同名会话 ⇒ 键不同（这是限定键存在的全部理由）", () => {
    expect(runKey("/ws/a", "s1")).not.toBe(runKey("/ws/b", "s1"));
  });
});

describe("发送队列键一致性 · 接线层", () => {
  it("渲染层不许出现「按裸会话 id 读队列表」", () => {
    // 反向锚：这三处曾经是裸 id 读（打断并发送 / 移出队列 / 沉淀跳过守卫）。
    // 任何一处退回裸 id 读 ⇒ 队列被静默清空的那条路又开了。
    const offenders = bareIdQueueReads();
    expect(offenders).toEqual([]);
  });

  it("队列表的消费者都按 runKey 读（写与读同键）", () => {
    const strip = readRendererFile("panes/WorkbenchView.tsx");
    const dock = readRendererFile("panes/QueueDock.tsx");
    const sub = readRendererFile("state/session-subscription.ts");
    // 渲染条 + 三个改写点（打断并发送 / 移出 / 编辑）都住在 QueueDock
    expect(dock).toContain("queue.current.get(runKey(props.activeWorkspace, props.activeId))");
    expect(dock).toContain("const key = runKey(props.activeWorkspace, sid);");
    expect(dock).not.toContain("queue.current.get(sid)");
    // 分叉沉淀跳过守卫
    expect(strip).toContain("sendQueue.current.get(runKey(activeWorkspace, ctx.forkId))");
    expect(strip).not.toContain("sendQueue.current.get(sid)");
    // 订阅：沉淀跳过守卫（同样按限定键读，否则那条守卫永远不触发）
    expect(sub).toContain("sendQueue.current.get(runKey(");
    expect(sub).not.toContain("sendQueue.current.get(sid)");
  });
});

describe("发送队列键一致性 · 真机层（取料面）", () => {
  const evidence = fileURLToPath(new URL("../outputs/queue-key-750/checks.json", import.meta.url));
  const hasMeasured = existsSync(evidence);
  const measured = (hasMeasured ? JSON.parse(readFileSync(evidence, "utf8")) : []) as {
    name: string; ok: boolean; detail: unknown;
  }[];

  it("真机脚本存在（跑队列的两条交互路径）", () => {
    const smoke = readFileSync(fileURLToPath(new URL("../scripts/queue-key-smoke.cjs", import.meta.url)), "utf8");
    expect(smoke).toContain("打断并发送");
    expect(smoke).toContain("移出队列");
    expect(smoke).toContain("queue-key-");
  });

  // 取料缺席时 skip 并明说「跳过 ≠ 通过」（与 cds-parity 判卷同一口径）。
  it.skipIf(!hasMeasured)("真机读数：队列不被清空、被选中的那条真的被派出去", () => {
    const byName = (needle: string) => measured.find((c) => c.name.includes(needle));
    expect(byName("第二条进入队列")?.ok).toBe(true);
    expect(byName("移出队列只删这一条")?.ok).toBe(true);
    expect(byName("两条排队在场")?.ok).toBe(true);
    // 这一条是缺陷本体的真机读数：被选中的那条**被派出去**（runs 里多一条），
    // 另一条**仍留在队列**（items 不为空）——修前是 items 直接空掉、runs 不多。
    expect(byName("另一条仍留在队列")?.ok).toBe(true);
  });
});
