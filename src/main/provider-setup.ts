// 「自定义接口」的表单逻辑（桌面端与命令行共用同一套核心）。
//
// 分三件事，每件都刻意做成可注入、可离线判卷的：
//   · discoverForProviderSetup —— 探测 + 目录补参数（回答「这家有什么、能填什么」）
//   · saveCustomProvider       —— 把一家写进工作区 `.agent/providers.json`（upsert，保住别的家）
//   · （存钥匙）交给 provider-keys 的 safeStorage 面，本模块只负责让它落对地方
//
// 为什么不做成 Electron 里的一段胶水：这三件事每一件出错都会让用户"配了不生效"，
// 而那正是本仓点名过的失败形态。放在 src/main 里就能被 vitest 直接判卷（注入 fetchImpl / 目录读数）。
import { readFileSync } from "node:fs";
import { writeFileAtomic } from "../atomic-write";
import { loadCatalog } from "./catalog-store";
import { customProvidersPath } from "./custom-provider-store";
import { discoverModels, type DiscoverFailure } from "./model-discovery";
import type { CatalogReadout } from "../providers/catalog";
import type { DiscoveryProtocol } from "../providers/discovery";
import {
  deriveCustomProviders,
  parseCustomProviders,
  type CustomProviderConfig,
  type CustomProviderProblem,
  type CustomProvidersFile,
  type DerivedCustomProvider,
} from "../providers/provider-config";
import {
  DEFAULT_DRAFT_LIMIT,
  draftGaps,
  mergeDiscoveredWithCatalog,
  suggestApiKeyEnv,
  suggestProviderId,
  type DiscoveredRow,
} from "../providers/provider-draft";

export interface SetupDeps {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  /** 目录读数（测试注入，免得联网）。 */
  loadCatalogImpl?: (input: { refresh: "never" | "auto" | "force" }) => Promise<CatalogReadout>;
}

export interface DiscoverForSetupInput {
  baseURL: string;
  protocol: DiscoveryProtocol;
  keyEnv: string;
  /** 表单里刚输入、还没落盘的钥匙（一次性）。不给则读 `keyEnv` 对应的环境变量。 */
  keyValue?: string;
  allowLocalEndpoint?: boolean;
  /** 只保留这一条（用户在表里勾了单条）。 */
  only?: string;
  limit?: number;
}

export type DiscoverForSetup =
  | {
      ok: true;
      rows: readonly DiscoveredRow[];
      truncated: number;
      missing: readonly string[];
      warnings: readonly string[];
      catalogOrigin: CatalogReadout["origin"];
      catalogNote?: string;
      matchedProviderId?: string;
    }
  | { ok: false; reason: DiscoverFailure | "catalog"; message: string };

/** 探测 + 目录补参数。**不改任何文件**（表单的「拉取」按钮必须是无副作用的）。 */
export async function discoverForProviderSetup(
  input: DiscoverForSetupInput,
  deps: SetupDeps = {},
): Promise<DiscoverForSetup> {
  const env = { ...(deps.env ?? process.env) };
  const keyEnv = input.keyEnv.trim();
  if (input.keyValue !== undefined && input.keyValue.trim() !== "") env[keyEnv] = input.keyValue.trim();
  const found = await discoverModels({
    baseURL: input.baseURL,
    protocol: input.protocol,
    keyEnv,
    env,
    ...(input.allowLocalEndpoint === true ? { allowLocalEndpoint: true } : {}),
    ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
  });
  if (!found.ok) return { ok: false, reason: found.reason, message: found.message };

  let readout: CatalogReadout;
  try {
    readout = deps.loadCatalogImpl !== undefined ? await deps.loadCatalogImpl({ refresh: "auto" }) : await loadCatalog({ refresh: "auto" });
  } catch (err) {
    // 目录只是补参数用的辅助：拿不到就按「没有目录」走，模型清单照常给用户看
    return {
      ok: false,
      reason: "catalog",
      message: `模型清单拿到了（${String(found.models.length)} 条），但读本地目录失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const merged = mergeDiscoveredWithCatalog({
    models: found.models,
    catalog: readout.catalog,
    baseURL: input.baseURL,
    ...(input.only !== undefined ? { only: input.only } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  });
  const gaps = draftGaps(merged.rows);
  return {
    ok: true,
    rows: merged.rows,
    truncated: merged.truncated,
    missing: gaps.missing,
    warnings: gaps.warnings,
    catalogOrigin: readout.origin,
    ...(readout.note !== undefined ? { catalogNote: readout.note } : {}),
    ...(merged.matchedProviderId !== undefined ? { matchedProviderId: merged.matchedProviderId } : {}),
  };
}

/** 表单里那一家要写进配置的样子（与 `.agent/providers.json` 的 schema 一致）。 */
export interface ProviderEntryInput {
  id: string;
  label?: string;
  protocol: DiscoveryProtocol;
  baseURL: string;
  apiKeyEnv: string;
  allowLocalEndpoint?: boolean;
  models: readonly {
    id: string;
    model?: string;
    contextWindow?: number;
    maxOutputTokens?: number;
    price?: { inputPerMTok?: number; outputPerMTok?: number; cacheReadPerMTok?: number; cacheWritePerMTok?: number };
    reasoningEfforts?: readonly string[];
  }[];
}

export type SaveProviderResult =
  | { ok: true; path: string; providers: readonly string[]; derived: readonly DerivedCustomProvider[]; warnings: readonly string[] }
  | { ok: false; error: string; problems?: readonly CustomProviderProblem[] };

/** 读出工作区里现有的 `.agent/providers.json`（不存在 ⇒ 空骨架）。
 *  **坏文件一律不覆盖**：读不懂的配置是用户手写的东西，拿我们的 upsert 把它盖掉等于删人家的配置。 */
function readExisting(
  path: string,
): { ok: true; file: { version: 1; providers: CustomProviderConfig[] } } | { ok: false; error: string; problems?: readonly CustomProviderProblem[] } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, file: { version: 1, providers: [] } };
    return { ok: false, error: `读取失败：${err instanceof Error ? err.message : String(err)}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (err) {
    return { ok: false, error: `现有文件不是合法 JSON（${err instanceof Error ? err.message : String(err)}）——请先修好它，我们不覆盖读不懂的配置` };
  }
  const parsed = parseCustomProviders(raw);
  if (!parsed.ok) {
    return {
      ok: false,
      error: `现有文件没通过校验（${String(parsed.problems.length)} 处问题）——请先修好它，我们不覆盖读不懂的配置`,
      problems: parsed.problems,
    };
  }
  return { ok: true, file: { version: 1, providers: [...parsed.file.providers] } };
}

/**
 * 把一家 provider 写进工作区配置（按 id upsert；**别的家原样保留**）。
 *
 * 写之前先拿**合并后的整份文件**过一遍我们自己的严格校验：宁可现在拒，也不要把一份非法配置写进磁盘
 * （那时用户会在下一次启动看到一堆问题，而且不知道是哪一步弄坏的）。写盘走原子写（临时文件 + rename）。
 */
/** 校验并算好「要写什么」，但**不落盘**。
 *
 *  为什么要拆成 prepare/commit 两步：桌面表单的正确顺序是
 *  「先把这一家装进运行期注册表（可逆）→ 再存钥匙 → 最后落盘」。
 *  因为钥匙面（safeStorage）的判据是「**已装上**的 provider 才许存」——这是本仓既有判据
 *  （未知 id 拒收），它是对的；错的是顺序（先存钥匙时那家还没装上，首次添加必然被拒）。
 *  判据不动、顺序改掉，这就是那一步的支点。 */
/** prepare 的产物：要么「算好了要写什么」，要么带着问题清单拒掉。**没有第三种。** */
export type PrepareCustomProviderResult =
  | {
      ok: true;
      path: string;
      file: CustomProvidersFile;
      derived: readonly DerivedCustomProvider[];
      warnings: readonly string[];
    }
  | { ok: false; error: string; problems?: readonly CustomProviderProblem[] };

export function prepareCustomProvider(workspace: string, entry: ProviderEntryInput): PrepareCustomProviderResult {
  const path = customProvidersPath(workspace);
  const existing = readExisting(path);
  if (!existing.ok) {
    return { ok: false, error: existing.error, ...(existing.problems !== undefined ? { problems: existing.problems } : {}) };
  }
  const rest = existing.file.providers.filter((p) => p.id !== entry.id);
  const next = {
    version: 1,
    providers: [
      ...rest,
      // 上游调用名缺省 = 模型 id：表单里用户填的是「模型 id」，让他再抄一遍"上游调用名"只是摩擦。
      // 写进文件时**一定是显式的**（schema 不动），所以配置本身仍然自证。
      { ...entry, models: entry.models.map((m) => ({ ...m, model: m.model ?? m.id })) },
    ],
  };
  const parsed = parseCustomProviders(next);
  if (!parsed.ok) {
    return { ok: false, error: `${String(parsed.problems.length)} 处配置问题`, problems: parsed.problems };
  }
  const derived = deriveCustomProviders(parsed.file);
  const warnings = derived.flatMap((d) => d.warnings.map((w) => `${d.label}：${w}`));
  return { ok: true, path, file: parsed.file, derived, warnings };
}

/** 落盘（原子写）。传入的是 prepare 的产物。 */
export async function commitCustomProvider(prepared: {
  path: string;
  file: CustomProvidersFile;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await writeFileAtomic(prepared.path, JSON.stringify(prepared.file, null, 2) + "\n");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `写盘失败：${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * 把一家 provider 写进工作区配置（按 id upsert；**别的家原样保留**）= prepare + commit。
 *
 * 写之前先拿**合并后的整份文件**过一遍我们自己的严格校验：宁可现在拒，也不要把一份非法配置写进磁盘
 * （那时用户会在下一次启动看到一堆问题，而且不知道是哪一步弄坏的）。写盘走原子写（临时文件 + rename）。
 * 桌面端不用这一个（它要插一步「存钥匙」），用 prepare/commit 两段。
 */
export async function saveCustomProvider(workspace: string, entry: ProviderEntryInput): Promise<SaveProviderResult> {
  const prepared = prepareCustomProvider(workspace, entry);
  if (!prepared.ok) return prepared;
  const wrote = await commitCustomProvider(prepared);
  if (!wrote.ok) return { ok: false, error: wrote.error };
  return { ok: true, path: prepared.path, providers: prepared.file.providers.map((p) => p.id), derived: prepared.derived, warnings: prepared.warnings };
}

/** 表单的默认值：地址 → provider id → key 变量名（与命令行同一套推导，见 provider-draft.ts）。 */
export function suggestSetupDefaults(baseURL: string): { providerId: string; apiKeyEnv: string; note?: string } {
  const s = suggestProviderId(baseURL);
  return {
    providerId: s.id,
    apiKeyEnv: suggestApiKeyEnv(s.id),
    ...(s.note !== undefined ? { note: s.note } : {}),
  };
}

export { DEFAULT_DRAFT_LIMIT };
