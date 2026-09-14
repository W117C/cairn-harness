// H3-P5 回归（审查 E-10）：信任记录绑定内容指纹——同路径内容被替换后必须重新出信任卡；
// 旧版裸路径记录按兼容口径继续命中（显式备案的兼容边界）。
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pluginFingerprint, pluginFingerprintEx, TrustStore } from "../src/agent/plugins/trust";

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

// 审查 S1-7（修复任务书 2.1）：bounded（指纹被截断：软链/超大/超帽）必须编进条目键，
// 否则「批准 → 写下无界条目 → 下轮仍 pending」死循环，含软链的合法开发布局永久装不上。
// 信任文件放在插件树**外**（生产口径 <pluginDataRoot>/plugin-trust.json）：放进插件根会让
// 决议文件本身改变指纹，测出来的是脚手架假象。
describe("bounded 指纹的信任条目（S1-7 回归）", () => {
  let trustDir = "";
  afterEach(async () => { if (trustDir) await rm(trustDir, { recursive: true, force: true }); });
  const outsideStore = async (): Promise<TrustStore> => {
    trustDir = await mkdtemp(join(tmpdir(), "h3-trustfile-"));
    return new TrustStore(join(trustDir, "plugin-trust.json"));
  };
  const linkInto = (p: string): Promise<void> => symlink(join(p, ".claude-plugin", "plugin.json"), join(p, "alias.json"), "file");

  it("含软链插件：批准一次后仍 trusted（不死循环）", async () => {
    const p = await newPluginRoot('{"name":"link"}');
    await linkInto(p);
    const { fp, bounded } = await pluginFingerprintEx(p);
    expect(bounded).toBe(true); // 前置：样本确实是有界指纹（否则本用例什么都没测）
    const t = await outsideStore();
    expect(await t.status(p, fp, bounded)).toBe("pending");
    await t.decide(p, true, fp, bounded);
    expect(await t.status(p, fp, bounded)).toBe("trusted"); // 旧实现：这一步永远 pending
    const again = await pluginFingerprintEx(p); // 下一轮扫描：同指纹同形态，卡不再复现
    expect(again.bounded).toBe(true);
    expect(await t.status(p, again.fp, again.bounded)).toBe("trusted");
  });

  it("有界与无界条目互不通用：批准有界后去掉软链（变无界）要重新出卡", async () => {
    const p = await newPluginRoot('{"name":"shape"}');
    const link = join(p, "alias.json");
    await linkInto(p);
    const b = await pluginFingerprintEx(p);
    const t = await outsideStore();
    await t.decide(p, true, b.fp, b.bounded);
    expect(await t.status(p, b.fp, false)).toBe("pending"); // 无界查询不得复用有界批准
    await rm(link);
    const u = await pluginFingerprintEx(p);
    expect(u.bounded).toBe(false);
    expect(await t.status(p, u.fp, u.bounded)).toBe("pending"); // 形态变了 = 重新出卡
    await t.decide(p, true, u.fp, u.bounded);
    expect(await t.status(p, u.fp, u.bounded)).toBe("trusted");
    expect(await t.status(p, b.fp, true)).toBe("pending"); // 反向：有界查询也不复用无界批准
  });

  it("旧版裸路径记录只兼容无界形态（有界查询不顺带命中，E1/E2 fail-closed 不回退）", async () => {
    const p = await newPluginRoot('{"name":"legacy-b"}');
    await linkInto(p);
    const { fp, bounded } = await pluginFingerprintEx(p);
    const t = await outsideStore();
    expect(await t.status(p, fp, bounded)).toBe("pending");
    // 手工写旧版裸路径记录（无 @ 后缀），再查两种形态
    await writeFile(join(trustDir, "plugin-trust.json"), JSON.stringify({ trusted: [p], declined: [] }), "utf8");
    const t2 = new TrustStore(join(trustDir, "plugin-trust.json"));
    expect(await t2.status(p, fp, false)).toBe("trusted"); // 无界：兼容命中（文档化边界）
    expect(await t2.status(p, fp, bounded)).toBe("pending"); // 有界：绝不复用裸路径记录
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
