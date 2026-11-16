// 记忆面板的服务端一半：把三层目录数出来（主题数 + 字节），交给核心的纯投影折成行。
//
// 只读、只数：不写、不建目录、不猜（目录不存在 ⇒ 0）。
// 主题 = `<dir>/<name>.md`；`MEMORY_INDEX.md` 是索引文件，不算主题（否则永远多 1）。
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { memoryPanelView, type MemoryPanelView } from "../../../../src/agent/memory/panel";

export const MEMORY_INDEX_FILE = "MEMORY_INDEX.md";

export async function dirStat(dir: string): Promise<{ dir: string; topics: number; bytes: number }> {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return { dir, topics: 0, bytes: 0 };
  }
  const topics = names.filter((n) => n.endsWith(".md") && n !== MEMORY_INDEX_FILE);
  let bytes = 0;
  for (const name of topics) {
    try {
      bytes += (await stat(join(dir, name))).size;
    } catch { /* 数不出来就当 0，不假装有 */ }
  }
  return { dir, topics: topics.length, bytes };
}

export async function memoryPanelFor(input: {
  projectDir: string;
  teamDir: string;
  memberIds: readonly string[];
  memberDirOf: (id: string) => string;
}): Promise<MemoryPanelView> {
  const project = await dirStat(input.projectDir);
  const team = await dirStat(input.teamDir);
  const members = await Promise.all(
    input.memberIds.map(async (id) => ({ memberId: id, ...(await dirStat(input.memberDirOf(id))) })),
  );
  return memoryPanelView({ project, team, members });
}
