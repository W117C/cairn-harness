// 浏览器窗格的两道洞（2026-10-19 独立评审追出，都在真 Electron 44 上实测复现过）。
//
// ① **子框架导航不过闸**：`will-navigate` / `will-redirect` **只对主框架触发**。旧实现只挂这两个
//    ⇒ 页面里一个 `<iframe src="https://intranet.corp/">` 就能把未授权站点拉进窗格跑 JS/WebSocket，
//    而 UI 上那份"已授权站点"清单（还能逐站移除）让人以为它限定了这个窗格能到哪。
//    实测真 Electron 44：子框架跳转时 will-navigate 根本不触发；will-frame-navigate 触发
//    （带 isMainFrame）——正确的 API 就在那儿，只是没挂。
//
// ② **失败的 iframe 改写本窗格的 URL 与标题**：`did-fail-load` 对**每个**帧都触发，旧实现忽略
//    isMainFrame ⇒ 一个加载失败的第三方 iframe（被拦的广告帧、拉不到的追踪像素）把**那个 iframe 的
//    URL** 推成本窗格的 URL，标题也变成错误文案。实测：主框架 did-navigate 之后子框架失败事件才到
//    ⇒ 覆盖掉正确的 URL；渲染层 `if (key === activeKeyRef.current && s.url !== "") setUrlDraft(s.url)`
//    照单全收 ⇒ 地址栏变成用户从没打开过的 URL（可以据此点进任意外站）。
//
// 判据落在**纯函数**上（decideNavigation / hostAllowed）+ 接线面：
// 本仓无 jsdom，交互逻辑走「纯函数 + 接线见证」两面。纯函数能真跑 ⇒ 这一条不是恒真的源码断言。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decideNavigation, hostAllowed } from "../src/main/browser-host";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const src = read("../src/main/browser-host.ts");

describe("子框架导航也要过闸（decideNavigation）", () => {
  const allowed = new Set(["example.com"]);

  it("★iframe 跳未授权 host ⇒ 拦下（不是放行）", () => {
    expect(decideNavigation("https://intranet.corp/", false, allowed)).toBe("block-frame");
  });

  it("iframe 跳已授权 host ⇒ 放行", () => {
    expect(decideNavigation("https://example.com/frame", false, allowed)).toBe("allow");
  });

  it("iframe 跳本地面（localhost / 回环）⇒ 放行（与主框架同口径）", () => {
    expect(decideNavigation("http://localhost:3000/x", false, allowed)).toBe("allow");
    expect(decideNavigation("http://127.0.0.1:8080/", false, allowed)).toBe("allow");
  });

  it("主框架跳未授权 host ⇒ block-main（与子框架分开：主框架要给待批卡）", () => {
    expect(decideNavigation("https://intranet.corp/", true, allowed)).toBe("block-main");
  });

  it("非 http/https 一律不放行（file:// / javascript: 等）", () => {
    expect(hostAllowed("file:///etc/passwd", allowed)).toBe(false);
    expect(hostAllowed("javascript:alert(1)", allowed)).toBe(false);
    expect(hostAllowed("data:text/html,<script>1</script>", allowed)).toBe(false);
    expect(decideNavigation("file:///etc/passwd", false, allowed)).toBe("block-frame");
  });

  it("host 大小写不同也算同一个（授权清单按小写存）", () => {
    expect(hostAllowed("https://EXAMPLE.com/", allowed)).toBe(true);
    expect(hostAllowed("https://example.com/", new Set(["example.com"]))).toBe(true);
  });

  it("反向对照：判据不是恒真（换个 host 就换个结论）", () => {
    expect(decideNavigation("https://example.com/", false, allowed)).toBe("allow");
    expect(decideNavigation("https://elsewhere.example/", false, allowed)).toBe("block-frame");
  });
});

describe("接线：子框架闸与失败帧过滤都挂上了", () => {
  it("挂上了 will-frame-navigate（子框架导航才会进闸）", () => {
    expect(src).toContain('wc.on("will-frame-navigate"');
    expect(src).toContain("if (details.isMainFrame) return;");
    expect(src).toContain("details.preventDefault();");
  });

  it("子框架拦下时不推标题、不给待批卡（第三方 iframe 不是用户发起的导航）", () => {
    const i = src.indexOf('wc.on("will-frame-navigate"');
    const fn = src.slice(i, i + 1200);
    expect(fn).not.toContain("this.push(");
    expect(fn).toContain("console.warn(");
  });

  it("did-fail-load 只认主框架（失败的 iframe 不许改写本窗格的 URL/标题）", () => {
    expect(src).toContain("did-fail-load");
    const i = src.indexOf('wc.on("did-fail-load"');
    const fn = src.slice(i, i + 1200);
    expect(fn).toContain("if (!isMainFrame) return;");
  });

  it("授权面只有一个实现（targetAllowed 走 hostAllowed，不另抄一份）", () => {
    expect(src).toContain("return hostAllowed(raw, this.allowedHosts);");
  });
});
