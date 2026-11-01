// 更新清单生成器判卷（2026-10-30 · 第 830 页）：
// 生成侧的契约必须和 checkUpdate 消费侧一致；坏的 version/url 在发布时就被拒，不留给用户。
import { describe, expect, it } from "vitest";
import { checkUpdate } from "../src/main/updater";
import { buildUpdateManifest } from "../scripts/update-manifest";

describe("buildUpdateManifest", () => {
  it("产出 checkUpdate 可接受的 manifest（三段 semver + https + notes）", async () => {
    const built = buildUpdateManifest({ version: "0.2.0", url: "https://example.com/Cairn.dmg", notes: "  发布说明  " });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.manifest).toEqual({ version: "0.2.0", url: "https://example.com/Cairn.dmg", notes: "发布说明" });
    const checked = await checkUpdate({
      manifestUrl: "https://example.com/update.json",
      currentVersion: "0.1.0",
      fetchImpl: async () => new Response(JSON.stringify(built.manifest), { status: 200, headers: { "content-type": "application/json" } }),
    });
    expect(checked).toMatchObject({ state: "available", currentVersion: "0.1.0", version: "0.2.0" });
  });

  it("坏 version / http / 空 url 都拒绝", () => {
    expect(buildUpdateManifest({ version: "0.2", url: "https://example.com/x" }).ok).toBe(false);
    expect(buildUpdateManifest({ version: "0.2.0", url: "http://example.com/x" }).ok).toBe(false);
    expect(buildUpdateManifest({ version: "0.2.0", url: "   " }).ok).toBe(false);
    expect(buildUpdateManifest({ version: "0.2.0", url: "file:///tmp/x" }).ok).toBe(false);
  });
});
