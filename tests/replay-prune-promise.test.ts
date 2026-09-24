// 复跑面判卷 · `scripts/replay/prune-promise.ts`
//
// 这一支数的是「prune 打桩那句『需要时 read_file 取回』到底有没有受害者」。它是任务 #33 的
// **优先级读数**：修它要动一处热文件（`glm-session` 的组装那一跳），值不值得动，应由
// "模型照这句话做过几笔、其中几笔失败"决定，而不是由"缺陷听起来很严重"决定。
//
// 判卷必须把三种 0 分开——它们的处置完全相反：
//   ① 语料里没有这句承诺 ⇒ 潜在，别动；
//   ② 有承诺但没人照做 ⇒ **不许**读成"没问题"（走不通的路本来没人走）；
//   ③ 有人照做且收到失败回执 ⇒ 活缺陷，红。
// 另外 join 键（call 侧 `id` / result 侧 `callId`）读错会得到一片零假读数（本仓 09-21 实踩过），
// 所以「成功/失败/无回执」三格各有一条正例，且互不串数。
import { describe, expect, it } from "vitest";
import {
  prunePromiseVerdict,
  tallyPrunePromise,
  type PruneEvent,
} from "../scripts/replay/prune-promise";

const ABS = "/Users/ze/Library/Application Support/m0-agent-loop/sessions/prune-attachments/s1-ab-cd.txt";
/** 与 `src/agent/prune.ts` 拼的那半句同形（占位符 + 换行 + 一句路径提示）。 */
const stub = (path: string): string => "[已裁剪：原文过长]\n[原文已存附件 " + path + "，需要时 read_file 取回]";

const call = (id: string, name: string, args: Record<string, unknown>): PruneEvent =>
  ({ type: "tool_call", id, name, args });
const result = (callId: string, ok: boolean, output = ""): PruneEvent =>
  ({ type: "tool_result", callId, ok, output });

describe("prune 回取承诺读数：三种 0 各归各的处置", () => {
  it("照做过且每次都是失败回执 ⇒ 判「活缺陷」（这一格红，才允许去动热文件）", () => {
    const t = tallyPrunePromise([
      result("c1", true, stub(ABS)),
      call("c2", "read_file", { path: ABS }),
      result("c2", false, "read_file: 只允许 workspace 相对路径"),
    ]);
    expect(t.stubs).toBe(1);
    expect(t.stubsWithAbsPath).toBe(1);
    expect(t.attempts).toBe(1);
    expect(t.attemptFailed).toBe(1);
    expect(t.attemptOk).toBe(0);
    const v = prunePromiseVerdict(t);
    expect(v.live).toBe(true);
    expect(v.why).toContain("活缺陷");
  });

  it("反向：同一句承诺但通道真能用（ok=true）⇒ 不判活缺陷", () => {
    const t = tallyPrunePromise([
      result("c1", true, stub(ABS)),
      call("c2", "read_file", { path: ABS }),
      result("c2", true, "文件正文…"),
    ]);
    expect(t.attemptOk).toBe(1);
    expect(t.attemptFailed).toBe(0);
    const v = prunePromiseVerdict(t);
    expect(v.live).toBe(false);
    expect(v.why).toContain("通道可用");
  });

  it("发射过承诺、没人照做 ⇒ 单独一态，且明写「不能读成没问题」", () => {
    const t = tallyPrunePromise([result("c1", true, stub(ABS)), call("c2", "grep", { pattern: "x" })]);
    expect(t.stubs).toBe(1);
    expect(t.attempts).toBe(0);
    const v = prunePromiseVerdict(t);
    expect(v.live).toBe(false);
    expect(v.why).toContain("无人照做");
    expect(v.why).toContain("不能读成");
  });

  it("语料里从没发射过 ⇒ 「潜在」态（与上一态措辞必须不同，否则两个 0 会被读成同一个）", () => {
    const v = prunePromiseVerdict(tallyPrunePromise([call("c1", "grep", { pattern: "x" }), result("c1", true, "命中 0 处")]));
    expect(v.live).toBe(false);
    expect(v.why).toContain("从没发射");
    expect(v.why).not.toContain("无人照做");
  });

  it("join 键：回执 callId 配不上 tool_call 的 id ⇒ 记「无回执」，不冒充失败也不冒充成功", () => {
    const t = tallyPrunePromise([
      result("c1", true, stub(ABS)),
      call("c2", "read_file", { path: ABS }),
      result("c9", false, "别的调用"),
    ]);
    expect(t.attempts).toBe(1);
    expect(t.attemptNoResult).toBe(1);
    expect(t.attemptFailed).toBe(0);
    expect(prunePromiseVerdict(t).why).toContain("无从判定");
  });

  it("数的是「绝对路径」那一类，不是所有承诺（相对路径的打桩不许被算进 unreachable 半句）", () => {
    const t = tallyPrunePromise([result("c1", true, stub("src/relative-note.txt"))]);
    expect(t.stubs).toBe(1);
    expect(t.stubsWithAbsPath).toBe(0);
  });

  it("附件路径出现在任意参数位都算「照做」（run_shell 的 command 位也是合法出路）", () => {
    const t = tallyPrunePromise([
      result("c1", true, stub(ABS)),
      call("c2", "run_shell", { command: "cat " + ABS }),
      result("c2", true, "正文…"),
    ]);
    expect(t.attempts).toBe(1);
    expect(t.attemptOk).toBe(1);
  });

  it("toolCalls 计数含所有调用（corpusProblem 的第二格靠它，读错形状会得到假读数）", () => {
    const t = tallyPrunePromise([
      call("a", "grep", { pattern: "x" }),
      result("a", true, "hit"),
      call("b", "read_file", { path: "src/x.ts" }),
      result("b", true, stub(ABS)),
    ]);
    expect(t.toolCalls).toBe(2);
    expect(t.stubs).toBe(1);
  });
});
