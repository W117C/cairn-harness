// M2e：信任门（§9.8）。项目级插件（.agent/plugins/）首次加载出信任卡；未信任只列出、
// hook/MCP/LSP 一律不激活；信任决议持久化（tmp+rename 原子写，仿 SettingsStore）。
// 用户级插件免信任（用户自己装的）；散装 skill 免信任（纯 markdown，无执行面）。
import { readFile, rm, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { writeFileAtomic } from "../../atomic-write";
import { pluginSnapshot } from "./snapshot";

export { pluginSnapshot, type PluginSnapshot } from "./snapshot";

export type TrustState = "trusted" | "declined" | "pending";

interface TrustFile {
  trusted: string[];
  declined: string[];
}

/** 信任表那份文本的**唯一**读取口径（第 432 页给 `--doctor` 用，装载路径 `TrustStore.load` 走同一个函数）。
 *  返回**条目数组**而不是计数：doctor 报的数字就是装载时真正在用的那份表取 `length`，
 *  不是它自己按另一套口径数出来的第二份事实（本仓点名的「登记表与表所指的行为各算一次 ⇒ 表退化成注释」）。
 *  返回值 `null` ＝「读不出」（JSON 坏、顶层不是对象）——调用方必须把它当第三态，
 *  不许折成「0 条已批准」：那等于把「没尺」报成「干净」。
 *  数组里非字符串的条目按既有口径丢掉（不因为脏条目让整份表失效）。 */
export function parseTrustFile(text: string): { trusted: string[]; declined: string[] } | null {
  let parsed: Partial<TrustFile> | null = null;
  try {
    parsed = JSON.parse(text) as Partial<TrustFile>;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const of = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s) => typeof s === "string") : []);
  return { trusted: of(parsed.trusted), declined: of(parsed.declined) };
}

// ---- H3-P5（审查 E-10）：信任绑定内容指纹 ----
// 旧实现只按绝对路径记录信任：同路径下的插件内容被替换（恶意改写 hooks/MCP 配置）仍自动 trusted。
// v1 口径：**一概**写 `abs@指纹`（内容绑定，改动即重新出信任卡）。旧版裸路径记录不再命中
// （fail-closed：重新出一次卡），见 hit 的注释。
// 当前内容摘要为 SHA-256；旧 SHA-1 指纹条目同样不命中，必须重新批准。这里刻意不做
// “按路径恢复旧的 SHA-1 信任”迁移——那会把弱摘要重新变回授权依据。
// 只跳过 `.git`（版本库元数据不参与执行）。`dist`/`out`/`node_modules` 必须入指纹：
// 插件 manifest 可以把 hooks/MCP/LSP 指向这些目录，旧实现跳过它们 ⇒ 批准后替换
// `dist/hooks.json` 不改指纹，信任继续命中（等于批准了一个可随时换内容的执行面）。
/** 指纹结果（E1/E2，审查 P1-11/P1-12）：bounded=true 表示本指纹**不能**完整绑定插件内容
 *  （文件数超帽 / 单文件超大 / 目录内存在软链）——信任判定必须 fail-closed（视为 pending），
 *  不允许复用旧信任记录：帽外新增或改写的恶意 hooks/MCP 配置在截断指纹下逐字不变。 */
export interface PluginFingerprint {
  fp: string;
  bounded: boolean;
}

/** 插件内容指纹（完整口径）：全量文件按 (相对路径, sha256(内容)) 排序后取 sha256。
 *  `pluginSnapshot` 同时保留已绑定内容的不可变快照，装载器只消费这份快照；不能在
 *  `pluginFingerprintEx` 之后重新按路径读文件，否则指纹与真正装载的配置会分叉。 */
export async function pluginFingerprintEx(root: string): Promise<PluginFingerprint> {
  const snapshot = await pluginSnapshot(root);
  return { fp: snapshot.fp, bounded: snapshot.bounded };
}

/** 兼容口径（既有调用点）：只取指纹串。信任判定面请用 pluginFingerprintEx（bounded 须 fail-closed）。 */
export async function pluginFingerprint(root: string): Promise<string> {
  return (await pluginFingerprintEx(root)).fp;
}

export class TrustStore {
  private file: string;
  private cache: TrustFile | null = null;
  /** 决议读-改-写串行链（并发批准不互相覆盖）。 */
  private writes: Promise<unknown> = Promise.resolve();

  constructor(filePath: string) {
    this.file = filePath;
  }

  private async load(): Promise<TrustFile> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.file, "utf8");
      // 读不出（JSON 坏／顶层不是对象）与「表里没有决议」在**装载面**都落成空表：
      // 那两态在 status() 里给不出可信判定，fail-closed 到 pending（重新出信任卡）。
      // 但 doctor 那一面必须把它们分开报——见 src/main/doctor.ts 的 trustFaceCheck。
      const parsed = parseTrustFile(raw);
      this.cache = parsed ?? { trusted: [], declined: [] };
    } catch {
      this.cache = { trusted: [], declined: [] };
    }
    return this.cache;
  }

  private async persist(state: TrustFile): Promise<void> {
    // 临时名由目标文件名派生（见 src/atomic-write），清理前缀同样派生：写死的名字在
    // trustFile 被换掉时清不到自己留下的残留。
    const dir = dirname(this.file);
    const prefix = basename(this.file) + ".tmp-";
    try {
      for (const name of await readdir(dir)) {
        if (name.startsWith(prefix)) await rm(join(dir, name), { force: true });
      }
    } catch {
      /* 清理失败不阻塞主写入 */
    }
    await writeFileAtomic(this.file, JSON.stringify(state, null, 2) + "\n");
    this.cache = state;
  }

  /** 条目键：`abs@指纹`；指纹被截断（bounded：超帽 / 超大文件 / 目录内软链）时加 `+b` 位。
   *  审查 S1-7（修复任务书 2.1）：2026-09-13 那轮把 bounded 直接塌成 discover 侧的 pending，
   *  而 decide 写下的仍是**无界**条目 => 「批准了还弹卡」死循环，含软链/超大文件的合法开发
   *  布局永久装不上（拒绝决议同样落不地）。正确做法是把不完整性编进条目本身：bounded 决议
   *  只授予 bounded 形态，两种形态互不通用（有界↔无界互相转换都要重新出卡）——既不留死循环，
   *  也不放松 E1/E2 的绑定要求。 */
  private entryKey(absRoot: string, fingerprint: string, bounded: boolean): string {
    return absRoot + "@" + fingerprint + (bounded ? "+b" : "");
  }

  /** 条目命中：只认 `abs@指纹[+b]` 精确匹配。
   *  2026-10-19：**移除**旧版裸路径兼容——裸条目在批准后任何内容替换都不改键，
   *  等于把「授权绑内容」退回「授权绑路径」（本文件存在的理由）。旧信任文件里的裸条目
   *  会让对应插件重新出一次信任卡（fail-closed），用户重新批准后写入指纹条目。 */
  private hit(list: string[], absRoot: string, fingerprint: string, bounded: boolean): boolean {
    return list.includes(this.entryKey(absRoot, fingerprint, bounded));
  }

  /** 决议查询：未记录 = pending（首次加载出信任卡）。
   *  bounded 指纹**不可批准**：它没绑定软链目标/超帽/读不出的那部分内容，批准后替换那些内容
   *  指纹逐字不变 ⇒ 等于授权绑路径。bounded 只允许 declined（明确拒绝）。 */
  async status(absRoot: string, fingerprint: string, bounded = false): Promise<TrustState> {
    const s = await this.load();
    if (!bounded && this.hit(s.trusted, absRoot, fingerprint, bounded)) return "trusted";
    if (this.hit(s.declined, absRoot, fingerprint, bounded)) return "declined";
    return "pending";
  }

  /** 同步查询（发现器 trustStatus 回调是同步口；以已加载缓存为准）。 */
  statusSync(absRoot: string, fingerprint: string, bounded = false): TrustState {
    if (!this.cache) return "pending";
    if (!bounded && this.hit(this.cache.trusted, absRoot, fingerprint, bounded)) return "trusted";
    if (this.hit(this.cache.declined, absRoot, fingerprint, bounded)) return "declined";
    return "pending";
  }

  /** 预热缓存（发现器同步口之前调用一次）。 */
  async warm(): Promise<void> {
    await this.load();
  }

  /** 信任决议（信任卡批准/拒绝）；持久化。新决议一律写 `abs@指纹`（E-10：内容绑定）。
   *  读-改-写走单条串行链：并发批准两个插件时旧实现各自基于旧表整写，后写者抹掉前者。 */
  async decide(absRoot: string, trusted: boolean, fingerprint: string, bounded = false): Promise<void> {
    if (trusted && bounded) {
      throw new Error(
        "插件内容指纹不完整（含软链 / 超出指纹上限 / 有文件读不出），不能批准："
        + "那部分内容没有绑定，批准后可以不经重新授权被替换。请把插件改成普通文件布局后重试。",
      );
    }
    const run = async (): Promise<void> => {
      const s = await this.load();
      const entry = this.entryKey(absRoot, fingerprint, bounded);
      const other = this.entryKey(absRoot, fingerprint, !bounded);
      const next: TrustFile = {
        // 清掉同路径同指纹的旧决议（两种有界形态 + 旧版裸路径一并移除，避免残留相反决议）
        trusted: s.trusted.filter((p) => p !== absRoot && p !== entry && p !== other),
        declined: s.declined.filter((p) => p !== absRoot && p !== entry && p !== other),
      };
      (trusted ? next.trusted : next.declined).push(entry);
      await this.persist(next);
    };
    const pending = this.writes.then(run, run);
    this.writes = pending.catch(() => undefined);
    await pending;
  }
}
