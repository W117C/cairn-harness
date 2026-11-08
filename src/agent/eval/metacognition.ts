// Opt-in evaluation policy only. No permissions, tools, judge or production defaults change.
import { createRng, nextRandom } from '../../routing/bandit';
import { isEnvVerifyCause, type AgentEvent } from '../../events';
import { judgeNoProgressEvents, normalizeFailureLine, verifySignature } from '../no-progress';
import { classifyVerifyFailure } from '../verify';

export const STUDY_STRATEGIES = ['baseline', 'high', 'triggered', 'periodic', 'random'] as const;
export type StudyStrategy = typeof STUDY_STRATEGIES[number];
export interface InterventionOptions { strategy: string; seed: number; maxInterventions: number; period?: number; probability?: number }
export interface InterventionDecision { request: number; reason: string; evidenceEvent: number }

export function createInterventionPolicy(options: InterventionOptions): {
  next: (events: readonly AgentEvent[]) => string | undefined;
  decisions: InterventionDecision[];
} {
  const period = options.period ?? 5, probability = options.probability ?? 0.2;
  if (!(STUDY_STRATEGIES as readonly string[]).includes(options.strategy) || !Number.isSafeInteger(options.seed) ||
      !Number.isSafeInteger(options.maxInterventions) || options.maxInterventions < 0 || !Number.isSafeInteger(period) || period < 1 ||
      !Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('Invalid intervention strategy or budget');
  const decisions: InterventionDecision[] = [], seen = new Set<string>();
  const rng = createRng(options.seed);
  let request = 0, userCount = 0;
  return { decisions, next(events) {
    request++;
    if (options.strategy === 'baseline' || options.strategy === 'high' || decisions.length >= options.maxInterventions) return undefined;
    const users = events.filter(event => event.type === 'user_message').length;
    if (users !== userCount) { seen.clear(); userCount = users; }
    let reason = '', key = '', evidenceEvent = events.length;
    if (options.strategy === 'periodic') {
      if (request % period !== 0) return undefined;
      reason = 'periodic'; key = 'periodic:' + request;
    } else if (options.strategy === 'random') {
      if (request === 1 || nextRandom(rng) >= probability) return undefined;
      reason = 'random'; key = 'random:' + request;
    } else {
      let latest = -1;
      for (let at = events.length - 1; at >= 0; at--) {
        if (events[at]!.type === 'user_message') break;
        if (events[at]!.type === 'tool_result' || events[at]!.type === 'verify_result') { latest = at; break; }
      }
      const last = events[latest];
      const verify = last?.type === 'verify_result' ? last : last?.type === 'tool_result'
        ? [...events.slice(0, latest)].reverse().find(event => event.type === 'verify_result' && event.callId === last.callId) : undefined;
      if (verify?.type === 'verify_result' && !verify.ok) {
        if (isEnvVerifyCause(verify.cause)) return undefined;
        reason = 'validation-failed'; key = reason + ':' + verifySignature(verify.results).signature;
      } else if (last?.type === 'tool_result' && !last.ok && !last.blockedBy) {
        if ((last.exitCode !== undefined || last.timedOut) && isEnvVerifyCause(classifyVerifyFailure({
          exitCode:last.exitCode??null,timedOut:last.timedOut===true,output:last.output,
        }))) return undefined;
        const call = [...events.slice(0, latest)].reverse().find(event => event.type === 'tool_call' && event.id === last.callId);
        reason = 'tool-failed'; key = reason + ':' + (call?.type === 'tool_call' ? call.name : '?') + ':' + normalizeFailureLine(last.output);
      } else {
        let start = events.length;
        while (start > 0 && events[start - 1]!.type !== 'user_message') start--;
        const progress = judgeNoProgressEvents(events.slice(start) as unknown as readonly Record<string, unknown>[]);
        if (progress.action === 'silent') return undefined;
        reason = 'no-progress'; key = reason + ':' + progress.rules.join(',');
      }
      evidenceEvent = latest >= 0 ? latest + 1 : events.length;
      if (seen.has(key)) return undefined;
    }
    seen.add(key); decisions.push({ request, reason, evidenceEvent });
    const evidence = reason === 'validation-failed' ? `验证未通过（事件序号 ${evidenceEvent}）。`
      : reason === 'tool-failed' ? `工具未成功（事件序号 ${evidenceEvent}）。`
      : reason === 'no-progress' ? `已有重复或停滞证据（截至事件序号 ${evidenceEvent}）。` : '';
    return '[实验策略提示] ' + evidence + '继续前简短核对目标、关键假设和已有证据；选择一个能区分原因的最小探针，再决定下一项修改与验证。遵守原有权限与验收要求。';
  } };
}
