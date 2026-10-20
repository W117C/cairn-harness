// BYOK 可达性对账（纯函数，零 IO）：把「哪家 provider 真能配上 key」算成一份可判卷的缺口清单。
// 事实（facts）**一律由调用方从机制上采集**后灌进来——本模块不 import 主进程/渲染层（方向纪律：
// providers 层不得依赖 main），也不读登记表当事实：providers-check ⑦ 是**跑真 injector**、
// **扫真 index.html**，而不是查这张表的某一列（否则未登记项会静默漏在机制外）。
export interface ByokFacts {
  /** 路由能选到的 provider = registry 白名单 ∪ 档位表里出现过的。 */
  routable: readonly string[];
  /** key 存储面白名单（`src/main/provider-keys.ts` 的 `PROVIDER_IDS`）。 */
  storable: readonly string[];
  /** env 名映射表覆盖到的 provider（`PROVIDER_ENV_KEYS` 的键）。 */
  envKeyed: readonly string[];
  /** 启动注入面**实际**注入到的 provider（跑 `injectStoredProviderKey` 得到，不是查表）。 */
  injected: readonly string[];
  /** 设置面出现的通道选项（扫 `index.html` 里 `data-setting="provider"` 那组的 `data-val`）。 */
  offered: readonly string[];
}

export interface ByokGaps {
  /** 可路由却不在 env 映射表里 ⇒ 用户连「该设哪个变量」都答不出。 */
  routableWithoutEnvKey: string[];
  /** 可存 key 但注入面没覆盖 ⇒ **存进去没人读**（能力发货、入口不通的下半截）。 */
  storableNotInjected: string[];
  /** 设置面给了选项但存储白名单不收（demo 通道除外）⇒ 点了存不下。 */
  offeredNotStorable: string[];
  /** 可路由但存不进 key 的 provider = V1 边界本体；判据拿它与登记水位**逐字**比（只降不升）。 */
  routableNotStorable: string[];
}

/** 集合差（保序去重，按 a 的原序输出；读数要能逐字 diff，不能靠 Set 迭代顺序碰运气）。 */
export function setDiff(a: readonly string[], b: readonly string[]): string[] {
  const inB = new Set(b);
  return [...new Set(a)].filter((x) => !inB.has(x));
}

/** 两集合是否互为子集（逐字相等，顺序无关）。 */
export function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return setDiff(a, b).length === 0 && setDiff(b, a).length === 0;
}

/** 「模型通道=演示」不是 provider key 的事：它走冻结剧本，无需 key，故从 offered 一侧豁免。 */
export const DEMO_PROVIDER = "demo";

export function byokGapsOf(f: ByokFacts): ByokGaps {
  return {
    routableWithoutEnvKey: setDiff(f.routable, f.envKeyed),
    storableNotInjected: setDiff(f.storable, f.injected),
    offeredNotStorable: setDiff(f.offered.filter((p) => p !== DEMO_PROVIDER), f.storable),
    routableNotStorable: setDiff(f.routable, f.storable),
  };
}
