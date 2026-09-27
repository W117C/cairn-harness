// 测试专用：比较事件流时**只**剥掉落盘时钟戳那一个字段。
//
// 为什么需要它：`createEventLog.append` 现在给每条落盘事件盖 `ts`（延迟唯一可测的面）。
// 戳盖在事件本身上，不是盘上的私有副本 ⇒ **同一次 run 里** live 与 replay 逐字相等，
// 「丢弃内存态 → 重放等价」那条不变量不需要这把尺（`tests/events.test.ts` 里那条「盘与 live
// 必须是同一个式子」就是钉它的）。
// 但**跨 run** 比较必须剥：两次跑的墙钟必然不同，不剥就是恒红：
//  - `tests/action-fusion.test.ts`「默认/off 两次 run 逐字节不变」——这正是 orchestration spec
//    给 D8 / W4a 写的验收口径（「单工具调用时事件流逐字节不变」）所用的那把尺；
//  - `tests/session-wiring.test.ts` 的两次装配对照。
// 只剥 `ts` 一个键、其余逐字照比 ⇒ 判据强度不降，只是不再要求两次 run 的时钟相同。
// 放在 tests 侧而不进产品：产品没有任何"剥掉时间再比"的需求，留在那边就是给生产类加测试孔。
export type Stripped = Record<string, unknown>;

/** 浅拷贝后删掉 `ts`（不改调用方对象；保留其余键的插入序，`JSON.stringify` 才可比）。 */
export function withoutTs(event: unknown): Stripped {
  const copy = { ...(event as Stripped) };
  delete copy.ts;
  return copy;
}

export function stripTs(events: readonly unknown[]): Stripped[] {
  return events.map(withoutTs);
}
