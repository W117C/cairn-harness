// 许可证导入判卷（2026-10-30 · 第 805 页）：
// 安全口径是「先验签、后落盘」——签名/结构不合格绝不覆盖现有 license；有效/过期才写。
// 测试自带 Ed25519 密钥对（与 license.test 同式，零文件依赖）。
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importLicenseFile, licenseBodyOf, signLicense, verifyLicenseFile } from "../src/main/license";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUBLIC_KEY_B64 = (publicKey.export({ format: "der", type: "spki" }) as Buffer).toString("base64");
const PRIVATE_KEY_PEM = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const signedLicense = (licensee: string, expiresAt: string | null) => ({
  licensee,
  ...(expiresAt !== null ? { expires_at: expiresAt } : {}),
  signature: signLicense(licenseBodyOf({ licensee, expires_at: expiresAt }), PRIVATE_KEY_PEM),
});

let dir = "";
const target = (): string => join(dir, "license.json");
const source = (name = "incoming.json"): string => join(dir, name);

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "cairn-license-import-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("importLicenseFile", () => {
  it("有效签名：验签通过才写，写入后重新验签仍是 valid", async () => {
    await writeFile(source(), JSON.stringify(signedLicense("客户 A", "2099-01-01T00:00:00Z")), "utf8");
    const r = await importLicenseFile(source(), target(), { publicKey: PUBLIC_KEY_B64 });
    expect(r.ok).toBe(true);
    expect(r.state).toEqual({ state: "valid", licensee: "客户 A", expiresAt: "2099-01-01T00:00:00Z" });
    expect((await verifyLicenseFile(target(), { publicKey: PUBLIC_KEY_B64 })).state).toBe("valid");
  });

  it("过期签名可以导入（状态如实为 expired），不当作无效文件", async () => {
    await writeFile(source(), JSON.stringify(signedLicense("老客户", "2020-01-01T00:00:00Z")), "utf8");
    const r = await importLicenseFile(source(), target(), { publicKey: PUBLIC_KEY_B64 });
    expect(r.ok).toBe(true);
    expect(r.state.state).toBe("expired");
  });

  it("签名被篡改：拒绝导入，且**不覆盖**现有 license", async () => {
    await writeFile(target(), JSON.stringify(signedLicense("原客户", null)), "utf8");
    const before = await readFile(target(), "utf8");
    await writeFile(source(), JSON.stringify({ ...signedLicense("客户 A", null), licensee: "客户 B" }), "utf8");
    const r = await importLicenseFile(source(), target(), { publicKey: PUBLIC_KEY_B64 });
    expect(r.ok).toBe(false);
    expect(r.state.state).toBe("invalid");
    expect(await readFile(target(), "utf8")).toBe(before);
  });

  it("坏 JSON / 不是文件 / 超限 / 读不到：都拒绝且不动现有文件", async () => {
    await writeFile(target(), "existing", "utf8");
    await writeFile(source("bad.json"), "{not json", "utf8");
    expect((await importLicenseFile(source("bad.json"), target(), { publicKey: PUBLIC_KEY_B64 })).ok).toBe(false);
    expect(await readFile(target(), "utf8")).toBe("existing");

    await writeFile(source("big.json"), "x".repeat(200), "utf8");
    const oversized = await importLicenseFile(source("big.json"), target(), { publicKey: PUBLIC_KEY_B64, maxBytes: 100 });
    expect(oversized.ok).toBe(false);
    expect(oversized.error).toContain("过大");
    expect(await readFile(target(), "utf8")).toBe("existing");

    const missing = await importLicenseFile(source("nope.json"), target(), { publicKey: PUBLIC_KEY_B64 });
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain("读取许可证失败");
  });
});
