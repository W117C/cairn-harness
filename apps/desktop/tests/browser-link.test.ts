// 聊天链接直达侧栏浏览器（2026-11-05 业主）的判卷面：
//  ① isWebLink 只认 http(s)——mailto:/解析失败不拦，走既有默认（target=_blank → 主进程 openExternalSafe）；
//  ② 有宿主注册 → 点击转处理器（进 browser 窗格）；无宿主（独立弹出窗）→ 回落 openExternal（旧行为），
//     不产生死点击；注销后再点同回落。注册收口在常驻 WorkbenchView；弹出窗不注册——这个口径由本测钉住。
//  ③ 第 1085 页：无宿主回落失败（resolve-{ok:false} 或 reject）必须交给失败处理器，不许吞。
import { afterEach, describe, expect, it } from "vitest";
import { isWebLink, registerBrowserLinkFailureHandler, registerBrowserLinkHandler, requestBrowserOpen } from "../src/renderer/browser-link";

afterEach(() => {
  registerBrowserLinkHandler(null);
  registerBrowserLinkFailureHandler(null);
});

describe("browser-link", () => {
  it("isWebLink 只认 http(s)：mailto:/javascript:/解析失败一律不拦", () => {
    expect(isWebLink("https://example.com/x")).toBe(true);
    expect(isWebLink("http://localhost:5173/x")).toBe(true);
    expect(isWebLink("mailto:a@b.c")).toBe(false);
    expect(isWebLink("javascript:alert(1)")).toBe(false);
    expect(isWebLink("not a url")).toBe(false);
  });

  it("有宿主 → 转处理器；无宿主 → 回落 openExternal（不产生死点击）", async () => {
    const seen: string[] = [];
    registerBrowserLinkHandler((url) => seen.push(url));
    requestBrowserOpen("https://example.com/a");
    expect(seen).toEqual(["https://example.com/a"]);

    registerBrowserLinkHandler(null);
    const calls: string[] = [];
    (globalThis as { window?: unknown }).window = {
      agent: { openExternal: async (u: string) => { calls.push(u); return { ok: true }; } },
    };
    try {
      requestBrowserOpen("https://example.com/b");
      // void 的 promise：微任务里落地
      await Promise.resolve();
      expect(calls).toEqual(["https://example.com/b"]);
    } finally {
      (globalThis as { window?: unknown }).window = undefined;
    }
  });

  // 第 1085 页：无宿主（独立弹出窗）回落 openExternal 的失败不许吞——resolve-{ok:false} 与 reject
  // 都要交给错误处理器；PopoutApp 注册的处理器把它落成 .fp-note.err「链接打开失败」。
  it("无宿主回落失败要出声：resolve-{ok:false} 与 reject 都交给失败处理器", async () => {
    const failures: { url: string; error: string }[] = [];
    registerBrowserLinkFailureHandler((f) => failures.push(f));
    const popoutWindow = {
      agent: { openExternal: async (_url: string): Promise<{ ok: boolean; error?: string }> => ({ ok: false, error: "blocked by whitelist" }) },
    };
    (globalThis as { window?: unknown }).window = popoutWindow;
    try {
      requestBrowserOpen("https://example.com/blocked");
      await Promise.resolve();
      await Promise.resolve();
      expect(failures).toEqual([{ url: "https://example.com/blocked", error: "blocked by whitelist" }]);

      popoutWindow.agent.openExternal = async () => { throw new Error("no shell"); };
      requestBrowserOpen("https://example.com/throw");
      await Promise.resolve();
      await Promise.resolve();
      expect(failures[1]).toEqual({ url: "https://example.com/throw", error: "no shell" });
    } finally {
      (globalThis as { window?: unknown }).window = undefined;
    }
  });
});
