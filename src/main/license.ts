// M4b §2.2：license 校验 V1 = 离线 Ed25519（零新依赖，node:crypto）。
// 形态：<appData>/license.json = { licensee, expires_at?, signature }（signature = 对 canonical body 的
//   Ed25519 签名 base64；canonical body = JSON.stringify({licensee, expires_at: expires_at ?? null})，字段序固定）。
// 状态机四态：valid（有效）/ expired（过期）/ inactive（无文件 = 未激活）/ invalid（坏 JSON / 字段缺 / 签名坏）。
// V1 收敛（任务书 §2.2 拍板）：验证失败/缺失 = **不阻断功能**——只在设置页与关于页显示状态；
//   私钥不入仓库（.tmp 一次性工具签发测试 license），内置公钥为常量。
// 可测性：publicKey / now 可注入（缺省 = 内置公钥 + 当前时间），headless 单测与 commercial-check 零文件依赖。
import { readFile } from "node:fs/promises";
import { createPublicKey, sign as edSign, verify as edVerify } from "node:crypto";

/**
 * 内置 Ed25519 公钥（base64 DER SPKI）。私钥由发行方保管，**不入仓库**（任务书 §2.2）。
 * 测试/验收用密钥对由 .tmp/license-keygen.ts 一次性生成——该公钥即测试公钥，
 * 真实发行时由发行方私钥对应的公钥替换本常量（单点替换面）。
 */
export const LICENSE_PUBLIC_KEY =
  "MCowBQYDK2VwAyEAGvwU6C0q40n0USdohYREJAIIDu/L78DISv9Cz3RZVls=";

export type LicenseState =
  | { state: "valid"; licensee: string; expiresAt: string | null }
  | { state: "expired"; licensee: string; expiresAt: string }
  | { state: "inactive" }
  | { state: "invalid"; reason: string };

/** canonical body（签发与验签共用；字段序固定，缺省 expires_at 归一为 null）。 */
export function licenseBodyOf(lic: { licensee: string; expires_at?: string | null }): string {
  return JSON.stringify({ licensee: lic.licensee, expires_at: lic.expires_at ?? null });
}

/** 用 Ed25519 私钥（PEM）签一份 license（keygen 工具 / 测试与验收签样例用）。 */
export function signLicense(body: string, privateKeyPem: string): string {
  return edSign(null, Buffer.from(body, "utf8"), privateKeyPem).toString("base64");
}

function publicKeyObject(publicKeyB64: string): ReturnType<typeof createPublicKey> {
  return createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
}

/** 内置公钥自检（keygen 工具与门禁用它确认常量是合法 Ed25519 SPKI）。 */
export function isBuiltinPublicKeyUsable(publicKeyB64: string = LICENSE_PUBLIC_KEY): boolean {
  try {
    const key = publicKeyObject(publicKeyB64);
    return key.asymmetricKeyType === "ed25519";
  } catch {
    return false;
  }
}

function parseLicenseBody(raw: unknown): { body: string; licensee: string; expiresAt: string | null } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "license.json 不是对象" };
  const r = raw as Record<string, unknown>;
  if (typeof r.licensee !== "string" || r.licensee.trim() === "") return { error: "licensee 缺失或为空" };
  if (typeof r.signature !== "string" || r.signature.trim() === "") return { error: "signature 缺失" };
  let expiresAt: string | null = null;
  if (r.expires_at !== undefined && r.expires_at !== null) {
    if (typeof r.expires_at !== "string" || Number.isNaN(Date.parse(r.expires_at))) {
      return { error: "expires_at 非法（须为可解析的 ISO 时刻）" };
    }
    expiresAt = r.expires_at;
  }
  const unknown = Object.keys(r).filter((k) => k !== "licensee" && k !== "expires_at" && k !== "signature");
  if (unknown.length > 0) return { error: "未知字段：" + unknown.join("、") };
  return { body: licenseBodyOf({ licensee: r.licensee, expires_at: expiresAt }), licensee: r.licensee, expiresAt };
}

/** 核心验签 + 状态机（纯函数；raw = license.json 解析后的对象，或坏 JSON 时 null）。 */
export function verifyLicense(
  raw: unknown,
  opts: { publicKey?: string; now?: number } = {},
): LicenseState {
  const now = opts.now ?? Date.now();
  const pub = opts.publicKey ?? LICENSE_PUBLIC_KEY;
  const parsed = parseLicenseBody(raw);
  if ("error" in parsed) return { state: "invalid", reason: parsed.error };
  let sigOk = false;
  try {
    sigOk = edVerify(
      null,
      Buffer.from(parsed.body, "utf8"),
      publicKeyObject(pub),
      Buffer.from(raw && typeof raw === "object" ? ((raw as Record<string, unknown>).signature as string) : "", "base64"),
    );
  } catch {
    sigOk = false;
  }
  if (!sigOk) return { state: "invalid", reason: "签名校验失败（body 与 signature 不匹配或签发方不是内置公钥持有者）" };
  if (parsed.expiresAt !== null && Date.parse(parsed.expiresAt) < now) {
    return { state: "expired", licensee: parsed.licensee, expiresAt: parsed.expiresAt };
  }
  return { state: "valid", licensee: parsed.licensee, expiresAt: parsed.expiresAt };
}

/** 读 <appData>/license.json 并验签：无文件 = inactive（未激活，不阻断功能）。 */
export async function verifyLicenseFile(
  filePath: string,
  opts: { publicKey?: string; now?: number } = {},
): Promise<LicenseState> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
    if (missing) return { state: "inactive" };
    return { state: "invalid", reason: "license.json 不是合法 JSON" };
  }
  return verifyLicense(raw, opts);
}
