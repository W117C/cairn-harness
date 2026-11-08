/**
 * 打包构建信息（2026-10-30 · 第 820 页）。
 *
 * 打包脚本在 `Cairn.app/Contents/Resources/app/build-info.json` 写一份构建凭据；关于页读它，
 * 让支持场景能一眼看到「这个包是什么时候、用什么签名构建的」，而不是只看版本号。
 * 开发态 / 旧包没有这个文件 ⇒ null，关于页不编造构建信息。
 */
import { readFileSync } from "node:fs";

export interface BuildInfo {
  version: string;
  platform: string;
  arch: string;
  sourceLockSha256: string;
  /** 打包脚本在产出前跑过真窗口冒烟才会写 passed。 */
  packagedSmoke: string;
  signature: string;
  createdAt: string;
  /** 旧包缺省；dirty=true 时 commit 仅代表工作树基线。 */
  sourceCommit?: string;
  sourceDirty?: boolean;
}

function field(raw: Record<string, unknown>, key: keyof BuildInfo): string | null {
  const v = raw[key];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** 严格形状：七个字段都必须是字符串；多/少字段不在这里判（包内文件由打包脚本写）。 */
export function parseBuildInfo(raw: unknown): BuildInfo | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const values = {
    version: field(r, "version"),
    platform: field(r, "platform"),
    arch: field(r, "arch"),
    sourceLockSha256: field(r, "sourceLockSha256"),
    packagedSmoke: field(r, "packagedSmoke"),
    signature: field(r, "signature"),
    createdAt: field(r, "createdAt"),
  };
  for (const value of Object.values(values)) if (value === null) return null;
  if ("sourceCommit" in r || "sourceDirty" in r) {
    if (typeof r.sourceCommit !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(r.sourceCommit)
      || typeof r.sourceDirty !== "boolean") return null;
    return { ...values, sourceCommit: r.sourceCommit, sourceDirty: r.sourceDirty } as BuildInfo;
  }
  return values as BuildInfo;
}

/** 读包内 build-info.json；不存在/坏 JSON = null（关于页显示「开发构建」而不是编造）。 */
export function readBuildInfoSync(file: string): BuildInfo | null {
  try {
    return parseBuildInfo(JSON.parse(readFileSync(file, "utf8")) as unknown);
  } catch {
    return null;
  }
}
