// 插件敏感值（safeStorage）单测——此前 secrets.ts 完全无单测，仅 plugins-check
// 门禁级覆盖。本文件补：存取往返 + 明文零落盘三处扫描 + fail-closed + 解密失败
// 不回显 + 原子写（tmp→rename，崩溃不截断密文存储）+ 写失败 tmp 清理。
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
// ESM 命名空间不可 spy（Cannot redefine property），改用 mock 工厂包一层真实模块：
// SUT 与测试拿到同一个被包装的 writeFile/rename，断言走 mock.calls，行为走真实现。
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile), rename: vi.fn(actual.rename) };
});
import { mkdtemp, readFile, readdir, rename, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NO_BACKEND_ERROR,
  SECRET_PLACEHOLDER,
  getPluginSecret,
  installSafeStorageBackend,
  putPluginSecret,
  secretKey,
  setPluginSecretBackend,
  writePluginUserConfig,
  type SafeStorageIo,
} from "../src/agent/plugins/secrets";

/** 真 AES-256-GCM 模拟 safeStorage（加解密真实不可逆，覆盖「解密失败」路径）。 */
function makeFakeSafeStorage(): SafeStorageIo {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(plain: string): Buffer {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      return Buffer.concat([iv, cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
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

const SECRET = "mock-secret-0123456789abcdef0123456789abcdef"; // 演练假值（非 sk- 形态，零扫描命中）
let dir: string;
let storePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "m2g-secrets-"));
  storePath = join(dir, "plugin-secrets.json");
});
afterEach(async () => {
  setPluginSecretBackend(null);
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("插件敏感值（safeStorage）", () => {
  it("存取往返还原明文；store 文件只有 base64 密文，明文零落盘", async () => {
    expect(installSafeStorageBackend(makeFakeSafeStorage(), storePath)).toBe(true);
    await putPluginSecret("tres-finance", "apiKey", SECRET);
    expect(await getPluginSecret("tres-finance", "apiKey")).toBe(SECRET);
    // store 文件里绝无明文；secretKey 命名空间在
    const raw = await readFile(storePath, "utf8");
    expect(raw.includes(SECRET)).toBe(false);
    expect(raw.includes(secretKey("tres-finance", "apiKey"))).toBe(true);
  });

  it("fail-closed：无后端 → 拒存 + 显式错误；safeStorage 不可用 → 不装配且拒存", async () => {
    setPluginSecretBackend(null);
    await expect(putPluginSecret("p", "k", SECRET)).resolves.toEqual({ ok: false, error: NO_BACKEND_ERROR });
    const unavailable: SafeStorageIo = {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => "",
    };
    expect(installSafeStorageBackend(unavailable, storePath)).toBe(false);
    await expect(putPluginSecret("p", "k", SECRET)).resolves.toMatchObject({ ok: false });
    // 拒存不产生任何 store 文件
    await expect(stat(storePath)).rejects.toThrow();
  });

  it("解密失败（换钥匙/损坏）→ get 返回 null，不抛不回显", async () => {
    installSafeStorageBackend(makeFakeSafeStorage(), storePath);
    await putPluginSecret("p", "k", SECRET);
    // 换钥匙：新后端解不出旧密文
    installSafeStorageBackend(makeFakeSafeStorage(), storePath);
    await expect(getPluginSecret("p", "k")).resolves.toBeNull();
  });

  it("原子写：经 tmp→rename 落盘，成功后无 .tmp 残留", async () => {
    installSafeStorageBackend(makeFakeSafeStorage(), storePath);
    await putPluginSecret("p", "k", SECRET);
    // 必须走了 rename(tmp → storePath)，不能是裸 writeFile 直写终态文件
    const renames = rename.mock.calls.filter((c) => String(c[1]) === storePath);
    expect(renames.length).toBeGreaterThanOrEqual(1);
    expect(renames[0]![0]).toMatch(/\.tmp-/);
    // 落定后目录里没有残留 tmp
    const left = (await readdir(dir)).filter((f) => f.includes(".tmp-"));
    expect(left).toEqual([]);
  });

  it("写失败时 tmp 被清理，且不截断既有密文存储", async () => {
    installSafeStorageBackend(makeFakeSafeStorage(), storePath);
    await putPluginSecret("p", "k", SECRET);
    const before = await readFile(storePath, "utf8");
    // 模拟写中途失败：writeFile 对 tmp 路径抛一次
    writeFile.mockImplementation(async (p) => {
      if (String(p).includes(".tmp-")) throw new Error("模拟磁盘满");
      return await writeFile(p, "", "utf8");
    });
    await expect(putPluginSecret("p", "k2", SECRET)).rejects.toThrow("模拟磁盘满");
    writeFile.mockReset();
    const left = (await readdir(dir)).filter((f) => f.includes(".tmp-"));
    expect(left).toEqual([]); // 失败分支也清理 tmp
    expect(await readFile(storePath, "utf8")).toBe(before); // 旧密文存储未被截断
  });

  it("writePluginUserConfig：敏感字段进 safeStorage（占位符），任一存不进则不写半成品", async () => {
    // 无后端：敏感字段必失败 → 整体失败，不产生配置文件
    setPluginSecretBackend(null);
    const r = await writePluginUserConfig({
      plugin: "tres-finance",
      fields: [{ key: "apiKey", label: "API Key", sensitive: true }],
      values: { apiKey: SECRET },
      dir,
    });
    expect(r.ok).toBe(false);
    expect(r.plaintextKeys).toEqual([]);
    await expect(stat(join(dir, "plugin-userconfig.json"))).rejects.toThrow();
  });

  it("writePluginUserConfig：非敏感明文落盘 + 敏感只留占位符，扫描无明文", async () => {
    installSafeStorageBackend(makeFakeSafeStorage(), storePath);
    const r = await writePluginUserConfig({
      plugin: "tres-finance",
      fields: [
        { key: "apiKey", label: "API Key", sensitive: true },
        { key: "baseUrl", label: "Base URL", sensitive: false },
      ],
      values: { apiKey: SECRET, baseUrl: "https://example.test" },
      dir,
    });
    expect(r.ok).toBe(true);
    expect(r.secretKeys).toEqual(["apiKey"]);
    expect(r.plaintextKeys).toEqual(["baseUrl"]);
    const cfg = await readFile(join(dir, "plugin-userconfig.json"), "utf8");
    expect(cfg.includes(SECRET)).toBe(false);
    expect(cfg.includes(SECRET_PLACEHOLDER)).toBe(true);
    expect(cfg.includes("https://example.test")).toBe(true);
  });
});
