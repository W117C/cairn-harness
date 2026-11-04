// 预览失败的结构化错误面（2026-11-02 真机订正 · 业主截图）。
//
// 缺陷本体（真机那一行）：
//   「预览失败（spec）：这个文件夹里有网页，但没有入口页 index.html——根目录的网页：pelican-bicycle.html
//     ——把主页改名成 index.html（或新增一个）再导入一次，静态预览按这个名字找首页。」
// 三处毛病，各钉一条：
//   ① 内部代号漏给用户——「spec」是协议里的阶段枚举（spec/prepare/start/ready）；
//   ② 三件不同的事（原因 / 依据 / 下一步）被「——」拍成一行，读者分不出哪句是哪句；
//   ③ 最该被看见的「下一步」排在最后。
//
// 改法：主进程把三段分开走（message / reasons[] / hint）⇒ 渲染层分行渲染，
// 阶段枚举翻成人话。本文件钉住三段不重新拍平、代号不外泄、分行渲染真的发生。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorStrip } from "../src/renderer/components/ErrorStrip";
import { previewFailureError, previewStageLabel } from "../src/renderer/preview-failure";
import { STR } from "../src/renderer/strings";
import type { PreviewSnapshot } from "../../../src/main/project-preview";

const repoFile = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const failed = (over: Partial<PreviewSnapshot> = {}): PreviewSnapshot => ({
  projectPath: "/tmp/pelican",
  status: "failed",
  stage: "spec",
  message: "这个文件夹里有网页，但没有入口页 index.html",
  reasons: ["根目录的网页：pelican-bicycle.html"],
  hint: "把主页改名成 index.html（或新增一个）再导入一次，静态预览按这个名字找首页。",
  ...over,
});

describe("阶段枚举不外泄：翻成人话", () => {
  it("四个阶段各有人话，没有一个是协议里的枚举名", () => {
    expect(previewStageLabel("spec")).toBe(STR.preview.stageSpec);
    expect(previewStageLabel("prepare")).toBe(STR.preview.stagePrepare);
    expect(previewStageLabel("start")).toBe(STR.preview.stageStart);
    expect(previewStageLabel("ready")).toBe(STR.preview.stageReady);
    expect(previewStageLabel(undefined)).toBe(STR.preview.stageUnknown);
    for (const stage of ["spec", "prepare", "start", "ready"] as const) {
      expect(previewStageLabel(stage)).not.toBe(stage);
    }
  });
});

describe("三段分开走：原因 / 依据 / 下一步", () => {
  it("载荷里三段各占一个字段，不是一行", () => {
    const err = previewFailureError(failed());
    expect(err.title).toContain(STR.preview.failedTitle);
    expect(err.title).toContain(STR.preview.stageSpec);
    expect(err.body).toBe("这个文件夹里有网页，但没有入口页 index.html");
    expect(err.reasons).toEqual(["根目录的网页：pelican-bicycle.html"]);
    expect(err.next).toBe("把主页改名成 index.html（或新增一个）再导入一次，静态预览按这个名字找首页。");
    // 拍平的痕迹不许回来：任一段里都不许含另一段
    expect(err.body).not.toContain("——");
    expect(err.next).not.toContain("——");
    expect(err.body).not.toContain("pelican-bicycle.html");
  });

  it("没有依据就只给原因与下一步（不摆空列表）", () => {
    const err = previewFailureError(failed({ reasons: undefined }));
    expect(err.reasons).toBeUndefined();
    expect(err.body).not.toBeUndefined();
  });

  it("主进程不再把依据拼进 message（依据单独走 reasons）", () => {
    const src = repoFile("../../../src/main/project-preview.ts");
    expect(src).not.toContain('diagnosis.reasons.join("；")');
    expect(src).toContain("diagnosis.reasons,");
    // 快照形状里 reasons 是数组
    expect(src).toMatch(/reasons\?: string\[\]/);
  });

  it("渲染层不再自己拼那一行（真机那行的拼法不许回来）", () => {
    // 剥注释再扫：注释里可以引用旧文案当证据，代码里不许再有那个拼法。
    const chrome = repoFile("../src/renderer/state/chrome.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => {
        const at = line.indexOf("//");
        return at < 0 ? line : line.slice(0, at);
      })
      .join("\n");
    expect(chrome).not.toContain("预览失败（");
    expect(chrome).not.toContain("——");
    expect(chrome).toContain("previewFailureError(snapshot)");
  });
});

describe("错误条：结构化载荷分行渲染", () => {
  const strip = (message: Parameters<typeof ErrorStrip>[0]["message"]): string =>
    renderToStaticMarkup(<ErrorStrip message={message} onDismiss={() => undefined} />);

  it("标题 / 原因 / 依据 / 下一步各占一行，依据逐条列", () => {
    const html = strip(previewFailureError(failed()));
    expect(html).toContain("is-structured");
    expect(html).toContain(STR.preview.failedTitle);
    expect(html).toContain(STR.preview.stageSpec);
    expect(html).toContain("这个文件夹里有网页，但没有入口页 index.html");
    expect(html).toContain(STR.errorStrip.why);
    expect(html).toContain("<li>根目录的网页：pelican-bicycle.html</li>");
    expect(html).toContain(STR.errorStrip.next);
    expect(html).toContain("把主页改名成 index.html");
    // 三段不许被拍回一行
    expect(html).not.toContain("——");
  });

  it("一句话载荷照旧一行读完（多数错误还是一句话）", () => {
    const html = strip("权限档保存失败：网络不通");
    expect(html).not.toContain("is-structured");
    expect(html).toContain("权限档保存失败：网络不通");
  });
});
