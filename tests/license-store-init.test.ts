// 判卷 · license 状态面真的接在 settings store 的**真实初始化路径**上
// （登记缺陷：产品 P1「initLicenseStore 全仓零调用点 ⇒ license 状态恒 inactive」，2026-10-22 修）
//
// 这条判卷只认**运行期行为**：走真实的 initSettingsStore → 读真实的 license.json →
// 从 agent:state 的应答面（handleAgentState）里读 license 字段。
// 「源码里调用了 initLicenseStore」不算判卷：修之前那个函数躺在文件里零调用点，grep 一眼可见，
// 而状态面恒 inactive——那只证明死代码写在那里，不证明状态面活着。
// 修之前本文件第 1/3/4 条全红（应答里只有 inactive），第 2/5 条是反向对照（不许出现假阳性）。
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleAgentState, initSettingsStore } from "../src/main/agent-runner";
import { licenseBodyOf, signLicense } from "../src/main/license";

/** 判卷自带的签发链：当场生成的一对 Ed25519 密钥（私钥只活在本次进程的内存里）。 */
function keypair(): { publicKeyB64: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyB64: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
}

/** 签一份 license.json（canonical body = licenseBodyOf，签名覆盖它）。 */
function signedLicenseFile(licensee: string, privateKeyPem: string): string {
  const signature = signLicense(licenseBodyOf({ licensee }), privateKeyPem);
  return JSON.stringify({ licensee, signature });
}

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "m4b-license-init-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("license 状态面挂在 settings store 的真实初始化路径上", () => {
  it("走真实初始化路径后，agent:state 应答里的 license 真的变成 valid（不是 inactive）", async () => {
    const { publicKeyB64, privateKeyPem } = keypair();
    await writeFile(join(dir, "license.json"), signedLicenseFile("验收用户", privateKeyPem), "utf8");
    // 真实初始化路径：桌面/headless 都是这一条（settings.json 落哪，license.json 就跟到哪）。
    initSettingsStore(join(dir, "settings.json"), { licensePublicKey: publicKeyB64 });
    const state = await handleAgentState(dir);
    expect(state.license).toEqual({ state: "valid", licensee: "验收用户", expiresAt: null });
  });

  it("反向对照：license.json 在别处 ⇒ 应答仍是 inactive（路径随 settings.json 走，不扫别处）", async () => {
    const { publicKeyB64, privateKeyPem } = keypair();
    const other = await mkdtemp(join(tmpdir(), "m4b-license-elsewhere-"));
    try {
      await writeFile(join(other, "license.json"), signedLicenseFile("别处的人", privateKeyPem), "utf8");
      initSettingsStore(join(dir, "settings.json"), { licensePublicKey: publicKeyB64 });
      const state = await handleAgentState(dir);
      expect(state.license).toEqual({ state: "inactive" });
    } finally {
      await rm(other, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("同目录的 license.json 是坏 JSON ⇒ invalid（不是 inactive）：文件真的被读了", async () => {
    await writeFile(join(dir, "license.json"), "{ 这不是 JSON", "utf8");
    initSettingsStore(join(dir, "settings.json"));
    const state = await handleAgentState(dir);
    expect(state.license?.state).toBe("invalid");
  });

  it("签名不是注入的那把公钥签的 ⇒ invalid（valid 只可能来自真验签通过）", async () => {
    const mine = keypair();
    const stranger = keypair();
    await writeFile(join(dir, "license.json"), signedLicenseFile("外人", stranger.privateKeyPem), "utf8");
    initSettingsStore(join(dir, "settings.json"), { licensePublicKey: mine.publicKeyB64 });
    const state = await handleAgentState(dir);
    expect(state.license?.state).toBe("invalid");
  });

  it("同目录没有 license.json ⇒ inactive（缺文件 = 未激活，不阻断功能）", async () => {
    initSettingsStore(join(dir, "settings.json"));
    const state = await handleAgentState(dir);
    expect(state.license).toEqual({ state: "inactive" });
  });
});
