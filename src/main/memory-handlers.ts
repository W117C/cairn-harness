import {
  deleteTopic,
  globalMemoryDir,
  listTopics,
  loadExternalRefState,
  parseTopicDoc,
  projectMemoryDir,
  readTextOrNull,
  type TopicEntry,
} from "../agent/memory/store";
import { extractExternalRefs } from "../agent/memory/inject";
import type { MemoryLayerSnapshot, MemorySnapshot } from "./ipc-protocol";
import { getLastWorkspace } from "./runner-workspace";

// ---- M2d：记忆快照（getState 透传）+ 记忆删除（仅用户；IPC 通道 main 侧就绪，preload 暴露见 BLOCKED 备案）----

async function memoryLayerSnapshot(dir: string, scanWorkspace: string | null): Promise<MemoryLayerSnapshot> {
  const state = await loadExternalRefState();
  const index = await readTextOrNull(dir + "/MEMORY.md");
  const topics: TopicEntry[] = await listTopics(dir);
  // 外部引用扫描：索引 + 全部 topic 正文 + （项目层）根三文件；
  // v13：正文顺手带上（本来就为扫描逐条读过——frontmatter 剥掉后进 payload，供「主题正文」面板）。
  const texts: string[] = [];
  if (index) texts.push(index);
  const bodyByTopic = new Map<string, string>();
  for (const t of topics) {
    const raw = await readTextOrNull(dir + "/" + t.topic + ".md");
    if (raw) {
      texts.push(raw);
      bodyByTopic.set(t.topic, parseTopicDoc(raw).body);
    }
  }
  if (scanWorkspace) {
    for (const f of ["ARCHITECTURE.md", "DECISIONS.md", "preferences.md"]) {
      const body = await readTextOrNull(scanWorkspace + "/.agent/" + f);
      if (body) texts.push(body);
    }
  }
  const found = new Set<string>();
  if (scanWorkspace) for (const t of texts) for (const r of extractExternalRefs(t, scanWorkspace)) found.add(r);
  return {
    path: dir,
    index,
    topics: topics.map((t) => ({ ...t, body: bodyByTopic.get(t.topic) ?? "" })),
    pendingExternalRefs: [...found].filter((r) => !state.approved.includes(r) && !state.declined.includes(r)),
  };
}

export async function memorySnapshot(workspaceOverride: string | null = null): Promise<MemorySnapshot> {
  // 2026-10-17：优先用活动工作区（desktop 切项目/开会话上报），缺省才回落最近一次 run；
  // 此前冷启动的项目层记忆指向 process.cwd()（应用所在目录），切的不是正在看的项目。
  const ws = workspaceOverride ?? getLastWorkspace();
  return {
    project: await memoryLayerSnapshot(ws ? projectMemoryDir(ws) : projectMemoryDir(process.cwd()), ws),
    global: await memoryLayerSnapshot(globalMemoryDir(), ws),
  };
}

/** IPC "agent:memory-delete"：用户经记忆面板显式删除（§8.1.7：删除仅用户，模型无删除权）。 */
export async function handleMemoryDelete(scope: "project" | "global", topic: string, workspaceOverride: string | null = null): Promise<{ ok: boolean; error?: string }> {
  try {
    const dir = scope === "project" ? projectMemoryDir(workspaceOverride ?? getLastWorkspace() ?? process.cwd()) : globalMemoryDir();
    const ok = await deleteTopic(dir, topic);
    return ok ? { ok: true } : { ok: false, error: "topic 不存在: " + topic };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
