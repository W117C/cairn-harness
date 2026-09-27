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
  type ProviderKeyBackend,
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

  it("四家真实 provider 都能存取；demo/未知 id 仍拒收", async () => {
    installProviderKeyBackend(makeFakeSafeStorage(), storePath);
    for (const provider of ["glm", "openai", "anthropic", "gemini"] as const) {
      expect(await putProviderKey(provider, `${FAKE_KEY}-${provider}`)).toEqual({ ok: true });
    }
    expect((await providerKeyStatus()).stored).toEqual(["anthropic", "gemini", "glm", "openai"]);
    expect((await putProviderKey("demo", FAKE_KEY)).ok).toBe(false);
    expect((await putProviderKey("unknown", FAKE_KEY)).ok).toBe(false);
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
    expect(validateProviderKeyStore({ version: 1, keys: { unknown: { ciphertext: "QUJD", updatedAt: "2026-09-12T00:00:00Z" } } }).ok).toBe(false);
    expect(validateProviderKeyStore({ version: 1 }).ok).toBe(false);
    expect(validateProviderKeyStore({ version: 1, keys: { glm: { ciphertext: "不是 base64!", updatedAt: "2026-09-12T00:00:00Z" } } }).ok).toBe(false);
    expect(validateProviderKeyStore({ version: 1, keys: { glm: { ciphertext: "QUJD", updatedAt: "不是时间" } } }).ok).toBe(false);
    expect(validateProviderKeyStore({ version: 1, keys: { glm: { ciphertext: "QUJD", updatedAt: "2026-09-12T00:00:00Z", leaked: "plain" } } }).ok).toBe(false);
    expect(validateProviderKeyStore("nope").ok).toBe(false);
  });

  it("env 并存（injectStoredProviderKey）：M0_API_KEY 已在 = env 优先零行为；不在 = 注入已存 key", async () => {
    // import 放用例内控制 process.env 时序；injectStoredProviderKey 已抽到 provider-key-inject
    // 轻模块（原经 agent-runner 导入：依赖链含 MCP SDK/LSP 约 20s，确定性击穿 5s 超时）。
    const { injectStoredProviderKey } = await import("../src/main/provider-key-inject");
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

  it("注入面按清单逐家注入各自的 env 名（白名单扩家那天存进去有人读）", async () => {
    const { injectStoredProviderKey } = await import("../src/main/provider-key-inject");
    const mem = new Map<string, string>([
      ["glm", "byok-probe-glm-0123456789"],
      ["anthropic", "byok-probe-anthropic-0123456789"],
    ]);
    const backend: ProviderKeyBackend = {
      name: "in-memory",
      isAvailable: () => true,
      async set(p, v) { mem.set(p, v); },
      async get(p) { return mem.get(p) ?? null; },
      async delete(p) { return mem.delete(p); },
      async storedProviders() { return [...mem.keys()]; },
    };
    const savedGlm = process.env.M0_API_KEY;
    const savedAnthropic = process.env.ANTHROPIC_API_KEY;
    setProviderKeyBackend(backend);
    try {
      delete process.env.M0_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      // 缺省 = 四家存储白名单；每家写进自己的 env，不能只激活 glm。
      expect(await injectStoredProviderKey()).toBe(true);
      expect(process.env.M0_API_KEY).toBe("byok-probe-glm-0123456789");
      expect(process.env.ANTHROPIC_API_KEY).toBe("byok-probe-anthropic-0123456789");
      // 按清单调用：每家写到自己那个 env 名（envKeyOf 决定，不是 M0_API_KEY 一把筐）
      delete process.env.M0_API_KEY;
      expect(await injectStoredProviderKey(["glm", "anthropic"])).toBe(true);
      expect(process.env.M0_API_KEY).toBe("byok-probe-glm-0123456789");
      expect(process.env.ANTHROPIC_API_KEY).toBe("byok-probe-anthropic-0123456789");
      // env 优先是**逐家**判断：glm 已在不覆盖，anthropic 撤掉后仍会注入
      process.env.M0_API_KEY = "env-path-key";
      delete process.env.ANTHROPIC_API_KEY;
      expect(await injectStoredProviderKey(["glm", "anthropic"])).toBe(true);
      expect(process.env.M0_API_KEY).toBe("env-path-key");
      expect(process.env.ANTHROPIC_API_KEY).toBe("byok-probe-anthropic-0123456789");
    } finally {
      setProviderKeyBackend(null);
      if (savedGlm === undefined) delete process.env.M0_API_KEY;
      else process.env.M0_API_KEY = savedGlm;
      if (savedAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = savedAnthropic;
    }
  });

  it("未登记 env 名映射的 provider：崩，不许静默跳过那一家", async () => {
    // 静默跳过的后果：用户以为「存了 key 就生效」，而该 provider 层其实读的是别家的变量
    const { injectStoredProviderKey } = await import("../src/main/provider-key-inject");
    const empty = new Map<string, string>();
    const backend: ProviderKeyBackend = {
      name: "in-memory-empty",
      isAvailable: () => true,
      async set(p, v) { empty.set(p, v); },
      async get(p) { return empty.get(p) ?? null; },
      async delete(p) { return empty.delete(p); },
      async storedProviders() { return [...empty.keys()]; },
    };
    setProviderKeyBackend(backend);
    try {
      await expect(injectStoredProviderKey(["no-such-provider"])).rejects.toThrow(/没有 env 名映射/);
    } finally {
      setProviderKeyBackend(null);
    }
  });
});
