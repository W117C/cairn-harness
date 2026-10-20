import {
  deleteTopic,
  globalMemoryDir,
  listTopics,
  loadExternalRefState,
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
  // 外部引用扫描：索引 + 全部 topic 正文 + （项目层）根三文件
  const texts: string[] = [];
  if (index) texts.push(index);
  for (const t of topics) {
    const body = await readTextOrNull(dir + "/" + t.topic + ".md");
    if (body) texts.push(body);
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
    topics,
    pendingExternalRefs: [...found].filter((r) => !state.approved.includes(r) && !state.declined.includes(r)),
  };
}

export async function memorySnapshot(): Promise<MemorySnapshot> {
  const ws = getLastWorkspace();
  return {
    project: await memoryLayerSnapshot(ws ? projectMemoryDir(ws) : projectMemoryDir(process.cwd()), ws),
    global: await memoryLayerSnapshot(globalMemoryDir(), ws),
  };
}

/** IPC "agent:memory-delete"：用户经记忆面板显式删除（§8.1.7：删除仅用户，模型无删除权）。 */
export async function handleMemoryDelete(scope: "project" | "global", topic: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const dir = scope === "project" ? projectMemoryDir(getLastWorkspace() ?? process.cwd()) : globalMemoryDir();
    const ok = await deleteTopic(dir, topic);
    return ok ? { ok: true } : { ok: false, error: "topic 不存在: " + topic };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
