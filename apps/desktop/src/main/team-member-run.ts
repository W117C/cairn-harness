import type { MemberProfile } from "../../../../src/agent/team/members";
import type { PermissionMode } from "../../../../src/permissions/modes";
import { canonicalWorkspacePath } from "./kernel-host";
import {
  prepareMemberRun,
  startMemberWithSecrets,
  type StartDepsWithSecrets,
  type StartWithSecretsResult,
} from "./team-dispatch";

export interface RosterMemberRunInput {
  sessionsRootFor: (workspace: string) => Promise<string | undefined>;
  member: MemberProfile;
  task: string;
  maxMode: PermissionMode;
  workspace: string;
}

export type RosterMemberRunDeps = StartDepsWithSecrets & {
  hasWorkspace: (workspace: string) => boolean;
};

export type RosterMemberRunResult = StartWithSecretsResult & { sessionsRoot?: string };

export async function startRosterMember(
  input: RosterMemberRunInput,
  deps: RosterMemberRunDeps,
): Promise<RosterMemberRunResult> {
  const baseWorkspace = canonicalWorkspacePath(input.workspace);
  const prepared = await prepareMemberRun({
    sessionsRoot: "",
    memberId: input.member.id,
    task: input.task,
    mode: input.member.tier,
    maxMode: input.maxMode,
    workspace: baseWorkspace,
    ...(input.member.model === undefined ? {} : { model: input.member.model }),
    ...(input.member.thinking === undefined ? {} : { thinking: input.member.thinking }),
    ...(input.member.workdir == null ? {} : { workdir: input.member.workdir }),
  });
  if (!prepared.ok) return prepared;
  const executionWorkspace = canonicalWorkspacePath(prepared.workspace ?? baseWorkspace);
  if (!deps.hasWorkspace(executionWorkspace)) {
    return { ok: false, error: `成员工作区未注册: ${executionWorkspace}` };
  }
  const sessionsRoot = await input.sessionsRootFor(executionWorkspace);
  if (sessionsRoot === undefined) return { ok: false, error: "没有可用的会话根" };
  const result = await startMemberWithSecrets({
    sessionsRoot,
    memberId: input.member.id,
    task: input.task,
    mode: prepared.mode,
    workspace: executionWorkspace,
    ...(prepared.model === undefined ? {} : { model: prepared.model }),
    ...(prepared.thinking === undefined ? {} : { thinking: prepared.thinking }),
  }, deps);
  return result.ok === true ? { ...result, sessionsRoot } : result;
}
