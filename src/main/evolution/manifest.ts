// SEMA Phase 0（方案：docs/sema-proposal.md §3.1）：CAP Bundle manifest —— 自进化平面（Evolution
// Plane）产出的「模块包提案」的唯一契约；控制平面（registry / gate runner / installer）只装通过
// 本校验的包。这是**安全契约**，不是兼容层：未知顶层字段 fail-closed（笔误字段静默丢失 = 一个
// 永不生效的权限声明），与 src/agent/plugins 那套「CC 超集、未知字段警告放行」是两个刻意不同的取向。
//
// 事实源纪律（不抄第二份）：
//  - 门名单的唯一事实源是 scripts/gate-manifest.ts 的 GATES（「新增门只改这里」）。这里不抄名单：
//    knownGates 由调用方注入（scripts / tests 侧传 GATES），src 侧不做名单的事实源。
//  - 权限词表的唯一事实源在 src/permissions/。这里只做**形状**校验（带命名空间的点分小写词）；
//    「这个包能不能用这个权限」的成员裁决属于 Phase 1 的 Permission Broker（方案 §4）——
//    提前抄一份词表只会得到两份会各自漂的名单。
//
// 边界不变量在本层编码（fail-closed，AGENTS.md 单向依赖的 schema 面）：
//  - 一切路径（entry / deps）必须是规范相对路径：禁绝对路径、反斜杠、NUL、`..`／`.`／空段；
//  - deps 是仓库相对路径：desktop-panel 包的 deps 必须全部落在 apps/desktop/ 内，
//    其余 kind 的 deps 禁止伸进 apps/desktop/；node_modules 一律不得作 dep；
//  - entry 是「包根相对」路径（包根按 kind 落在哪棵树，由 Phase 1 Installer 裁决），
//    所以本层只查形状；对实际 staging 目录的包含性校验在 registry.registerStaged 里补。
import { isAbsolute } from "node:path";

export type BundleKind = "tool" | "service" | "plugin" | "content-pack" | "desktop-panel";

/** kind 全集；id 的第一段必须等于 kind（路径即身份，不认第二种写法）。 */
export const BUNDLE_KINDS: readonly BundleKind[] = ["tool", "service", "plugin", "content-pack", "desktop-panel"];

export const BUNDLE_ID_RE = /^(tool|service|plugin|content-pack|desktop-panel)\.[a-z][a-z0-9-]*$/;

/** semver 核心 triple，允许 prerelease 与 build 段；禁前导零。 */
export const BUNDLE_VERSION_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** 权限词只查形状：小写词干 + 至少一段命名空间（net.fetch / fs.write / shell.exec 这一族）。 */
const PERMISSION_RE = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;

/** 权限词的首段命名空间形状；`<ns>.*` 通配（permission-broker 的口径）复用这一份，不抄第二份。 */
export const PERMISSION_NAMESPACE_RE = /^[a-z][a-z0-9-]*$/;

/** 权限词形状（不含通配）的单一出口：manifest 校验与 grants 取料面共用。 */
export function isPermissionWord(value: unknown): value is string {
  return typeof value === "string" && PERMISSION_RE.test(value);
}

const MAX_ID_LENGTH = 128;
const MAX_VERSION_LENGTH = 64;
const MAX_PATH_LENGTH = 4096;
const MAX_TEXT_LENGTH = 200;
const MAX_LIST_LENGTH = 64;

/** manifest 顶层字段的闭集：多一个键即红（fail-closed），少必需键也红。 */
const KNOWN_FIELDS: ReadonlySet<string> = new Set([
  "id", "version", "kind", "entry", "deps", "permissions", "gates", "title", "description", "signedBy",
]);

export class BundleManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleManifestError";
  }
}

export function isBundleId(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_ID_LENGTH && BUNDLE_ID_RE.test(value);
}

export function isBundleVersion(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_VERSION_LENGTH && BUNDLE_VERSION_RE.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBundleKind(value: unknown): value is BundleKind {
  return typeof value === "string" && (BUNDLE_KINDS as readonly string[]).includes(value);
}

function cleanText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_TEXT_LENGTH ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new BundleManifestError(`${field} 非法：须为 1–${MAX_TEXT_LENGTH} 个无首尾空白/控制字符的字符`);
  }
  return value;
}

/** 规范相对路径：禁绝对路径、反斜杠、NUL、首尾空白与 `..`／`.`／空段。（进化平面 v1 的
 *  files 键也走这份校验——同一个包根相对路径口径，不抄第二份。） */
export function canonicalRelPath(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PATH_LENGTH) {
    throw new BundleManifestError(`${field} 非法：须为 1–${MAX_PATH_LENGTH} 字符的相对路径`);
  }
  if (value.trim() !== value || value.includes("\\") || value.includes("\u0000")) {
    throw new BundleManifestError(`${field} 非法：禁反斜杠/NUL/首尾空白（收到 ${JSON.stringify(value)}）`);
  }
  if (isAbsolute(value)) {
    throw new BundleManifestError(`${field} 非法：必须是相对路径（收到 ${JSON.stringify(value)}）`);
  }
  const segments = value.split("/");
  if (segments.includes("..") || segments.includes(".") || segments.includes("")) {
    throw new BundleManifestError(`${field} 非法：路径段须为规范段，禁 ".."、"//" 与 "."（收到 ${JSON.stringify(value)}）`);
  }
  return value;
}

function stringList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_LIST_LENGTH) {
    throw new BundleManifestError(`${field} 必须是不超过 ${MAX_LIST_LENGTH} 项的字符串数组`);
  }
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") throw new BundleManifestError(`${field} 必须是字符串数组`);
    if (seen.has(item)) throw new BundleManifestError(`${field} 有重复项: ${item}`);
    seen.add(item);
  }
  return value;
}

export interface BundleManifest {
  id: string;
  version: string;
  kind: BundleKind;
  /** 包根相对入口；content-pack（纯数据）可省，其余 kind 必填。 */
  entry?: string;
  /** 仓库相对依赖路径（边界与淘汰判据的取料面）。 */
  deps: string[];
  /** 高权限能力的显式声明；Permission Broker 按此比对会话授权，未声明即拒装。 */
  permissions: string[];
  /** 激活前必须全绿的闸门；名单以 scripts/gate-manifest.ts 的 GATES 为准。 */
  gates: string[];
  title?: string;
  description?: string;
  /** 产出管线的标识（如 evolution-plane-pipeline-v1）；Phase 1 起 Installer 据此区分信任档。 */
  signedBy?: string;
}

/** 校验并归一化一份 bundle manifest；任何结构性缺陷抛 BundleManifestError（无警告面）。 */
export function parseBundleManifest(raw: unknown, knownGates: ReadonlySet<string>): BundleManifest {
  if (!isRecord(raw)) throw new BundleManifestError("manifest 必须是 JSON 对象");
  const unknownFields = Object.keys(raw).filter((k) => !KNOWN_FIELDS.has(k));
  if (unknownFields.length > 0) {
    throw new BundleManifestError(`未知顶层字段（fail-closed，笔误字段不许静默丢失）: ${unknownFields.join("、")}`);
  }
  const kind = raw.kind;
  if (!isBundleKind(kind)) {
    throw new BundleManifestError(`kind 非法：须为 ${BUNDLE_KINDS.join(" / ")} 之一（收到 ${JSON.stringify(kind)}）`);
  }
  if (!isBundleId(raw.id)) {
    throw new BundleManifestError(`id 非法：须为 <kind>.<kebab-name> 形态（收到 ${JSON.stringify(raw.id)}）`);
  }
  const idPrefix = raw.id.split(".")[0];
  if (idPrefix !== kind) {
    throw new BundleManifestError(`id 前缀与 kind 不一致：${String(raw.id)} 的前缀是 ${String(idPrefix)}，manifest 却声明 ${kind}`);
  }
  if (!isBundleVersion(raw.version)) {
    throw new BundleManifestError(`version 非法：须为 semver triple（收到 ${JSON.stringify(raw.version)}）`);
  }
  const entry = raw.entry === undefined ? undefined : canonicalRelPath(raw.entry, "entry");
  if (entry === undefined && kind !== "content-pack") {
    throw new BundleManifestError(`${kind} 包必须声明 entry（只有 content-pack 可省）`);
  }
  const deps = stringList(raw.deps, "deps").map((dep) => canonicalRelPath(dep, "deps"));
  for (const dep of deps) {
    if (dep === "node_modules" || dep.startsWith("node_modules/")) {
      throw new BundleManifestError(`deps 禁止指向 node_modules: ${dep}`);
    }
    if (kind === "desktop-panel" && !dep.startsWith("apps/desktop/")) {
      throw new BundleManifestError(`desktop-panel 包的 deps 必须全部落在 apps/desktop/ 内（收到 ${dep}）`);
    }
    if (kind !== "desktop-panel" && dep.startsWith("apps/desktop/")) {
      throw new BundleManifestError(`${kind} 包的 deps 禁止伸进 apps/desktop/（单向依赖，收到 ${dep}）`);
    }
  }
  const permissions = stringList(raw.permissions, "permissions");
  for (const perm of permissions) {
    if (!PERMISSION_RE.test(perm)) {
      throw new BundleManifestError(`permissions 形状非法（须为 <词干>.<命名空间> 点分小写）: ${perm}`);
    }
  }
  const gates = stringList(raw.gates, "gates");
  if (gates.length === 0) {
    throw new BundleManifestError("gates 不能为空——未过闸门的包永不激活（验证先行）");
  }
  for (const gate of gates) {
    if (!knownGates.has(gate)) {
      throw new BundleManifestError(`gates 里有未知门 ${gate}——门名单以 scripts/gate-manifest.ts 的 GATES 为准`);
    }
  }
  const title = cleanText(raw.title, "title");
  const description = cleanText(raw.description, "description");
  const signedBy = cleanText(raw.signedBy, "signedBy");
  return {
    id: raw.id,
    version: raw.version,
    kind,
    ...(entry !== undefined ? { entry } : {}),
    deps,
    permissions,
    gates,
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(signedBy !== undefined ? { signedBy } : {}),
  };
}
