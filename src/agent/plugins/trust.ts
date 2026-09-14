// M2e：信任门（§9.8）。项目级插件（.agent/plugins/）首次加载出信任卡；未信任只列出、
// hook/MCP/LSP 一律不激活；信任决议持久化（tmp+rename 原子写，仿 SettingsStore）。
// 用户级插件免信任（用户自己装的）；散装 skill 免信任（纯 markdown，无执行面）。
import { createHash } from "node:crypto";
import { readFile, mkdir, rename, rm, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export type TrustState = "trusted" | "declined" | "pending";

interface TrustFile {
  trusted: string[];
  declined: string[];
}

// ---- H3-P5（审查 E-10）：信任绑定内容指纹 ----
// 旧实现只按绝对路径记录信任：同路径下的插件内容被替换（恶意改写 hooks/MCP 配置）仍自动 trusted。
// v1 口径：**新决议**一律写 `abs@指纹`（内容绑定，改动即重新出信任卡）；旧版裸路径记录继续命中
// （兼容既有信任文件与验收预信任通道，显式备案的兼容边界）。
const FP_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out"]);
const FP_MAX_FILES = 500;
const FP_MAX_FILE_BYTES = 512 * 1024;

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
        await walk(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      const st = await stat(abs).catch(() => null);
      if (st && st.size > FP_MAX_FILE_BYTES) {
        bounded = true; // E1：超大文件不入指纹 = 绑定不完整（不再静默 continue）
        continue;
      }
      if (!st) continue;
      const content = await readFile(abs).catch(() => null);
      if (content === null) continue;
      count++;
      parts.push(relative(root, abs).replaceAll("\\", "/") + ":" + createHash("sha1").update(content).digest("hex"));
    }
  };
  await walk(root);
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

  constructor(filePath: string) {
    this.file = filePath;
  }

  private async load(): Promise<TrustFile> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as Partial<TrustFile>;
      this.cache = {
        trusted: Array.isArray(parsed.trusted) ? parsed.trusted.filter((s) => typeof s === "string") : [],
        declined: Array.isArray(parsed.declined) ? parsed.declined.filter((s) => typeof s === "string") : [],
      };
    } catch {
      this.cache = { trusted: [], declined: [] };
    }
    return this.cache;
  }

  private async persist(state: TrustFile): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const dir = dirname(this.file);
    try {
      for (const name of await readdir(dir)) {
        if (name.startsWith("plugin-trust.json.tmp-")) await rm(dir + "/" + name, { force: true });
      }
    } catch {
      /* 清理失败不阻塞主写入 */
    }
    const tmp = dir + "/plugin-trust.json.tmp-" + String(process.pid) + "-" + String(Date.now());
    await writeFile(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
    await rename(tmp, this.file);
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

  /** 条目命中：按 `abs@指纹[+b]` 精确匹配；裸路径 = 旧版记录，仅无界形态兼容命中
   *  （旧版没有「有界」概念，放它顺带命中有界条目等于绕开 E1/E2 的 fail-closed）。 */
  private hit(list: string[], absRoot: string, fingerprint: string, bounded: boolean): boolean {
    return list.includes(this.entryKey(absRoot, fingerprint, bounded)) || (!bounded && list.includes(absRoot));
  }

  /** 决议查询：未记录 = pending（首次加载出信任卡）。 */
  async status(absRoot: string, fingerprint: string, bounded = false): Promise<TrustState> {
    const s = await this.load();
    if (this.hit(s.trusted, absRoot, fingerprint, bounded)) return "trusted";
    if (this.hit(s.declined, absRoot, fingerprint, bounded)) return "declined";
    return "pending";
  }

  /** 同步查询（发现器 trustStatus 回调是同步口；以已加载缓存为准）。 */
  statusSync(absRoot: string, fingerprint: string, bounded = false): TrustState {
    if (!this.cache) return "pending";
    if (this.hit(this.cache.trusted, absRoot, fingerprint, bounded)) return "trusted";
    if (this.hit(this.cache.declined, absRoot, fingerprint, bounded)) return "declined";
    return "pending";
  }

  /** 预热缓存（发现器同步口之前调用一次）。 */
  async warm(): Promise<void> {
    await this.load();
  }

  /** 信任决议（信任卡批准/拒绝）；持久化。新决议一律写 `abs@指纹`（E-10：内容绑定）。 */
  async decide(absRoot: string, trusted: boolean, fingerprint: string, bounded = false): Promise<void> {
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
  }
}
