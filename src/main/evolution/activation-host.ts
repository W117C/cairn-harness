// 生产接线宿主：把控制平面接到真实 run 的两个缝上。
//  - 装配缝：读当前 active 的 content-pack，把 prompt.md / system.md 拼进 system prompt；
//  - 收束缝：把本轮 EvolutionSignals 喂给 CanaryController.tickAll（跨进程续档、退化回退都在里面）。
//
// 纪律：
//  · 工作区没有 `modules/` 或没有观察档 ⇒ 零行为（不建目录、不改 prompt 字节）；
//  · 门名单不在这里抄第二份：knownGates 从账本已定格的 declaredGates 取（这些包在注册时已经对照过
//    scripts/gate-manifest.ts 的真名单），装载时再与账本逐项比对，漂移即拒；
//  · 内容包进提示词前必须核对候选档案的 contentDigest（档案覆盖包内全部文件、不含 manifest；
//    manifest 面由 RuntimeLoader 单独与账本比对）。档案缺失 / 摘要不符 ⇒ 拒绝注入并出声——
//    「装完之后盘上被改过」不能靠 SystemPrompt 静默接住。
//  · **坏档不许把两条链一起带走**（2026-10-22 修）：账本读不动（投影要重建而重放撞上坏行 ⇒
//    RegistryLogCorruptError）是这两条缝**共用**的一个失败源。从前它从共享开口一路抛出去
//    ⇒ 注入缝与收束缝同时熄火；而收束缝熄火 = 观察期收不到样本 = 连败计数不再前进 =
//    退化版本永远装着退不下来（收束缝是安全网，灭掉它比少一段提示词严重得多）。
//    现在账本开口分三态（没有 / 好 / 读不动），**每条链各自降级、各自出声**：
//    · 注入缝读不动 ⇒ 跳过注入并出声（**不是「没有包」**：盘上可能装着包，是这本账读不动）；
//    · 收束缝读不动 ⇒ 观察档在盘上（.agent/canary/*.json）且自己记着「这一档是为哪个候选开的」，
//      那一格不需要账本 ⇒ 按盘上观察档继续收样本（「候选是否还在位」这一格降级为「无法核验」，
//      按还在位处理——答「不在位」会把连败计数静默清零 = 观察期被悄悄撤掉）。
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvolutionSignals } from "../../agent/evolution/signal";
import { CanaryController, RuntimeLoader, type CanarySample, type CanaryTickResult } from "./canary";
import { digestFiles, readCandidateRecord } from "./candidate-record";
import { Installer } from "./installer";
import { BUNDLE_KINDS, type BundleKind } from "./manifest";
import { ModuleRegistry, type BundleEntry, type RegistryIndex } from "./registry";

/** content-pack 里被当成提示词正文的文件名；其它文件不拼进 prompt。 */
export const PROMPT_PACK_FILES: ReadonlySet<string> = new Set(["prompt.md", "system.md"]);

const MAX_PACK_BYTES = 16_384;
const MAX_TOTAL_BYTES = 32_768;
const MAX_PACKS = 8;

async function hasRegistry(workspace: string): Promise<boolean> {
  try {
    // 目录存在即可；index 缺失时 readIndex 会从 registry.jsonl 重建。
    await readdir(join(workspace, "modules"));
    return true;
  } catch {
    return false;
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.name + ": " + err.message : String(err);
}

/** 账本开口的三态。**「没有」与「读不动」是两个数**——折成同一个就是让坏档静默消失。 */
export type LedgerOpen =
  /** 没有 modules/ ⇒ 零行为。 */
  | { kind: "absent" }
  /** 账本好。 */
  | { kind: "ok"; registry: ModuleRegistry; index: RegistryIndex }
  /** 账本在，但读不动（投影重建撞坏行 ⇒ RegistryLogCorruptError 等）。 */
  | { kind: "broken"; registry: ModuleRegistry; detail: string };

/** 打开工作区账本；knownGates = 调用方补充 + 账本里已经定格的 declaredGates。
 *  返回 {kind:"absent"} = 这个工作区没有 modules/（零行为）。
 *  返回 {kind:"broken"} = 账本在但读不动：**不在这里抛**——这个开口是两条生产缝共用的，
 *  抛出去就是把两条链一起带走；交回给每条链自己降级、自己出声。 */
export async function openEvolutionRegistry(
  workspace: string,
  extraGates: Iterable<string> = [],
): Promise<LedgerOpen> {
  if (!(await hasRegistry(workspace))) return { kind: "absent" };
  const known = new Set<string>(extraGates);
  const registry = new ModuleRegistry(workspace, { knownGates: known });
  let index: RegistryIndex;
  try {
    index = await registry.readIndex();
  } catch (err) {
    return { kind: "broken", registry, detail: describeError(err) };
  }
  // 门名单补齐：账本自己定格的 declaredGates（这些包在注册时已对照真名单校验过 ⇒ 已知门）。
  for (const entry of Object.values(index.bundles)) {
    for (const version of Object.values(entry.versions)) {
      for (const gate of version.declaredGates) known.add(gate);
    }
  }
  return { kind: "ok", registry, index };
}

/** 当前 active content-pack 的提示词正文。零包 / 无提示词文件 / 全部超帽 ⇒ 空串（系统提示词逐字节不变）。 */
export async function activeContentPackNote(
  workspace: string,
  opts: { extraGates?: Iterable<string> } = {},
): Promise<string> {
  const opened = await openEvolutionRegistry(workspace, opts.extraGates ?? []);
  if (opened.kind === "absent") return "";
  if (opened.kind === "broken") {
    // 坏档 ⇒ **本链**降级：跳过注入并出声。
    // 「读不到」不许折成「没有包」（那把一件事实说成另一件）；出声必须说清是哪一种。
    console.warn(
      "[evolution-pack] 账本读不动（" + opened.detail + "）——本链跳过注入"
        + "（不是没有包：盘上可能装着包，是这本账读不动；先修账，注入会自动回来）",
    );
    return "";
  }
  const { registry, index } = opened;
  const ids = Object.entries(index.bundles)
    .filter(([, entry]) => entry.kind === "content-pack" && entry.active !== undefined)
    .map(([id]) => id)
    .sort();
  if (ids.length === 0) return "";
  const loader = new RuntimeLoader(registry);
  const chunks: string[] = [];
  let total = 0;
  for (const id of ids) {
    if (chunks.length >= MAX_PACKS) break;
    let loaded;
    try {
      loaded = await loader.load(id);
    } catch (err) {
      console.warn("[evolution-pack] " + id + " 装载失败，跳过（不等于没有这个包）: " + (err instanceof Error ? err.message : String(err)));
      continue;
    }
    if (loaded.kind !== "content-pack") continue;
    let record;
    try {
      record = await readCandidateRecord(workspace, id, loaded.version);
    } catch (err) {
      console.warn(
        "[evolution-pack] " + id + "@" + loaded.version + " 的候选档案读不了，拒绝注入: "
          + (err instanceof Error ? err.message : String(err)),
      );
      continue;
    }
    if (record === null) {
      console.warn("[evolution-pack] " + id + "@" + loaded.version + " 没有候选档案，拒绝注入（无法核验内容摘要）");
      continue;
    }
    const diskDigest = digestFiles(Object.fromEntries(loaded.files.map((file) => [file.rel, file.text])));
    if (record.contentDigest !== diskDigest) {
      console.warn(
        "[evolution-pack] " + id + "@" + loaded.version + " 内容摘要不符（档案 " + record.contentDigest
          + " / 盘上 " + diskDigest + "），拒绝注入",
      );
      continue;
    }
    const bodies = loaded.files
      .filter((file) => PROMPT_PACK_FILES.has(file.rel))
      .map((file) => file.text);
    if (bodies.length === 0) continue;
    const body = bodies.join("\n\n");
    const bytes = Buffer.byteLength(body, "utf8");
    if (bytes > MAX_PACK_BYTES || total + bytes > MAX_TOTAL_BYTES) {
      console.warn(
        "[evolution-pack] " + id + "@" + loaded.version + " 的提示词越过帽（单包 " + String(MAX_PACK_BYTES)
          + " / 总量 " + String(MAX_TOTAL_BYTES) + " 字节），跳过",
      );
      continue;
    }
    total += bytes;
    chunks.push("\n\n[evolution-pack] " + id + "@" + loaded.version + "\n" + body);
  }
  return chunks.join("");
}

async function hasOpenCanaryRecords(workspace: string): Promise<boolean> {
  try {
    const names = await readdir(join(workspace, ".agent", "canary"));
    return names.some((name) => name.endsWith(".json"));
  } catch {
    return false;
  }
}

/** 降级索引：只由**盘上观察档自己说的那一格**构成（「这一档是为哪个候选开的」）。
 *
 *  账本在这条路上只被问一格（CanaryController.tickAllLocked）：「这个候选还在位吗」。
 *  账本不可信时这一格的降级答法 = 观察档自己说的那一格（观察档开出来时记的就是当时的
 *  active 版本）。**答「不在位」是危险方向**：controller 会把这档当 idle 收掉 ⇒ 连败计数
 *  静默清零 ⇒ 观察期被悄悄撤掉 ⇒ 退化版本永远装着退不下来。
 *  其余格（versions / previous）一律空：**收束这条路没人读**（只有 active.version 那一格被问）。
 *  kind 这一格同理（只为了满足索引形状，没人读）：id 的契约是 <kind>.<kebab-name>，
 *  前缀取自 id 本身，不是另抄一份。 */
async function degradedIndex(workspace: string): Promise<RegistryIndex> {
  const bundles: Record<string, BundleEntry> = {};
  const dir = join(workspace, ".agent", "canary");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    names = [];
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(dir, name), "utf8"));
    } catch {
      // 读不动的观察档：controller 自己会点名 refused（不许折成「没有档」），这里跳过即可。
      continue;
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.candidateVersion !== "string") continue;
    const prefix = r.id.split(".")[0] ?? "";
    const kind = (BUNDLE_KINDS as readonly string[]).includes(prefix) ? (prefix as BundleKind) : "content-pack";
    bundles[r.id] = {
      kind,
      versions: {},
      active: { version: r.candidateVersion, activatedAt: typeof r.startedAt === "string" ? r.startedAt : "" },
    };
  }
  return { version: 1, rebuiltAt: new Date().toISOString(), bundles };
}

/** 只回答「候选还在位吗」这一格的降级账本（其余格不答，也不许有人拿它写回账本）。 */
class DegradedLedger extends ModuleRegistry {
  constructor(
    rootDir: string,
    opts: { knownGates: ReadonlySet<string> },
    private readonly fallback: RegistryIndex,
  ) {
    super(rootDir, opts);
  }

  override async readIndex(): Promise<RegistryIndex> {
    return this.fallback;
  }
}

/** 降级收束：账本读不动时，按盘上观察档继续收样本。
 *
 *  installer 走**真账本**：要回退就写真账本；账本写不动 ⇒ 当场失败并把原因留在观察档上
 *  （degraded + rollbackError），不许降级索引代写（那等于凭一份拼出来的索引改指针）。 */
async function tickDegradedCanary(
  workspace: string,
  registry: ModuleRegistry,
  sample: CanarySample,
): Promise<CanaryTickResult[]> {
  const fallback = await degradedIndex(workspace);
  const controller = new CanaryController({
    registry: new DegradedLedger(workspace, { knownGates: registry.knownGates }, fallback),
    workspace,
    installer: new Installer(registry),
  });
  return await controller.tickAll(sample);
}

/** 收束缝：把本轮读数喂给所有还开着的观察档。没有观察档 ⇒ 返回空数组且不建任何目录。 */
export async function tickCanaryFromSignals(
  workspace: string,
  signals: EvolutionSignals,
  runId?: string,
  opts: { extraGates?: Iterable<string> } = {},
): Promise<CanaryTickResult[]> {
  if (!(await hasOpenCanaryRecords(workspace))) return [];
  const opened = await openEvolutionRegistry(workspace, opts.extraGates ?? []);
  if (opened.kind === "absent") return [];
  const sample: CanarySample = {
    ...(runId !== undefined ? { runId } : {}),
    verifyOutcome: signals.verifyOutcome,
    costMeasurable: signals.costMeasurable,
    tokensPerBoundary: signals.tokensPerBoundary,
    spendAfterLastBoundary: signals.spendAfterLastBoundary,
  };
  if (opened.kind === "broken") {
    // 坏档 ⇒ **本链降级，但不灭**：观察档在盘上、自己记着「这一档是为哪个候选开的」，
    // 那一格不需要账本 ⇒ 按盘上观察档继续收样本（连败计数照常前进，不许被清零）。
    console.warn(
      "[canary] 账本读不动（" + opened.detail + "）——观察期按盘上观察档继续收样本"
        + "（「候选是否还在位」这一格无法核验，按还在位处理；连败计数照常前进，不许被清零）",
    );
    return await tickDegradedCanary(workspace, opened.registry, sample);
  }
  const controller = new CanaryController({ registry: opened.registry, workspace });
  return await controller.tickAll(sample);
}
