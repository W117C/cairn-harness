// M4-6：BYOK fail-closed 全链路判卷（Task 6 收口）。
// 勘定结论（task-6-report 落数）：brief 三例中例②（存入→注入→env 在场）与例③（env 优先零行为）
// 与 T1 桌面 provider-keys.test.ts 用例 1/2 逐字同语义（putProviderKey 原语层 + injectStoredProviderKey
// 双双已在），不重复建。本文件收敛为 brief 允许的「handleProviderKeySet 层 fail-closed + 注入链」
// 两例行为 + 一例接线守卫，增量各不相重叠：
//   ① fail-closed 走 handleProviderKeySet 层——IPC 通道 agent:provider-key-set 绑定的真函数
//     （index.ts wired 表），T1 只测了 putProviderKey 原语层；fake userData **全目录递归 grep**
//     断言零明文（T1 的顶层 readdir=[] 在空目录上恒真，这里预置无关文件让 grep 非空转）；
//   ② handler 层注入链：handleProviderKeySet 成功 → 密文落盘零明文 → injectStoredProviderKey →
//     对应 provider env 在场（env 名经 envKeyOf 唯一事实源解析，不手抄第二份）；
//   ③ 接线守卫（index.ts 源文，T1 手法）：M4-5「保存成功 then 即时重注」链此前零测试守卫——
//     wired providerKeySet 的 r.ok 分支必须调 reinjectSavedProviderKey，失败留痕不含 key 值。
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PROVIDER_KEY_NO_BACKEND_ERROR,
  installProviderKeyBackend,
  setProviderKeyBackend,
  type SafeStorageIo,
} from "../../../src/main/provider-keys";
import { handleProviderKeySet } from "../../../src/main/settings-handlers";
import { injectStoredProviderKey } from "../../../src/main/provider-key-inject";
import { envKeyOf } from "../../../src/providers/env-keys";

/** AES-256-GCM 模拟 safeStorage（与 T1 两面同式：加解密真实不可逆）。 */
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

// 演练假 key（非 sk- 形态，零扫描命中）；走 gemini 家＝第三家独立 env 名——core T1 用 glm/anthropic、
// 桌面 T1 用 openai，三面各占一家，同 worker 内互不踩（也避开 dev 壳可能已设的 CAIRN_API_KEY）。
const PROVIDER = "gemini";
const FAKE_KEY = "desktop-byok-e2e-gemini-0123456789";
const envName = envKeyOf(PROVIDER);
if (envName === null) throw new Error("gemini 未登记 env 名映射（env-keys.ts 唯一事实源被改坏）");
const ENV_NAME: string = envName;

let dir: string;
let storePath: string;
let savedEnv: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "m4-byok-e2e-")); // fake userData
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

describe("BYOK fail-closed 全链路（handleProviderKeySet 层，headless fake safeStorage）", () => {
  it("fail-closed：safeStorage 不可用装配拒绝 ⇒ handler set 拒绝显式错误；fake userData 全目录递归 grep 零明文", async () => {
    // 预置无关文件（electron userData 恒有 Preferences 之类杂物）：让「全目录 grep」非空转——
    // 哪怕 fail-closed 失守、半成品明文写进目录任何角落，都逃不过这条扫描。
    await writeFile(join(dir, "Preferences"), JSON.stringify({ benign: true }));
    // safeStorage 不可用（部分 Linux/headless）：装配返回 false，后端不注入——electron 壳 ready 回调里的形态
    expect(
      installProviderKeyBackend(
        { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" },
        storePath,
      ),
    ).toBe(false);
    // IPC 通道 agent:provider-key-set 绑定的真函数：拒存 + 显式错误，不抛、不静默退回明文
    expect(await handleProviderKeySet(PROVIDER, FAKE_KEY)).toEqual({ ok: false, error: PROVIDER_KEY_NO_BACKEND_ERROR });
    // headless 完全未装配（electron 壳之外）：同一 fail-closed 面
    setProviderKeyBackend(null);
    expect(await handleProviderKeySet(PROVIDER, FAKE_KEY)).toEqual({ ok: false, error: PROVIDER_KEY_NO_BACKEND_ERROR });
    // 全目录递归 grep：fake userData 里任何文件（含预置杂物）都不得出现 key 串；密文 store 也不该存在
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    expect(entries.filter((e) => e.isFile()).length).toBeGreaterThanOrEqual(1); // grep 面非空（预置文件在场）
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      expect((await readFile(join(ent.parentPath, ent.name), "utf8")).includes(FAKE_KEY)).toBe(false);
      expect(ent.name).not.toBe("provider-keys.json");
    }
    expect(process.env[ENV_NAME]).toBeUndefined(); // 拒存路径零注入
  });

  it("存入即注入（handler 层链）：set 成功 → 密文落盘零明文 → injectStoredProviderKey → 对应 provider env 在场", async () => {
    expect(installProviderKeyBackend(makeFakeSafeStorage(), storePath)).toBe(true);
    // renderer 设置页 / 首启向导走的同一入口（wired providerKeySet → handleProviderKeySet）
    expect(await handleProviderKeySet(PROVIDER, FAKE_KEY)).toEqual({ ok: true });
    // 落盘只含密文 base64：明文零落盘（handler 层全链的第一段纪律）
    expect((await readFile(storePath, "utf8")).includes(FAKE_KEY)).toBe(false);
    // 保存成功 → 即时重注语义（index.ts M4-5 链的 headless 等价步）：env 名经 envKeyOf 解析
    expect(await injectStoredProviderKey()).toBe(true);
    expect(process.env[ENV_NAME]).toBe(FAKE_KEY); // provider 层读得到
  });
});

describe("BYOK 保存后重注接线守卫（index.ts 源文——T1 装配守卫同手法）", () => {
  const indexTs = readFileSync(fileURLToPath(new URL("../src/main/index.ts", import.meta.url)), "utf8");

  it("M4-5 即时重注：wired providerKeySet 在 r.ok 分支调 reinjectSavedProviderKey（= injectStoredProviderKey 别名），失败留痕不含 key 值", () => {
    // 次序：wired 行 → handleProviderKeySet 调用 → r.ok 分支 → 重注调用（保存失败不重注，也不该重注）
    const at = (marker: string, from = 0) => indexTs.indexOf(marker, from);
    const setAt = at("providerKeySet: (provider, key) =>");
    const handleAt = at("handleProviderKeySet(", setAt);
    const okAt = at("if (r.ok)", setAt);
    const reinjectAt = at("void reinjectSavedProviderKey()", setAt);
    expect(setAt).toBeGreaterThan(-1);
    expect(handleAt).toBeGreaterThan(setAt);
    expect(okAt).toBeGreaterThan(handleAt);
    expect(reinjectAt).toBeGreaterThan(okAt);
    // 别名恒等（同出口同语义；别名缘由见 index.ts 文件头注与 task-5-report §3.1）
    expect(indexTs).toMatch(/const reinjectSavedProviderKey = injectStoredProviderKey;/);
    // 重注失败留痕（fire-and-forget 不许吞错），正文不引用 env 值 / key 源（明文零落盘的日志面纪律）
    expect(indexTs).toMatch(/console\.error\("\[byok-inject\] 保存后重注失败/);
  });
});
