// 元素选择「短 chip + 完整载荷在状态里」判卷（2026-11-03 业主）：
//   原状：选择器 + HTML 片段整段拼进输入框，用户打消息前先面对两行机器文本；
//         删掉半行又会把选择器/片段改坏。现在输入区只留一枚可整枚移除的 chip。
// 这里判纯函数（标签/载荷拼装）+ 接线哨兵（Composer 不再把整段 append 进草稿）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pickedElementContext, pickedElementLabel } from "../src/renderer/picked-element";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const composer = read("../src/renderer/components/Composer.tsx");
const paneDock = read("../src/renderer/components/PaneDock.tsx");
const drafts = read("../src/renderer/state/drafts.ts");

describe("pickedElementLabel：只上短标签", () => {
  it("从 HTML 片段取标签名；有 id 就带上 id", () => {
    expect(pickedElementLabel("body > div > svg > ellipse", '<ellipse cx="425" cy="208" rx="72" ry="56" fill="url(#bodyShade)">')).toBe("<ellipse>");
    expect(pickedElementLabel("body > div#stage > svg", '<svg id="stage" viewBox="0 0 800 600">')).toBe("<svg#stage>");
  });

  it("片段为空时退回选择器最后一段；都认不出才说「页面元素」", () => {
    expect(pickedElementLabel("body > div > svg > g:nth-of-type(3) > path", "")).toBe("<path>");
    expect(pickedElementLabel("body > :nth-child(2)", "")).toBe("页面元素");
  });

  it("长度上限：永远不把整串选择器当标签", () => {
    const long = "body > div > svg > g:nth-of-type(3) > g:nth-of-type(5) > ellipse";
    expect(pickedElementLabel(long, "").length).toBeLessThan(30);
  });
});

describe("pickedElementContext：完整载荷只在发送时出现", () => {
  it("逐枚拼 URL / 选择器 / HTML 片段", () => {
    const text = pickedElementContext([
      { selector: "body > svg > ellipse", snippet: '<ellipse cx="1">', url: "http://127.0.0.1:49164/", label: "<ellipse>" },
    ]);
    expect(text).toContain("浏览器中选中的页面元素（http://127.0.0.1:49164/）：");
    expect(text).toContain("选择器：body > svg > ellipse");
    expect(text).toContain('HTML 片段：<ellipse cx="1">');
  });
  it("片段为空时不写空行", () => {
    const text = pickedElementContext([{ selector: "body > svg", snippet: "", url: "u", label: "<svg>" }]);
    expect(text).not.toContain("HTML 片段");
  });
});

describe("接线：输入区只留 chip", () => {
  it("Composer 不再用 injectedAppend 整段 append；改收 injectedElement 并渲染 element-pill", () => {
    expect(composer).not.toContain("injectedAppend");
    expect(composer).toContain("injectedElement?: PickedElementSignal");
    const pill = read("../src/renderer/components/ElementPill.tsx");
    expect(composer).toContain("<ElementPill");
    expect(pill).toContain('className="element-pill"');
    expect(composer).toContain("pickedElementContext(pickedElements)");
    expect(composer).toContain("elementsByKey.current.delete(draftKeyRef.current)");
  });

  it("状态层只发信号，不拼文本；浏览器状态行也只报短标签", () => {
    expect(drafts).not.toContain("HTML 片段：${r.snippet}");
    expect(drafts).toContain("setInjectedElement({ ...r, label, seq: elementSeqRef.current })");
    expect(paneDock).toContain("setNotice(`已选中页面元素：${pickedElementLabel(r.selector, r.snippet ?? \"\")}`)");
    expect(paneDock).not.toContain("setNotice(`已选中：${r.selector}`)");
  });
});
