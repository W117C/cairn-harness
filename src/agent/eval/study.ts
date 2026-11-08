import { createRng, nextRandom } from '../../routing/bandit';

export interface StudyTrial { taskId: string; strategy: string; rep: number; seed: number }
export interface StudyRecord extends StudyTrial { outcome: 'pass' | 'fail' | 'unmeasurable'; tokens: number | null; seconds: number | null }
const identity = (trial: StudyTrial): string => JSON.stringify([trial.taskId, trial.strategy, trial.rep]);

export function createStudySchedule(options: { tasks: readonly string[]; strategies: readonly string[]; reps: number; seed: number }): StudyTrial[] {
  for (const values of [options.tasks, options.strategies]) {
    if (values.length === 0 || values.some(value => value.trim() === '') || new Set(values).size !== values.length) throw new Error('Study identities must be non-empty and unique');
  }
  if (!Number.isSafeInteger(options.reps) || options.reps < 1 || !Number.isSafeInteger(options.seed)) throw new Error('Invalid study repeats or seed');
  const rng = createRng(options.seed);
  const trials: StudyTrial[] = [];
  for (const taskId of options.tasks) for (let rep = 1; rep <= options.reps; rep++) {
    const block = options.strategies.map(strategy => ({ taskId, strategy, rep, seed: Math.floor(nextRandom(rng) * 0x100000000) }));
    for (let at = block.length - 1; at > 0; at--) {
      const other = Math.floor(nextRandom(rng) * (at + 1));
      [block[at], block[other]] = [block[other]!, block[at]!];
    }
    trials.push(...block);
  }
  return trials;
}

export function summarizeStudy(schedule: readonly StudyTrial[], records: readonly StudyRecord[]) {
  const planned = new Map(schedule.map(trial => [identity(trial), trial]));
  if (planned.size !== schedule.length) throw new Error('Duplicate scheduled trial');
  const actual = new Map<string, StudyRecord>();
  for (const record of records) {
    const key = identity(record), trial = planned.get(key);
    if (!trial || trial.seed !== record.seed || actual.has(key)) throw new Error('Foreign or duplicate study record');
    if (!['pass', 'fail', 'unmeasurable'].includes(record.outcome) || (record.seconds !== null && (!Number.isFinite(record.seconds) || record.seconds < 0)) ||
        (record.tokens !== null && (!Number.isFinite(record.tokens) || record.tokens < 0))) throw new Error('Invalid study measurement');
    actual.set(key, record);
  }
  const arms = [...new Set(schedule.map(trial => trial.strategy))].map(strategy => {
    const requested = schedule.filter(trial => trial.strategy === strategy);
    const rows = records.filter(record => record.strategy === strategy);
    const pass = rows.filter(row => row.outcome === 'pass').length, fail = rows.filter(row => row.outcome === 'fail').length;
    const unknownUsageRuns = rows.filter(row => row.tokens === null).length;
    return { strategy, planned: requested.length, attempted: rows.length, pass, fail,
      unmeasurable: rows.filter(row => row.outcome === 'unmeasurable').length, pending: requested.length - rows.length,
      decidablePassRate: pass + fail > 0 ? pass / (pass + fail) : null,
      totalTokens: unknownUsageRuns === 0 && rows.length > 0 ? rows.reduce((sum, row) => sum + row.tokens!, 0) : null,
      unknownUsageRuns, unknownTimeRuns: rows.filter(row=>row.seconds===null).length,
      seconds: rows.some(row=>row.seconds===null)?null:rows.reduce((sum, row) => sum + row.seconds!, 0) };
  });
  const comparisons = arms.filter(arm => arm.strategy !== 'baseline').map(arm => {
    const pairs: { taskId: string; difference: number }[] = [];
    let wins = 0, losses = 0;
    for (const row of records.filter(record => record.strategy === arm.strategy)) {
      const base = records.find(candidate => candidate.strategy === 'baseline' && candidate.taskId === row.taskId && candidate.rep === row.rep);
      if (!base || base.outcome === 'unmeasurable' || row.outcome === 'unmeasurable') continue;
      const difference = Number(row.outcome === 'pass') - Number(base.outcome === 'pass');
      pairs.push({ taskId: row.taskId, difference }); wins += Number(difference > 0); losses += Number(difference < 0);
    }
    const tasks = [...new Set(pairs.map(pair => pair.taskId))];
    const effects = tasks.map(task => { const rows = pairs.filter(pair => pair.taskId === task); return rows.reduce((sum, row) => sum + row.difference, 0) / rows.length; });
    return { strategy: arm.strategy, pairedTrajectories: pairs.length, pairedTasks: tasks.length, wins, losses,
      taskMeanCompletionDifference: effects.length > 0 ? effects.reduce((sum, value) => sum + value, 0) / effects.length : null };
  });
  return { arms, comparisons, independentTasks: new Set(schedule.map(trial => trial.taskId)).size,
    complete: records.length === schedule.length, inference: 'pilot-only' as const,
    limitation: 'Descriptive pilot. Repeated attempts and test assertions are not independent tasks; saturation does not establish equivalence.' };
}
