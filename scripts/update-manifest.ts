/**
 * 发布更新清单生成器（2026-10-30 · 第 830 页）。
 *
 * `checkUpdate` 只认 `{ version, url, notes? }` 且 version 必须是三段 semver、url 必须是 https。
 * 过去发布只能手抄 JSON，抄错一个字段就被更新检查判「manifest 未知字段」整条拒收。
 * 这里把契约校验放在发布侧：生成时即失败，而不是等用户点「检查更新」才失败。
 */
import { writeFileSync } from "node:fs";
import { parseSemver, type UpdateManifest } from "../src/main/updater";

export type ManifestResult = { ok: true; manifest: UpdateManifest } | { ok: false; error: string };

export function buildUpdateManifest(input: { version: string; url: string; notes?: string }): ManifestResult {
  const version = input.version.trim();
  if (parseSemver(version) === null) return { ok: false, error: `version 必须是三段 semver：${version || "(空)"}` };
  const url = input.url.trim();
  if (url === "") return { ok: false, error: "url 不能为空（下载页地址）" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: `url 非法：${url}` };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: `url 必须是 https（拒绝 ${parsed.protocol}）` };
  const notes = input.notes?.trim();
  return { ok: true, manifest: { version, url, ...(notes !== undefined && notes !== "" ? { notes } : {}) } };
}

function argValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function main(argv: string[]): number {
  const version = argValue(argv, "--version");
  const url = argValue(argv, "--url");
  const notes = argValue(argv, "--notes");
  const out = argValue(argv, "--out");
  if (version === undefined || url === undefined) {
    console.error("用法：node --import tsx scripts/update-manifest.ts --version 0.2.0 --url https://…/Cairn.dmg [--notes 文案] [--out update.json]");
    return 2;
  }
  const result = buildUpdateManifest({ version, url, ...(notes !== undefined ? { notes } : {}) });
  if (!result.ok) {
    console.error(`[update-manifest] ${result.error}`);
    return 2;
  }
  const text = JSON.stringify(result.manifest, null, 2) + "\n";
  if (out === undefined) process.stdout.write(text);
  else writeFileSync(out, text, "utf8");
  return 0;
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("update-manifest.ts")) {
  process.exitCode = main(process.argv.slice(2));
}
