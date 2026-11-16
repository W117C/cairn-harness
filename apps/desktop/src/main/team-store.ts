// 团队档案的落点（ADR 0015 §五 B3：registry ＝ 投影）。
//
// 一句话：**没有 team.json**。成员档案是一条一条追加进事件日志的补丁
// （`session_meta_update` 的 `member.<id>.<字段>` 键），名单由投影现算。
// 这样删人不需要「改文件」，只需要再追加一条 `removed=1`；重放能得到同一份名单。
//
// 为什么用 `createEventLog` 而不是自己 `appendFile`：写入面已有一份——单一写者、未知事件类型
// 当场拒、半行修复都在那里。团队日志没有理由再造第二套写盘语义。
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createEventLog, replay, type AgentEvent } from "../../../../src/events";
import type { AgentPermissionMode } from "../../../../src/events/types";
import { MEMBER_KEY_PREFIX, projectMembers, type MemberPatchRecord, type MemberRoster } from "../../../../src/agent/team/members";
import { GRANT_KEY_PREFIX } from "../../../../src/agent/team/secrets";

/** 团队日志落点：`<userData>/team/events.jsonl`（与会话/编排日志同级，不在工作区里）。 */
export function teamLogPath(userData: string): string {
  return join(userData, "team", "events.jsonl");
}

/** 读：日志 → 补丁记录。行号即 `at`（单调即可，投影不比大小，只按顺序累积）。 */
export async function readTeamRecords(path: string): Promise<MemberPatchRecord[]> {
  let events: AgentEvent[];
  try {
    events = await replay(path);
  } catch {
    // 文件还没建（全新用户）：空名单是合法状态，不是错误。
    return [];
  }
  const out: MemberPatchRecord[] = [];
  events.forEach((event, index) => {
    if (event.type !== "session_meta_update") return;
    const patch = event.patch;
    if (patch === null || typeof patch !== "object") return;
    // 团队日志里现在有两族键：成员档案（member.*）与密钥授权（grant.*）。两族都要读，
    // 各自投影；不认识的键仍在各自投影里被点名为 rejected。
    if (!Object.keys(patch).some((key) => key.startsWith(MEMBER_KEY_PREFIX) || key.startsWith(GRANT_KEY_PREFIX))) return;
    out.push({ at: index + 1, patch });
  });
  return out;
}

/** 写：只追加。校验过的补丁才该走到这里（`memberPatch` 是唯一的构造器）。 */
export async function appendTeamPatch(path: string, patch: Record<string, string>): Promise<void> {
  if (Object.keys(patch).length === 0) throw new Error("空的成员补丁：没有任何键可写");
  // 目录不存在是全新用户的常态：先建目录再追加（与会话/编排日志同一条落盘纪律）。
  await mkdir(dirname(path), { recursive: true });
  await createEventLog(path).append({ type: "session_meta_update", patch } as AgentEvent);
}

/**
 * 读名单：同一份日志重放两次逐字相同（`projectMembers` 是纯函数，这里只做落盘 → 记录的搬运）。
 * `teamTier` 是成员档的上界；调用方给当前用户档（成员不得宽于团队）。
 */
export async function readTeamRoster(
  path: string,
  teamTier: AgentPermissionMode,
): Promise<MemberRoster & { records: number }> {
  const records = await readTeamRecords(path);
  return { ...projectMembers(records, teamTier), records: records.length };
}
