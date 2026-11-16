// 天气源的 key 存放：**不明文落盘**。用 Electron 的 safeStorage（钥匙串）加密后再写文件。
//
// 为什么不放 settings.json：那份文件是可读文本，key 会在备份/同步/截图里泄露。
// 不可用（无钥匙串）时：**不存**，返回明确错误——宁可让用户知道没存上，也不悄悄写明文。
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
/** 只要这三件事的接口（与 provider-keys 的用法同形；不引它的具体类型，省一层耦合）。 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(payload: Buffer): string;
}

export interface WeatherKeyDeps {
  file: string;
  safeStorage: SafeStorageLike;
}

export function saveWeatherKey(deps: WeatherKeyDeps, key: string | null): { ok: boolean; error?: string } {
  if (key === null || key.trim() === "") {
    try { if (existsSync(deps.file)) rmSync(deps.file); } catch { /* 删不掉也只是残留 */ }
    return { ok: true };
  }
  if (!deps.safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: "这台机器没有可用的钥匙串，key 不会以明文保存" };
  }
  try {
    writeFileSync(deps.file, deps.safeStorage.encryptString(key.trim()));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function readWeatherKey(deps: WeatherKeyDeps): string | null {
  try {
    if (!existsSync(deps.file)) return null;
    return deps.safeStorage.decryptString(readFileSync(deps.file));
  } catch {
    return null; // 解密失败当没有（不阻塞天气源降级）
  }
}
