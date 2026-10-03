// M4-1：BYOK 启动注入接线的桌面端判卷。
// 勘定结论（task-1-report）：src/main/provider-keys.ts **electron-free**——safeStorage 依赖是
// 注入式 SafeStorageIo 接口（installProviderKeyBackend(io, storePath)），存储落盘走 node:fs +
// writeFileAtomic，与 electron 零耦合 ⇒ headless 直接测全链（fake safeStorage + 临时 storePath），
// 无需借道 provider-key-inject 的 providers 形参缝（那缝留给「白名单扩家」判卷，core tests 已覆盖）。
// 本文件判 desktop 侧两件事：
//   ① 全链：fake safeStorage 落盘密文 → injectStoredProviderKey → provider env 生效 + fail-closed 面
//     （safeStorage 不可用 ⇒ set 拒绝且零明文落盘——headless 未装配后端同判）；
//   ② 装配接线守卫（index.ts 源文，channels.test wired 覆盖守卫同手法）：backend 装配先于注入调用、
//     两者都在 app ready 之后（safeStorage 的平台前提，见用例内勘定注）、fire-and-forget 带拒绝留痕
//     且日志零 key 值。
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PROVIDER_KEY_NO_BACKEND_ERROR,
  installProviderKeyBackend,
  putProviderKey,
  setProviderKeyBackend,
  type SafeStorageIo,
} from "../../../src/main/provider-keys";
import { injectStoredProviderKey } from "../../../src/main/provider-key-inject";

/** AES-256-GCM 模拟 safeStorage（与 core tests/provider-keys.test.ts 同式：加解密真实不可逆）。 */
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

// 演练假 key（非 sk- 形态，零扫描命中）；走 openai 家＝独立 env 名，避开 dev 壳里可能已设的 CAIRN_API_KEY。
const FAKE_KEY = "desktop-byok-probe-openai-0123456789";
const ENV_NAME = "OPENAI_API_KEY";

let dir: string;
let storePath: string;
let savedEnv: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "m4-desktop-provider-keys-"));
  storePath = join(dir, "provider-keys.json");
  savedEnv = process.env[ENV_NAME];
  delete process.env[ENV_NAME];
});
afterEach(async () => {
  setProviderKeyBackend(null); // 后端单例复位：不把 fake 后端漏给同 worker 的其他用例
  if (savedEnv === undefined) delete process.env[ENV_NAME];
  else process.env[ENV_NAME] = savedEnv;
  await rm(dir, { recursive: true, force: true });
});

describe("BYOK 启动注入（desktop 全链，headless fake safeStorage）", () => {
  it("存 key → 密文落盘 → injectStoredProviderKey → provider env 生效；落盘零明文", async () => {
    expect(installProviderKeyBackend(makeFakeSafeStorage(), storePath)).toBe(true);
    expect(await putProviderKey("openai", FAKE_KEY)).toEqual({ ok: true });
    const raw = await readFile(storePath, "utf8");
    expect(raw.includes(FAKE_KEY)).toBe(false); // 落盘只含密文 base64，明文零落盘
    expect(await injectStoredProviderKey()).toBe(true);
    expect(process.env[ENV_NAME]).toBe(FAKE_KEY); // 进程内 env 生效：provider 层读得到
  });

  it("env 优先：该家 env 已在 ⇒ 注入零行为（不覆盖 env，返回 false）", async () => {
    installProviderKeyBackend(makeFakeSafeStorage(), storePath);
    await putProviderKey("openai", FAKE_KEY);
    process.env[ENV_NAME] = "env-path-key";
    expect(await injectStoredProviderKey()).toBe(false);
    expect(process.env[ENV_NAME]).toBe("env-path-key"); // 用户自设 env 不被存储 key 覆盖
  });

  it("fail-closed：safeStorage 不可用 ⇒ 装配拒绝 + set 拒绝不落明文（目录零文件）；未装配后端同判", async () => {
    // safeStorage 不可用（部分 Linux/headless）：installProviderKeyBackend 返回 false，后端不注入
    expect(
      installProviderKeyBackend(
        { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" },
        storePath,
      ),
    ).toBe(false);
    expect(await putProviderKey("openai", FAKE_KEY)).toEqual({ ok: false, error: PROVIDER_KEY_NO_BACKEND_ERROR });
    expect(await injectStoredProviderKey()).toBe(false); // 无后端 = 无 key 可读 = 注入空转，不炸不落
    expect(await readdir(dir)).toEqual([]); // 拒存路径零落盘（不存在半成品明文）
    // headless 完全未装配（electron 壳之外）：同一 fail-closed 面
    setProviderKeyBackend(null);
    expect(await putProviderKey("openai", FAKE_KEY).then((r) => r.ok)).toBe(false);
    expect(process.env[ENV_NAME]).toBeUndefined();
  });
});

describe("BYOK 装配接线守卫（index.ts 源文——wired 覆盖守卫同手法）", () => {
  const indexTs = readFileSync(fileURLToPath(new URL("../src/main/index.ts", import.meta.url)), "utf8");

  it("backend 装配（safeStorage→userData/provider-keys.json）与注入调用都在装配段，install 先于 inject 且在 ready 之后", () => {
    // 装配必须消费真 safeStorage（不是又一个没人调的缝——勘定发现全仓此前零调用点）
    expect(indexTs).toMatch(/import\s*\{[^}]*\bsafeStorage\b[^}]*\}\s*from\s*"electron"/);
    expect(indexTs).toMatch(/installProviderKeyBackend\(/);
    expect(indexTs).toMatch(/"provider-keys\.json"/); // 密文 store 落点钉在 userData
    expect(indexTs).toMatch(/void injectStoredProviderKey\(\)\.then\(/); // fire-and-forget 注入调用
    // 次序红线：install 先于 inject（否则注入恒读空后端）；两者都在 app.whenReady() 之后——
    // Electron 文档钉死 Windows/Linux 的 isEncryptionAvailable() 以 ready 事件为前提（未 ready 恒
    // false），顶层装配会让后端在那些平台永不注入（BYOK 静默全灭）。勘定偏差记录：brief 原文
    // 「host 创建前」按字面落位即踩此坑，装配点据此改为 ready 回调内（host 不消费 provider key，
    // 首场 run 又必晚于 renderer 加载 ⇒ 「先于一切 run」的实质约束不受影响）。
    const at = (marker: string) => indexTs.indexOf(marker);
    const readyAt = at("app.whenReady()");
    const installAt = at("installProviderKeyBackend(");
    const injectAt = at("injectStoredProviderKey(");
    expect(readyAt).toBeGreaterThan(-1);
    expect(installAt).toBeGreaterThan(readyAt);
    expect(injectAt).toBeGreaterThan(installAt);
  });

  it("注入结果留痕一行且零 key 值：成功/失败两路都有 console 出口，正文不引用 env 或 key 源", () => {
    expect(indexTs).toMatch(/console\.log\(`\[byok-inject\]/); // 成功路径：结果一行（boolean 文案，无值）
    expect(indexTs).toMatch(/console\.error\("\[byok-inject\]/); // 拒绝被吞：fire-and-forget 必须带失败留痕
    // 明文零落盘三处纪律的日志面：注入段不得把 env 值/key 串进 console（注入调用点到文件尾扫描）
    const injectSegment = indexTs.slice(indexTs.indexOf("injectStoredProviderKey("));
    expect(injectSegment).not.toMatch(/console\.\w+\([^\n]*process\.env/);
    expect(injectSegment).not.toMatch(/console\.\w+\([^\n]*getProviderKey/);
  });
});
