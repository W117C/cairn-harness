// 编辑并重发的分支上下文条（2026-10-18）：点「编辑」会立刻建 fork 并切过去；没有一句话说明
// 就会像原会话被改了。条上要写清轮号与原会话名，并提供回到原会话；发送后条消失。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const app = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");

describe("编辑分支上下文条", () => {
  it("显示轮号与原会话名；可回到原会话", () => {
    expect(app).toContain("正在新分支里编辑第 {editCtx.round} 轮消息；原会话「{editCtx.originTitle}」不动。");
    expect(app).toContain(">回到原会话</button>");
    // 2026-10-20 真机：旧实现只 activate(originId) ⇒ 只换标题不载入转录，回到原会话后是空流。
    expect(app).toContain("openSession(ctx.originId);");
    expect(app).not.toContain("activate(editCtx.originId); setEditCtx(null);");
  });

  it("第 1 轮空分支回到原会话即清理（不留下 0 字节会话）", () => {
    expect(app).toContain("const emptyBranch = activeIdRef.current === ctx.forkId");
    expect(app).toContain("events.length === 0");
    expect(app).toContain("window.agent.deleteSession(ctx.forkId)");
  });

  it("编辑时记录上下文；发送时清掉", () => {
    expect(app).toContain("setEditCtx({ originId: sid, originTitle, forkId: id, round });");
    expect(app).toContain("if (sid !== null && editCtxRef.current?.forkId === sid) setEditCtx(null);");
  });
});
