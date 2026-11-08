import { describe, expect, it } from 'vitest';
import { createStudySchedule, summarizeStudy } from '../src/agent/eval/study';

describe('study identity and denominators',()=>{
  it('keeps every task, strategy and repeat exactly once with reproducible randomization',()=>{
    const options={tasks:['one','two'],strategies:['baseline','triggered'],reps:2,seed:17};
    const one=createStudySchedule(options),two=createStudySchedule(options);
    expect(one).toEqual(two);expect(one).toHaveLength(8);
    expect(new Set(one.map(t=>`${t.taskId}/${t.strategy}/${t.rep}`)).size).toBe(8);
    expect(createStudySchedule({...options,seed:18})).not.toEqual(one);
  });
  it('rejects duplicate task identities rather than inflating the denominator',()=>{
    expect(()=>createStudySchedule({tasks:['one','one'],strategies:['baseline'],reps:1,seed:1})).toThrow();
  });
  it('keeps missing and unmeasurable trials separate from passes and failures',()=>{
    const schedule=createStudySchedule({tasks:['one','two'],strategies:['baseline','triggered'],reps:1,seed:1});
    const records=[{...schedule.find(t=>t.taskId==='one'&&t.strategy==='baseline')!,outcome:'pass' as const,tokens:10,seconds:1},
      {...schedule.find(t=>t.taskId==='one'&&t.strategy==='triggered')!,outcome:'unmeasurable' as const,tokens:null,seconds:1}];
    const summary=summarizeStudy(schedule,records);
    expect(summary.arms.find(a=>a.strategy==='baseline')).toMatchObject({planned:2,pass:1,fail:0,pending:1,unmeasurable:0});
    expect(summary.arms.find(a=>a.strategy==='triggered')).toMatchObject({planned:2,pass:0,fail:0,pending:1,unmeasurable:1});
    expect(summary.complete).toBe(false);
  });
  it('does not turn repeated attempts on one task into independent tasks',()=>{
    const schedule=createStudySchedule({tasks:['one'],strategies:['baseline','triggered'],reps:3,seed:1});
    const records=schedule.map(t=>({...t,outcome:'pass' as const,tokens:10,seconds:1}));
    const summary=summarizeStudy(schedule,records);
    expect(summary.independentTasks).toBe(1);expect(summary.complete).toBe(true);
    expect(summary.inference).toBe('pilot-only');
  });
  it('rejects duplicate or foreign records instead of overwriting an earlier result',()=>{
    const schedule=createStudySchedule({tasks:['one'],strategies:['baseline'],reps:1,seed:1});
    const row={...schedule[0]!,outcome:'pass' as const,tokens:10,seconds:1};
    expect(()=>summarizeStudy(schedule,[row,row])).toThrow();
    expect(()=>summarizeStudy(schedule,[{...row,taskId:'foreign'}])).toThrow();
  });
  it('does not report an interrupted attempt as zero elapsed time',()=>{
    const schedule=createStudySchedule({tasks:['one'],strategies:['baseline'],reps:1,seed:1});
    expect(summarizeStudy(schedule,[{...schedule[0]!,outcome:'unmeasurable',tokens:null,seconds:null}]).arms[0]).toMatchObject({seconds:null,unknownTimeRuns:1});
  });
});
