import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
    // 运行时计数钉（终审顺手项）：类型侧红线靠 tsconfig include 含 tests/ 才生效，
    // include 一收窄就哑火——表长在运行时也咬得住，漂移（AgentApi 增删方法）当场红。
    // M4-5：＋pickDirectory（dialog 选目录，M3 deferred 收口）⇒ 40。
    expect(Object.keys(INVOKE_CHANNELS)).toHaveLength(40);
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

  it("wired 覆盖守卫：应接线通道在 index.ts wired 表逐一有行（防漏行三连复发）", () => {
    // M3 终审防回归守卫：wired 表漏行这一类 bug 已三连同型发生（getProviderInfo → submitClarify
    // → decidePlan）——channels 表/preload/AgentApi 三面齐全，wired 表独缺一行，renderer 调用
    // 即 reject「No handler registered」，且只有真开窗冒烟才暴露。守卫读 index.ts 源文，
    // 逐一断言「应接线名单」的每个键都有 wired 行（行首锚定 key:；index.ts 的注册循环按
    // AgentApi 方法名从 wired 表取行，通道名字符串本身不出现在其源文——断言对象因此是键行）。
    // 新接线一个通道：把它从白名单移出、加入应接线名单；漏行当场红。
    const indexTs = readFileSync(fileURLToPath(new URL("../src/main/index.ts", import.meta.url)), "utf8");
    // 应接线名单（M3 终审时点的实际已接线集合，含本笔新增 submitClarify/decidePlan）。
    const mustWire: readonly string[] = [
      "run",
      "decide",
      "submitClarify",
      "decidePlan",
      "runCancel",
      "listSessions",
      "createSession",
      "openSession",
      "getProviderInfo",
      "listProjects",
      "addProject",
      "removeProject",
    ];
    // 有意未接线白名单：v1 不做清单通道（M4+ 逐个接线时从白名单移出）。与 mustWire 无交、
    // 二者并集恰为 INVOKE_CHANNELS 全键——名单本身漂移（漏列/多列）当场红。
    const whitelist: readonly string[] = [
      // 目标/压缩/状态（M4+ 会话管理面）
      "setGoal",
      "compact",
      "getState",
      // 引导与设置（v1 静默默认 + 模型选择器只读 getProviderInfo）
      "getOnboarding",
      "getSettings",
      "setSettings",
      // 会话修饰（列表分组后的重命名/删除/归档/钉选/归组）
      "renameSession",
      "deleteSession",
      "setSessionPinned",
      "setSessionArchived",
      "assignSessionProject",
      // 记忆/插件（v1 无管理 UI）
      "deleteMemory",
      "pluginDecide",
      // 侧聊（v1 不做）
      "sidechatCreate",
      "sidechatAsk",
      "sidechatPromote",
      "sidechatState",
      // 卡片动作（v1 卡片只读）
      "cardAction",
      // 调度（v1 不做）
      "scheduleSnapshot",
      "scheduleUpsert",
      "scheduleDelete",
      "scheduleRunNow",
      // provider key 管理（v1 走 settings 文件，无 key 入库面）
      "providerKeySet",
      "providerKeyDelete",
      "providerKeyStatus",
      // 更新与外链（桌面壳职责，M4+）
      "checkUpdate",
      "openExternal",
      // M4-5：dialog 选目录——新通道直接接真（wired 行＋AgentApi＋channels 三面同步），不进白名单。
      "pickDirectory",
    ];
    const allKeys = Object.keys(INVOKE_CHANNELS) as (keyof typeof INVOKE_CHANNELS)[];
    const expected = allKeys.filter((k) => !whitelist.includes(k));
    // 名单完整性自钉：白名单之外的每一键都必须列在 mustWire 里（防名单漏列守卫哑火）。
    expect([...mustWire].sort()).toEqual([...expected].sort());
    for (const key of mustWire) {
      const row = new RegExp(`^\\s*${key}\\s*:`, "m");
      expect(row.test(indexTs), `wired 表缺行：${key}（通道 ${INVOKE_CHANNELS[key as keyof typeof INVOKE_CHANNELS]}）`).toBe(true);
    }
  });
});
