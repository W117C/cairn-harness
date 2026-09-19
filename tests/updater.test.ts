// M4b 任务 3：更新检查单测——手写三段 semver 比对矩阵 + checkUpdate 全显式态
//（未配置 / 网络失败 / HTTP 非 2xx / 坏 JSON / 未知字段 / 缺 version / 缺 url / 已最新 / 有新版 notes+url 透传）
// + 下载页 URL 白名单。fetch 全 mock，零网络依赖。
import { describe, expect, it } from "vitest";
import { checkUpdate, compareSemver, isSafeExternalUrl, parseSemver } from "../src/main/updater";

function fetchOk(body: unknown): typeof fetch {
  return (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 })) as typeof fetch;
}
function fetchStatus(status: number): typeof fetch {
  return (async () => new Response("err", { status })) as typeof fetch;
}
function fetchThrows(): typeof fetch {
  return (async () => {
    throw new Error("ECONNREFUSED 模拟断网");
  }) as typeof fetch;
}

describe("更新检查 V1（手写 semver + 显式态）", () => {
  it("semver 比对矩阵（三段逐段数值比较；非法 = null）", () => {
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("1.2.4", "1.2.3")).toBe(1);
    expect(compareSemver("1.2.2", "1.2.3")).toBe(-1);
    expect(compareSemver("2.0.0", "1.99.99")).toBe(1);
    expect(compareSemver("1.10.0", "1.9.0")).toBe(1); // 数值比较，非字典序
    expect(compareSemver("0.0.10", "0.0.9")).toBe(1);
    expect(compareSemver("1.2", "1.2.3")).toBeNull();
    expect(compareSemver("1.2.3.4", "1.2.3")).toBeNull();
    expect(compareSemver("v1.2.3", "1.2.3")).toBeNull();
    expect(compareSemver("", "1.2.3")).toBeNull();
    expect(parseSemver("10.20.30")).toEqual([10, 20, 30]);
  });

  it("checkUpdate：未配置 manifest URL = 显式 unconfigured（缺省空串 / 空白串同态）", async () => {
    expect(await checkUpdate({ manifestUrl: "", currentVersion: "0.0.1" })).toEqual({ state: "unconfigured" });
    expect(await checkUpdate({ manifestUrl: "   ", currentVersion: "0.0.1" })).toEqual({ state: "unconfigured" });
  });

  it("checkUpdate：网络失败 / HTTP 非 2xx / 坏 JSON → error 显式态（绝不静默）", async () => {
    const netErr = await checkUpdate({ manifestUrl: "https://e.example/manifest.json", currentVersion: "0.0.1", fetchImpl: fetchThrows() });
    expect(netErr.state).toBe("error");
    if (netErr.state === "error") expect(netErr.message).toContain("ECONNREFUSED");
    expect(await checkUpdate({ manifestUrl: "https://e/x.json", currentVersion: "0.0.1", fetchImpl: fetchStatus(500) })).toEqual({
      state: "error",
      message: "更新源响应 HTTP 500",
    });
    const badJson = await checkUpdate({ manifestUrl: "https://e/x.json", currentVersion: "0.0.1", fetchImpl: fetchOk("not json") });
    expect(badJson.state).toBe("error");
  });

  it("checkUpdate：manifest 结构坏（未知字段 / version 非法 / 缺 url / 当前版本非法）→ error", async () => {
    const base = { manifestUrl: "https://e/x.json", currentVersion: "0.0.1" };
    expect((await checkUpdate({ ...base, fetchImpl: fetchOk({ version: "1.0.0", url: "u", extra: 1 }) })).state).toBe("error");
    expect((await checkUpdate({ ...base, fetchImpl: fetchOk({ url: "u" }) })).state).toBe("error");
    expect((await checkUpdate({ ...base, fetchImpl: fetchOk({ version: "1.0", url: "u" }) })).state).toBe("error");
    expect((await checkUpdate({ ...base, fetchImpl: fetchOk({ version: "1.0.0" }) })).state).toBe("error");
    expect((await checkUpdate({ ...base, currentVersion: "dev", fetchImpl: fetchOk({ version: "1.0.0", url: "u" }) })).state).toBe("error");
  });

  it("checkUpdate：有新版 → available（version/url/notes 透传，出卡打开下载页的载荷）", async () => {
    const r = await checkUpdate({
      manifestUrl: "https://e/x.json",
      currentVersion: "0.0.1",
      fetchImpl: fetchOk({ version: "1.2.3", url: "https://example.com/download", notes: "修复与优化" }),
    });
    expect(r).toEqual({
      state: "available",
      currentVersion: "0.0.1",
      version: "1.2.3",
      url: "https://example.com/download",
      notes: "修复与优化",
    });
  });

  it("checkUpdate：同版 / 旧版 → up-to-date（显式「已是最新」）", async () => {
    const base = { manifestUrl: "https://e/x.json", currentVersion: "1.2.3" };
    expect(await checkUpdate({ ...base, fetchImpl: fetchOk({ version: "1.2.3", url: "u" }) })).toEqual({
      state: "up-to-date",
      currentVersion: "1.2.3",
      manifestVersion: "1.2.3",
    });
    expect((await checkUpdate({ ...base, fetchImpl: fetchOk({ version: "1.2.2", url: "u" }) })).state).toBe("up-to-date");
  });

  it("下载页白名单：仅 http(s) 可 openExternal（防 manifest 注入 file:/自定义协议）", () => {
    expect(isSafeExternalUrl("https://example.com/d")).toBe(true);
    expect(isSafeExternalUrl("http://example.com/d")).toBe(true);
    expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("")).toBe(false);
    expect(isSafeExternalUrl("not a url")).toBe(false);
  });
  it("manifest URL 只允许 https（D5：放行 http/file = 借主进程做 SSRF/明文劫持）", async () => {
    // 用 fetchOk 而非真网络：变异绕过协议检查时必须走到 available，不能靠断网误伤成 error
    const r1 = await checkUpdate({
      manifestUrl: "http://e.example/m.json",
      currentVersion: "0.0.1",
      fetchImpl: fetchOk({ version: "1.0.0", url: "https://d.example" }),
    });
    expect(r1.state).toBe("error");
    if (r1.state === "error") expect(r1.message).toContain("https");
    const r2 = await checkUpdate({
      manifestUrl: "file:///etc/manifest.json",
      currentVersion: "0.0.1",
      fetchImpl: fetchOk({ version: "1.0.0", url: "https://d.example" }),
    });
    expect(r2.state).toBe("error");
  });

});

// 审查 S3（任务 4.5）：停滞守卫三处收口——
// ①真·对端挂起要给「停滞超时」而不是一律「更新源不可达」（用户据此去查 DNS/域名，真因是挂起）；
// ②慢而有进展的响应体不该被一次性窗口误杀（stallGuard.bump 存在的意义就是按进展续命）；
// ③fetch 抛错路径的 dispose：早退发生在 body 段 try/finally 之外 => 每次网络失败留一个活定时器
//   （无用户可见行为差异，属结构修复，故不为其单独造断言，理由记在 archive/progress.md）。
describe("更新检查的停滞守卫（S3 回归）", () => {
  it("对端挂起（守卫触发 abort）→ 文案给停滞超时，不再谎报「不可达」", async () => {
    const stall: typeof fetch = (_u, init) =>
      new Promise((_res, rej) => {
        const s = init?.signal;
        if (!s) return;
        if (s.aborted) rej(s.reason);
        else s.addEventListener("abort", () => rej(s.reason), { once: true });
      });
    const r = await checkUpdate({
      manifestUrl: "https://e/x.json", currentVersion: "0.0.1", fetchImpl: stall, stallTimeoutMs: 30,
    });
    expect(r.state).toBe("error");
    const msg = r.state === "error" ? r.message : "";
    expect(msg).toContain("停滞超时");
    expect(msg).not.toContain("不可达");
  }, 20_000);

  it("慢而有进展的响应体（块间隔 30ms、总时长 > 窗口 100ms）→ 不被误杀", async () => {
    const json = JSON.stringify({ version: "1.0.0", url: "https://e/d", notes: "n" });
    const parts = json.match(/.{1,12}/gu) ?? [];
    expect(parts.length).toBeGreaterThanOrEqual(4);
    let sig: AbortSignal | undefined;
    const stream = new ReadableStream<Uint8Array>({
      async pull(c) {
        if (sig?.aborted) { c.error(sig.reason); return; }
        const t = parts.shift();
        if (t === undefined) { c.close(); return; }
        await new Promise((res) => setTimeout(res, 30));
        if (sig?.aborted) { c.error(sig.reason); return; }
        c.enqueue(new TextEncoder().encode(t));
      },
    });
    const impl = ((_u: RequestInfo | URL, init?: RequestInit) => {
      sig = init?.signal ?? undefined;
      return Promise.resolve(new Response(stream, { status: 200 }));
    }) as unknown as typeof fetch;
    const r = await checkUpdate({
      manifestUrl: "https://e/x.json", currentVersion: "0.0.1", fetchImpl: impl, stallTimeoutMs: 100,
    });
    expect(r).toEqual({
      state: "available", currentVersion: "0.0.1", version: "1.0.0", url: "https://e/d", notes: "n",
    });
  }, 20_000);

  it("真断网（非守卫抛错）→ 仍给「更新源不可达」（commercial-check B3 口径不变）", async () => {
    const r = await checkUpdate({
      manifestUrl: "https://e/x.json", currentVersion: "0.0.1", fetchImpl: fetchThrows(), stallTimeoutMs: 5_000,
    });
    expect(r.state === "error" ? r.message : "").toContain("更新源不可达");
  });
});
