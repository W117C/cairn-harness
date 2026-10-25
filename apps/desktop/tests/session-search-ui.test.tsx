import { Command } from "cmdk";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionSearchResults } from "../src/renderer/components/SessionSearchResults";

const render = (state: Parameters<typeof SessionSearchResults>[0]["state"]) => renderToStaticMarkup(
  <Command><SessionSearchResults state={state} workspace="/test/workspace" onOpenSession={() => undefined} onRetry={() => undefined} /></Command>,
);
const empty = { kind: "ok" as const, matches: [], scannedSessions: 2, scannedBytes: 123, totalSessions: 2 };
describe("会话正文搜索的可见状态", () => {
  it("未测与错误不显示没有匹配，失败有重试入口", () => {
    expect(render({ status: "idle" })).not.toContain("当前项目正文");
    const loading = render({ status: "loading" });
    expect(loading).toContain("正在搜索当前项目的对话正文");
    expect(loading).not.toContain("没有匹配");
    const unavailable = render({ status: "ready", result: { kind: "unavailable", reason: "workspace-unknown", detail: "工作区未登记" } });
    expect(unavailable).toContain("工作区未登记");
    expect(unavailable).toContain("重试搜索");
    expect(unavailable).not.toContain("没有匹配");
    expect(render({ status: "error", error: "读取失败" })).toContain("读取失败");
  });
  it("不可用状态有明确中文提示，保留原始诊断而不是仅显示系统异常", () => {
    const html = render({ status: "ready", result: { kind: "unavailable", reason: "root-missing", detail: "ENOENT: no such file or directory" } });
    expect(html).toContain("当前项目的对话正文暂时无法搜索");
    expect(html).toContain("ENOENT: no such file or directory");
    expect(html).toContain("重试搜索");
    expect(html).not.toContain("没有匹配");
  });
  it("完整空结果与预算不完整可区分", () => {
    expect(render({ status: "ready", result: empty })).toContain("正文中没有匹配");
    const partial = render({ status: "ready", result: { ...empty, kind: "partial", budgetBytes: 20, budgetExhaustedAt: "bytes", unreadableSessions: 0, badLines: 0, truncatedSessions: [] } });
    expect(partial).toContain("搜索尚未完成，可能还有结果");
    expect(partial).not.toContain("正文中没有匹配");
  });
  it("展示真实标题和摘录，保留会话与工作区身份", () => {
    const html = render({ status: "ready", result: { ...empty, matches: [{ sessionId: "s1", session: { workspace: "/w/s1", sessionId: "s1" }, title: "旧会话", matchCount: 1, snippets: [{ kind: "user_message", keyword: "中文", excerpt: "一条中文正文", index: 0 }], bytes: 20, complete: true, badLines: 0 }] } });
    expect(html).toContain("旧会话");
    expect(html).toContain("一条中文正文");
    expect(html).toContain('data-session-search-result="s1"');
  });
});
