// M4b 任务 2：license V1（离线 Ed25519）单测——验签矩阵（有效/篡改/过期/缺失/坏 JSON/未知字段/错公钥）
// + canonical body 稳定 + 内置公钥常量结构合法。测试自带密钥对（零文件依赖）；样例 license 由
// .tmp 私钥签发（不入 git），验签逻辑同一实现。
import { generateKeyPairSync, createPublicKey } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LICENSE_PUBLIC_KEY,
  isBuiltinPublicKeyUsable,
  licenseBodyOf,
  signLicense,
  verifyLicense,
  verifyLicenseFile,
} from "../src/main/license";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUBLIC_KEY_B64 = (publicKey.export({ format: "der", type: "spki" }) as Buffer).toString("base64");
const PRIVATE_KEY_PEM = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "m4b-license-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function signedLicense(licensee: string, expiresAt: string | null): { licensee: string; expires_at?: string; signature: string } {
  const body = licenseBodyOf({ licensee, expires_at: expiresAt });
  const signature = signLicense(body, PRIVATE_KEY_PEM);
  return { licensee, ...(expiresAt !== null ? { expires_at: expiresAt } : {}), signature };
}

describe("license V1（Ed25519 离线验签）", () => {
  it("内置公钥常量是合法 base64 Ed25519 SPKI（结构断言：坏常量会让所有验签失效）", () => {
    expect(isBuiltinPublicKeyUsable()).toBe(true);
    const key = createPublicKey({ key: Buffer.from(LICENSE_PUBLIC_KEY, "base64"), format: "der", type: "spki" });
    expect(key.asymmetricKeyType).toBe("ed25519");
    expect(isBuiltinPublicKeyUsable("not-base64!!!")).toBe(false);
  });

  it("licenseBodyOf 是 canonical（字段序固定 + 缺省 expires_at 归一 null）——签发与验签共用", () => {
    expect(licenseBodyOf({ licensee: "a", expires_at: undefined })).toBe('{"licensee":"a","expires_at":null}');
    expect(licenseBodyOf({ licensee: "a", expires_at: null })).toBe(licenseBodyOf({ licensee: "a", expires_at: undefined }));
    expect(licenseBodyOf({ licensee: "a", expires_at: "2027-01-01T00:00:00Z" })).toBe(
      '{"licensee":"a","expires_at":"2027-01-01T00:00:00Z"}',
    );
  });

  it("验签矩阵①：有效签名（带过期时间在未来 / 不带过期时间）→ valid", () => {
    const lic = signedLicense("客户 A", "2099-01-01T00:00:00Z");
    expect(verifyLicense(lic, { publicKey: PUBLIC_KEY_B64, now: 0 })).toEqual({
      state: "valid",
      licensee: "客户 A",
      expiresAt: "2099-01-01T00:00:00Z",
    });
    const perpetual = signedLicense("永久客户", null);
    expect(verifyLicense(perpetual, { publicKey: PUBLIC_KEY_B64 })).toEqual({
      state: "valid",
      licensee: "永久客户",
      expiresAt: null,
    });
  });

  it("验签矩阵②：篡改 body（licensee / expires_at 改任一字节）→ invalid（签名校验失败）", () => {
    const lic = signedLicense("客户 A", "2099-01-01T00:00:00Z");
    expect(verifyLicense({ ...lic, licensee: "客户 B" }, { publicKey: PUBLIC_KEY_B64 }).state).toBe("invalid");
    expect(verifyLicense({ ...lic, expires_at: "2098-01-01T00:00:00Z" }, { publicKey: PUBLIC_KEY_B64 }).state).toBe("invalid");
  });

  it("验签矩阵③：过期判定（expires_at 早于 now）→ expired；等于边界内不算过期", () => {
    const lic = signedLicense("客户 A", "2020-01-01T00:00:00Z");
    const r = verifyLicense(lic, { publicKey: PUBLIC_KEY_B64, now: Date.parse("2021-01-01T00:00:00Z") });
    expect(r).toEqual({ state: "expired", licensee: "客户 A", expiresAt: "2020-01-01T00:00:00Z" });
    // 恰好在 expires_at 时刻 = 仍有效（严格小于才过期）
    expect(verifyLicense(lic, { publicKey: PUBLIC_KEY_B64, now: Date.parse("2020-01-01T00:00:00Z") }).state).toBe("valid");
  });

  it("验签矩阵④：错公钥签发 / 签名 base64 坏 → invalid", () => {
    const other = generateKeyPairSync("ed25519");
    const otherPem = other.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const body = licenseBodyOf({ licensee: "x", expires_at: null });
    const forged = { licensee: "x", signature: signLicense(body, otherPem) };
    expect(verifyLicense(forged, { publicKey: PUBLIC_KEY_B64 }).state).toBe("invalid");
    const lic = signedLicense("y", null);
    expect(verifyLicense({ ...lic, signature: "!!!" }, { publicKey: PUBLIC_KEY_B64 }).state).toBe("invalid");
  });

  it("验签矩阵⑤：结构坏（非对象 / licensee 缺 / signature 缺 / 未知字段 / expires_at 非法）→ invalid 带原因", () => {
    expect(verifyLicense(null).state).toBe("invalid");
    expect(verifyLicense("nope").state).toBe("invalid");
    expect(verifyLicense({ signature: "abc" }).state).toBe("invalid");
    expect(verifyLicense({ licensee: "a" }).state).toBe("invalid");
    const lic = signedLicense("a", null);
    expect(verifyLicense({ ...lic, extra: 1 }).state).toBe("invalid");
    expect(verifyLicense({ licensee: "a", expires_at: "明天", signature: "abc" }).state).toBe("invalid");
  });

  it("verifyLicenseFile：无文件 = inactive（未激活不阻断）；坏 JSON = invalid；好文件走同一矩阵", async () => {
    expect(await verifyLicenseFile(join(dir, "absent.json"))).toEqual({ state: "inactive" });
    await writeFile(join(dir, "bad.json"), "{ 不是 JSON", "utf8");
    expect(await verifyLicenseFile(join(dir, "bad.json"))).toEqual({ state: "invalid", reason: "license.json 不是合法 JSON" });
    const file = join(dir, "license.json");
    await writeFile(file, JSON.stringify(signedLicense("验收用户", "2099-01-01T00:00:00Z")), "utf8");
    await expect(verifyLicenseFile(file, { publicKey: PUBLIC_KEY_B64 })).resolves.toMatchObject({ state: "valid", licensee: "验收用户" });
  });
});
