// M4b 任务 1：provider key 入 safeStorage 单测——存取往返（mock 后端）/ fail-closed（无后端拒存 + 明文零落盘
// 三处扫描）/ 解密失败 → null / 删除 / schema 严格校验 / env 并存（injectStoredProviderKey：env 优先）。
import { generateKeyPairSync, privateDecrypt, publicEncrypt, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PROVIDER_KEY_NO_BACKEND_ERROR,
  installProviderKeyBackend,
  putProviderKey,
  getProviderKey,
  deleteProviderKey,
  providerKeyStatus,
  validateProviderKeyStore,
  setProviderKeyBackend,
  type SafeStorageIo,
} from "../src/main/provider-keys";

/** 真 AES-256-GCM 模拟 safeStorage（加解密真实不可逆，能覆盖「解密失败」路径；测试密钥内存生成）。 */
function makeFakeSafeStorage(): SafeStorageIo {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(plain: string): Buffer {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
      return Buffer.concat([iv, enc]);
    },
    decryptString(payload: Buffer): string {
      const iv = payload.subarray(0, 12);
      const tag = payload.subarray(payload.length - 16);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(payload.subarray(12, payload.length - 16)), decipher.final()]).toString("utf8");
    },
  };
}

const FAKE_KEY = "mock-key-0123456789abcdef0123456789abcdef"; // 演练假 key（非 sk- 形态，零扫描命中）

let dir: string;
let storePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "m4b-provider-keys-"));
  storePath = join(dir, "provider-keys.json");
});
afterEach(async () => {
  setProviderKeyBackend(null);
  await rm(dir, { recursive: true, force: true });
});

describe("provider key（safeStorage，明文零落盘）", () => {
  it("存取往返：save → get 还原明文；storedProviders 只返回 provider 清单（零值）", async () => {
    const io = makeFakeSafeStorage();
    expect(installProviderKeyBackend(io, storePath)).toBe(true);
    expect(await putProviderKey("glm", FAKE_KEY)).toEqual({ ok: true });
    expect(await getProviderKey("glm")).toBe(FAKE_KEY);
    expect(await providerKeyStatus()).toEqual({ available: true, stored: ["glm"] });
  });

  it("fail-closed：无后端（safeStorage 不可用）→ 拒存 + 显式错误；任何路径不产生 store 文件", async () => {
    expect(installProviderKeyBackend({ isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" }, storePath)).toBe(false);
    setProviderKeyBackend(null);
    const r = await putProviderKey("glm", FAKE_KEY);
    expect(r).toEqual({ ok: false, error: PROVIDER_KEY_NO_BACKEND_ERROR });
    expect(await getProviderKey("glm")).toBeNull();
    expect(await providerKeyStatus()).toEqual({ available: false, stored: [] });
    // 拒存后目录里不出现任何含明文的文件（fail-closed 不写半成品）
    expect(await readdir(dir)).toEqual([]);
  });

  it("明文零落盘：落盘文件只含密文 base64，扫不到明文 key；删 key 后明文消失", async () => {
    installProviderKeyBackend(makeFakeSafeStorage(), storePath);
    await putProviderKey("glm", FAKE_KEY);
    const raw = await readFile(storePath, "utf8");
    expect(raw.includes(FAKE_KEY)).toBe(false); // 落盘处零明文
    const parsed = JSON.parse(raw) as unknown;
    const v = validateProviderKeyStore(parsed);
    expect(v.ok).toBe(true);
    if (v.ok) {
      const entries = Object.values(v.value.keys);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.ciphertext).not.toContain(FAKE_KEY);
      expect(entries[0]!.updatedAt).not.toBe("");
    }
    expect((await deleteProviderKey("glm")).ok).toBe(true);
    expect(await getProviderKey("glm")).toBeNull();
    expect((await deleteProviderKey("glm")).ok).toBe(false);
  });

  it("解密失败（换机器/换钥匙）→ get 返回 null，不抛不回显", async () => {
    installProviderKeyBackend(makeFakeSafeStorage(), storePath);
    await putProviderKey("glm", FAKE_KEY);
    // 重新装配 = 新密钥（模拟换机器）
    installProviderKeyBackend(makeFakeSafeStorage(), storePath);
    expect(await getProviderKey("glm")).toBeNull();
  });

  it("参数面：空 key 拒存 / 未知 provider 拒存（白名单）", async () => {
    installProviderKeyBackend(makeFakeSafeStorage(), storePath);
    expect((await putProviderKey("glm", "   ")).ok).toBe(false);
    expect((await putProviderKey("nope", FAKE_KEY)).ok).toBe(false);
    expect(await getProviderKey("nope")).toBeNull();
  });

  it("schema 校验：version 非 1 / 未知顶层字段 / 非法 ciphertext / 坏 updatedAt / 嵌套未知字段 全拒", () => {
    expect(validateProviderKeyStore({ version: 1, keys: {} }).ok).toBe(true);
    expect(validateProviderKeyStore({ version: 2, keys: {} }).ok).toBe(false);
    expect(validateProviderKeyStore({ version: 1, keys: {}, extra: 1 }).ok).toBe(false);
    expect(validateProviderKeyStore({ version: 1 }).ok).toBe(false);
    expect(validateProviderKeyStore({ version: 1, keys: { glm: { ciphertext: "不是 base64!", updatedAt: "2026-09-12T00:00:00Z" } } }).ok).toBe(false);
    expect(validateProviderKeyStore({ version: 1, keys: { glm: { ciphertext: "QUJD", updatedAt: "不是时间" } } }).ok).toBe(false);
    expect(validateProviderKeyStore({ version: 1, keys: { glm: { ciphertext: "QUJD", updatedAt: "2026-09-12T00:00:00Z", leaked: "plain" } } }).ok).toBe(false);
    expect(validateProviderKeyStore("nope").ok).toBe(false);
  });

  it("env 并存（injectStoredProviderKey）：M0_API_KEY 已在 = env 优先零行为；不在 = 注入已存 key", async () => {
    // import 放用例内：agent-runner 导入面大，且要控制 process.env 时序
    const { injectStoredProviderKey } = await import("../src/main/agent-runner");
    const saved = process.env.M0_API_KEY;
    try {
      delete process.env.M0_API_KEY;
      installProviderKeyBackend(makeFakeSafeStorage(), storePath);
      // 未存 key → 不注入
      expect(await injectStoredProviderKey()).toBe(false);
      expect(process.env.M0_API_KEY).toBeUndefined();
      await putProviderKey("glm", FAKE_KEY);
      // 存了 key 且 env 空 → 注入（进程内，不落日志/事件流）
      expect(await injectStoredProviderKey()).toBe(true);
      expect(process.env.M0_API_KEY).toBe(FAKE_KEY);
      delete process.env.M0_API_KEY;
      // env 已在 → env 优先，零行为（不覆盖 env）
      process.env.M0_API_KEY = "env-path-key";
      expect(await injectStoredProviderKey()).toBe(false);
      expect(process.env.M0_API_KEY).toBe("env-path-key");
    } finally {
      if (saved === undefined) delete process.env.M0_API_KEY;
      else process.env.M0_API_KEY = saved;
    }
  });

  it("RSA 混合样例：非对称形态密文也不落明文（provider 密文路径与对称等价）", async () => {
    // 交叉验证：safeStorage 底层是平台非对称加密——用 RSA 模拟一遍往返，确保 backend 只依赖 IO 接口
    const { publicKey: rsaPub, privateKey: rsaPriv } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const rsaIo: SafeStorageIo = {
      isEncryptionAvailable: () => true,
      encryptString: (plain: string) => publicEncrypt(rsaPub, Buffer.from(plain, "utf8")),
      decryptString: (payload: Buffer) => privateDecrypt(rsaPriv, payload).toString("utf8"),
    };
    installProviderKeyBackend(rsaIo, storePath);
    await putProviderKey("glm", FAKE_KEY);
    expect(await getProviderKey("glm")).toBe(FAKE_KEY);
    expect((await readFile(storePath, "utf8")).includes(FAKE_KEY)).toBe(false);
  });
});
