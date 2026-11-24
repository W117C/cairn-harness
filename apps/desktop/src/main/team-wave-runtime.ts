import type { AgentEvent } from "../../../../src/events";
import { readSessionEvents } from "../../../../src/main/sessions";
import type { MemberProfile } from "../../../../src/agent/team/members";
import type { PermissionMode } from "../../../../src/permissions/modes";
import type { StartDepsWithSecrets } from "./team-dispatch";
import { startRosterMember } from "./team-member-run";
import { runWave, type WaveResult } from "./team-wave";

export interface GroupWaveRuntimeInput {
  sessionsRoot: string;
  sessionId: string;
  workspace: string;
  members: readonly MemberProfile[];
  maxMode: PermissionMode;
  speakers: readonly string[];
  task: string;
}

export type GroupWaveRuntimeDeps = StartDepsWithSecrets & {
  sessionsRootFor: (workspace: string) => Promise<string | undefined>;
  hasWorkspace: (workspace: string) => boolean;
  readMember?: (root: string, id: string) => Promise<AgentEvent[]>;
};

function finalAssistant(events: readonly AgentEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.type === "assistant_message" && event.content.trim() !== "") return event.content;
  }
  return null;
}

export async function runTeamGroupWave(
  input: GroupWaveRuntimeInput,
  deps: GroupWaveRuntimeDeps,
): Promise<WaveResult> {
  const readMember = deps.readMember ?? readSessionEvents;
  return await runWave({
    speakers: input.speakers,
    task: input.task,
    read: async () => await readSessionEvents(input.sessionsRoot, input.sessionId),
    start: async (memberId, composed) => {
      const member = input.members.find((m) => m.id === memberId);
      if (member === undefined) return { ok: false, error: `成员不在名单里: ${memberId}` };
      const started = await startRosterMember({
        sessionsRootFor: deps.sessionsRootFor,
        member,
        task: composed,
        maxMode: input.maxMode,
        workspace: input.workspace,
      }, deps);
      if (started.ok !== true || started.sessionId === undefined || started.sessionsRoot === undefined) {
        return { ok: false, ...(started.error === undefined ? {} : { error: started.error ?? "成员会话根缺失" }) };
      }
      const reply = finalAssistant(await readMember(started.sessionsRoot, started.sessionId));
      return {
        ok: true,
        sessionId: started.sessionId,
        ...(reply === null ? {} : { reply }),
      };
    },
    writeBack: async (memberId, reply) => {
      await deps.append(deps.pathOf(input.sessionsRoot, input.sessionId), {
        type: "assistant_message",
        content: reply,
        agent_id: `member:${memberId}`,
      });
    },
  });
}
