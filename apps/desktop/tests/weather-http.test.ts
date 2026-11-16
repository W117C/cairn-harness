// 联网天气源判卷：用**本机真 HTTP 服务**跑，不打外网；失败一律回落不抛。
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { fetchWeather } from "../src/main/weather-http";

let server: Server | null = null;
const listen = async (handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void): Promise<string> => {
  server = createServer(handler);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => { r(); }));
  const addr = server!.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  return `http://127.0.0.1:${port}/weather`;
};

afterEach(async () => {
  if (server !== null) { await new Promise<void>((r) => server!.close(() => { r(); })); server = null; }
});

describe("联网天气源", () => {
  it("OpenWeather 载荷 ⇒ 解析出四档；key 只走请求头", async () => {
    let seenKey: string | undefined;
    const url = await listen((req, res) => {
      seenKey = req.headers["x-api-key"] as string | undefined;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ weather: [{ id: 500 }] }));
    });
    const out = await fetchWeather({ url, apiKey: "k-123" });
    expect(out).toMatchObject({ kind: "rain", reason: "ok", status: 200 });
    expect(seenKey).toBe("k-123");
  });

  it("非 2xx / 载荷读不懂 ⇒ kind null 且有理由（不抛）", async () => {
    const bad = await listen((_req, res) => { res.statusCode = 503; res.end("nope"); });
    expect(await fetchWeather({ url: bad })).toMatchObject({ kind: null });
    const weird = await listen((_req, res) => { res.end(JSON.stringify({ hello: 1 })); });
    expect(await fetchWeather({ url: weird })).toMatchObject({ kind: null, reason: "载荷读不懂" });
  });

  it("URL 校验：非 http(s) 拒；key 放 URL 里也拒", async () => {
    expect(await fetchWeather({ url: "file:///etc/passwd" })).toMatchObject({ kind: null, reason: "URL 必须是 http(s)" });
    expect(await fetchWeather({ url: "https://x.example/w?appid=secret" })).toMatchObject({ kind: null });
  });

  it("超时 ⇒ 理由写「超时」", async () => {
    const slow = await listen((_req, res) => { setTimeout(() => { res.end("{}"); }, 500); });
    const out = await fetchWeather({ url: slow, timeoutMs: 80 });
    expect(out).toMatchObject({ kind: null, reason: "超时" });
  });
});
