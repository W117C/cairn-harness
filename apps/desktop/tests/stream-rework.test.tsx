// P3-1 对话区收口判卷（计划稿 Task P3-1）：判卷先红——本文件先于实现落盘。
//   ① 阅读列 760（tokens.test 反转钉）；
//   ② user 右气泡 / agent 左无气泡（第十五遍语义，SSR class 断言）；
//   ③ 工具卡折叠行含耗时（有 then 显示；纯函数 formatDuration）；
//   ④ 生成中顶栏细进度条（.gen-bar[data-running]，SSR 两态 + styles 源文）；
//   ⑤ hover 操作：user 复制+分叉 / agent 复制+回放，tooltip 说明「从该轮起新建会话，原会话不动」；
//   ⑥ data-event-id 锚（timeline 跳转落点，四类行全带）；
//   ⑦ 纯函数 roundOfEvent / userTextOfRound（事件日志 fork/replay 的投影，先红后绿）；
//   ⑧ 滚动记忆 App 接线哨兵（Map(sessionId → scrollTop)；回底钮逻辑不动）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentEvent } from "../../../src/events";
import { formatDuration, Stream, writeDiffPathOf } from "../src/renderer/components/Stream";
import { projectStream, roundOfEvent, userTextOfRound } from "../src/renderer/projections";

const styles = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const appSrc = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");
const streamSrc = readFileSync(fileURLToPath(new URL("../src/renderer/components/Stream.tsx", import.meta.url)), "utf8");

// 六事件夹具：user/assistant/user/tool_call/tool_result/assistant（工具 ts 2100→3300 = 1.2s）。
const events = [
  { type: "user_message", content: "你好", ts: 1000 },
  { type: "assistant_message", content: "收到。", ts: 1200 },
  { type: "user_message", content: "跑个命令", ts: 2000 },
  { type: "tool_call", id: "t1", name: "run_shell", args: { command: "ls" }, ts: 2100 },
  { type: "tool_result", callId: "t1", ok: true, ts: 3300 },
  { type: "assistant_message", content: "好了。", ts: 3400 },
] as unknown as AgentEvent[];

describe("② 对话左右分（第十五遍语义，SSR class 断言）", () => {
  it("user 行 = .row.user（右气泡）；assistant 行 = .row.assistant（左无气泡）", () => {
    const html = renderToStaticMarkup(<Stream rows={projectStream(events)} />);
    expect(html.match(/class="row user"/g)?.length).toBe(2);
    expect(html.match(/class="row assistant"/g)?.length).toBe(2);
  });
});

describe("③ 工具卡折叠行：图标 + 摘要 + 耗时（有 then 显示）+ 状态符", () => {
  it("formatDuration：ms / 一位小数秒 / 整数秒 / 分秒（边界逐值钉）", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(340)).toBe("340ms");
    expect(formatDuration(999)).toBe("999ms");
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(1234)).toBe("1.2s");
    expect(formatDuration(12000)).toBe("12s");
    expect(formatDuration(89000)).toBe("1m29s");
    expect(formatDuration(120000)).toBe("2m");
  });

  it("tool_result 收口 ⇒ 折叠行渲染耗时；未收口（无 then）不渲染耗时", () => {
    const withPending = [
      ...events,
      { type: "tool_call", id: "t2", name: "read_file", args: { path: "a.ts" }, ts: 4000 },
    ] as unknown as AgentEvent[];
    const html = renderToStaticMarkup(<Stream rows={projectStream(withPending)} />);
    // 仅 t1 有 then（3300-2100=1.2s）；t2 pending 无耗时
    expect(html.match(/class="tdur"/g)?.length).toBe(1);
    expect(html).toContain(">1.2s<");
    // 状态符与摘要仍在（折叠行三件套不丢）
    expect(html).toContain("run_shell");
    expect(html).toContain("运行 ls");
  });
});

describe("④ 生成中顶栏细进度条（.gen-bar[data-running]）", () => {
  it("SSR 两态：streaming（缺省 true）→ data-running=true；streaming=false → false", () => {
    const rows = projectStream(events, false);
    const run = renderToStaticMarkup(<Stream rows={rows} />);
    const idle = renderToStaticMarkup(<Stream rows={rows} streaming={false} />);
    expect(run).toContain('class="gen-bar"');
    expect(run).toContain('data-running="true"');
    expect(idle).toContain('data-running="false"');
  });

  it("styles.css：.gen-bar 块在场且 running 态可辨（含 reduced-motion 让路）", () => {
    expect(styles).toContain(".gen-bar");
    expect(styles).toContain('.gen-bar[data-running="true"]');
    expect(styles).toMatch(/prefers-reduced-motion/);
  });
});

describe("⑤ hover 操作：user 复制+分叉 / agent 复制+回放（tooltip 同句说明）", () => {
  it("tooltip 句「从该轮起新建会话，原会话不动」在两处各 2 枚", () => {
    const html = renderToStaticMarkup(
      <Stream
        rows={projectStream(events)}
        actions={{ onCopyText: () => undefined, onBranch: () => undefined, onReplay: () => undefined }}
      />,
    );
    expect(html.match(/title="分叉：从该轮起新建会话，原会话不动"/g)?.length).toBe(2);
    expect(html.match(/title="回放：从该轮起新建会话并填入当时的输入，原会话不动"/g)?.length).toBe(2);
  });
});

describe("⑥ data-event-id 锚（timeline 跳转落点）", () => {
  it("四类行全带锚：user/assistant/tool/error（1-based 行号口径）", () => {
    const errFirst = [{ type: "error", message: "炸了", ts: 5 }] as unknown as AgentEvent[];
    const html = renderToStaticMarkup(<Stream rows={projectStream(events)} />);
    // user2 seq=2 → 3；tool seq=3 → 4；assistant2 seq=5 → 6
    expect(html).toContain('data-event-id="1"');
    expect(html).toContain('data-event-id="3"');
    expect(html).toContain('data-event-id="4"');
    expect(html).toContain('data-event-id="6"');
    const err = renderToStaticMarkup(<Stream rows={projectStream(errFirst)} />);
    expect(err).toContain('data-event-id="1"');
  });
});

describe("⑦ 纯函数：roundOfEvent / userTextOfRound（事件日志 fork/replay 投影）", () => {
  it("roundOfEvent：user/assistant/tool 归轮；越界与首 user 之前 → null", () => {
    expect(roundOfEvent(events, 1)).toBe(1); // user 自身
    expect(roundOfEvent(events, 2)).toBe(1); // assistant
    expect(roundOfEvent(events, 3)).toBe(2); // 第二个 user
    expect(roundOfEvent(events, 4)).toBe(2); // tool 归第 2 轮
    expect(roundOfEvent(events, 6)).toBe(2);
    expect(roundOfEvent(events, 0)).toBeNull();
    expect(roundOfEvent(events, 7)).toBeNull();
  });

  it("roundOfEvent：worker 子流不计轮；首 user 之前的事件 → null", () => {
    const withWorker = [
      { type: "user_message", content: "A", ts: 1 },
      { type: "assistant_delta", callId: "c1", text: "…", agent_id: "w1", ts: 2 },
      { type: "user_message", content: "B", ts: 3 },
    ] as unknown as AgentEvent[];
    expect(roundOfEvent(withWorker, 3)).toBe(2);
    expect(roundOfEvent(withWorker, 2)).toBe(1); // worker 事件归当前轮
    const errFirst = [{ type: "error", message: "x", ts: 1 }] as unknown as AgentEvent[];
    expect(roundOfEvent(errFirst, 1)).toBeNull();
  });

  it("userTextOfRound：取该轮用户输入原文；越界/无轮 → null", () => {
    expect(userTextOfRound(events, 1)).toBe("你好");
    expect(userTextOfRound(events, 2)).toBe("跑个命令");
    expect(userTextOfRound(events, 0)).toBeNull();
    expect(userTextOfRound(events, 3)).toBeNull();
  });
});

describe("⑧ App 接线哨兵（滚动记忆 / 回放链）", () => {
  it("滚动记忆：Map(sessionId → scrollTop) 离场存回场取；owner 守卫 + 可达等帧（回底钮逻辑不动）", () => {
    expect(appSrc).toContain("const scrollMemory = useRef(new Map<string, number>())");
    // owner 守卫：没滚动过的会话不落盘（lastScrollTop 揣着上个会话的数，直接存会记错人头）。
    expect(appSrc).toContain("lastScrollOwner.current = activeIdRef.current");
    expect(appSrc).toContain("lastScrollOwner.current === lastScrollSession.current");
    expect(appSrc).toContain("scrollMemory.current.set(lastScrollSession.current, lastScrollTop.current)");
    expect(appSrc).toContain("scrollMemory.current.get(activeId)");
    // 可达等帧：会话内容异步载入——等 scrollHeight 容纳目标位再落（早落被空流 clamp 成 0，
    // P3 真机抓到的竞态）；至多 N 帧仍不可达则贴可达上限。
    expect(appSrc).toContain("streamEl.scrollHeight - streamEl.clientHeight >= restore");
    expect(appSrc).toContain("restoreTo(restore)");
  });

  it("restoreTo（useStickyScroll）：换场回位后按真实落点重判贴底——不在底部即解除粘底（不与跟底观察器打架）", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/renderer/useStickyScroll.ts", import.meta.url)), "utf8");
    expect(src).toContain("const restoreTo = useCallback");
    expect(src).toContain("restoreTo: (top: number, behavior?: ScrollBehavior) => void");
  });

  it("回放链：fork → 切换 → 注入该轮输入不发送（round/userText 从事件投影）", () => {
    expect(appSrc).toContain("const handleReplay = useCallback((eventId: number)");
    expect(appSrc).toContain("roundOfEvent(events, eventId)");
    expect(appSrc).toContain("userTextOfRound(events, round)");
    expect(appSrc).toContain("setInjectedText(text)");
  });
});

// ⑨ P3-1 Step 2（计划稿）：写文件类工具卡展开区——改动 diff 行内渲染（changeDiff 懒加载 +
//    既有 DiffView 复用）；路径从 args JSON 取（非写文件类/非法 args → 不摆差异区）。
describe("⑨ 工具卡行内 diff（写文件类）", () => {
  it("writeDiffPathOf：只认写文件三类 + args.path 合法非空串", () => {
    expect(writeDiffPathOf("write_file", JSON.stringify({ path: "src/a.ts", content: "x" }))).toBe("src/a.ts");
    expect(writeDiffPathOf("edit_file", JSON.stringify({ path: "b.ts" }))).toBe("b.ts");
    expect(writeDiffPathOf("apply_patch", JSON.stringify({ path: "c.ts" }))).toBe("c.ts");
    expect(writeDiffPathOf("read_file", JSON.stringify({ path: "d.ts" }))).toBeNull();
    expect(writeDiffPathOf("run_shell", JSON.stringify({ command: "ls" }))).toBeNull();
    expect(writeDiffPathOf("write_file", undefined)).toBeNull();
    expect(writeDiffPathOf("write_file", "{坏 JSON")).toBeNull();
    expect(writeDiffPathOf("write_file", JSON.stringify({ noPath: 1 }))).toBeNull();
    expect(writeDiffPathOf("write_file", JSON.stringify({ path: "" }))).toBeNull();
  });

  it("SSR（verbose 展开）：成功的 write_file 行摆「文件差异」位；read_file 行不摆（不收口不摆）", () => {
    const rows = projectStream([
      { type: "user_message", content: "改", ts: 1 },
      { type: "tool_call", id: "t1", name: "write_file", args: { path: "src/a.ts", content: "x" }, ts: 2 },
      { type: "tool_result", callId: "t1", ok: true, ts: 3 },
      { type: "tool_call", id: "t2", name: "read_file", args: { path: "src/b.ts" }, ts: 4 },
      { type: "tool_result", callId: "t2", ok: true, ts: 5 },
    ] as unknown as AgentEvent[]);
    const html = renderToStaticMarkup(<Stream rows={rows} view="verbose" />);
    expect((html.match(/文件差异/g) ?? []).length).toBe(1);
  });

  it("懒加载源文哨兵：changeDiff({ path: diffPath }) 调既有通道 + DiffView 复用 + 失败原文上屏", () => {
    expect(streamSrc).toContain(".changeDiff({ path: diffPath })");
    expect(streamSrc).toContain("<DiffView hunks=");
    expect(streamSrc).toContain("正在读快照与当前文件…");
    expect(streamSrc).toContain("通道无应答（主进程未返回差异数据）");
  });
});
