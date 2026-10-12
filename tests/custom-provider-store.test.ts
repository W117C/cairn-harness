// 读 `.agent/providers.json` 的三态判卷。三态本身就是要钉的东西：
// 「没配」必须与「配坏了」区分开 —— 前者零行为，后者必须出声（配了却不生效是最坏的中间态）。
// 测试数据一律 mkdtemp（仓规：测试不写工作区、不写家目录）。
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { customProvidersPath, loadCustomProviders } from "../src/main/custom-provider-store";

const dirs: string[] = [];
function workspaceWith(content?: string): string {
  const ws = mkdtempSync(join(tmpdir(), "cairn-providers-"));
  dirs.push(ws);
  if (content !== undefined) {
    mkdirSync(join(ws, ".agent"), { recursive: true });
    writeFileSync(customProvidersPath(ws), content, "utf8");
  }
  return ws;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const VALID = JSON.stringify({
  version: 1,
  providers: [
    {
      id: "deepseek",
      protocol: "openai",
      baseURL: "https://api.deepseek.com/v1",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      models: [{ id: "chat", model: "deepseek-chat" }],
    },
  ],
});

describe("loadCustomProviders：三态", () => {
  it("文件不存在 ⇒ absent（零行为，不是错误）", () => {
    const r = loadCustomProviders(workspaceWith());
    expect(r.kind).toBe("absent");
    expect(r.path).toContain(".agent/providers.json");
  });

  it("配好了 ⇒ ok，并连派生结果一起给出（含缺窗口/缺价的提醒）", () => {
    const r = loadCustomProviders(workspaceWith(VALID));
    if (r.kind !== "ok") throw new Error("期望 ok，实际 " + r.kind);
    expect(r.file.providers[0].id).toBe("deepseek");
    expect(r.derived[0].specs[0]).toEqual({
      id: "deepseek-chat",
      provider: "deepseek",
      model: "deepseek-chat",
      tier: "standard",
      ctxWindow: 128_000, // 档位表里最小的一档：缺窗口时的保守值
    });
    expect(r.derived[0].prices).toEqual({});
    // 两条提醒都要带 provider 标签，用户才知道说的是哪一家
    expect(r.warnings.some((w) => w.startsWith("deepseek：") && w.includes("contextWindow"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("price"))).toBe(true);
  });

  it("JSON 坏 ⇒ broken 且带上解析错误（不静默当成没配）", () => {
    const r = loadCustomProviders(workspaceWith("{ 这不是 JSON"));
    if (r.kind !== "broken") throw new Error("期望 broken，实际 " + r.kind);
    expect(r.message).toContain("JSON");
  });

  it("校验不过 ⇒ broken 并交出**全部**问题（用户改一次要看全）", () => {
    const bad = JSON.stringify({
      version: 2,
      providers: [
        { id: "openai", protocol: "openai", baseURL: "http://api.x.com", apiKeyEnv: "k", models: [] },
      ],
    });
    const r = loadCustomProviders(workspaceWith(bad));
    if (r.kind !== "broken") throw new Error("期望 broken，实际 " + r.kind);
    const kinds = r.problems.map((p) => p.kind);
    expect(kinds).toContain("shape"); // version
    expect(kinds).toContain("provider-id"); // 占用内置名字
    expect(kinds).toContain("insecure-endpoint"); // http
    expect(kinds).toContain("api-key-env"); // 小写不是合法变量名
    expect(kinds).toContain("model"); // models 空
    expect(r.problems.length).toBeGreaterThanOrEqual(5);
  });

  it("空 providers 数组 ⇒ ok 但没有派生结果（配了文件但还没加 provider 是合法状态）", () => {
    const r = loadCustomProviders(workspaceWith(JSON.stringify({ version: 1, providers: [] })));
    if (r.kind !== "ok") throw new Error("期望 ok，实际 " + r.kind);
    expect(r.derived).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});
