import { describe, expect, it } from "vitest";
import type { AgentApi } from "../../../src/main/ipc-protocol";
import { INVOKE_CHANNELS, PUSH_CHANNELS, type PushChannel } from "../src/main/channels";

// 完整性裁决在类型侧：interface 无运行时形态，Object.keys({} as AgentApi) 恒为 []，
// 「invoke 通道覆盖 AgentApi 全部非推送键」只能由 channels.ts 的 INVOKE_CHANNELS
// 映射类型声明 ＋ tsc（pnpm --filter m0-desktop typecheck，tsconfig include 含 tests/）
// 静态裁决。运行时用例只验推送三键与 invoke 表非空。

describe("通道名表完整性", () => {
  it("推送通道恰为三条且通道名非空", () => {
    expect(Object.keys(PUSH_CHANNELS).sort()).toEqual(["onAsk", "onAskDone", "onEvent"]);
    for (const channel of Object.values(PUSH_CHANNELS)) expect(channel).toBeTruthy();
  });

  it("invoke 通道表非空且每行通道名非空", () => {
    const keys = Object.keys(INVOKE_CHANNELS) as (keyof typeof INVOKE_CHANNELS)[];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(INVOKE_CHANNELS[key]).toBeTruthy();
  });

  it("类型侧红线：INVOKE_CHANNELS 键集恰为 AgentApi 去掉三条推送键（typecheck 裁决）", () => {
    type Expect<T extends true> = T;
    type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
    // 双向钉死：AgentApi 增删方法或 PushChannel 漂移 ⇒ 此 Equal 破 ⇒ typecheck 红。
    type _invokeKeysAreExact = Expect<Equal<keyof typeof INVOKE_CHANNELS, Exclude<keyof AgentApi, PushChannel>>>;
    expect(true).toBe(true);
  });
});
