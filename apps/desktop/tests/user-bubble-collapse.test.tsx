// 长用户消息折叠判卷（2026-10-31，R1）：参考库 ChatMessageBubbles 的 collapseThreshold。
// 短消息不摆按钮；长消息 SSR 先折叠（挂载后按真实高度再量）；data-round-anchor 不断。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { USER_TEXT_COLLAPSE_CHARS, USER_TEXT_COLLAPSE_PX, UserText } from "../src/renderer/components/Stream";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("UserText：长消息折叠", () => {
  it("短消息不折叠、不摆展开按钮；定位锚保留", () => {
    const html = renderToStaticMarkup(<UserText text="短消息" round={3} />);
    expect(html).toContain('data-round-anchor="3"');
    expect(html).toContain('data-collapsed="false"');
    expect(html).not.toContain("user-more");
    expect(html).toContain("短消息");
  });

  it("超过字数阈值先折叠，按钮带 aria-expanded=false", () => {
    const html = renderToStaticMarkup(<UserText text={"长".repeat(USER_TEXT_COLLAPSE_CHARS + 1)} round={1} />);
    expect(html).toContain('data-collapsed="true"');
    expect(html).toContain('class="user-more"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(">展开全文<");
  });

  it("阈值常量与 CSS 高度/遮罩同源", () => {
    expect(USER_TEXT_COLLAPSE_CHARS).toBe(1200);
    expect(USER_TEXT_COLLAPSE_PX).toBe(320);
    const css = read("../src/renderer/styles.css");
    expect(css).toMatch(/\.row\.user \.t\[data-collapsed="true"\]\s*\{[^}]*max-height:\s*320px/s);
    expect(css).toMatch(/\.row\.user \.t\[data-collapsed="true"\]\s*\{[^}]*mask-image:\s*linear-gradient/s);
    expect(css).toMatch(/\.user-more\s*\{[^}]*justify-self:\s*end/s);
  });
});
