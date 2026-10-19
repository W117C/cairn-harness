// 批准卡重设计判卷（第十一遍，业主截屏批「批准面板设计的太丑」）。
// 病灶实证：v1 重建样式表时 .btn 族整批漏移植 ⇒ 动作按钮裸文本；remember 卡把
// `JSON.stringify(args)` 直接上屏（`{"trigger":"session_end_distill"}`）；风险 chip 英文且恒出。
// 本文件判：describeAsk 人话单点（纯函数）+ SSR 真 HTML（标题/主体/chip 分级/按钮类/回归钉）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ApprovalCard } from "../src/renderer/components/ApprovalCard";
import { describeAsk } from "../src/renderer/components/cards";
import type { AskPayload } from "../../../src/main/ipc-protocol";

const ask = (over: Partial<AskPayload>): AskPayload =>
  ({ askId: "a1", tool: "run_shell", args: {}, ...over }) as AskPayload;

describe("describeAsk（批准卡人话单点）", () => {
  it("run_shell：标题「运行命令」+ 命令做主体", () => {
    expect(describeAsk({ tool: "run_shell", args: { command: "pnpm test" } })).toEqual({ title: "运行命令", body: "pnpm test" });
  });

  it("write_file/edit_file：标题人话 + 路径做主体（content 大块不进卡面）", () => {
    expect(describeAsk({ tool: "write_file", args: { path: "src/a.ts", content: "x".repeat(500) } }))
      .toEqual({ title: "写入文件", body: "src/a.ts" });
    expect(describeAsk({ tool: "edit_file", args: { path: "src/b.ts" } })).toEqual({ title: "编辑文件", body: "src/b.ts" });
  });

  it("remember：分层给词（项目/全局）+ 类型与主题入 subject", () => {
    expect(describeAsk({ tool: "remember", args: { scope: "project", kind: "decision", topic: "d1" } }))
      .toEqual({ title: "写入项目记忆", subject: "决策「d1」" });
    expect(describeAsk({ tool: "remember", args: { scope: "global", kind: "preference", topic: "lang" } }))
      .toEqual({ title: "写入全局记忆", subject: "偏好「lang」" });
    expect(describeAsk({ tool: "remember", args: { scope: "project", kind: "memory", type: "feedback", topic: "t" } }).subject)
      .toBe("记忆「t」");
  });

  it("distill 合并审批：固定人话并写明影响面（跨项目回注）", () => {
    const d = describeAsk({ tool: "remember", args: { trigger: "session_end_distill", scope: "global" } });
    expect(d.title).toBe("写入全局记忆");
    expect(d.subject).toContain("跨项目记忆");
    expect(d.body).toBeUndefined();
  });

  it("web_fetch 出网地址入 subject；名单外工具保留 JSON 兜底（可诊断性）", () => {
    expect(describeAsk({ tool: "web_fetch", args: { url: "https://x.example" } })).toEqual({ title: "访问网络", subject: "https://x.example" });
    const fb = describeAsk({ tool: "mystery_tool", args: { a: 1 } });
    expect(fb.title).toBe("需要你批准");
    expect(fb.body).toContain('"a"');
  });
});

describe("ApprovalCard SSR（重设计后）", () => {
  it("头行 = 工具图标 + 人话标题；低风险不出 chip、不摆警示三角", () => {
    const html = renderToStaticMarkup(
      <ApprovalCard ask={ask({ tool: "write_file", args: { path: "src/a.ts" }, risk: "low" })} onDecide={() => undefined} />,
    );
    expect(html).toContain("<h3>写入文件</h3>");
    expect(html).toContain("lucide-file-text");
    expect(html).not.toContain("chip"); // 低风险安静：不出风险 chip
    expect(html).not.toContain("triangle-alert");
    expect(html).toContain("src/a.ts");
  });

  it("中/高风险：chip 中文化 + class 分级；高风险换警示图标", () => {
    const mid = renderToStaticMarkup(<ApprovalCard ask={ask({ risk: "medium" })} onDecide={() => undefined} />);
    expect(mid).toContain("中风险");
    expect(mid).toContain('class="chip risk"');
    const high = renderToStaticMarkup(<ApprovalCard ask={ask({ risk: "high" })} onDecide={() => undefined} />);
    expect(high).toContain("高风险");
    expect(high).toContain('class="chip danger"');
    expect(high).toContain("triangle-alert");
  });

  it("remember 合并审批卡：不裸 JSON（旧形状回归钉）", () => {
    const html = renderToStaticMarkup(
      <ApprovalCard ask={ask({ tool: "remember", args: { trigger: "session_end_distill", scope: "global" }, risk: "low" })} onDecide={() => undefined} />,
    );
    expect(html).not.toContain("session_end_distill");
    expect(html).not.toContain("trigger");
    expect(html).toContain("写入全局记忆");
  });

  it("动作行按钮带 .btn 类，且样式表对四档都有定义（v1 漏移植回归钉）", () => {
    const html = renderToStaticMarkup(<ApprovalCard ask={ask({})} onDecide={() => undefined} />);
    expect(html).toContain('class="btn primary"');
    expect(html).toContain('class="btn secondary"');
    expect(html).toContain('class="btn ghost"');
    const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    for (const sel of [".btn {", ".btn.primary", ".btn.secondary", ".btn.ghost", ".btn.danger-text", ".chip.risk", ".chip.danger", ".chip.wait", ".note-net", ".opt {", ".card-head h3"]) {
      expect(css).toContain(sel);
    }
    // 建议族类名不得再退回裸 `.ghost` 也不得撞按钮修饰符（与 .btn.ghost 撞名的旧伤；
    // 第二十四遍改锚 .suggest-note —— 灰字芯片下架后，suggest- 前缀纪律由提示行承接）。
    expect(css).not.toContain("\n.ghost {");
    expect(css).not.toContain("\n.suggest-ghost"); // 规则位清零（行首锚；注释里的历史说明不算）
    expect(css).toContain(".suggest-note {");
  });
});

// ── P3-1 Step 3（计划稿「审批卡键盘」）：⏎ = 允许一次（焦点在卡本体时——按钮的原生 ⏎ 不抢、
//    不双发）；**Esc 不做决议保留**：计划前提「按钮集合一致」核证不成立（现行三枚 = 允许·本次/
//    拒绝/总是允许 + 卡面明示「Esc 不做决议」），且 Esc=拒绝 会与全局 Esc（浮层优先/停止）打架
//    ——不落，偏差登记 §9。──
describe("P3-1 审批卡键盘（⏎ 允许一次；Esc 维持既有口径）", () => {
  const src = readFileSync(new URL("../src/renderer/components/ApprovalCard.tsx", import.meta.url), "utf8");
  it("卡容器可聚焦 + Enter 只认卡本体目标（不抢按钮原生 ⏎）→ onDecide(true)", () => {
    expect(src).toContain("tabIndex={0}");
    expect(src).toContain('e.key === "Enter" && e.target === e.currentTarget');
    expect(src).toContain("props.onDecide(true)");
    const html = renderToStaticMarkup(<ApprovalCard ask={ask({})} onDecide={() => undefined} />);
    expect(html).toContain('tabindex="0"');
  });
  it("Esc 不做决议保留：卡面明示文案与安全口径不动（防误触 + 不与全局 Esc 语义打架）", () => {
    expect(src).toContain("Esc 不做决议");
    const html = renderToStaticMarkup(<ApprovalCard ask={ask({})} onDecide={() => undefined} />);
    expect(html).toContain("Esc 不做决议");
  });
});
