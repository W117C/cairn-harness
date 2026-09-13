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

/** 插件内容指纹：全量文件按 (相对路径, sha1(内容)) 排序后取 sha256。目录结构变化即指纹变化。 */
export async function pluginFingerprint(root: string): Promise<string> {
  const parts: string[] = [];
  let count = 0;
  const walk = async (dir: string): Promise<void> => {
    if (count >= FP_MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (count >= FP_MAX_FILES) return;
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (FP_SKIP_DIRS.has(ent.name)) continue;
        await walk(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      const st = await stat(abs).catch(() => null);
      if (!st || st.size > FP_MAX_FILE_BYTES) continue;
      const content = await readFile(abs).catch(() => null);
      if (content === null) continue;
      count++;
      parts.push(relative(root, abs).replaceAll("\\", "/") + ":" + createHash("sha1").update(content).digest("hex"));
    }
  };
  await walk(root);
  return createHash("sha256").update(parts.sort().join("\n")).digest("hex").slice(0, 32);
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

  /** 条目命中：先按 `abs@指纹`（内容绑定）精确匹配；裸路径 = 旧版记录（兼容命中）。 */
  private hit(list: string[], absRoot: string, fingerprint: string): boolean {
    return list.includes(absRoot + "@" + fingerprint) || list.includes(absRoot);
  }

  /** 决议查询：未记录 = pending（首次加载出信任卡）。 */
  async status(absRoot: string, fingerprint: string): Promise<TrustState> {
    const s = await this.load();
    if (this.hit(s.trusted, absRoot, fingerprint)) return "trusted";
    if (this.hit(s.declined, absRoot, fingerprint)) return "declined";
    return "pending";
  }

  /** 同步查询（发现器 trustStatus 回调是同步口；以已加载缓存为准）。 */
  statusSync(absRoot: string, fingerprint: string): TrustState {
    if (!this.cache) return "pending";
    if (this.hit(this.cache.trusted, absRoot, fingerprint)) return "trusted";
    if (this.hit(this.cache.declined, absRoot, fingerprint)) return "declined";
    return "pending";
  }

  /** 预热缓存（发现器同步口之前调用一次）。 */
  async warm(): Promise<void> {
    await this.load();
  }

  /** 信任决议（信任卡批准/拒绝）；持久化。新决议一律写 `abs@指纹`（E-10：内容绑定）。 */
  async decide(absRoot: string, trusted: boolean, fingerprint: string): Promise<void> {
    const s = await this.load();
    const entry = absRoot + "@" + fingerprint;
    const next: TrustFile = {
      // 清掉同路径的旧决议（指纹条目与旧版裸路径一并移除，避免残留相反决议）
      trusted: s.trusted.filter((p) => p !== absRoot && p !== entry),
      declined: s.declined.filter((p) => p !== absRoot && p !== entry),
    };
    (trusted ? next.trusted : next.declined).push(entry);
    await this.persist(next);
  }
}
