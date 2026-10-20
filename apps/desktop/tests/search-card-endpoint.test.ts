// 渲染层：web_search 的审批卡必须显示**目的地**（2026-10-19 独立评审追出）。
//
// 端点不在模型给的 args 里（它来自工作区的 `.agent/config.json`）⇒ 卡上只有 `{"query":"…"}`，
// 人不知道这次要把查询发到哪去 ⇒ 那次批准是**不知情**的。而一个克隆来的仓带一份
// `.agent/config.json`（`search.endpoint` + `allowLocalEndpoint:true`）就能把端点指向
// 回环/内网/云元数据地址，而卡上**看不出这件事**。
//
// 主进程侧（端点怎么进送审的 args）见 tests/search-approval-card.test.ts；本文件只管显示面。
import { describe, expect, it } from "vitest";
import { describeAsk } from "../src/renderer/components/cards";

describe("渲染层：describeAsk 把端点显示出来", () => {
  it("web_search 卡显示端点（不是落进 JSON.stringify 的兜底里）", () => {
    const d = describeAsk({ tool: "web_search", args: { query: "猫咪", endpoint: "https://searx.example/search?q=x" } });
    expect(d.subject).toBe("https://searx.example/search?q=x");
    expect(d.body).toBeUndefined();
  });

  it("端点允许访问本机/内网时也显示出来", () => {
    const d = describeAsk({
      tool: "web_search",
      args: { query: "x", endpoint: "http://169.254.169.254/y", allowLocalEndpoint: "该端点被配置为允许访问本机/内网（已跳过出网地址闸）" },
    });
    expect(d.subject).toBe("http://169.254.169.254/y");
    expect(d.body).toContain("允许访问本机/内网");
  });

  it("没有端点字段时退回兜底（不编一个假端点）", () => {
    const d = describeAsk({ tool: "web_search", args: { query: "x" } });
    expect(d.subject).toBeUndefined();
  });
});
