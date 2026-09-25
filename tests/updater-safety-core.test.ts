// 更新面的**安全半边**判卷（第 79 页）。为什么不直接把 `tests/updater.test.ts` 捞回来：
// 那份是另一会话在飞的桌面层删除的一部分（盘上 `D`、HEAD 里还在），按既定裁决那笔由原作者自己提交，
// 我不替他们恢复文件。而 `src/main/updater.ts` 仍留在树上、被 `settings-handlers.ts` / `ipc-protocol.ts` 引用，
// 它自己第 51 行注释声明的两个观察者（headless 单测 + `commercial-check`）**在工作树里都不存在了**
// ⇒ 一条 https-only 的 SSRF 闸、一条 openExternal 协议白名单、一个 1MB 响应帽，此刻零观测者。
// 这里只补"安全半边"那几条（不与旧文件重叠的完整态矩阵），旧文件若回来，本文件按第 79 页的撤登记条件删。
import { describe, expect, it } from "vitest";

import { checkUpdate, compareSemver, isSafeExternalUrl } from "../src/main/updater";

/** 记录调用次数的 fetch 桩：拒绝必须发生在**网络之前**，所以"没被调用"才是要断言的那件事。 */
function countingFetch(): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  return { calls, impl: (async (input: unknown) => { calls.push(String(input)); return new Response("{}", { status: 200 }); }) as typeof fetch };
}

describe("更新面：网络之前的协议闸（D5）", () => {
  it("非 https 的 manifest 源一律 error，且一次都不碰网络", async () => {
    for (const url of ["http://e.example/m.json", "file:///etc/passwd", "javascript:alert(1)", "ftp://e/m.json", "//e/m.json"]) {
      const f = countingFetch();
      const r = await checkUpdate({ manifestUrl: url, currentVersion: "0.0.1", fetchImpl: f.impl });
      expect(r.state, url).toBe("error");
      expect(f.calls, `协议被拒却还是发了请求：${url}`).toEqual([]);
    }
  });

  it("非法 URL 与「未配置」是两个态，不许都读成 error 或都读成 unconfigured", async () => {
    expect(await checkUpdate({ manifestUrl: "  ", currentVersion: "0.0.1" })).toEqual({ state: "unconfigured" });
    const bad = await checkUpdate({ manifestUrl: "not a url at all", currentVersion: "0.0.1", fetchImpl: countingFetch().impl });
    expect(bad.state).toBe("error");
    if (bad.state === "error") expect(bad.message).toContain("非法");
  });

  it("报错要说清被拒的协议是什么（只说「必须 https」会让人去改对端而不是改配置）", async () => {
    const r = await checkUpdate({ manifestUrl: "http://e.example/m.json", currentVersion: "0.0.1", fetchImpl: countingFetch().impl });
    expect(r.state).toBe("error");
    if (r.state === "error") {
      expect(r.message).toContain("https");
      expect(r.message).toContain("http:");
    }
  });
});

describe("更新面：下载页白名单（防 manifest 注入 openExternal）", () => {
  it("只放 http(s)；file/自定义协议/相对串/空串全拒", () => {
    expect(isSafeExternalUrl("https://e.example/dmg")).toBe(true);
    expect(isSafeExternalUrl("http://e.example/dmg")).toBe(true);
    expect(isSafeExternalUrl("HTTPS://E.example/dmg")).toBe(true); // 协议大小写由 URL 归一，别反过来判死
    for (const bad of ["file:///Applications/X.app", "vscode://x", "cursor://x", "javascript:alert(1)", "/relative/path", "", "   "]) {
      expect(isSafeExternalUrl(bad), bad).toBe(false);
    }
  });
});

describe("更新面：版本方向与响应帽", () => {
  it("同版与旧版都判 up-to-date（把旧版报成「有新版」会让人反复下载更旧的包）", async () => {
    const mk = (manifestVersion: string): typeof fetch =>
      ((async () => new Response(JSON.stringify({ version: manifestVersion, url: "https://e/d" }), { status: 200 }))) as typeof fetch;
    for (const v of ["1.2.3", "1.2.2"]) {
      const r = await checkUpdate({ manifestUrl: "https://e/m.json", currentVersion: "1.2.3", fetchImpl: mk(v) });
      expect(r.state, "manifest " + v).toBe("up-to-date");
    }
    expect(await checkUpdate({ manifestUrl: "https://e/m.json", currentVersion: "1.2.3", fetchImpl: mk("1.2.10") })).toMatchObject({ state: "available", version: "1.2.10" });
  });

  it("semver 逐段数值比较：1.10.0 大于 1.9.0（字典序会反）", () => {
    expect(compareSemver("1.10.0", "1.9.0")).toBe(1);
    expect(compareSemver("0.0.10", "0.0.9")).toBe(1);
    expect(compareSemver("1.2", "1.2.0")).toBeNull();
  });

  it("声明的 Content-Length 超帽 ⇒ 报「上限」且不落进「不是合法 JSON」那一支", async () => {
    const big = {
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === "content-length" ? String(2 * 1024 * 1024) : null) },
      body: undefined,
      text: async () => "{}",
    } as unknown as Response;
    const r = await checkUpdate({
      manifestUrl: "https://e/m.json", currentVersion: "0.0.1",
      fetchImpl: ((async () => big) as typeof fetch),
    });
    expect(r.state).toBe("error");
    if (r.state === "error") expect(r.message).toMatch(/上限/);
  });
});
