// 渲染层不许挂演示数据（AGENTS 立的规矩：假象比空白更坏）。
// 动因：右栏五面板曾有演示常量（已删），但工作树看板那份 `BRANCHES`（四条假分支）活到 2026-09-23——
// 点一行只翻数组里的 `current` 再 toast「已切换到分支…」，而 `src/preload` 没有任何 git 通道。
// 真窗口那一半在 panels-check B28（屏上读数），这里守的是"别从注释旁边又溜回源码里"这一半。
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const rendererFiles = ["../src/renderer/app.js", "../src/renderer/projections.ts"] as const;

/** 去掉注释后的源码：注释允许**谈论**这些名字（那是历史与理由），字面量不允许携带它们。 */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/* 演示分支名：分支那一半已彻底删除（真运行时与原型态都不再画它们），所以源码里**只允许**在注释里出现。
   演示工作区名不同：`WORKSPACES` 是原型态（浏览器直接打开这份文件）的正当用途，仍在源码里，
   但它不许进入发货路径——那一半由上面 `workspacePanel` 那组"跑 shipped 代码"的断言守着，
   这里不收进 `demoTokens`（收了就是把自己逼成删掉正当用途）。 */
const demoTokens = ["ttl-rotation", "grace-window", "chore/deps"];

describe("渲染层源码里不许携带演示数据", () => {
  for (const rel of rendererFiles) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    const code = codeOnly(src);
    it(`${rel}：去注释后不含任何演示分支名／演示工作区名`, () => {
      const hit = demoTokens.filter((t) => code.includes(t));
      expect(hit, "命中的演示字面量：" + JSON.stringify(hit)).toEqual([]);
    });
  }

  it("反面对手：注释里提到这些名字仍然允许（修法与理由要写下来，判据不许把人逼成不回写历史）", () => {
    const src = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");
    expect(src).toContain("ttl-rotation");
    expect(codeOnly(src)).not.toContain("ttl-rotation");
  });

  it("工作树那一格必须自己说未接入（撤假数据不等于留白）", () => {
    const src = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");
    const branchFn = /function branchesViewHTML\(\)[\s\S]*?\n\}/.exec(src)?.[0] ?? "";
    expect(branchFn).not.toBe("");
    expect(branchFn).toContain("未接入");
    expect(branchFn).not.toContain("branch-row");
  });
});

/** 把 app.js 里工作区看板那一段真跑一遍（不复制实现）：`window.agent` 与注入的行数是它读的两个开关。 */
function workspacePanel(opts: { agent: boolean; rows: { id: string; name: string; path: string }[] }): string {
  const src = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");
  // 边界用代码标识，不用注释文本：改注释 = 改判卷取料面（切片悄悄变小是静默通过的那种错）。
  const a = src.indexOf("let realWorkspaceRows");
  const b = src.indexOf("function renderWorkspacePanel", a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  const context: Record<string, unknown> = {
    esc: (s: unknown) => String(s),
    window: opts.agent ? { agent: {} } : {},
    // 演示数组与"当前"指针只服务原型态；agent 态不读它们（读到了就会被下面的断言抓到）。
    WORKSPACES: opts.rows, currentWs: opts.rows[0],
    __rows: opts.rows,
    __out: "",
  };
  runInNewContext(
    src.slice(a, b) +
    "\nif (window.agent) { realWorkspaceRows = () => __rows; }" +
    "\n__out = workspaceViewHTML();",
    context,
  );
  return context.__out as string;
}

describe("工作区看板：真运行时只列注入的那一条，演示数据只留在原型态", () => {
  it("agent 态：列真目录那一条，且它不是可点的 radio（没有能生效的切换）", () => {
    const html = workspacePanel({ agent: true, rows: [{ id: "real", name: "proj-ws", path: "/Users/me/proj-ws" }] });
    expect(html).toContain("proj-ws");
    expect(html).toContain("/Users/me/proj-ws");
    expect(html).toContain("<div class=\"ws-row is-current\"");
    expect(html).not.toContain("role=\"radio\"");
  });

  it("agent 态：演示文件夹名与「打开其他文件夹…」都不许出现（那句「已切换」可证伪）", () => {
    const html = workspacePanel({ agent: true, rows: [{ id: "real", name: "proj-ws", path: "/Users/me/proj-ws" }] });
    for (const demo of ["coding-suite", "docs-site", "edge-gateway", "wsAdd"]) {
      expect(html, "命中演示/假流程痕迹：" + demo).not.toContain(demo);
    }
  });

  it("反面对手（非恒真）：同一个函数在原型态**确实**会画那三条 —— 上面那条不许是靠删渲染变绿的", () => {
    const html = workspacePanel({ agent: false, rows: [
      { id: "ws1", name: "coding-suite", path: "~/dev/coding-suite" },
      { id: "ws2", name: "docs-site", path: "~/dev/docs-site" },
      { id: "ws3", name: "edge-gateway", path: "~/work/edge-gateway" },
    ] });
    expect(html).toContain("coding-suite");
    expect(html).toContain("docs-site");
    expect(html).toContain("wsAdd");
  });

  it("没配运行目录时明说「未指定」，而不是留一格空白让人猜", () => {
    const html = workspacePanel({ agent: true, rows: [] });
    expect(html).toContain("未指定运行目录");
    expect(html).toContain("data-ws-state=\"unconfigured\"");
  });
});
