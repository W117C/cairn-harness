// SEMA Phase 0（方案：docs/sema-proposal.md §3.2/§5）：模块注册表 —— 控制平面的账本。
// 事实源 = <root>/modules/registry.jsonl（追加式事件日志）；registry.index.json 是可重建的投影，
// 丢失/损坏即从日志重放重建，不当作权威。重放与在线操作走**同一套** foldEvent 转移（含全部不变量
// 校验），所以被篡改或乱序的日志在重建时当场红——账本不需要额外的「防篡改检测器」。
//
// Phase 0 只动账本与指针，不部署代码：staging → 运行面的文件部署、canary 观察期、快照回滚
// 属于 Phase 1 的 Installer（方案 §7）。同进程串行（enqueue 链）与 src/main/project-registry.ts
// 同款；跨进程并发不在本层承诺内，索引与日志的全部写入都经同一条队列。
//
// staging 约定（自进化平面的**唯一**写入口，控制平面只读它）：
//   <root>/modules/staging/<id>/<version>/manifest.json
// 路径即身份：registerStaged(id, version) 读该路径下的 manifest 并要求 id/version 与之一致。
//
// 不变量（foldEvent 内逐条执行）：
//  - 同一 (id, version) 只注册一次，且 bundle 的 kind 不得漂移；
//  - activate 前提：版本已注册、未废弃、且 manifest 声明的每一道门都有 pass 记录
//    （同门多录以最后一条为准）——未过验证的包永不激活；
//  - rollback 前提：active 与 previous 都在；语义 = 两者对换（可来回滚，previous 只保一步）；
//  - deprecate 不许落在当前 active 版本上——先回滚再废弃，不留「已废弃却还在位」的模糊态；
//  - prune（清退）只许落在已废弃、且不在 active/previous 位、未清退过的版本上——
//    回滚目标被清退 = 指针将指向盘上没有的文件，这条在账本层就闸死。
import { constants } from "node:fs";
import { mkdir, open, readFile, stat, truncate } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { writeFileAtomic } from "../../atomic-write";
import {
  isBundleId,
  isBundleVersion,
  parseBundleManifest,
  type BundleKind,
} from "./manifest";

const INDEX_VERSION = 1 as const;
const MAX_ACTOR_LENGTH = 128;
const MAX_GATE_LENGTH = 128;
const MAX_DETAIL_LENGTH = 512;

export interface IndexVersion {
  registeredAt: string;
  kind: BundleKind;
  entry?: string;
  /** 注册时 manifest 声明的权限（Phase 1 Permission Broker 的比对面）。 */
  permissions: string[];
  /** 注册时 manifest 声明的门清单；recordGate 只认这份清单内的门。 */
  declaredGates: string[];
  /** 每道门的最新一次结论（同门多录以最后一条为准）。 */
  gates: Record<string, "pass" | "fail">;
  deprecatedAt?: string;
  /** 已清退（installed/staging 文件已移除）；注册记录保留，只作账面事实。 */
  prunedAt?: string;
}

export interface ActiveRef {
  version: string;
  activatedAt: string;
}

export interface BundleEntry {
  kind: BundleKind;
  versions: Record<string, IndexVersion>;
  active?: ActiveRef;
  previous?: ActiveRef;
}

export interface RegistryIndex {
  version: typeof INDEX_VERSION;
  rebuiltAt: string;
  bundles: Record<string, BundleEntry>;
  /** 生成这份索引时 registry.jsonl 的字节数。append 成功而 persist 失败时两者不一致 ⇒ 重建，
   *  否则日志里已落账的事件会永久不可见（旧实现只校验索引 JSON 形状）。 */
  logSize?: number;
}

export type RegistryEvent =
  | { op: "register"; ts: string; id: string; version: string; kind: BundleKind; entry?: string; permissions: string[]; gates: string[]; actor: string }
  | { op: "gate"; ts: string; id: string; version: string; gate: string; passed: boolean; actor: string; detail?: string }
  | { op: "activate"; ts: string; id: string; version: string; actor: string }
  | { op: "rollback"; ts: string; id: string; actor: string }
  | { op: "deprecate"; ts: string; id: string; version: string; actor: string }
  | { op: "prune"; ts: string; id: string; version: string; actor: string };

/** 非法状态转移 / 非法参数（在线操作与重放共用）。 */
export class RegistryStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryStateError";
  }
}

/** 事件日志本身不可信（坏 JSON / 坏形状）：账本拒绝重建，宁可空转也不拿错账继续走。 */
export class RegistryLogCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryLogCorruptError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isActor(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ACTOR_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);
}

export function assertActor(actor: string): void {
  if (!isActor(actor)) throw new RegistryStateError(`actor 非法：须为 1–${MAX_ACTOR_LENGTH} 个无控制字符的字符`);
}

function nowIso(): string {
  return new Date().toISOString();
}

function cloneIndex(index: RegistryIndex): RegistryIndex {
  return JSON.parse(JSON.stringify(index)) as RegistryIndex;
}

function cloneEntry(entry: BundleEntry): BundleEntry {
  return JSON.parse(JSON.stringify(entry)) as BundleEntry;
}

/** 磁盘边界的纵深防御：canonicalRelPath 已保证形状，这里再对**实际**staging 目录核一次包含性。 */
function assertInside(baseDir: string, rel: string, field: string): void {
  const back = relative(resolve(baseDir), resolve(baseDir, rel));
  if (back.length > 0 && (back.startsWith("..") || isAbsolute(back))) {
    throw new RegistryStateError(`${field} 越出包根: ${rel}`);
  }
}

function requireVersion(index: RegistryIndex, id: string, version: string): IndexVersion {
  const entry = index.bundles[id];
  const v = entry?.versions[version];
  if (entry === undefined || v === undefined) throw new RegistryStateError(`${id}@${version} 未注册`);
  return v;
}

/** 唯一一份状态转移（在线与重放共用）；违反不变量抛 RegistryStateError。 */
function foldEvent(index: RegistryIndex, ev: RegistryEvent): void {
  switch (ev.op) {
    case "register": {
      const entry: BundleEntry = index.bundles[ev.id] ?? { kind: ev.kind, versions: {} };
      if (entry.kind !== ev.kind) {
        throw new RegistryStateError(`${ev.id} 的 kind 漂移：${entry.kind} → ${ev.kind}`);
      }
      if (Object.prototype.hasOwnProperty.call(entry.versions, ev.version)) {
        throw new RegistryStateError(`${ev.id}@${ev.version} 重复注册`);
      }
      entry.versions[ev.version] = {
        registeredAt: ev.ts,
        kind: ev.kind,
        ...(ev.entry !== undefined ? { entry: ev.entry } : {}),
        permissions: [...ev.permissions],
        declaredGates: [...ev.gates],
        gates: {},
      };
      index.bundles[ev.id] = entry;
      return;
    }
    case "gate": {
      const v = requireVersion(index, ev.id, ev.version);
      if (!v.declaredGates.includes(ev.gate)) {
        throw new RegistryStateError(`${ev.id}@${ev.version} 未声明门 ${ev.gate}，不得记录其结论`);
      }
      v.gates[ev.gate] = ev.passed ? "pass" : "fail";
      return;
    }
    case "activate": {
      const v = requireVersion(index, ev.id, ev.version);
      if (v.deprecatedAt !== undefined) throw new RegistryStateError(`${ev.id}@${ev.version} 已废弃，不得激活`);
      const notPassed = v.declaredGates.filter((g) => v.gates[g] !== "pass");
      if (notPassed.length > 0) {
        throw new RegistryStateError(`${ev.id}@${ev.version} 还有未过闸门：${notPassed.join("、")}——未过验证的包永不激活`);
      }
      const entry = index.bundles[ev.id]!;
      if (entry.active?.version === ev.version) throw new RegistryStateError(`${ev.id}@${ev.version} 已处于激活位`);
      if (entry.active !== undefined) entry.previous = { ...entry.active };
      entry.active = { version: ev.version, activatedAt: ev.ts };
      return;
    }
    case "rollback": {
      const entry = index.bundles[ev.id];
      if (entry?.active === undefined || entry.previous === undefined) {
        throw new RegistryStateError(`${ev.id} 没有 active+previous 可对换，无从回滚`);
      }
      const a = entry.active;
      entry.active = { version: entry.previous.version, activatedAt: ev.ts };
      entry.previous = { version: a.version, activatedAt: a.activatedAt };
      return;
    }
    case "deprecate": {
      const v = requireVersion(index, ev.id, ev.version);
      if (v.deprecatedAt !== undefined) throw new RegistryStateError(`${ev.id}@${ev.version} 已废弃`);
      if (index.bundles[ev.id]!.active?.version === ev.version) {
        throw new RegistryStateError(`${ev.id}@${ev.version} 在激活位上——先 rollback 再 deprecate`);
      }
      v.deprecatedAt = ev.ts;
      return;
    }
    case "prune": {
      const v = requireVersion(index, ev.id, ev.version);
      if (v.deprecatedAt === undefined) throw new RegistryStateError(`${ev.id}@${ev.version} 未废弃，不得清退`);
      const entry = index.bundles[ev.id]!;
      if (entry.active?.version === ev.version || entry.previous?.version === ev.version) {
        throw new RegistryStateError(`${ev.id}@${ev.version} 在 active/previous 位上——回滚目标不许清退`);
      }
      if (v.prunedAt !== undefined) throw new RegistryStateError(`${ev.id}@${ev.version} 已清退`);
      v.prunedAt = ev.ts;
      return;
    }
  }
}

export interface PruneCandidate {
  id: string;
  version: string;
  deprecatedAt: string;
}

/** 控制平面的模块账本：JSONL 事实源 + 可重建索引 + 原子指针切换。 */
export class ModuleRegistry {
  private writes: Promise<unknown> = Promise.resolve();
  private readonly logPath: string;
  private readonly indexPath: string;
  private readonly stagingRoot: string;
  private readonly installedRoot: string;

  constructor(rootDir: string, private readonly opts: { knownGates: ReadonlySet<string> }) {
    const modulesDir = join(rootDir, "modules");
    this.logPath = join(modulesDir, "registry.jsonl");
    this.indexPath = join(modulesDir, "registry.index.json");
    this.stagingRoot = join(modulesDir, "staging");
    this.installedRoot = join(modulesDir, "installed");
  }

  get knownGates(): ReadonlySet<string> {
    return this.opts.knownGates;
  }

  get paths(): { log: string; index: string; stagingRoot: string; installed: string } {
    return { log: this.logPath, index: this.indexPath, stagingRoot: this.stagingRoot, installed: this.installedRoot };
  }

  /** staging 目录约定；id/version 先过形状（它们直接拼进路径，这里就是路径安全闸）。 */
  stagingDir(id: string, version: string): string {
    if (!isBundleId(id)) throw new RegistryStateError(`id 非法: ${JSON.stringify(id)}`);
    if (!isBundleVersion(version)) throw new RegistryStateError(`version 非法: ${JSON.stringify(version)}`);
    return join(this.stagingRoot, id, version);
  }

  /** 登记一个 staged 包：读 staging manifest、按契约校验、路径即身份核对、entry 包含性核对。 */
  async registerStaged(id: string, version: string, actor: string): Promise<BundleEntry> {
    return await this.enqueue(async () => {
      assertActor(actor);
      const dir = this.stagingDir(id, version);
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as unknown;
      } catch (err) {
        throw new RegistryStateError(
          `staging 里读不到合法 manifest.json（${join(dir, "manifest.json")}）：${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const manifest = parseBundleManifest(raw, this.opts.knownGates);
      if (manifest.id !== id || manifest.version !== version) {
        throw new RegistryStateError(
          `staging 路径与 manifest 身份不一致：路径 ${id}@${version}，manifest ${manifest.id}@${manifest.version}`,
        );
      }
      if (manifest.entry !== undefined) assertInside(dir, manifest.entry, "entry");
      const index = await this.loadOrRebuild();
      const ev: RegistryEvent = {
        op: "register",
        ts: nowIso(),
        id,
        version,
        kind: manifest.kind,
        ...(manifest.entry !== undefined ? { entry: manifest.entry } : {}),
        permissions: manifest.permissions,
        gates: manifest.gates,
        actor,
      };
      foldEvent(index, ev);
      await this.commit(ev, index);
      return cloneEntry(index.bundles[id]!);
    });
  }

  /** 记录一道门的结论；只认注册时 manifest 声明过的门（同门多录以最后一条为准）。 */
  async recordGate(id: string, version: string, gate: string, passed: boolean, actor: string, detail?: string): Promise<BundleEntry> {
    return await this.enqueue(async () => {
      assertActor(actor);
      if (!isBundleId(id)) throw new RegistryStateError(`id 非法: ${JSON.stringify(id)}`);
      if (!isBundleVersion(version)) throw new RegistryStateError(`version 非法: ${JSON.stringify(version)}`);
      if (typeof gate !== "string" || gate.length === 0 || gate.length > MAX_GATE_LENGTH) {
        throw new RegistryStateError(`gate 名非法: ${JSON.stringify(gate)}`);
      }
      if (typeof passed !== "boolean") throw new RegistryStateError("passed 必须是布尔值");
      if (detail !== undefined && (typeof detail !== "string" || detail.length > MAX_DETAIL_LENGTH || /[\u0000-\u001f\u007f]/.test(detail))) {
        throw new RegistryStateError(`detail 非法：须为不超过 ${MAX_DETAIL_LENGTH} 个无控制字符的字符`);
      }
      const index = await this.loadOrRebuild();
      const ev: RegistryEvent = {
        op: "gate",
        ts: nowIso(),
        id,
        version,
        gate,
        passed,
        actor,
        ...(detail !== undefined ? { detail } : {}),
      };
      foldEvent(index, ev);
      await this.commit(ev, index);
      return cloneEntry(index.bundles[id]!);
    });
  }

  async activate(id: string, version: string, actor: string): Promise<BundleEntry> {
    return await this.enqueue(async () => {
      assertActor(actor);
      if (!isBundleId(id)) throw new RegistryStateError(`id 非法: ${JSON.stringify(id)}`);
      if (!isBundleVersion(version)) throw new RegistryStateError(`version 非法: ${JSON.stringify(version)}`);
      const index = await this.loadOrRebuild();
      const ev: RegistryEvent = { op: "activate", ts: nowIso(), id, version, actor };
      foldEvent(index, ev);
      await this.commit(ev, index);
      return cloneEntry(index.bundles[id]!);
    });
  }

  async rollback(id: string, actor: string): Promise<BundleEntry> {
    return await this.enqueue(async () => {
      assertActor(actor);
      if (!isBundleId(id)) throw new RegistryStateError(`id 非法: ${JSON.stringify(id)}`);
      const index = await this.loadOrRebuild();
      const ev: RegistryEvent = { op: "rollback", ts: nowIso(), id, actor };
      foldEvent(index, ev);
      await this.commit(ev, index);
      return cloneEntry(index.bundles[id]!);
    });
  }

  /** version 缺省 = 当前 active 版本；active 版本不可直接废弃（先回滚）。 */
  async deprecate(id: string, version: string | undefined, actor: string): Promise<BundleEntry> {
    return await this.enqueue(async () => {
      assertActor(actor);
      if (!isBundleId(id)) throw new RegistryStateError(`id 非法: ${JSON.stringify(id)}`);
      const index = await this.loadOrRebuild();
      let target = version;
      if (target === undefined) {
        const active = index.bundles[id]?.active;
        if (active === undefined) throw new RegistryStateError(`${id} 没有 active 版本，deprecate 必须指明 version`);
        target = active.version;
      }
      if (!isBundleVersion(target)) throw new RegistryStateError(`version 非法: ${JSON.stringify(target)}`);
      const ev: RegistryEvent = { op: "deprecate", ts: nowIso(), id, version: target, actor };
      foldEvent(index, ev);
      await this.commit(ev, index);
      return cloneEntry(index.bundles[id]!);
    });
  }

  /** 清退落账：文件移除由 Installer 执行，账面事实在这里落（fold 拒绝一切非法清退）。 */
  async recordPrune(id: string, version: string, actor: string): Promise<BundleEntry> {
    return await this.enqueue(async () => {
      assertActor(actor);
      if (!isBundleId(id)) throw new RegistryStateError(`id 非法: ${JSON.stringify(id)}`);
      if (!isBundleVersion(version)) throw new RegistryStateError(`version 非法: ${JSON.stringify(version)}`);
      const index = await this.loadOrRebuild();
      const ev: RegistryEvent = { op: "prune", ts: nowIso(), id, version, actor };
      foldEvent(index, ev);
      await this.commit(ev, index);
      return cloneEntry(index.bundles[id]!);
    });
  }

  async readIndex(): Promise<RegistryIndex> {
    return await this.enqueue(async () => cloneIndex(await this.loadOrRebuild()));
  }

  async listBundles(): Promise<{ id: string; entry: BundleEntry }[]> {
    const index = await this.readIndex();
    return Object.entries(index.bundles).map(([id, entry]) => ({ id, entry }));
  }

  /** 废弃超过 olderThanDays 天的版本（Phase 0 的淘汰候选面：真正的文件清退在 Phase 1 Installer）。 */
  async pruneCandidates(now: Date, olderThanDays: number): Promise<PruneCandidate[]> {
    if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
      throw new RegistryStateError("olderThanDays 须为非负数");
    }
    const cutoff = now.getTime() - olderThanDays * 86_400_000;
    const index = await this.readIndex();
    const out: PruneCandidate[] = [];
    for (const [id, entry] of Object.entries(index.bundles)) {
      for (const [version, v] of Object.entries(entry.versions)) {
        if (v.deprecatedAt !== undefined && v.prunedAt === undefined && new Date(v.deprecatedAt).getTime() < cutoff) {
          out.push({ id, version, deprecatedAt: v.deprecatedAt });
        }
      }
    }
    return out.sort((a, b) => (a.id + "@" + a.version < b.id + "@" + b.version ? -1 : 1));
  }

  /** 从日志重放重建索引（fold 与在线操作同一套转移）：日志缺行/坏行/违反不变量都在这里红。 */
  async rebuildIndex(): Promise<RegistryIndex> {
    return await this.enqueue(async () => await this.rebuildInner());
  }

  private async rebuildInner(): Promise<RegistryIndex> {
    const index: RegistryIndex = { version: INDEX_VERSION, rebuiltAt: nowIso(), bundles: {} };
    let text: string;
    try {
      text = await readFile(this.logPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return await this.persistIndex(index);
      throw err;
    }
    const lines = text.split("\n");
    // **尾部半写行**（进程被硬杀在单次 append 中途）：文件不以换行结尾、且最后一行解析失败
    // ⇒ 这一行**从未成行**（读者本来也看不见它）。旧实现让它当场抛 ⇒ **注册表永久打不开**
    // （每次重建都撞同一行），而 canary 的回滚正是走这条 ⇒ 退化的版本就一直装着退不下来。
    // 修法（同 src/events/log.ts 的 repairPartialTail 口径）：裁掉未成行的字节、响亮告警，
    // 并把 journal **截回最后一条完整行**（不截的话下一次重建又撞同一行）。
    // **中段的坏行不走这一支**：那是另一类事故（数据丢失），必须当场抛，不许被安静地抹掉。
    const tornTail = !text.endsWith("\n") && lines.length > 0 && lines[lines.length - 1]!.trim() !== "";
    for (const [i, line] of lines.entries()) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      let ev: RegistryEvent;
      try {
        ev = this.parseEventLine(trimmed, i + 1);
      } catch (err) {
        if (!tornTail || i !== lines.length - 1) throw err;
        const cut = Buffer.byteLength(text.slice(0, text.lastIndexOf("\n") + 1), "utf8");
        await truncate(this.logPath, cut);
        console.warn(
          "[evolution] registry.jsonl 尾部半写行（上次写入未完成，多半是被硬杀在写中途）："
            + "已丢弃未成行的字节并截回最后一条完整行：",
          err instanceof Error ? err.message : String(err),
        );
        index.logSize = cut;
        return await this.persistIndex(index);
      }
      foldEvent(index, ev);
    }
    index.logSize = Buffer.byteLength(text, "utf8");
    return await this.persistIndex(index);
  }

  private async persistIndex(index: RegistryIndex): Promise<RegistryIndex> {
    index.rebuiltAt = nowIso();
    await writeFileAtomic(this.indexPath, JSON.stringify(index, null, 2) + "\n");
    return index;
  }

  /** 索引是投影：缺了/坏了都从日志重建，绝不静默拿坏缓存当事实。其他 fs 错误照常抛。 */
  private async loadOrRebuild(): Promise<RegistryIndex> {
    let text: string | null = null;
    try {
      text = await readFile(this.indexPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    if (text !== null) {
      try {
        const raw = JSON.parse(text) as unknown;
        if (isRecord(raw) && raw.version === INDEX_VERSION && isRecord(raw.bundles)) {
          // 与日志对账：投影不是事实。大小不一致（append 后 persist 失败 / 外部追加）⇒ 重建。
          const st = await stat(this.logPath).catch(() => null);
          const logSize = st?.size ?? 0;
          if (typeof raw.logSize !== "number" || raw.logSize !== logSize) {
            return await this.rebuildInner();
          }
          return raw as unknown as RegistryIndex;
        }
      } catch {
        // 落到重建
      }
    }
    return await this.rebuildInner();
  }

  private async commit(ev: RegistryEvent, index: RegistryIndex): Promise<void> {
    await mkdir(dirname(this.logPath), { recursive: true });
    // 追加前先把**没以换行收尾**的旧尾行隔开：那次 append 若是半写（进程被硬杀在写中途），
    // 尾段没成行；下一次 append 会直接拼在它后面 ⇒ **半行 + 完整行 = 一条坏行**，
    // 而这条坏行在**中段**（后面还有好行）⇒ 重建会当场抛 ⇒ 注册表永久打不开。
    // 这里补一个换行把它隔开（与 src/events/log.ts 的同一口径）。
    const fh = await open(
      this.logPath,
      constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      let needsNewline = false;
      const st = await fh.stat();
      if (st.size > 0) {
        const last = Buffer.alloc(1);
        await fh.read(last, 0, 1, st.size - 1);
        needsNewline = last[0] !== 0x0a;
      }
      await fh.writeFile((needsNewline ? "\n" : "") + JSON.stringify(ev) + "\n", "utf8");
      if (needsNewline) {
        console.warn("[evolution] registry.jsonl 尾行没以换行收尾：已补换行隔离（否则下一次追加会把它拼成坏行）");
      }
      index.logSize = (await fh.stat()).size;
    } finally {
      await fh.close().catch(() => undefined);
    }
    await this.persistIndex(index);
  }

  /** 日志行的形状校验（坏行 = 账本不可信）。register 事件的凭据字段复用 manifest 契约校验——
   *  同一份 parseBundleManifest，不给重放面留第二种口径。 */
  private parseEventLine(line: string, lineNo: number): RegistryEvent {
    const corrupt = (why: string): RegistryLogCorruptError =>
      new RegistryLogCorruptError(`registry.jsonl 第 ${String(lineNo)} 行损坏（${why}）`);
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw corrupt("JSON.parse 失败");
    }
    if (!isRecord(raw) || typeof raw.op !== "string" || !isTimestamp(raw.ts)) throw corrupt("缺 op/ts 或形状非法");
    if (!isBundleId(raw.id) || !isActor(raw.actor)) throw corrupt("id/actor 非法");
    const { op, ts, id, actor } = raw as { op: string; ts: string; id: string; actor: string };
    switch (op) {
      case "register": {
        if (!isBundleVersion(raw.version)) throw corrupt("version 非法");
        let manifest;
        try {
          manifest = parseBundleManifest(
            { id, version: raw.version, kind: raw.kind, entry: raw.entry, permissions: raw.permissions, gates: raw.gates },
            this.opts.knownGates,
          );
        } catch (err) {
          throw corrupt(err instanceof Error ? err.message : String(err));
        }
        return {
          op: "register",
          ts,
          id,
          version: manifest.version,
          kind: manifest.kind,
          ...(manifest.entry !== undefined ? { entry: manifest.entry } : {}),
          permissions: manifest.permissions,
          gates: manifest.gates,
          actor,
        };
      }
      case "gate": {
        if (!isBundleVersion(raw.version)) throw corrupt("version 非法");
        if (typeof raw.gate !== "string" || raw.gate.length === 0 || raw.gate.length > MAX_GATE_LENGTH) throw corrupt("gate 非法");
        if (typeof raw.passed !== "boolean") throw corrupt("passed 非法");
        if (raw.detail !== undefined && (typeof raw.detail !== "string" || raw.detail.length > MAX_DETAIL_LENGTH)) throw corrupt("detail 非法");
        return {
          op: "gate",
          ts,
          id,
          version: raw.version,
          gate: raw.gate,
          passed: raw.passed,
          actor,
          ...(raw.detail !== undefined ? { detail: raw.detail } : {}),
        };
      }
      case "activate": {
        if (!isBundleVersion(raw.version)) throw corrupt("version 非法");
        return { op: "activate", ts, id, version: raw.version, actor };
      }
      case "rollback":
        return { op: "rollback", ts, id, actor };
      case "deprecate": {
        if (!isBundleVersion(raw.version)) throw corrupt("version 非法");
        return { op: "deprecate", ts, id, version: raw.version, actor };
      }
      case "prune": {
        if (!isBundleVersion(raw.version)) throw corrupt("version 非法");
        return { op: "prune", ts, id, version: raw.version, actor };
      }
      default:
        throw corrupt(`未知 op ${JSON.stringify(op)}`);
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writes.then(operation);
    this.writes = next.catch(() => undefined);
    return next;
  }
}
