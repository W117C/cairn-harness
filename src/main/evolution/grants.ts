// SEMA Phase 2（docs/sema-proposal.md §10 立案的取料面接线）：grants —— Permission Broker
// 裁决用的授权面「从哪份配置读」在这一格落定：控制平面自管的 <root>/modules/grants.json，
// 人补授权就改这份文件（授权缺口的修法是补授权配置，不是逐次放行——broker 只给裁决，不开后门）。
//
// 口径与 fail-closed：
//  - 授权词与 manifest.permissions 同一份形状（manifest.isPermissionWord 单一口径）；通配只放
//    `<ns>.*`（broker.grantsCover 认的只有这一种），深通配 a.b.*、单段裸命名空间、裸 * 一律红——
//    写一条永远不会被匹配的授权词比写错更危险，它制造「已授权」的错觉。
//  - 文件缺失 = 空授权面（fail-closed 缺省：没配过就是什么都没授权）；坏 JSON / 未知顶层字段 /
//    version 漂移 / 重复词都红——宁可空转也不拿错账继续走（registry 的账本同款纪律）。
//  - 本文件只读。谁写它：人（或未来的审批 UI）。它不属于进化平面的写入口——进化平面只写 staging。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isPermissionWord, PERMISSION_NAMESPACE_RE } from "./manifest";

export class GrantsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrantsConfigError";
  }
}

const GRANTS_VERSION = 1 as const;
const MAX_GRANTS = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 授权词 = exact 权限词（manifest 同口径）或 `<ns>.*` 单段通配；裸 * 与深通配都不是授权词。 */
export function isGrantWord(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.endsWith(".*")) return PERMISSION_NAMESPACE_RE.test(value.slice(0, -2));
  return isPermissionWord(value);
}

export class GrantsStore {
  private readonly filePath: string;

  /** @param modulesDir 控制平面自管的 modules/ 根（registry.jsonl / staging / installed 的邻居）。 */
  constructor(modulesDir: string) {
    this.filePath = join(modulesDir, "grants.json");
  }

  get path(): string {
    return this.filePath;
  }

  /** 每次现读不缓存：授权是低频写、高频裁决面，改了配置应当即生效。 */
  async load(): Promise<ReadonlySet<string>> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Set();
      throw err;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new GrantsConfigError(`grants.json 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`);
    }
    if (!isRecord(raw)) throw new GrantsConfigError("grants.json 必须是 JSON 对象");
    const unknownFields = Object.keys(raw).filter((k) => k !== "version" && k !== "grants");
    if (unknownFields.length > 0) {
      throw new GrantsConfigError(`grants.json 未知顶层字段（fail-closed，笔误字段不许静默丢失）: ${unknownFields.join("、")}`);
    }
    if (raw.version !== GRANTS_VERSION) {
      throw new GrantsConfigError(`grants.json version 非法：须为 ${GRANTS_VERSION}（收到 ${JSON.stringify(raw.version)}）`);
    }
    if (!Array.isArray(raw.grants)) throw new GrantsConfigError("grants.json 的 grants 必须是字符串数组");
    if (raw.grants.length > MAX_GRANTS) {
      throw new GrantsConfigError(`grants.json 超帽：授权词最多 ${MAX_GRANTS} 条（§8 膨胀护栏）`);
    }
    const grants = new Set<string>();
    for (const grant of raw.grants) {
      if (!isGrantWord(grant)) {
        throw new GrantsConfigError(
          `授权词非法（exact 须为点分小写权限词，通配只放 <ns>.*，禁裸 * 与深通配）: ${JSON.stringify(grant)}`,
        );
      }
      if (grants.has(grant)) throw new GrantsConfigError(`授权词重复: ${grant}`);
      grants.add(grant);
    }
    return grants;
  }
}
