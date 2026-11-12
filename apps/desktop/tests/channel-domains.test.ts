// 桥面域归属判卷（2026-11-12 · 对标 ADR 0010 的待办第 3 条）。
//
// 为什么有这批判据：Claude Desktop 5.1231.2 的桥面按域命名空间组织
// （claude.web / claude.settings / claude.internal.ui … 约 24 个命名空间对象），
// 于是「这块能力属于哪个域」在那边**可枚举**。本仓的桥是单一扁平面，
// 165 条通道（156 invoke + 9 push）原本没有归属结构——归属只活在
// `apps/desktop/tests/channels.test.ts` 里那张 156 条的手写「接真名单」中，
// 而那张名单证明的是「有没有接真」，不是「归谁管」。
//
// 这批判据钉的是**归属表本身**：
//   ① 归属表与通道表**同生共死**（键集双向相等；漏一条 = 归属缺失 = 红）；
//   ② 每个域**非空**（域多到没通道 ⇒ 名存实亡，红）；
//   ③ 域名有说明、说明有域（孤儿说明 = 红）；
//   ④ 各域的通道数被钉住——**改归属是显式动作**，不是随手拖一条。
//
// 完整性红线的静态那半在 channels.ts 的映射类型里
// （`{ [K in InvokeChannel]: ChannelDomain }` ⇒ AgentApi 增删方法 ⇒ typecheck 红），
// 这里钉的是运行时的另一半（表与表一致、域非空、计数）。
import { describe, expect, it } from "vitest";
import {
  CHANNEL_DOMAINS,
  CHANNEL_DOMAIN_DESC,
  INVOKE_CHANNELS,
  PUSH_CHANNEL_DOMAINS,
  PUSH_CHANNELS,
  PUSH_DOMAIN_DESC,
  type ChannelDomain,
} from "../src/main/channels";

const invokeKeys = Object.keys(INVOKE_CHANNELS);
const pushKeys = Object.keys(PUSH_CHANNELS);
const allDomains = Object.keys(CHANNEL_DOMAIN_DESC) as ChannelDomain[];

describe("归属表与通道表同生共死", () => {
  it("invoke 归属表键集 = 通道表键集（漏一条就是归属缺失）", () => {
    expect(Object.keys(CHANNEL_DOMAINS).sort()).toEqual([...invokeKeys].sort());
  });

  it("push 归属表键集 = 推送通道键集", () => {
    expect(Object.keys(PUSH_CHANNEL_DOMAINS).sort()).toEqual([...pushKeys].sort());
  });

  it("归属表的值都是已声明的域（拼错的域名当场红）", () => {
    const known = new Set<string>(allDomains);
    for (const [key, domain] of Object.entries(CHANNEL_DOMAINS)) {
      expect(known.has(domain), `${key} → 未声明的域 ${domain}`).toBe(true);
    }
    for (const [key, domain] of Object.entries(PUSH_CHANNEL_DOMAINS)) {
      expect(known.has(domain), `${key} → 未声明的域 ${domain}`).toBe(true);
    }
  });
});

describe("域不是名存实亡：每个域都有通道、都有说明", () => {
  it("每个声明的域至少有一条通道（invoke 或 push）", () => {
    const used = new Set([...Object.values(CHANNEL_DOMAINS), ...Object.values(PUSH_CHANNEL_DOMAINS)]);
    for (const domain of allDomains) {
      expect(used.has(domain), `域 ${domain} 一条通道都没有`).toBe(true);
    }
  });

  it("每个域都有说明，且说明不少于 10 字（空话等于没登记）", () => {
    for (const domain of allDomains) {
      const desc = CHANNEL_DOMAIN_DESC[domain];
      expect(desc, `域 ${domain} 没有说明`).toBeTruthy();
      expect(desc.trim().length, `域 ${domain} 的说明太短`).toBeGreaterThanOrEqual(10);
    }
  });

  it("push 侧用到的域都有 push 说明（孤儿说明当场红）", () => {
    for (const domain of new Set(Object.values(PUSH_CHANNEL_DOMAINS))) {
      expect(PUSH_DOMAIN_DESC[domain], `push 域 ${domain} 没有说明`).toBeTruthy();
    }
  });
});

describe("各域的通道数被钉住（改归属是显式动作）", () => {
  it("invoke 侧 156 条按 18 个域分布，计数如下", () => {
    const counts: Record<string, number> = {};
    for (const domain of Object.values(CHANNEL_DOMAINS)) {
      counts[domain] = (counts[domain] ?? 0) + 1;
    }
    expect(counts).toEqual({
      run: 10,
      session: 21,
      project: 18,
      provider: 8,
      settings: 15,
      plugin: 15,
      skills: 2,
      memory: 2,
      automation: 9,
      pane: 15,
      app: 18,
      integration: 5,
      evolve: 7,
      orchestration: 3,
      usage: 1,
      lsp: 1,
      sidechat: 4,
      feedback: 2,
    });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(invokeKeys.length);
  });

  it("push 侧 9 条按 3 个域分布", () => {
    const counts: Record<string, number> = {};
    for (const domain of Object.values(PUSH_CHANNEL_DOMAINS)) {
      counts[domain] = (counts[domain] ?? 0) + 1;
    }
    expect(counts).toEqual({ run: 3, pane: 4, app: 2 });
  });
});
