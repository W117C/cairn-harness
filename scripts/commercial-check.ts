// M4b 第 22 道门：commercial-check（A license 验签矩阵 / B 更新检查矩阵 / C provider key 安全往返
// 与 fail-closed / D 引导七组覆盖 + settings 状态机 / E Provider 管理设置面 schema）。
// 全程可注入（keypair 内存生成 / fetchImpl 替身 / mock SafeStorageIo / 临时目录），零网络零文件残留。
// 用法：pnpm commercial-check（TERM=dumb）；失败退出码非 0。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import {
  LICENSE_PUBLIC_KEY,
  licenseBodyOf,
  signLicense,
  verifyLicense,
  verifyLicenseFile,
} from "../src/main/license";
import { checkUpdate, compareSemver, isSafeExternalUrl, parseSemver } from "../src/main/updater";
import {
  PROVIDER_KEY_NO_BACKEND_ERROR,
  installProviderKeyBackend,
  providerKeyBackend,
  setProviderKeyBackend,
} from "../src/main/provider-keys";
import { DEFAULT_SETTINGS, SettingsStore, validateSettings } from "../src/main/settings";
import { ONBOARDING_GROUPS } from "../src/main/onboarding-groups";
import { wizardReachability, wizardUnverifiedNote, type SourceFile } from "./lib/commercial-reachability";

let pass = 0;
let fail = 0;
/** 断言没跑到 / 被测行为在产品侧无处可达 —— 显式列出，绝不等于通过。 */
const unverified: string[] = [];
function check(cond: boolean, name: string, detail?: string): void {
  if (cond) {
    pass++;
    console.log("  ✅ " + name);
  } else {
    fail++;
    console.log("  ❌ " + name + (detail ? "（" + detail + "）" : ""));
  }
}

const work = await mkdtemp(join(tmpdir(), "m4b-commercial-"));

// ---- A license 验签矩阵（§2.2：离线 Ed25519；验签失败/缺失不阻断功能，只显状态）----
console.log("[commercial-check] A license 验签矩阵");
{
  const kp = generateKeyPairSync("ed25519");
  const privPem = kp.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const pubB64 = kp.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const body = licenseBodyOf({ licensee: "验收用户", expires_at: "2099-01-01T00:00:00.000Z" });
  const sig = signLicense(body, privPem);
  const lic = { licensee: "验收用户", expires_at: "2099-01-01T00:00:00.000Z", signature: sig };
  const v = verifyLicense(lic, { publicKey: pubB64 });
  check(v.state === "valid" && v.licensee === "验收用户", "A1 有效签名（含未来过期时间）→ valid");
  const noExp = verifyLicense({ licensee: "永久", signature: signLicense(licenseBodyOf({ licensee: "永久" }), privPem) }, { publicKey: pubB64 });
  check(noExp.state === "valid", "A1b 不带过期时间（canonical null 归一）→ valid");
  const tampered = { ...lic, licensee: "攻击者" };
  check(verifyLicense(tampered, { publicKey: pubB64 }).state === "invalid", "A2 篡改 body 任一字节 → invalid");
  check(verifyLicense(lic).state === "invalid", "A3 错公钥（内置公钥验非其签发）→ invalid", JSON.stringify(verifyLicense(lic)).slice(0, 60));
  check(verifyLicense({ ...lic, signature: "!!!not-base64!!!" }, { publicKey: pubB64 }).state === "invalid", "A4 签名 base64 坏 → invalid");
  const past = verifyLicense({ licensee: "过期户", expires_at: "2020-01-01T00:00:00.000Z", signature: signLicense(licenseBodyOf({ licensee: "过期户", expires_at: "2020-01-01T00:00:00.000Z" }), privPem) }, { publicKey: pubB64 });
  check(past.state === "expired", "A5 过期判定 → expired（不阻断但显状态）");
  check(verifyLicense("not-an-object", { publicKey: pubB64 }).state === "invalid", "A6 结构坏（非对象）→ invalid");
  check(verifyLicense({ licensee: "缺签名" }, { publicKey: pubB64 }).state === "invalid", "A6b 缺 signature → invalid");
  check(typeof LICENSE_PUBLIC_KEY === "string" && LICENSE_PUBLIC_KEY.length > 40, "A7 内置公钥常量在场（发行方验签锚）");
  const licPath = join(work, "license.json");
  check((await verifyLicenseFile(join(work, "absent.json"))).state === "inactive", "A8 无文件 = inactive（未激活不阻断）");
  await writeFile(licPath, "{broken", "utf8");
  check((await verifyLicenseFile(licPath)).state === "invalid", "A8b 坏 JSON = invalid（显式原因）");
  await writeFile(licPath, JSON.stringify(lic), "utf8");
  check((await verifyLicenseFile(licPath, { publicKey: pubB64 })).state === "valid", "A8c 文件路径全链路 → valid");
}

// ---- B 更新检查矩阵（§2.3：轻量检查；未配置/失败绝不静默；下载页 http(s) 白名单）----
console.log("[commercial-check] B 更新检查矩阵");
{
  check(compareSemver("1.2.3", "1.2.3") === 0 && compareSemver("1.10.0", "1.9.9") === 1 && compareSemver("0.9.9", "1.0.0") === -1, "B1 semver 三段数值比较");
  check(parseSemver("1.2") === null && parseSemver("a.b.c") === null, "B1b 非三段 semver = null");
  const unconfig = await checkUpdate({ manifestUrl: "", currentVersion: "1.0.0" });
  check(unconfig.state === "unconfigured", "B2 未配置更新源 = 显式 unconfigured（缺省零行为）");
  const err = await checkUpdate({ manifestUrl: "https://e/x.json", currentVersion: "1.0.0", fetchImpl: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch });
  check(err.state === "error" && (err.message ?? "").includes("更新源不可达"), "B3 网络失败 → 显式 error");
  const httpErr = await checkUpdate({ manifestUrl: "https://e/x.json", currentVersion: "1.0.0", fetchImpl: (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch });
  check(httpErr.state === "error" && (httpErr.message ?? "").includes("500"), "B3b HTTP 非 2xx → 显式 error");
  const okFetch = (body: unknown): typeof fetch =>
    (async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body) })) as unknown as typeof fetch;
  const bad = await checkUpdate({ manifestUrl: "https://e/x.json", currentVersion: "1.0.0", fetchImpl: okFetch({ version: 42, url: "https://e" }) });
  check(bad.state === "error" && (bad.message ?? "").includes("semver"), "B4 manifest 结构坏（version 非法）→ error");
  const unknownField = await checkUpdate({ manifestUrl: "https://e/x.json", currentVersion: "1.0.0", fetchImpl: okFetch({ version: "2.0.0", url: "https://e/dmg", extra: 1 }) });
  check(unknownField.state === "error" && (unknownField.message ?? "").includes("未知字段"), "B4b manifest 未知字段拒绝（注入面收窄）");
  const avail = await checkUpdate({ manifestUrl: "https://e/x.json", currentVersion: "1.0.0", fetchImpl: okFetch({ version: "2.0.0", url: "https://e/d", notes: "n" }) });
  check(avail.state === "available" && avail.version === "2.0.0" && avail.url === "https://e/d", "B5 有新版 → available（透传 url/notes 出卡）");
  const same = await checkUpdate({ manifestUrl: "https://e/x.json", currentVersion: "2.0.0", fetchImpl: okFetch({ version: "2.0.0", url: "https://e/d" }) });
  check(same.state === "up-to-date", "B5b 同版 → up-to-date");
  check(isSafeExternalUrl("https://e/d") && isSafeExternalUrl("http://e/d") && !isSafeExternalUrl("file:///etc") && !isSafeExternalUrl("javascript:alert(1)"), "B6 下载页白名单：仅 http(s)（防 manifest 注入 openExternal）");
}

// ---- C provider key 安全往返与 fail-closed（§2.1：明文零落盘；safeStorage 不可用拒存不退回明文）----
console.log("[commercial-check] C provider key 安全往返与 fail-closed");
{
  const mockIo = {
    isEncryptionAvailable: (): boolean => true,
    encryptString: (plain: string): Buffer => Buffer.from("enc:" + plain, "utf8"),
    decryptString: (payload: Buffer): string => payload.toString("utf8").replace(/^enc:/, ""),
  };
  const storePath = join(work, "provider-keys.json");
  check(installProviderKeyBackend(mockIo, storePath) === true, "C1 safeStorage 可用 → 后端装配成功");
  const b = providerKeyBackend();
  check(b !== null, "C1b 后端在场");
  await b!.set("glm", "sk-test-plaintext-0123456789");
  check((await b!.get("glm")) === "sk-test-plaintext-0123456789", "C2 存取往返还原明文");
  const raw = await readFile(storePath, "utf8");
  check(!raw.includes("sk-test-plaintext-0123456789") && raw.includes("ZW5j"), "C2b **明文零落盘**（store 文件只有密文 base64）");
  check(JSON.stringify(await b!.storedProviders()) === JSON.stringify(["glm"]), "C2c storedProviders 只返回清单（零值）");
  check((await b!.delete("glm")) === true && (await b!.get("glm")) === null, "C3 删除生效");
  const tampered = JSON.parse(await readFile(storePath, "utf8")) as { keys: Record<string, { ciphertext: string }> };
  tampered.keys["glm"] = { ciphertext: Buffer.from("garbage", "utf8").toString("base64") };
  await writeFile(storePath, JSON.stringify(tampered), "utf8");
  await b!.set("glm", "k2");
  check((await b!.get("glm")) === "k2", "C3b 损坏条目被覆盖写修复（解密失败不抛明文）");
  setProviderKeyBackend(null);
  check(providerKeyBackend() === null, "C4 无后端 = fail-closed 前提");
  const noBackend = installProviderKeyBackend({ ...mockIo, isEncryptionAvailable: (): boolean => false }, join(work, "pk2.json"));
  check(noBackend === false && providerKeyBackend() === null, "C4b safeStorage 不可用 → 装配失败（不静默退回明文）");
  check(PROVIDER_KEY_NO_BACKEND_ERROR.length > 0, "C4c 无后端错误文案常量在场（headless 拒存路径）");
}

// ---- D 引导七组覆盖 + settings 状态机（§13「走通全部设置项」）----
console.log("[commercial-check] D 引导七组覆盖 + settings 状态机");
{
  const expected = ["provider", "permission", "ui", "schedule", "memory", "telemetry", "about"] as const;
  check(JSON.stringify(ONBOARDING_GROUPS.map((g) => g.id)) === JSON.stringify([...expected]), "D1 引导组 = §13 七组（不多不少，顺序一致）");
  for (const step of [1, 2, 3, 4] as const) {
    check(ONBOARDING_GROUPS.some((g) => g.step === step), "D1b 第 " + String(step) + " 步有组");
  }
  check(ONBOARDING_GROUPS.every((g) => g.label.length > 0 && g.entry.length > 0), "D1c 每组 label/entry 非空");
  check(DEFAULT_SETTINGS.onboarded === false && DEFAULT_SETTINGS.telemetry === false && DEFAULT_SETTINGS.updateManifestUrl === "", "D2 缺省：未引导 + 遥测关 + 更新源未配置（三者皆零行为缺省）");
  const store = new SettingsStore(join(work, "settings.json"));
  check((await store.get()).onboarded === false, "D2b onboarded 缺省 false（存储面；「首启必弹」另计，见 D2e）");
  await store.set({ onboarded: true });
  check((await new SettingsStore(join(work, "settings.json")).get()).onboarded === true, "D2c true 重载还原（存储面；「不再弹」需产品消费者，见 D2e）");
  // D2e：向导是否真在产品里可达。React 树归档后 `onboarding.tsx` 被删、纯数据留在这里，
  // 若 shipped 源码无人读它，则「必弹/不再弹」两句产品话无处可验——记未证而不是绿。
  const shipped: SourceFile[] = [];
  for (const rel of [
    "src/renderer/app.js", "src/renderer/index.html", "src/renderer/projections.ts",
    "src/main/index.ts", "src/main/agent-runner.ts", "src/preload/index.ts",
  ]) {
    try { shipped.push({ path: rel, text: await readFile(join(process.cwd(), rel), "utf8") }); } catch { /* 读不到 = 该面少一个消费者 */ }
  }
  const reach = wizardReachability(shipped);
  if (reach.reachable) {
    check(reach.reachable && reach.consumers.length > 0, "D2e 引导向导在产品里可达（消费者：" + reach.consumers.join("、") + "）");
  } else {
    console.log("  ⚠️  " + wizardUnverifiedNote(reach.consumers));
    unverified.push(wizardUnverifiedNote(reach.consumers));
  }
  await writeFile(join(work, "settings.json"), JSON.stringify({ onboarded: "yes" }), "utf8");
  check((await new SettingsStore(join(work, "settings.json")).get()).onboarded === false, "D2d 非法值回退 false（防「永不再现」）");
  const v = validateSettings({ updateManifestUrl: "https://e/m.json", telemetry: true, onboarded: true });
  check(v.updateManifestUrl === "https://e/m.json" && v.telemetry === true && v.onboarded === true, "D3 设置三项可配置（validateSettings 收敛）");
  check(validateSettings({ updateManifestUrl: 42 }).updateManifestUrl === "", "D3b 非法 updateManifestUrl 回退缺省空（显式未配置态）");
  check(validateSettings({ budgetPricePerMTok: 3.5 }).budgetPricePerMTok === 3.5 && validateSettings({}).budgetPricePerMTok === 0, "D3c 单价表字段（USD/百万 token；0 = 成本闸无效化）");
}

// ---- 收口 ----
await rm(work, { recursive: true, force: true });
console.log("");
// 机器可读标记（与 plugins-check 同格式）：让 pnpm gates 把未证上浮到汇总，
// 而不是本脚本里打一行警告、门禁汇总照样宣称「全部通过」。
console.log("UNVERIFIED=" + String(unverified.length));
console.log("commercial-check: " + String(pass) + " ✅ / " + String(fail) + " ❌" + (unverified.length > 0 ? " / " + String(unverified.length) + " 未证" : ""));
if (process.env.DSH_STRICT_UNVERIFIED === "1" && unverified.length > 0) {
  console.log("严格模式（DSH_STRICT_UNVERIFIED=1）：存在未证项，判红");
  process.exit(1);
}
process.exit(fail === 0 ? 0 : 1);
