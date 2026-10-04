// bandit 的原语与状态守卫（2026-10-02 普查增补）。
//
// 立项动因（实测）：`src/routing/bandit.ts` 162 行、**零**变异锚点；
// `createRng` / `selectArm` 各只有 1 支判卷，而 **`nextRandom` / `defaultPosterior` /
// `armKeyOf` 零判卷**——可 `docs/m5-proposal.md` §5.12 把「同 seed 两次跑逐字段一致」
// 写成了**验收要求**。要求在这里，却没有人钉它。
//
// 顺着这条查下去发现一个**挂死**（见下面 ②）：守卫只查「posteriors 是不是对象」，
// 不查条目内部，于是畸形 shape 流进 Gamma 拒绝采样后，那个 `for(;;)` 永不退出。
// 本文件钉三件事：① RNG 的确定性契约 ② 状态守卫的逐条校验 ③-⑥ update/selectArm 语义。
import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  armKeyOf,
  createRng,
  defaultPosterior,
  loadBanditState,
  newBanditState,
  nextRandom,
  saveBanditState,
  selectArm,
  update,
  updatePriced,
  type ArmKey,
  type Posteriors,
} from "../src/routing/bandit";

/** 一份临时状态文件的路径 + 清理。 */
async function statePath(): Promise<{ p: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "dsh-bandit-"));
  return { p: join(dir, "state.json"), cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => {}) };
}

const arm = (stage: string, tier: ArmKey["tier"]): ArmKey => ({ stage, tier });

/** 往临时文件里写一份状态，读回来，并把 onCorrupt 收到的东西交出来。 */
async function loadFrom(body: unknown): Promise<{ st: Awaited<ReturnType<typeof loadBanditState>>; warned: string | null }> {
  const { p, cleanup } = await statePath();
  try {
    await writeFile(p, typeof body === "string" ? body : JSON.stringify(body), "utf8");
    let warned: string | null = null;
    const st = await loadBanditState(p, (r) => { warned = r; });
    return { st, warned };
  } finally {
    await cleanup();
  }
}

describe("① RNG：可播种、逐值可复现（m5-proposal §5.12 的验收要求）", () => {
  it("同 seed 两次跑逐值一致 —— 这一条是硬要求，不是性质描述", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 400 }, () => nextRandom(a)))
      .toEqual(Array.from({ length: 400 }, () => nextRandom(b)));
  });

  it("不同 seed 产出不同序列（否则「播种」只是装饰）", () => {
    expect(nextRandom(createRng(42))).not.toBe(nextRandom(createRng(43)));
  });

  it("值恒在 [0,1) —— 下游 Math.floor(v*10) 之类不许越界", () => {
    const r = createRng(7);
    const vals = Array.from({ length: 2000 }, () => nextRandom(r));
    expect(vals.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it("不卡住：连续取值几乎全不重复（RNG 退化成常量会立刻打爆路由）", () => {
    // 注意 rng 只建一次：建在循环里的话每次都是「同一个种子的第一次取值」，
    // 于是 2000 个值全等 —— 那测的是我的写法不是 RNG（第一版就踩了这个）。
    const r = createRng(99);
    const vals = Array.from({ length: 2000 }, () => nextRandom(r));
    expect(new Set(vals).size).toBeGreaterThan(1990);
  });

  it("分布大致均匀（十桶最大偏离在噪声带内）", () => {
    const r = createRng(1234);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 4000; i++) buckets[Math.floor(nextRandom(r) * 10)]++;
    // n=4000、σ≈20 ⇒ 4σ≈80；卡 100 既能抓真偏斜，又不会被正常波动误伤
    for (const n of buckets) expect(Math.abs(n - 400), "十桶分布: " + buckets.join(",")).toBeLessThan(100);
  });
});

describe("② 状态守卫：畸形 posterior 必须被逐条挡下（挂死那一格）", () => {
  // ↓↓↓ 本轮核心。实测过的挂死链条：
  //   `{"alpha":"oops"}` 被放行 → selectArm → sampleBeta → sampleGamma("oops")
  //   → `shape - 1/3` = NaN → 判据 `Math.log(u3) < …NaN…` 恒 false → for(;;) 永不退出。
  // 所以断言不写成「selectArm 会怎样」（那会挂住判卷本身），而是**断言守卫在入口就挡住**。
  const malformed: readonly { label: string; entry: unknown }[] = [
    { label: "alpha 是字符串", entry: { alpha: "oops", beta: 2 } },
    { label: "缺 alpha", entry: { beta: 2 } },
    { label: "缺 beta", entry: { alpha: 2 } },
    { label: "alpha 是 null", entry: { alpha: null, beta: 2 } },
    { label: "beta 是字符串", entry: { alpha: 2, beta: "x" } },
    { label: "alpha 是负数", entry: { alpha: -5, beta: 2 } },
    { label: "条目是字符串", entry: "nope" },
    { label: "条目是 null", entry: null },
  ];

  for (const { label, entry } of malformed) {
    it(`${label} ⇒ onCorrupt 告警 + 重播种（不许流进采样器）`, async () => {
      const { st, warned } = await loadFrom({ seed: 42, rngState: { a: 42 }, posteriors: { "s|cheap": entry } });
      expect(warned, "畸形状态必须告警（文件头的承诺）").not.toBeNull();
      expect(Object.keys(st.posteriors), "重播种 ⇒ 旧的学习历史清空").toEqual([]);
    });
  }

  it("告警正文点名是哪一条坏（否则用户只知道「坏了」不知道坏在哪）", async () => {
    const { warned } = await loadFrom({ seed: 42, rngState: { a: 42 }, posteriors: { "impl|cheap": { alpha: "x", beta: 1 } } });
    expect(warned).toContain("impl|cheap");
  });

  it("合法状态原样放行，且**不**告警（守卫不能变成永真）", async () => {
    const { st, warned } = await loadFrom({ seed: 42, rngState: { a: 1 }, posteriors: { "s|cheap": { alpha: 2, beta: 2 } } });
    expect(warned).toBeNull();
    expect(st.posteriors["s|cheap"]).toEqual({ alpha: 2, beta: 2 });
    expect(st.seed).toBe(42);
  });

  it("空 posteriors（首启/已清空）是合法状态，不告警", async () => {
    const { st, warned } = await loadFrom({ seed: 1, rngState: { a: 1 }, posteriors: {} });
    expect(warned).toBeNull();
    expect(st.posteriors).toEqual({});
  });

  it("文件不存在 ⇒ 静默重播种（首启正常，不是损坏）", async () => {
    const { p, cleanup } = await statePath();
    try {
      let warned: string | null = null;
      await loadBanditState(join(p, "never-written.json"), (r) => { warned = r; });
      expect(warned, "首启不该告警").toBeNull();
    } finally {
      await cleanup();
    }
  });

  it("非 JSON ⇒ 告警（不是静默当空）", async () => {
    const { warned } = await loadFrom("{ 这不是 JSON");
    expect(warned).not.toBeNull();
  });
});

describe("③ save/load 往返：写出去的必须读得回来", () => {
  it("save → load 逐字段一致（含 rngState 与 posteriors）", async () => {
    const { p, cleanup } = await statePath();
    try {
      const st = newBanditState(12345);
      update(st.posteriors, arm("impl", "cheap"), 1, 100);
      updatePriced(st.posteriors, arm("impl", "strong"), 0, 0.5);
      await saveBanditState(p, st);
      let warned: string | null = null;
      const back = await loadBanditState(p, (r) => { warned = r; });
      expect(warned).toBeNull();
      expect(back.seed).toBe(st.seed);
      expect(back.rngState).toEqual(st.rngState);
      expect(back.posteriors).toEqual(st.posteriors);
    } finally {
      await cleanup();
    }
  });
});

describe("④ update 的代价项语义", () => {
  it("reward=1 ⇒ alpha 涨、beta 不涨", () => {
    const post: Posteriors = {};
    update(post, arm("s", "cheap"), 1, 0);
    expect(post[armKeyOf(arm("s", "cheap"))]).toEqual({ alpha: 3, beta: 2 }); // 冷启动 2,2
  });

  it("reward=0 ⇒ beta 涨（失败也要记进后验，否则学不会）", () => {
    const post: Posteriors = {};
    update(post, arm("s", "cheap"), 0, 0);
    expect(post[armKeyOf(arm("s", "cheap"))]).toEqual({ alpha: 2, beta: 3 });
  });

  it("costTokens 把代价折进 beta（用量越大越不划算）", () => {
    const post: Posteriors = {};
    update(post, arm("s", "cheap"), 1, 10, 0.5); // costWeight 0.5 × 10 tok = 5
    expect(post[armKeyOf(arm("s", "cheap"))]).toEqual({ alpha: 3, beta: 7 });
  });

  it("updatePriced 按真钱折算（scale 缺省 1000：$0.001 ≈ 1 单位代价）", () => {
    const post: Posteriors = {};
    // beta = 冷启动 2 + (1 - reward) + costUsd × scale = 2 + 1 + 0.002×1000 = 5。
    // （我第一版写成 4，漏了 `(1 - reward)` 那一项——这条断言自己算一遍才不会被“看起来对”骗过去。）
    updatePriced(post, arm("s", "cheap"), 0, 0.002);
    expect(post[armKeyOf(arm("s", "cheap"))]).toEqual({ alpha: 2, beta: 5 });
  });

  it("未初始化过的臂自动落冷启动先验 2/2（不从 1/1 起步）", () => {
    expect(defaultPosterior()).toEqual({ alpha: 2, beta: 2 });
  });
});

describe("⑤ armKeyOf：臂的键必须唯一", () => {
  it("stage 与 tier 用 `|` 分隔", () => {
    expect(armKeyOf(arm("impl", "cheap"))).toBe("impl|cheap");
  });

  it("不同 (stage,tier) 不撞键", () => {
    const tiers = ["cheap", "standard", "strong"] as const;
    const keys = new Set(["a", "b"].flatMap((s) => tiers.map((t) => armKeyOf(arm(s, t)))));
    expect(keys.size).toBe(6);
  });
});

describe("⑥ selectArm：确定性 + 探索 + 必答", () => {
  it("同 seed 同后验 ⇒ 同选择（这是路由可复现的前提）", () => {
    const post: Posteriors = { [armKeyOf(arm("s", "cheap"))]: { alpha: 5, beta: 1 } };
    const arms = [arm("s", "cheap"), arm("s", "strong")];
    expect(selectArm(post, createRng(7), arms, 0)).toEqual(selectArm(post, createRng(7), arms, 0));
  });

  it("后验悬殊时压倒性选强势臂（ε=0 关掉探索）", () => {
    const post: Posteriors = {
      [armKeyOf(arm("s", "cheap"))]: { alpha: 1, beta: 20 },
      [armKeyOf(arm("s", "strong"))]: { alpha: 20, beta: 1 },
    };
    const arms = [arm("s", "cheap"), arm("s", "strong")];
    const picks = Array.from({ length: 60 }, () => armKeyOf(selectArm(post, createRng(11), arms, 0)));
    expect(picks.filter((k) => k === "s|strong").length).toBeGreaterThan(55);
  });

  it("exploreEpsilon=1 ⇒ 必落进某条臂（不许因探索分支而返回 undefined）", () => {
    const arms = [arm("s", "cheap"), arm("s", "standard"), arm("s", "strong")];
    for (let seed = 0; seed < 40; seed++) {
      expect(armKeyOf(selectArm({}, createRng(seed), arms, 1))).toMatch(/^s\|(cheap|standard|strong)$/);
    }
  });

  it("没有臂可选 ⇒ 抛错（静默返回 undefined 会让上层拿它当臂名去拨号）", () => {
    expect(() => selectArm({}, createRng(1), [])).toThrow();
  });
});
