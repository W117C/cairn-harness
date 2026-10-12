// M5b 路由开关的**解析面**：纯函数、零 IO、可单测。
//
// 这一笔要钉的不变式：`routingBandit` / `routingCascade` 两个开关的**机制全在**
// （`agent-runner` 的 `orchestratorExtras` 装配线、`.agent/routing-bandit.json` 持久化、
// 级联升档），但 `DEFAULT_SETTINGS` 两枚都写死 false，而 CLI 上此前**没有任何旗标**能把它们
// 翻起来 ⇒ 生产路径零流量（本仓那句「存在 ≠ 接线」）。
//
// 这里补的只是「可翻」这一半，**绝不改默认值**——翻默认会真花钱，而仓里自己写着
// 「要翻先得接基准」（见 settings.ts 里 `impactAnalysis` 那段裁决注释）。
//
// 三态语义（与 settings 里的布尔不同）：**缺席 = 不覆盖**。这是「不给旗标 ⇒ 下游逐字节
// 等价于今天」的前提——`resolveRoutingFlags` 在不覆盖时原样取 settings 的值。

/** 本 run 的路由开关覆盖。字段**缺席** = 这次不覆盖（用 settings），不是「false」。 */
export interface RoutingFlagOverrides {
  /** 给了 `--bandit` / `--no-bandit` 才出现。 */
  routingBandit?: boolean;
  /** 给了 `--cascade` / `--no-cascade` 才出现。 */
  routingCascade?: boolean;
}

export type RoutingFlagParse =
  | { ok: true; overrides: RoutingFlagOverrides }
  | { ok: false; error: string };

/** 一正一反两枚旗标与它们翻的那个键。 */
const FLAG_PAIRS: readonly [on: string, off: string, key: keyof RoutingFlagOverrides][] = [
  ["--bandit", "--no-bandit", "routingBandit"],
  ["--cascade", "--no-cascade", "routingCascade"],
];

/** 从 argv 里解出两个路由开关的覆盖。
 *
 *  正着给 ⇒ true，反着给 ⇒ false，都不给 ⇒ 该键**缺席**（不覆盖）。
 *  一正一反同时给 ⇒ 拒绝（`ok:false`）而不是让后一枚赢：两枚都在时读数不知道自己跑在哪副
 *  装配上，这与仓里 `--replay` 那族「矛盾旗标一起带 ⇒ 拒跑」是同一条口径（exit 2 由调用方落）。
 *  零旗标 ⇒ `overrides` 为空对象 ⇒ 展开进 over 后一个键都不多（逐字节等价于今天）。 */
export function parseRoutingFlags(argv: readonly string[]): RoutingFlagParse {
  const included = new Set(argv);
  const overrides: RoutingFlagOverrides = {};
  for (const [on, off, key] of FLAG_PAIRS) {
    const hasOn = included.has(on);
    const hasOff = included.has(off);
    if (hasOn && hasOff) {
      return {
        ok: false,
        error: `${on} 与 ${off} 不能同时给：一正一反两枚都在，读数不知道自己跑在哪副装配上（去掉其中一枚）`,
      };
    }
    if (hasOn) overrides[key] = true;
    else if (hasOff) overrides[key] = false;
  }
  return { ok: true, overrides };
}

/** 把三态的 overrides 与 settings 合起来，得到这一 run 真用的两个值。
 *
 *  这就是 `over.X ?? settings.X` 那半个形状的**唯一一份**：写在这里（而不是散在装配点里），
 *  是为了让判卷能直接喂纯函数验证「不给旗标 ⇒ 与今天逐字节等价」，而不是在测试里把 `??`
 *  再抄一遍（写第二份真值迟早漂——本仓反复点名的那一族）。 */
export function resolveRoutingFlags(
  over: RoutingFlagOverrides,
  settings: { routingBandit: boolean; routingCascade: boolean },
): { routingBandit: boolean; routingCascade: boolean } {
  return {
    routingBandit: over.routingBandit ?? settings.routingBandit,
    routingCascade: over.routingCascade ?? settings.routingCascade,
  };
}
