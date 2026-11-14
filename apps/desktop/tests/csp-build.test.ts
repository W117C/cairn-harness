// 生产 CSP 注入（2026-10-17；2026-11-15 扩）：build-only 注入 + **壁纸协议必须放行**。
//
// 为什么不能只 grep 源码：2026-11-15 在真 Electron 里实测过——CSP 少写一个 scheme 时壁纸
// 一张图都加载不出来，而 typecheck / 单测 / 组件渲染全绿（判据全在源码文本上，没人在真引擎里
// 出过网）。所以判据改成 **import 那个真正的值**（apps/desktop/src/main/csp.ts 与 vite.config.ts
// 是同一个模块），再逐条断言「需要放行的指令里确实有这个 scheme」——改一半立刻红。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CSP_CONTENT, WALLPAPER_CSP_DIRECTIVES } from "../src/main/csp";
import { WALLPAPER_SCHEME } from "../../../src/main/wallpaper-protocol";

const cfg = readFileSync(fileURLToPath(new URL("../vite.config.ts", import.meta.url)), "utf8");
const html = readFileSync(fileURLToPath(new URL("../src/renderer/index.html", import.meta.url)), "utf8");
const directiveOf = (name: string): string =>
  CSP_CONTENT.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";

describe("生产 CSP 注入", () => {
  it('只在 build 生效（apply: "build"），index.html 本体不写死 CSP', () => {
    expect(cfg).toContain('apply: "build"');
    expect(html).not.toContain("Content-Security-Policy");
  });

  it("关键指令在场：无 eval、无 object、base/form 锁死", () => {
    expect(CSP_CONTENT).toContain("script-src 'self'");
    expect(CSP_CONTENT).not.toContain("'unsafe-eval'");
    expect(CSP_CONTENT).toContain("object-src 'none'");
    expect(CSP_CONTENT).toContain("base-uri 'none'");
    expect(CSP_CONTENT).toContain("form-action 'none'");
  });

  it("壁纸方案的 scheme 在每个需要放行它的指令里都在（漏一条＝媒体静默不出现）", () => {
    const origin = `${WALLPAPER_SCHEME}:`;
    for (const directive of WALLPAPER_CSP_DIRECTIVES) {
      const line = directiveOf(directive);
      expect(line, `CSP 里没有 ${directive} 指令`).not.toBe("");
      expect(line, `${directive} 没放行 ${origin} ⇒ 壁纸媒体会被浏览器挡掉`).toContain(origin);
    }
  });

  it("连接面不放壁纸方案：渲染层不从它 fetch，开了就是一扇多余的门", () => {
    expect(directiveOf("connect-src")).not.toContain(`${WALLPAPER_SCHEME}:`);
  });
});
