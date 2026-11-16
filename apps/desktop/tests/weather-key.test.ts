// 天气源 key：加密后落盘、明文不出现、钥匙串不可用时不写明文。
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readWeatherKey, saveWeatherKey, type SafeStorageLike } from "../src/main/weather-key";

const dirs: string[] = [];
const mk = async (): Promise<string> => { const d = await mkdtemp(join(tmpdir(), "wx-key-")); dirs.push(d); return d; };
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

const fakeStorage = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  // 判据要的是「文件里看不到明文」，所以替身用 base64（真实现走钥匙串）
  encryptString: (plain) => Buffer.from(plain, "utf8").toString("base64") as unknown as Buffer,
  decryptString: (payload) => Buffer.from(String(payload), "base64").toString("utf8"),
});

describe("天气源 key 存储", () => {
  it("存进去的文件里没有明文；读回来是原值", async () => {
    const file = join(await mk(), "weather-key.bin");
    expect(saveWeatherKey({ file, safeStorage: fakeStorage() }, "k-secret-123")).toEqual({ ok: true });
    const onDisk = await readFile(file, "utf8");
    expect(onDisk).not.toContain("k-secret-123");
    expect(readWeatherKey({ file, safeStorage: fakeStorage() })).toBe("k-secret-123");
  });

  it("钥匙串不可用 ⇒ 拒存且不落文件", async () => {
    const file = join(await mk(), "weather-key.bin");
    const out = saveWeatherKey({ file, safeStorage: fakeStorage(false) }, "k");
    expect(out.ok).toBe(false);
    expect(existsSync(file)).toBe(false);
  });

  it("传空 ⇒ 删掉；读不到 ⇒ null", async () => {
    const file = join(await mk(), "weather-key.bin");
    saveWeatherKey({ file, safeStorage: fakeStorage() }, "k");
    expect(saveWeatherKey({ file, safeStorage: fakeStorage() }, null)).toEqual({ ok: true });
    expect(existsSync(file)).toBe(false);
    expect(readWeatherKey({ file, safeStorage: fakeStorage() })).toBeNull();
  });
});
