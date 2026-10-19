// 动效批（2026-10-18）：三处「状态变化生硬」的补丁——窗格区进场、发送钮三态过渡+按压、
// 队列条进场。全部走既有 token 时长（--t-fast 140ms）与既有 keyframes（panel-in / fade-in）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");

describe("动效批", () => {
  it("窗格区进场用 panel-in + --t-fast", () => {
    expect(css).toMatch(/\.pane-dock-zone\s*{[^}]*animation:\s*panel-in var\(--t-fast\)/s);
  });
  it("发送钮三态过渡与按压缩放", () => {
    expect(css).toMatch(/\.send-btn\s*{[^}]*transition:[^}]*background-color var\(--t-fast\)/s);
    expect(css).toMatch(/\.send-btn:active\s*{[^}]*transform:\s*scale\(\.97\)/s);
  });
  it("队列条进场淡入", () => {
    expect(css).toMatch(/\.queue-strip\s*{[^}]*animation:\s*fade-in var\(--t-fast\)/s);
  });

  it("项目组收/开有高度过渡（inner 包一层才收得动）", () => {
    expect(css).toMatch(/\.group-body\s*{[^}]*grid-template-rows:\s*1fr/s);
    expect(css).toMatch(/\.group-body\s*{[^}]*transition:\s*grid-template-rows var\(--t-fast\)/s);
    expect(css).toMatch(/\.group\[data-collapsed="true"\] \.group-body\s*{[^}]*grid-template-rows:\s*0fr/s);
    const sidebar = readFileSync(fileURLToPath(new URL("../src/renderer/components/Sidebar.tsx", import.meta.url)), "utf8");
    expect(sidebar).toContain('className="group-body-inner"');
    // 归档组同批接入：不再条件渲染（常驻 + inner 才能过渡）
    expect(sidebar).not.toContain('!collapsed.has("\\u0000archived") &&');
  });

  it("输入类控件有键盘焦点环；composer 不叠第二圈", () => {
    expect(css).toMatch(/input:focus-visible, textarea:focus-visible, select:focus-visible\s*{[^}]*outline:\s*2px solid hsl\(var\(--accent-brand\) \/ 45%\)/s);
    expect(css).toMatch(/\.composer-card textarea:focus-visible\s*{[^}]*outline:\s*none/s);
  });
});
