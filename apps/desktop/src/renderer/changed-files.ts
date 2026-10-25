import type { AgentEvent } from "../../../../src/events";
import { turnChanges } from "./projections";

/** 变更审阅指示器：当前会话改动过的去重文件数（顶栏 Changes 徽标的数据源）。
 *  数据面 = turnChanges（它已把 tool_call 的 path 与 tool_result 的 change 配对投影）；
 *  同一文件改两次算一个（审阅的对象是文件，不是编辑次数）。 */
export function changedFileCount(events: readonly AgentEvent[]): number {
  const paths = new Set<string>();
  for (const t of turnChanges(events)) for (const f of t.files) paths.add(f.path);
  return paths.size;
}

