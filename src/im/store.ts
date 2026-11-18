// 连接存储（2026-11-17 · 通道线）：connections.json 单一事实源（原子写），宿主与设置页都读它。
// 密钥纪律（硬约束）：连接记录里只有 **safeStorage 键名**，值只在加密存储里——
// 源码/配置/测试都不落可用凭据字面量（安全约束 Mimosa 段）。
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic-write";
import type { ImConnection } from "./types";

/** 存储文件名（<userData>/im/connections.json）。导出给判卷钉路径形状。 */
export const IM_STORE_FILE = "connections.json";

export interface ImStore {
  load: () => Promise<ImConnection[]>;
  save: (all: ImConnection[]) => Promise<void>;
}

/** 生产存储：<dir>/connections.json（0600——目录里有密钥名与聊天清单，不该全局可读）。 */
export function createImStore(dir: string): ImStore {
  const path = join(dir, IM_STORE_FILE);
  return {
    load: async () => {
      try {
        const raw = await readFile(path, "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isConnection);
      } catch {
        return [];
      }
    },
    save: async (all) => {
      await mkdir(dir, { recursive: true });
      await writeFileAtomic(path, JSON.stringify(all, null, 2), { mode: 0o600 });
    },
  };
}

/** 严格过滤：坏行/旧版本形状不崩宿主，如实丢弃（坏输入不静默——丢弃计数由宿主点名）。 */
export function isConnection(value: unknown): value is ImConnection {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" && v.id !== "" &&
    typeof v.platform === "string" && v.platform !== "" &&
    typeof v.sessionId === "string" &&
    typeof v.settings === "object" && v.settings !== null &&
    typeof v.secretKeys === "object" && v.secretKeys !== null &&
    typeof v.enabled === "boolean" &&
    Array.isArray(v.paired) && Array.isArray(v.requests) &&
    typeof v.chats === "object" && v.chats !== null &&
    (v.runtime === undefined || (typeof v.runtime === "object" && v.runtime !== null)) &&
    typeof v.createdAt === "number"
  );
}
