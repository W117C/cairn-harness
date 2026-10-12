// M5b 路由开关解析面（`src/main/routing-flags.ts`）的判据。
//
// 修前：`routingBandit` / `routingCascade` 两枚开关的机制全在（装配线 / 持久化 / 级联），
// 但 CLI 上无处可翻 ⇒ 生产路径零流量。这里钉三件事：
//   ①四种旗标组合各自解出什么；②矛盾旗标（一正一反同时给）拒跑，而不是让后一枚赢；
//   ③「都不给 ⇒ 与今天逐字节等价」——不改行为才敢接线，这是本笔不动默认值之外的另一半前提。
import { describe, expect, it } from "vitest";
import { parseRoutingFlags, resolveRoutingFlags, type RoutingFlagOverrides } from "../src/main/routing-flags";

// DEFAULT_SETTINGS 里这两枚都是 false（本笔一个字没动它）。判据只借用这个盘上事实，
// 不 import settings（那会牵进 IPC / 文件 IO），所以如实写死并注明来源。
const DEFAULTS = { routingBandit: false, routingCascade: false };

const overridesOf = (argv: string[]): RoutingFlagOverrides => {
  const r = parseRoutingFlags(argv);
  expect(r.ok, "解失败了：" + (r.ok ? "" : r.error)).toBe(true);
  return r.ok ? r.overrides : {};
};

describe("parseRoutingFlags：四种组合", () => {
  it("一枚都不给 ⇒ 空覆盖（下游一个键都不多）", () => {
    expect(parseRoutingFlags([])).toEqual({ ok: true, overrides: {} });
    expect(Object.keys(overridesOf(["做点事", "--mode", "default"]))).toEqual([]);
  });

  it("--bandit / --no-bandit 解成 true / false", () => {
    expect(overridesOf(["--bandit"])).toEqual({ routingBandit: true });
    expect(overridesOf(["--no-bandit"])).toEqual({ routingBandit: false });
  });

  it("--cascade / --no-cascade 同形，且两族互不串", () => {
    expect(overridesOf(["--cascade"])).toEqual({ routingCascade: true });
    expect(overridesOf(["--no-cascade"])).toEqual({ routingCascade: false });
    expect(overridesOf(["--bandit", "--no-cascade"])).toEqual({ routingBandit: true, routingCascade: false });
  });
});

describe("parseRoutingFlags：矛盾旗标拒跑（不让后一枚赢）", () => {
  it("--bandit 与 --no-bandit 同时给 ⇒ ok:false，报文能让人看懂错在哪", () => {
    const r = parseRoutingFlags(["--bandit", "--no-bandit", "做点事"]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("--bandit");
      expect(r.error).toContain("--no-bandit");
      expect(r.error, "报文要写清是「同时给」这件事错了").toContain("同时");
    }
  });

  it("--cascade 与 --no-cascade 同理", () => {
    const r = parseRoutingFlags(["--no-cascade", "--cascade"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("--cascade");
  });

  it("先给哪一枚都拒（顺序不影响判定）", () => {
    expect(parseRoutingFlags(["--no-bandit", "--bandit"]).ok).toBe(false);
  });
});

describe("resolveRoutingFlags：over ?? settings（A＝B 必配 A≠旧值）", () => {
  it("两枚都不给 ⇒ 逐字等于 settings；且与显式给 --no-bandit 逐字相同（否则这条旗标是空操作）", () => {
    const absent = resolveRoutingFlags({}, DEFAULTS);
    const explicitOff = resolveRoutingFlags({ routingBandit: false, routingCascade: false }, DEFAULTS);
    expect(absent).toEqual(DEFAULTS);
    expect(absent).toEqual(explicitOff);
  });

  it("但 --bandit 必须与它们**不同**（否则判卷在自欺）", () => {
    const absent = resolveRoutingFlags({}, DEFAULTS);
    const on = resolveRoutingFlags({ routingBandit: true }, DEFAULTS);
    expect(on.routingBandit, "开了 bandit 却与缺省同值 ⇒ 这条旗标没接线").not.toBe(absent.routingBandit);
    expect(on).toEqual({ routingBandit: true, routingCascade: false });
  });

  it("覆盖胜过盘上值，两个方向都算（真→假、假→真）", () => {
    const on = { routingBandit: true, routingCascade: true };
    expect(resolveRoutingFlags({ routingBandit: false }, on).routingBandit).toBe(false);
    expect(resolveRoutingFlags({ routingCascade: false }, on).routingCascade).toBe(false);
    expect(resolveRoutingFlags({ routingCascade: true }, DEFAULTS).routingCascade).toBe(true);
  });

  it("两族互不牵连：只覆盖 bandit 不动 cascade", () => {
    const r = resolveRoutingFlags({ routingBandit: true }, DEFAULTS);
    expect(r.routingCascade).toBe(DEFAULTS.routingCascade);
  });
});
