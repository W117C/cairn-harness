// SEMA Phase 4（方案：docs/sema-proposal.md §7 Phase 4 运行面装载；§8 退化验证口径）：
// 运行面装载器 + canary 观察期。
//
// 两件事，一条接线：
//  ① RuntimeLoader：把**已激活**的包搬上运行面（tool / content-pack / desktop-panel）。
//     读的是 modules/installed/<id>/<version>；每一层都比对账本定格：manifest 契约合法、
//     身份一致（id / version / kind）、entry / permissions / gates 与注册时逐字一致、
//     entry 是常规文件、文本体量在帽内。staging 是不可信写入口，安装之后盘上的字节同样
//     不可信（恢复版本不可变挡得住覆写，挡不住手改）——装载面每次重验，不缓存信任。
//  ② CanaryController：新版本激活后进入观察期（样本 = 每轮读数）。三条退化规则任一命中即
//     自动回退 previous（Installer.rollbackInstalled），并把这次退化沉淀成 lesson
//     （走 memory store，落 <workspace>/.agent/memory/，带 evidence-line）。
//     观察期满且无退化 ⇒ promoted；回滚失败（没有 previous / previous 文件缺失）⇒ degraded。
//
// 口径与既有模块对齐：
//  · 判据三条按方案 §8：「连续失败样本」「no-progress（边界后仍花 token 且无新前进）」
//    与「cost-per-progress 相对基线 ×2」。
//  · 不可测 ≠ 0（cost-per-progress.ts 的纪律）：成本不可测且边界后无支出 ⇒ 这一项不判；
//    没有基线 ⇒ cost-per-progress 不判（不编造基线）。
//  · 回滚失败不假装成功：state = degraded + rollbackError 留档；active 指针原地不动。
//  · **lesson 与回滚是两笔账**：回滚成没成都照写 lesson（它是下一次的输入），
//    写盘失败只记 lessonWritten / lessonError，不改回滚结论。
//  · **观察期跨进程**（2026-10-16 补）：一档观察期落成 `.agent/canary/<id>.json`（原子写），
//    tickAll 在每次会话收束时把还开着的档接回内存收样本——连败计数、样本数不再随进程重启清零。
//    触发者仍是"装上位的那个宿主"（begin），账本只做校验（档里的候选还是不是当前 active）：
//    active/previous 的 activatedAt 会被 rollback 重新盖章，拿时间戳反过来推"谁是候选"会翻车。
//  · 读不动观察档不许折成"没有档"（那等于把连败计数静默清零）：一个点名 refused，一个不动账。
import { constants } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, type FileHandle } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { tmpPathFor, writeFileAtomic } from "../../atomic-write";
import { EVIDENCE_LINE_PREFIX, LESSON_MEMORY_TYPE, LESSON_TOPIC_PREFIX, SESSION_LINE_PREFIX } from "../../agent/memory/lessons";
import { projectMemoryDir, writeTopic } from "../../agent/memory/store";
import { Installer } from "./installer";
import { parseBundleManifest, type BundleKind, type BundleManifest } from "./manifest";
import type { IndexVersion, ModuleRegistry } from "./registry";

export class LoadRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoadRefusedError";
  }
}

export class CanaryRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanaryRefusedError";
  }
}

type StableFile =
  | { kind: "ok"; size: number; mtimeMs: number; nlink: number; text: string }
  | { kind: "too-large"; size: number }
  | { kind: "missing" | "unreadable" | "not-file" | "changed" | "symlink" };

/** Read metadata and bytes through one descriptor so the size/type decision and
 * the bytes cannot refer to different path targets. */
async function readStableTextFile(abs: string, maxBytes = Number.MAX_SAFE_INTEGER): Promise<StableFile> {
  let fh;
  try {
    fh = await open(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { kind: code === "ENOENT" ? "missing" : code === "ELOOP" ? "symlink" : "unreadable" };
  }
  try {
    const before = await fh.stat();
    if (!before.isFile()) return { kind: "not-file" };
    if (before.size > maxBytes) return { kind: "too-large", size: before.size };
    const data = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await fh.read(data, offset, data.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await fh.stat();
    if (
      offset !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    ) {
      return { kind: "changed" };
    }
    return { kind: "ok", size: before.size, mtimeMs: before.mtimeMs, nlink: before.nlink, text: data.toString("utf8") };
  } catch {
    return { kind: "unreadable" };
  } finally {
    await fh.close().catch(() => undefined);
  }
}

/* ---------------- ① 运行面装载 ---------------- */

export interface LoadedTool {
  kind: "tool";
  id: string;
  version: string;
  dir: string;
  entry: string;
  source: string;
  deps: string[];
}

export interface LoadedContentPack {
  kind: "content-pack";
  id: string;
  version: string;
  dir: string;
  /** 除 manifest.json 外的全部常规文件（相对包根的 / 分隔路径，按路径排序）。 */
  files: { rel: string; text: string }[];
}

export interface LoadedDesktopPanel {
  kind: "desktop-panel";
  id: string;
  version: string;
  dir: string;
  entry: string;
  source: string;
  deps: string[];
}

export type LoadedBundle = LoadedTool | LoadedContentPack | LoadedDesktopPanel;

/** 运行面收的 kind（与提交管线同一面；service / plugin 不进运行面）。 */
export const LOADABLE_KINDS: readonly BundleKind[] = ["tool", "content-pack", "desktop-panel"];

/** 膨胀护栏：装载面复审用（与提案管线同一档帽）。 */
const DEFAULT_CAPS = { maxFiles: 256, maxFileBytes: 1_048_576, maxTotalBytes: 8 * 1_048_576 } as const;

export interface RuntimeLoaderOptions {
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

function sortedJoin(xs: readonly string[]): string {
  return [...xs].sort().join("\u0000");
}

/** 盘上 manifest 与账本定格的**四面对面**（kind / entry / permissions / gates）逐项比对，
 *  返回漂移面的点名。装载器与 staging↔账本一致性检查共用这一份——同一条漂移口径不在文件里写两遍
 *  （两处各抄一遍，改一处漏一处就是「装载放行、查账报警」这种自相矛盾的账）。 */
function manifestFaceDrift(manifest: BundleManifest, v: IndexVersion): string[] {
  const drift: string[] = [];
  if (manifest.kind !== v.kind) drift.push(`kind（${manifest.kind} vs ${v.kind}）`);
  if ((manifest.entry ?? null) !== (v.entry ?? null)) {
    drift.push(`entry（${manifest.entry ?? "无"} vs ${v.entry ?? "无"}）`);
  }
  if (sortedJoin(manifest.permissions) !== sortedJoin(v.permissions)) drift.push("permissions");
  if (sortedJoin(manifest.gates) !== sortedJoin(v.declaredGates)) drift.push("gates");
  return drift;
}

export class RuntimeLoader {
  private readonly caps: { maxFiles: number; maxFileBytes: number; maxTotalBytes: number };

  constructor(private readonly registry: ModuleRegistry, opts: RuntimeLoaderOptions = {}) {
    this.caps = { ...DEFAULT_CAPS, ...opts };
  }

  /** 装载一个已激活版本。version 省略 = 当前 active；显式给值时必须等于 active。 */
  async load(id: string, version?: string): Promise<LoadedBundle> {
    const index = await this.registry.readIndex();
    const entry = index.bundles[id];
    if (entry === undefined) throw new LoadRefusedError(`${id} 不在账本上——未注册的包不上运行面`);
    const active = entry.active?.version;
    if (active === undefined) throw new LoadRefusedError(`${id} 没有激活版本——先过全门并激活，才谈得上装载`);
    if (version !== undefined && version !== active) {
      throw new LoadRefusedError(`${id}@${version} 不是当前激活版本（active = ${active}）——未激活的包不上运行面`);
    }
    const v = entry.versions[active];
    if (v === undefined) throw new LoadRefusedError(`${id}@${active} 的注册记录缺位——账本与激活指针不一致，先查账`);
    if (!LOADABLE_KINDS.includes(v.kind)) {
      throw new LoadRefusedError(`kind=${v.kind} 不进运行面（运行面只认 ${LOADABLE_KINDS.join(" / ")}）`);
    }
    const dir = join(this.registry.paths.installed, id, active);
    const manifest = await this.readManifest(dir, id, active);
    this.assertNoDrift(id, active, manifest, v);
    if (manifest.kind === "content-pack") {
      return { kind: "content-pack", id, version: active, dir, files: await this.readPackFiles(dir) };
    }
    const { entry: entryRel, source } = await this.readEntry(dir, manifest, id, active);
    if (manifest.kind === "desktop-panel") {
      return { kind: "desktop-panel", id, version: active, dir, entry: entryRel, source, deps: manifest.deps };
    }
    return { kind: "tool", id, version: active, dir, entry: entryRel, source, deps: manifest.deps };
  }

  private async readManifest(dir: string, id: string, version: string): Promise<BundleManifest> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as unknown;
    } catch (err) {
      throw new LoadRefusedError(
        `${id}@${version} 的盘上 manifest 读不了：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    let manifest: BundleManifest;
    try {
      manifest = parseBundleManifest(raw, this.registry.knownGates);
    } catch (err) {
      throw new LoadRefusedError(
        `${id}@${version} 的盘上 manifest 不合契约：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (manifest.id !== id || manifest.version !== version) {
      throw new LoadRefusedError(
        `盘上 manifest 身份与激活指针不一致：${manifest.id}@${manifest.version} vs ${id}@${version}——先查这本账`,
      );
    }
    return manifest;
  }

  /** 盘上 manifest 与注册时定格的四面必须逐字一致（kind / entry / permissions / gates）。 */
  private assertNoDrift(id: string, version: string, manifest: BundleManifest, v: IndexVersion): void {
    const drift = manifestFaceDrift(manifest, v);
    if (drift.length > 0) {
      throw new LoadRefusedError(
        `${id}@${version} 的盘上 manifest 与注册定格不一致：${drift.join("、")}——装载面拒绝带着漂移的包上线`,
      );
    }
  }

  private async readEntry(
    dir: string,
    manifest: BundleManifest,
    id: string,
    version: string,
  ): Promise<{ entry: string; source: string }> {
    if (manifest.entry === undefined) {
      throw new LoadRefusedError(`${id}@${version} 的 manifest 没写 entry——装载面没有入口可读`);
    }
    const rel = manifest.entry;
    const abs = join(dir, rel);
    const file = await readStableTextFile(abs, this.caps.maxFileBytes);
    if (file.kind === "missing" || file.kind === "unreadable") {
      throw new LoadRefusedError(`${id}@${version} 的 entry ${rel} 不在安装目录里——盘上字节与账本不符，拒绝装载`);
    }
    if (file.kind === "not-file") {
      throw new LoadRefusedError(`${id}@${version} 的 entry ${rel} 不是常规文件——entry 必须是一份普通文件`);
    }
    if (file.kind === "too-large") {
      throw new LoadRefusedError(
        `${id}@${version} 的 entry ${rel} 有 ${String(file.size)} 字节，越过装载帽 ${String(this.caps.maxFileBytes)}`,
      );
    }
    if (file.kind === "changed") {
      throw new LoadRefusedError(`${id}@${version} 的 entry ${rel} 在读取期间发生变化——拒绝装载`);
    }
    if (file.kind !== "ok") {
      throw new LoadRefusedError(`${id}@${version} 的 entry ${rel} 不能形成稳定快照——拒绝装载`);
    }
    return { entry: rel, source: file.text };
  }

  /** 收集包内文本文件（不含 manifest.json 自身），按路径排序并按帽计数。 */
  private async readPackFiles(dir: string): Promise<{ rel: string; text: string }[]> {
    const files: { rel: string; text: string }[] = [];
    let total = 0;
    const walk = async (cur: string): Promise<void> => {
      const entries = await readdir(cur, { withFileTypes: true });
      for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
        const abs = join(cur, e.name);
        if (e.isDirectory()) {
          await walk(abs);
          continue;
        }
        if (!e.isFile()) continue;
        const rel = relative(dir, abs).split(sep).join("/");
        if (rel === "manifest.json") continue;
        if (files.length + 1 > this.caps.maxFiles) {
          throw new LoadRefusedError(`${dir} 的文件数越过装载帽 ${String(this.caps.maxFiles)}`);
        }
        const file = await readStableTextFile(abs, this.caps.maxFileBytes);
        if (file.kind !== "ok") {
          throw new LoadRefusedError(`${dir}/${rel} 不能形成稳定快照（${file.kind}）`);
        }
        total += file.size;
        if (total > this.caps.maxTotalBytes) {
          throw new LoadRefusedError(`${dir} 的文本体量越过装载帽（单文件 ${String(this.caps.maxFileBytes)} / 总量 ${String(this.caps.maxTotalBytes)}）`);
        }
        files.push({ rel, text: file.text });
      }
    };
    await walk(dir);
    return files;
  }
}

/* ---------------- ② canary 观察期 ---------------- */

export type CanaryState = "observing" | "promoted" | "rolled-back" | "degraded";

/** 退化判据名（与方案 §8 同词）。 */
export type CanaryRule = "consecutive-failures" | "no-progress" | "cost-per-progress";

export interface CanaryDegradation {
  rule: CanaryRule;
  detail: string;
}

/** 一轮读数（EvolutionSignals 的子集，结构上可直传）。 */
export interface CanarySample {
  /** 样本标识（run / 会话 id）；只用于 lesson 的证据行。 */
  runId?: string;
  verifyOutcome: "green" | "red" | "none";
  costMeasurable: boolean;
  tokensPerBoundary: number | null;
  spendAfterLastBoundary: number;
}

export interface CanarySpec {
  id: string;
  /** 样本上限：达到且无退化 ⇒ promoted（缺省 5）。 */
  maxSamples?: number;
  /** 连续失败样本上限（缺省 2）。 */
  maxConsecutiveFailures?: number;
  /** tokensPerBoundary 相对基线的退化倍数（缺省 2）。 */
  costDegradeFactor?: number;
  /** 基线读数；缺省 / null = 没有可比读数，cost-per-progress 不判（不编造）。 */
  baselineTokensPerBoundary?: number | null;
}

export interface CanaryObservation {
  id: string;
  candidateVersion: string;
  previousVersion: string | null;
  state: CanaryState;
  samples: number;
  consecutiveFailures: number;
  baselineTokensPerBoundary: number | null;
  maxSamples: number;
  maxConsecutiveFailures: number;
  costDegradeFactor: number;
  degradations: CanaryDegradation[];
  /** rolled-back 时的落点（= previousVersion）。 */
  rollbackTo?: string;
  /** 回滚未成时的原因（state = degraded 时必有）。 */
  rollbackError?: string;
  /** lesson 有没有落盘（回滚失败也照写；写盘失败不阻塞回滚，只在这里记账）。 */
  lessonWritten?: boolean;
  lessonError?: string;
  /** 观察档有没有落盘（跨进程续档的凭据；写盘失败不动回滚结论，只在这里记账）。 */
  recordWritten?: boolean;
  recordError?: string;
  startedAt: string;
  endedAt?: string;
}

export interface CanaryObserveResult {
  observation: CanaryObservation;
  /** 本次 observe 触发了状态迁移（退化回滚 / 观察期满）。 */
  acted: boolean;
}

export interface CanaryLessonInput {
  workspace: string;
  topic: string;
  body: string;
  nowISO: string;
}

/* ---------------- 观察档（跨进程续档） ---------------- */

/** 观察档的文件版本；读不认的版本 = 读不动（不许当成"没有档"）。 */
const CANARY_RECORD_VERSION = 1;

/** 观察档路径：`<workspace>/.agent/canary/<id>.json`（与 evolution.json / memory 同一个家当目录）。
 *  id 折成文件名字符——bundle id 的字符集本来就在允许面内，这一手是给非 bundle id 兜底的。 */
export function canaryRecordPathFor(workspace: string, id: string): string {
  return join(workspace, ".agent", "canary", id.replace(/[^A-Za-z0-9._-]/gu, "-") + ".json");
}

/** 读回一份观察档并验形状。形状不对即抛（调用方按"读不动"处理，不许折成"没有档"）。 */
function parseCanaryRecord(raw: unknown): CanaryObservation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("观察档不是 JSON 对象");
  const r = raw as Record<string, unknown>;
  if (r.version !== CANARY_RECORD_VERSION) throw new Error(`观察档版本不认：${JSON.stringify(r.version)}`);
  if (typeof r.id !== "string" || typeof r.candidateVersion !== "string") throw new Error("观察档缺 id / candidateVersion");
  if (r.state !== "observing" && r.state !== "promoted" && r.state !== "rolled-back" && r.state !== "degraded") {
    throw new Error(`观察档 state 不在取值域：${JSON.stringify(r.state)}`);
  }
  for (const key of ["samples", "consecutiveFailures", "maxSamples", "maxConsecutiveFailures", "costDegradeFactor"]) {
    if (typeof r[key] !== "number") throw new Error(`观察档缺 ${key}`);
  }
  if (r.baselineTokensPerBoundary !== null && typeof r.baselineTokensPerBoundary !== "number") {
    throw new Error("观察档 baselineTokensPerBoundary 既不是数字也不是 null");
  }
  if (!Array.isArray(r.degradations)) throw new Error("观察档缺 degradations");
  if (typeof r.startedAt !== "string") throw new Error("观察档缺 startedAt");
  return raw as CanaryObservation;
}

export type CanaryTickOutcome =
  /** 这次把账本上还开着的档接回内存并收了一个样本。 */
  | "resumed"
  /** 档已经结案（promoted / rolled-back / degraded），不再喂样本。 */
  | "settled"
  /** 账本上这个候选已经不在位（回滚 / 又换了新版 / 清退）——档退场，不再喂样本。 */
  | "idle"
  /** 档读不动：既不许当"没有档"重开（那等于把连败计数静默清零），也不许覆盖。 */
  | "refused";

export interface CanaryTickResult {
  id: string;
  outcome: CanaryTickOutcome;
  observation: CanaryObservation | null;
  /** 本次 tick 触发了状态迁移（退化回滚 / 观察期满晋升）。 */
  acted: boolean;
  /** outcome = refused 时的原因（读不动的那一格，不是"没事发生"）。 */
  refused?: string;
}

export interface CanaryControllerOptions {
  registry: ModuleRegistry;
  /** 回滚执行面；缺省 new Installer(registry)。 */
  installer?: Installer;
  /** 装载器；缺省 new RuntimeLoader(registry)。 */
  loader?: RuntimeLoader;
  /** 回滚的账面 actor（缺省 "canary"）。 */
  actor?: string;
  /** lesson 落盘的工作区；缺省从账本根推出（<workspace>/modules/registry.jsonl → <workspace>）。 */
  workspace?: string;
  /** 测试注入口：lesson 写盘；缺省走 memory store 的 writeTopic。 */
  writeLesson?: (input: CanaryLessonInput) => Promise<void>;
  /** 测试注入口：观察档写盘；缺省原子写 .agent/canary/<id>.json。 */
  writeRecord?: (path: string, record: CanaryObservation) => Promise<void>;
  /** 测试注入口：观察档读盘（读不动即抛）；缺省读同名文件并验形状。 */
  readRecord?: (path: string) => Promise<CanaryObservation | null>;
}

/** lesson 的 topic 名：`lesson-canary-<id>-<version>`（非法字符折成 "-"，总长压进 topic 规矩的 64）。 */
export function canaryLessonTopic(id: string, version: string): string {
  const raw = LESSON_TOPIC_PREFIX + "canary-" + (id + "-" + version).replace(/[^A-Za-z0-9_-]/gu, "-");
  return raw.slice(0, 64);
}

function cloneObservation(obs: CanaryObservation): CanaryObservation {
  return { ...obs, degradations: obs.degradations.map((d) => ({ ...d })) };
}

export class CanaryController {
  private readonly observations = new Map<string, CanaryObservation>();
  private readonly installer: Installer;
  private readonly loader: RuntimeLoader;
  private readonly actor: string;
  /** 同实例重入（tickAll → observe）：文件锁只取一次。 */
  private lockDepth = 0;

  constructor(private readonly opts: CanaryControllerOptions) {
    this.installer = opts.installer ?? new Installer(opts.registry);
    this.loader = opts.loader ?? new RuntimeLoader(opts.registry);
    this.actor = opts.actor ?? "canary";
  }

  /** 跨进程互斥：观察档是读-改-写整文件；两实例同时收束会各写 N+1（丢样本）或互相撤销回滚。
   *  锁只覆盖「读档 → 判据 → 落盘」短段；O_EXCL + 持锁进程探活 + 60s 陈旧兜底。
   *
   *  为什么探活必须优先于时钟：持锁者会把 pid 写进锁文件（下面 `writeFile(String(process.pid))`），
   *  而"陈旧"从前只按 `Date.now() - mtimeMs > 60s` 判。时钟会跳——NTP 校正、虚拟机恢复、
   *  手动改表都能让它往回走。往回一跳，一个**早就不在的进程**留下的锁永远读不出"超过 60s"，
   *  于是 canary 从这一秒起永远 refused，盘上却没有任何东西能解开它。探活不受时钟影响：
   *  pid 不在就是不在。反过来它也堵住另一个方向——活着的进程卡住超过 60s 时，旧逻辑会把它的锁
   *  当陈旧收走，两个实例同时写同一份观察档（那正是这把锁要防的事）。 */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    if (this.lockDepth > 0) return await fn();
    const dir = join(this.workspace(), ".agent");
    // 锁文件放 `.agent/` 而不是 `.agent/canary/`：后者是「有观察档」的事实，
    // tickAll 在零档时只取锁不该顺手建出那个目录（判据钉着「没有档 = 目录不存在」）。
    const lockPath = join(dir, ".canary.lock");
    await mkdir(dir, { recursive: true });
    const acquire = async (): Promise<FileHandle> => {
      for (;;) {
        try {
          return await open(lockPath, "wx", 0o600);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
          // Serialize stale-lock inspection AND replacement. Without this second
          // exclusive name, two reclaimers can each read a dead PID and the later
          // one can delete the other's newly acquired live lock.
          const reclaimPath = lockPath + ".reclaim";
          let reclaim: FileHandle;
          try {
            reclaim = await open(reclaimPath, "wx", 0o600);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            throw new CanaryRefusedError("另一实例正在恢复观察档锁；若恢复进程已退出，请确认后清理 .agent/.canary.lock.reclaim");
          }
          let acquired: FileHandle | null = null;
          let retry = false;
          try {
            await reclaim.writeFile(String(process.pid));
            const lock = await readStableTextFile(lockPath, 1024);
            if (lock.kind === "missing") retry = true;
            else if (lock.kind === "symlink") {
              throw new CanaryRefusedError("观察档锁是软链，拒绝跟随；请人工检查 .agent/.canary.lock");
            }
            else if (lock.kind !== "ok") {
              throw new CanaryRefusedError("观察档锁不能形成稳定快照，请人工检查 .agent/.canary.lock");
            } else if (lock.nlink !== 1) {
              throw new CanaryRefusedError("观察档锁不是独立常规文件，请人工检查 .agent/.canary.lock");
            } else {
              const holder = Number.parseInt(lock.text.trim(), 10);
              const released = lock.text.trim() === "released";
              // 探活：`kill(pid, 0)` 只问存在。EPERM＝存在但不是我的进程 ⇒ 算活着。
              let alive = false;
              if (Number.isInteger(holder) && holder > 0) {
                try { process.kill(holder, 0); alive = true; }
                catch (e) { alive = (e as NodeJS.ErrnoException).code === "EPERM"; }
              }
              if (alive) throw new CanaryRefusedError("另一实例正在更新观察档，请稍后重试");
              // pid 读不出时不猜，退回 60s 时间兜底。
              if (!released && (!Number.isInteger(holder) || holder <= 0)) {
                if (Date.now() - lock.mtimeMs <= 60_000) {
                  throw new CanaryRefusedError("另一实例正在更新观察档，请稍后重试");
                }
              }
              // Never write through the inspected inode. A hardlink made after
              // inspection cannot be redirected into a victim because takeover
              // creates a fresh inode and atomically replaces only the lock name.
              const replacement = tmpPathFor(lockPath);
              let next: FileHandle | undefined;
              try {
                next = await open(
                  replacement,
                  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
                  0o600,
                );
                await next.write(String(process.pid), 0);
                await rename(replacement, lockPath);
                acquired = next;
              } catch (error) {
                if (next !== undefined) await next.close().catch(() => undefined);
                await rm(replacement, { force: true }).catch(() => undefined);
                throw error;
              }
            }
          } finally {
            await reclaim.close().catch(() => undefined);
            await rm(reclaimPath, { force: true }).catch(() => undefined);
          }
          if (acquired !== null) return acquired;
          if (retry) continue;
        }
      }
    };
    const fh = await acquire();
    this.lockDepth += 1;
    try {
      await fh.write(String(process.pid), 0);
      return await fn();
    } finally {
      this.lockDepth -= 1;
      await fh.write("released", 0).catch(() => undefined);
      await fh.close().catch(() => undefined);
    }
  }

  /** 进入观察期：先装载一次（装载不过 ⇒ 拒绝开始，原因即装载拒绝原因），再把观察档写下才认这档。
   *
   *  开档的**触发者是装上位的那个宿主**（它知道刚装了什么），不靠"active 比 previous 新"这类推断——
   *  账本上 active/previous 的 activatedAt 会被 rollback 重新盖章（registry.ts 的指针对换），
   *  同一毫秒内两次动指针时那种推断会翻车（把回滚后的落点又判成新候选）。 */
  async begin(spec: CanarySpec): Promise<CanaryObservation> {
    return await this.withLock(() => this.beginLocked(spec));
  }

  private async beginLocked(spec: CanarySpec): Promise<CanaryObservation> {
    const existing = this.observations.get(spec.id);
    if (existing !== undefined) {
      throw new CanaryRefusedError(`${spec.id} 已有一档观察记录（state=${existing.state}）——先收束再开新的`);
    }
    const index = await this.opts.registry.readIndex();
    const entry = index.bundles[spec.id];
    if (entry === undefined) throw new CanaryRefusedError(`${spec.id} 不在账本上——先注册、过门、安装`);
    const candidate = entry.active?.version;
    if (candidate === undefined) {
      throw new CanaryRefusedError(`${spec.id} 没有激活版本——观察期的对象是已激活的候选版本`);
    }
    // 盘上还开着一档同一个候选的观察档 ⇒ 拒绝重开：重开等于把连败计数静默清零。
    // （便宜检查放在装载之前：already-open 这一格不该为读一遍包体买单。）
    const onDisk = await this.readRecordOf(spec.id);
    if (onDisk.kind === "corrupt") {
      throw new CanaryRefusedError(`${spec.id} 的观察档读不出来（${onDisk.detail}）——先查清这份档再开新的`);
    }
    if (onDisk.kind === "ok" && onDisk.record.state === "observing" && onDisk.record.candidateVersion === candidate) {
      throw new CanaryRefusedError(
        `${spec.id}@${candidate} 盘上已有一档没结案的观察记录（samples=${String(onDisk.record.samples)}）——续档走 tickAll，别重开`,
      );
    }
    await this.loader.load(spec.id, candidate);
    const obs: CanaryObservation = {
      id: spec.id,
      candidateVersion: candidate,
      previousVersion: entry.previous?.version ?? null,
      state: "observing",
      samples: 0,
      consecutiveFailures: 0,
      baselineTokensPerBoundary: spec.baselineTokensPerBoundary ?? null,
      maxSamples: spec.maxSamples ?? 5,
      maxConsecutiveFailures: spec.maxConsecutiveFailures ?? 2,
      costDegradeFactor: spec.costDegradeFactor ?? 2,
      degradations: [],
      startedAt: new Date().toISOString(),
    };
    try {
      await this.writeRecordOf(obs);
      obs.recordWritten = true;
    } catch (err) {
      // 看不见的观察期不算观察期：跨进程都读不到的一档，宁可从入口就拒。
      throw new CanaryRefusedError(
        `${spec.id}@${candidate} 的观察档写不下：${err instanceof Error ? err.message : String(err)}——先修好盘上这一格再开观察期`,
      );
    }
    this.observations.set(spec.id, obs);
    return cloneObservation(obs);
  }

  /** 收一个样本：命中退化规则 ⇒ 回退 + 沉淀 lesson；样本用满且无退化 ⇒ promoted。
   *  每一档都回写观察档（跨进程续档的凭据）；写盘失败只记 recordWritten / recordError，
   *  不改回滚结论（同 lesson 的口径：已经发生的事实不因记账失败而改）。 */
  async observe(id: string, sample: CanarySample): Promise<CanaryObserveResult> {
    return await this.withLock(() => this.observeLocked(id, sample));
  }

  private async observeLocked(id: string, sample: CanarySample): Promise<CanaryObserveResult> {
    const obs = this.observations.get(id);
    if (obs === undefined) throw new CanaryRefusedError(`${id} 没有进行中的观察期——先 begin`);
    if (obs.state !== "observing") return { observation: cloneObservation(obs), acted: false };
    let acted = false;
    obs.samples += 1;
    if (sample.verifyOutcome === "red") obs.consecutiveFailures += 1;
    else if (sample.verifyOutcome === "green") obs.consecutiveFailures = 0;
    // "none"：没有 verify 拍，不计成败、也不打断连败——读数缺席不折成任何一边。
    const degradations = this.judge(obs, sample);
    if (degradations.length > 0) {
      obs.degradations = degradations;
      await this.settle(obs, sample, degradations);
      acted = true;
    } else if (obs.samples >= obs.maxSamples) {
      obs.state = "promoted";
      obs.endedAt = new Date().toISOString();
      acted = true;
    }
    await this.persistRecord(obs);
    return { observation: cloneObservation(obs), acted };
  }

  /** 账本驱动的一档入口：盘上还开着、且账本上候选还在位的档 ⇒ 接回内存收一个样本；
   *  结了案的档不再喂；账本换过人（回滚 / 又换了新版 / 清退）的档退场；读不动的档点名不动。
   *
   *  这是宿主在会话收束时的**一行**：抽完信号把读数喂进来，跨进程续档、越线回滚都在里面。 */
  async tickAll(sample: CanarySample): Promise<CanaryTickResult[]> {
    return await this.withLock(() => this.tickAllLocked(sample));
  }

  private async tickAllLocked(sample: CanarySample): Promise<CanaryTickResult[]> {
    const index = await this.opts.registry.readIndex();
    const scanned = await this.scanRecords();
    const out: CanaryTickResult[] = scanned.corrupt.map((c) => ({
      id: c.id,
      outcome: "refused" as const,
      observation: null,
      acted: false,
      refused: `观察档读不出来：${c.detail}`,
    }));
    for (const record of scanned.records) {
      if (record.state !== "observing") {
        out.push({ id: record.id, outcome: "settled", observation: record, acted: false });
        continue;
      }
      if (index.bundles[record.id]?.active?.version !== record.candidateVersion) {
        out.push({ id: record.id, outcome: "idle", observation: record, acted: false });
        continue;
      }
      // **每次都从盘上那份刷新内存副本**（2026-10-19 独立评审追出）：
      // 旧实现只在内存里**没有**这一档时才 set ⇒ 本进程里已经有一份（可能是上一轮、甚至
      // 另一个实例写下的）旧副本时，盘上刚读出来的新记录被**丢掉**，接着拿那份旧副本去判
      // ⇒ 两个实例各判各的、样本各丢各的，甚至能**为一个从没发生过的漂移做回滚**。
      // 根因：O_EXCL 那把锁只串行化了**写**，没串行化"读-改-写"（另一个实例的 observe 落盘
      // 之后，本进程的内存副本并不会自动跟着变）。盘上那份才是真相（每次 observe 都回写）。
      this.observations.set(record.id, record);
      const res = await this.observe(record.id, sample);
      out.push({ id: record.id, outcome: "resumed", observation: res.observation, acted: res.acted });
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** 盘上还开着的观察档（state=observing 且账本上候选还在位）。只读：不喂样本、不改账、不动回滚。 */
  async openObservations(): Promise<CanaryObservation[]> {
    const index = await this.opts.registry.readIndex();
    const scanned = await this.scanRecords();
    return scanned.records
      .filter((r) => r.state === "observing" && index.bundles[r.id]?.active?.version === r.candidateVersion)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  status(id: string): CanaryObservation | undefined {
    const obs = this.observations.get(id);
    return obs === undefined ? undefined : cloneObservation(obs);
  }

  /** 单档路径（写盘与读盘唯一来源）。 */
  recordPathOf(id: string): string {
    return canaryRecordPathFor(this.workspace(), id);
  }

  private async writeRecordOf(obs: CanaryObservation): Promise<void> {
    const path = this.recordPathOf(obs.id);
    if (this.opts.writeRecord !== undefined) {
      await this.opts.writeRecord(path, obs);
      return;
    }
    await writeFileAtomic(path, JSON.stringify({ version: CANARY_RECORD_VERSION, ...obs }, null, 2) + "\n");
  }

  /** 读盘上的观察档：absent / ok / corrupt 三态分开——"文件不在"与"文件坏了"不是一个数。 */
  private async readRecordOf(
    id: string,
  ): Promise<{ kind: "absent" } | { kind: "ok"; record: CanaryObservation } | { kind: "corrupt"; detail: string }> {
    const path = this.recordPathOf(id);
    try {
      if (this.opts.readRecord !== undefined) {
        const record = await this.opts.readRecord(path);
        return record === null ? { kind: "absent" } : { kind: "ok", record };
      }
      return { kind: "ok", record: parseCanaryRecord(JSON.parse(await readFile(path, "utf8")) as unknown) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
      return { kind: "corrupt", detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private async persistRecord(obs: CanaryObservation): Promise<void> {
    try {
      await this.writeRecordOf(obs);
      obs.recordWritten = true;
      delete obs.recordError;
    } catch (err) {
      obs.recordWritten = false;
      obs.recordError = err instanceof Error ? err.message : String(err);
    }
  }

  /** 扫一遍观察档目录（只读）：能读的按 id 返回，读不动的单独点名。 */
  private async scanRecords(): Promise<{ records: CanaryObservation[]; corrupt: { id: string; detail: string }[] }> {
    const dir = join(this.workspace(), ".agent", "canary");
    let names: string[];
    try {
      names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
    } catch {
      return { records: [], corrupt: [] };
    }
    const records: CanaryObservation[] = [];
    const corrupt: { id: string; detail: string }[] = [];
    for (const name of names) {
      const id = name.slice(0, -".json".length);
      const got = await this.readRecordOf(id);
      if (got.kind === "ok") records.push(got.record);
      else if (got.kind === "corrupt") corrupt.push({ id, detail: got.detail });
    }
    return { records, corrupt };
  }

  private judge(obs: CanaryObservation, sample: CanarySample): CanaryDegradation[] {
    const out: CanaryDegradation[] = [];
    if (obs.consecutiveFailures >= obs.maxConsecutiveFailures) {
      out.push({
        rule: "consecutive-failures",
        detail: `连续 ${String(obs.consecutiveFailures)} 个样本 verify 未转绿`,
      });
    }
    // 不把「成本不可测」判成 no-progress：measurable=false 的常见成因就是本跑没有模型侧
    // verify 调用（verified 边界=0），此时 spendAfterLastBoundary 等于整跑 token。
    // 2026-10-16 已裁决「不可测 ≠ 无前进」（strategy-patch/patch-effect/advice 同口径）；
    // 旧规则会让健康版本被一次测量缺口直接回滚。
    if (
      sample.costMeasurable &&
      sample.tokensPerBoundary !== null &&
      obs.baselineTokensPerBoundary !== null &&
      obs.baselineTokensPerBoundary > 0 &&
      sample.tokensPerBoundary > obs.baselineTokensPerBoundary * obs.costDegradeFactor
    ) {
      const ratio = (sample.tokensPerBoundary / obs.baselineTokensPerBoundary).toFixed(1);
      out.push({
        rule: "cost-per-progress",
        detail: `每次前进 ${String(sample.tokensPerBoundary)} token，是基线 ${String(obs.baselineTokensPerBoundary)} 的 ${ratio} 倍`,
      });
    }
    return out;
  }

  private async settle(
    obs: CanaryObservation,
    sample: CanarySample,
    degradations: readonly CanaryDegradation[],
  ): Promise<void> {
    if (obs.previousVersion === null) {
      obs.state = "degraded";
      obs.rollbackError = `${obs.id} 没有 previous 版本可回退（这是它的首个激活版本）`;
    } else {
      try {
        // 只回退到**观察记录里那个**版本（账本的 previous 位期间被别人动过就拒）：
        // 否则装上的版本与 `rollbackTo` 记的不一致 ⇒ 记录在撒谎。
        await this.installer.rollbackInstalled(obs.id, this.actor, obs.previousVersion ?? undefined);
        obs.state = "rolled-back";
        obs.rollbackTo = obs.previousVersion;
      } catch (err) {
        obs.state = "degraded";
        obs.rollbackError = err instanceof Error ? err.message : String(err);
      }
    }
    obs.endedAt = new Date().toISOString();
    // lesson 与回滚是两笔账：回滚成没成都照写；写盘失败只记账，不改回滚结论。
    try {
      await this.writeLesson(obs, sample, degradations);
      obs.lessonWritten = true;
    } catch (err) {
      obs.lessonWritten = false;
      obs.lessonError = err instanceof Error ? err.message : String(err);
    }
  }

  private async writeLesson(
    obs: CanaryObservation,
    sample: CanarySample,
    degradations: readonly CanaryDegradation[],
  ): Promise<void> {
    const why = degradations.map((d) => d.rule).join(" + ");
    const outcome =
      obs.state === "rolled-back"
        ? `已回退到 ${String(obs.rollbackTo)}`
        : `回退未成（${String(obs.rollbackError)}）`;
    const headline = `SEMA canary：${obs.id}@${obs.candidateVersion} 观察期退化（${why}），${outcome}`;
    const body = [
      headline,
      SESSION_LINE_PREFIX + "canary",
      ...degradations.map((d) => "- " + d.rule + "：" + d.detail),
      EVIDENCE_LINE_PREFIX +
        `[canary] ${obs.id}@${obs.candidateVersion} · run=${sample.runId ?? "unknown"} · samples=${String(obs.samples)}`,
    ].join("\n");
    const nowISO = obs.endedAt ?? new Date().toISOString();
    const workspace = this.workspace();
    const topic = canaryLessonTopic(obs.id, obs.candidateVersion);
    if (this.opts.writeLesson !== undefined) {
      await this.opts.writeLesson({ workspace, topic, body, nowISO });
      return;
    }
    await writeTopic(projectMemoryDir(workspace), topic, LESSON_MEMORY_TYPE, body, nowISO);
  }

  private workspace(): string {
    if (this.opts.workspace !== undefined) return this.opts.workspace;
    // 账本布局：<workspace>/modules/registry.jsonl ⇒ 往上一级是 modules、再上一级是工作区。
    return dirname(dirname(this.opts.registry.paths.log));
  }
}

/* ---------------- staging ↔ 账本一致性 ---------------- */

export type ConsistencyFindingKind =
  | "staging-unregistered"
  | "staging-manifest-invalid"
  | "staging-identity-mismatch"
  | "staging-drift"
  | "ledger-staging-missing";

export interface ConsistencyFinding {
  kind: ConsistencyFindingKind;
  id: string;
  version: string;
  detail: string;
}

export interface StagingLedgerReport {
  ok: boolean;
  /** staging 里的版本目录数（已清退版本的残留不计入判定，但计入这个数）。 */
  staged: number;
  findings: ConsistencyFinding[];
}

/**
 * 比对 staging 目录树与账本，找出「有一边不在」或「两边对不上」的格子。只读、不改。
 *
 * 两个方向都查：
 *   · staging 有目录 ⇒ 账本必须有登记（pipeline 先落 staging 再登记，中间崩溃会留下孤儿）；
 *     staging 的 manifest 必须仍然合法、身份一致、且四面与注册定格一致（诡异面在装之前被发现）。
 *   · 账本有未清退版本 ⇒ staging 目录必须在（installStaged 从 staging 复制；两边同源，
 *     缺一边说明盘上动过手）。
 * 已清退（prunedAt）的版本不在这本检查的账上：prune 只移 installed，staging 残留是正常形态。
 */
export async function checkStagingLedgerConsistency(registry: ModuleRegistry): Promise<StagingLedgerReport> {
  const findings: ConsistencyFinding[] = [];
  const stagingRoot = registry.paths.stagingRoot;
  const index = await registry.readIndex();

  let idDirs: string[] = [];
  try {
    idDirs = (await readdir(stagingRoot)).sort();
  } catch {
    idDirs = [];
  }
  let staged = 0;
  for (const id of idDirs) {
    let versionNames: string[] = [];
    try {
      versionNames = (await readdir(join(stagingRoot, id))).sort();
    } catch {
      continue;
    }
    for (const version of versionNames) {
      const dir = join(stagingRoot, id, version);
      let isDir = false;
      try {
        isDir = (await stat(dir)).isDirectory();
      } catch {
        isDir = false;
      }
      if (!isDir) continue;
      staged += 1;
      const v = index.bundles[id]?.versions[version];
      if (v === undefined) {
        findings.push({
          kind: "staging-unregistered",
          id,
          version,
          detail: "staging 里有目录，账本里却查不到这个版本——先 registerStaged，或把这堆孤儿清掉",
        });
        continue;
      }
      if (v.prunedAt !== undefined) continue; // 已清退：staging 残留是正常形态，不在本账上。
      let manifest: BundleManifest;
      try {
        manifest = parseBundleManifest(
          JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as unknown,
          registry.knownGates,
        );
      } catch (err) {
        findings.push({
          kind: "staging-manifest-invalid",
          id,
          version,
          detail: `staging manifest 读不了/不合契约：${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
      if (manifest.id !== id || manifest.version !== version) {
        findings.push({
          kind: "staging-identity-mismatch",
          id,
          version,
          detail: `目录路径与 manifest 身份不一致：${manifest.id}@${manifest.version}`,
        });
        continue;
      }
      const drift = manifestFaceDrift(manifest, v);
      if (drift.length > 0) {
        findings.push({
          kind: "staging-drift",
          id,
          version,
          detail: `staging manifest 与注册定格不一致：${drift.join("、")}`,
        });
      }
    }
  }

  for (const id of Object.keys(index.bundles).sort()) {
    const entry = index.bundles[id];
    if (entry === undefined) continue;
    for (const version of Object.keys(entry.versions).sort()) {
      const v = entry.versions[version];
      if (v === undefined || v.prunedAt !== undefined) continue;
      let present = false;
      try {
        present = (await stat(join(stagingRoot, id, version))).isDirectory();
      } catch {
        present = false;
      }
      if (!present) {
        findings.push({
          kind: "ledger-staging-missing",
          id,
          version,
          detail: `账本里这个版本尚未清退，staging 目录却不在：${join(stagingRoot, id, version)}——先查清是谁动了盘`,
        });
      }
    }
  }

  return { ok: findings.length === 0, staged, findings };
}
