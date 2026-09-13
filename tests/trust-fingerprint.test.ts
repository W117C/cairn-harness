// H3-P5 回归（审查 E-10）：信任记录绑定内容指纹——同路径内容被替换后必须重新出信任卡；
// 旧版裸路径记录按兼容口径继续命中（显式备案的兼容边界）。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pluginFingerprint, TrustStore } from "../src/agent/plugins/trust";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

async function newPluginRoot(manifest: string): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "h3-trust-"));
  await mkdir(join(root, ".claude-plugin"), { recursive: true });
  await writeFile(join(root, ".claude-plugin", "plugin.json"), manifest, "utf8");
  return root;
}

describe("pluginFingerprint（E-10）", () => {
  it("内容不变指纹稳定；任意文件变化即指纹变化", async () => {
    const p = await newPluginRoot('{"name":"fp-test"}');
    const fp1 = await pluginFingerprint(p);
    const fp2 = await pluginFingerprint(p);
    expect(fp1).toBe(fp2);
    await writeFile(join(root, ".claude-plugin", "plugin.json"), '{"name":"fp-test","version":"2"}', "utf8");
    const fp3 = await pluginFingerprint(p);
    expect(fp3).not.toBe(fp1);
  });
});

describe("TrustStore 内容绑定（E-10）", () => {
  it("decide 写 abs@fp：同指纹命中 trusted；内容被替换（新指纹）→ pending 重新出卡", async () => {
    const p = await newPluginRoot('{"name":"swap"}');
    const fp1 = await pluginFingerprint(p);
    const store = new TempStorePath();
    await store.t.decide(p, true, fp1);
    expect(await store.t.status(p, fp1)).toBe("trusted");
    await writeFile(join(root, ".claude-plugin", "plugin.json"), '{"name":"swap","hooks":"evil.json"}', "utf8");
    const fp2 = await pluginFingerprint(p);
    expect(fp2).not.toBe(fp1);
    expect(await store.t.status(p, fp2)).toBe("pending"); // 被替换的插件必须重新过信任卡
  });

  it("旧版裸路径记录兼容命中（既有信任文件与验收预信任通道不破坏）", async () => {
    const p = await newPluginRoot('{"name":"legacy"}');
    const store = new TempStorePath();
    await store.legacySeed(p); // 直写旧版格式
    const fp = await pluginFingerprint(p);
    expect(await store.t.status(p, fp)).toBe("trusted"); // 兼容命中（文档化边界）
  });
});

/** 每用例独立 trust 文件路径。 */
class TempStorePath {
  file: string;
  t: TrustStore;
  constructor() {
    this.file = join(root, "plugin-trust.json");
    this.t = new TrustStore(this.file);
  }
  /** 兼容性锚：直写旧版裸路径记录。 */
  async legacySeed(abs: string): Promise<void> {
    await writeFile(this.file, JSON.stringify({ trusted: [abs], declined: [] }), "utf8");
    await this.t.warm();
  }
}
