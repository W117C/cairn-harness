// M2e：信任门（§9.8）。项目级插件（.agent/plugins/）首次加载出信任卡；未信任只列出、
// hook/MCP/LSP 一律不激活；信任决议持久化（tmp+rename 原子写，仿 SettingsStore）。
// 用户级插件免信任（用户自己装的）；散装 skill 免信任（纯 markdown，无执行面）。
import { readFile, mkdir, rename, rm, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type TrustState = "trusted" | "declined" | "pending";

interface TrustFile {
  trusted: string[];
  declined: string[];
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

  /** 决议查询：未记录 = pending（首次加载出信任卡）。 */
  async status(absRoot: string): Promise<TrustState> {
    const s = await this.load();
    if (s.trusted.includes(absRoot)) return "trusted";
    if (s.declined.includes(absRoot)) return "declined";
    return "pending";
  }

  /** 同步查询（发现器 trustStatus 回调是同步口；以已加载缓存为准）。 */
  statusSync(absRoot: string): TrustState {
    if (!this.cache) return "pending";
    if (this.cache.trusted.includes(absRoot)) return "trusted";
    if (this.cache.declined.includes(absRoot)) return "declined";
    return "pending";
  }

  /** 预热缓存（发现器同步口之前调用一次）。 */
  async warm(): Promise<void> {
    await this.load();
  }

  /** 信任决议（信任卡批准/拒绝）；持久化。 */
  async decide(absRoot: string, trusted: boolean): Promise<void> {
    const s = await this.load();
    const next: TrustFile = {
      trusted: s.trusted.filter((p) => p !== absRoot),
      declined: s.declined.filter((p) => p !== absRoot),
    };
    (trusted ? next.trusted : next.declined).push(absRoot);
    await this.persist(next);
  }
}
