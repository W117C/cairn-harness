// M2e：信任门（§9.8）。项目级插件（.agent/plugins/）首次加载出信任卡；未信任只列出、
// hook/MCP/LSP 一律不激活；信任决议持久化（tmp+rename 原子写，仿 SettingsStore）。
// 用户级插件免信任（用户自己装的）；散装 skill 免信任（纯 markdown，无执行面）。
import { createHash } from "node:crypto";
import { readFile, rm, readdir, stat, lstat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { writeFileAtomic } from "../../atomic-write";

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
// 只跳过 `.git`（版本库元数据不参与执行）。`dist`/`out`/`node_modules` 必须入指纹：
// 插件 manifest 可以把 hooks/MCP/LSP 指向这些目录，旧实现跳过它们 ⇒ 批准后替换
// `dist/hooks.json` 不改指纹，信任继续命中（等于批准了一个可随时换内容的执行面）。
const FP_SKIP_DIRS = new Set<string>(); // 不再整目录跳过（`.git` 单独只哈希 config + hooks）
const FP_MAX_FILES = 5_000;
const FP_MAX_FILE_BYTES = 8 * 1024 * 1024;

/** 指纹结果（E1/E2，审查 P1-11/P1-12）：bounded=true 表示本指纹**不能**完整绑定插件内容
 *  （文件数超帽 / 单文件超大 / 目录内存在软链）——信任判定必须 fail-closed（视为 pending），
 *  不允许复用旧信任记录：帽外新增或改写的恶意 hooks/MCP 配置在截断指纹下逐字不变。 */
export interface PluginFingerprint {
  fp: string;
  bounded: boolean;
}

/** 插件内容指纹（完整口径）：全量文件按 (相对路径, sha1(内容)) 排序后取 sha256。目录结构变化即指纹变化。
 *  E2（审查）：walk 按 Dirent 判定软链——软链既不入指纹也不静默跳过，直接标记 bounded（加载侧
 *  跟随软链而指纹不 follow 的组合 = 「信任后新增软链 .mcp.json」绕过面）。 */
export async function pluginFingerprintEx(root: string): Promise<PluginFingerprint> {
  return await fingerprintDirs(root, [root]);
}

/** 只绑定根下若干相对目录的指纹（外部声明式来源用）：opencode/pi 的根目录里还可能有
 *  `plugins/`、`extensions/` 这类**不导入**的代码面；把它们算进指纹会让改一个无关代码插件
 *  也触发重新信任。相对路径仍从 `root` 起算（`skills/x/SKILL.md`），与完整指纹同一套命名。 */
export async function pluginFingerprintSubsetEx(root: string, relDirs: readonly string[]): Promise<PluginFingerprint> {
  const dirs = relDirs.map((d) => join(root, d)).sort();
  let bounded = false;
  const real: string[] = [];
  for (const dir of dirs) {
    const st = await lstat(dir).catch(() => null);
    if (st === null) continue;
    if (st.isSymbolicLink()) { bounded = true; continue; } // 与 walk 同口径：软链 fail-closed
    if (st.isDirectory()) real.push(dir);
  }
  const res = await fingerprintDirs(root, real);
  return bounded ? { ...res, bounded: true } : res;
}

async function fingerprintDirs(root: string, startDirs: readonly string[]): Promise<PluginFingerprint> {
  const parts: string[] = [];
  let count = 0;
  let bounded = false;
  const walk = async (dir: string): Promise<void> => {
    if (count >= FP_MAX_FILES) {
      bounded = true; // E1：超帽不再静默截断——剩余内容未入指纹 = 绑定不完整
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      bounded = true; // 读不出 = 这部分内容没绑定（旧实现静默 return）
      return;
    }
    for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (count >= FP_MAX_FILES) {
        bounded = true;
        return;
      }
      const abs = join(dir, ent.name);
      if (ent.isSymbolicLink()) {
        bounded = true; // E2：软链（文件或目录）一律 fail-closed——加载侧会 follow 而指纹不跟
        continue;
      }
      if (ent.isDirectory()) {
        if (FP_SKIP_DIRS.has(ent.name)) continue;
        if (ent.name === ".git") {
          // 版本库元数据不整体入指纹（churn 大），但**可执行面**必须绑定：
          // manifest 可以把 hooks 指向 `.git/hooks.json`，整目录跳过会让批准后替换 hook 指纹不变。
          await walkGitMeta(abs);
          continue;
        }
        await walk(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      const st = await stat(abs).catch(() => null);
      if (st === null) { bounded = true; continue; }
      if (st.size > FP_MAX_FILE_BYTES) {
        bounded = true; // 超大文件不入指纹 = 绑定不完整（信任会被拒绝）
        continue;
      }
      const content = await readFile(abs).catch(() => null);
      if (content === null) { bounded = true; continue; }
      count++;
      parts.push(relative(root, abs).replaceAll("\\", "/") + ":" + createHash("sha1").update(content).digest("hex"));
    }
  };
  /** `.git` 里只绑定会参与执行的两处：config（可重定向 hooksPath）与 hooks/ 下的全部文件。 */
  const walkGitMeta = async (gitDir: string): Promise<void> => {
    const config = await readFile(join(gitDir, "config")).catch(() => null);
    if (config !== null) {
      count++;
      parts.push(relative(root, join(gitDir, "config")).replaceAll("\\", "/") + ":" + createHash("sha1").update(config).digest("hex"));
    }
    const hooksDir = join(gitDir, "hooks");
    let hooks;
    try { hooks = await readdir(hooksDir, { withFileTypes: true }); }
    catch { return; } // 没有 hooks 目录是常态
    for (const ent of hooks.sort((a, b) => a.name.localeCompare(b.name))) {
      if (ent.isSymbolicLink()) { bounded = true; continue; }
      if (!ent.isFile()) continue;
      const abs = join(hooksDir, ent.name);
      const content = await readFile(abs).catch(() => null);
      if (content === null) { bounded = true; continue; }
      count++;
      parts.push(relative(root, abs).replaceAll("\\", "/") + ":" + createHash("sha1").update(content).digest("hex"));
    }
  };
  for (const dir of startDirs) {
    if (dir !== root && !(await stat(dir).then((s) => s.isDirectory(), () => false))) continue;
    await walk(dir);
  }
  return {
    fp: createHash("sha256").update(parts.sort().join("\n")).digest("hex").slice(0, 32),
    bounded,
  };
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
