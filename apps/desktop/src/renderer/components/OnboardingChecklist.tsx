// 首启空屏的「设置检查」：七组覆盖面**来自主进程**（唯一事实源 `src/main/onboarding-groups.ts`），
// 渲染层不抄那份清单——只把它按步号摆开，并给出到设置页的入口。
//
// 为什么是「检查」而不是「向导」：向导要记进度、要能跳过、要有下一步按钮；本仓的首启面是一屏空态，
// 用户要的是「我该看哪几格」——四行步号，七格都有落点。做得比需要的多，就是噪音。
//
// 纪律：组 id → 设置分区是**唯一一份**映射（七组全有落点 ⇒ 没有一格是「点不动的死行」）。
// 清单本身由服务端给，渲染层只负责排版与导航——抄一份清单就多一份会各自漂的决策点。
import type { OnboardingGroup } from "../../../../src/main/onboarding-groups";
import type { SectionId } from "../app-controls";
import { STR } from "../strings";

/** 组 id → 设置分区。**七组全有落点**：没有落点的那一格会被读成「点不动」，
 * 而「点不动」比「不列它」更糟——用户以为坏了。 */
export const ONBOARDING_TARGET: Readonly<Record<OnboardingGroup["id"], SectionId>> = {
  provider: "provider",
  permission: "permissions",
  ui: "general",
  schedule: "automation",
  memory: "memory",
  telemetry: "advanced",
  about: "about",
};

/** 按步号摆开（步号域是 1..4，服务端给的事实；这里只排版）。 */
export function groupByStep(
  groups: readonly OnboardingGroup[],
): { step: number; groups: OnboardingGroup[] }[] {
  const byStep = new Map<number, OnboardingGroup[]>();
  for (const g of groups) {
    byStep.set(g.step, [...(byStep.get(g.step) ?? []), g]);
  }
  return [...byStep.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([step, items]) => ({ step, groups: items }));
}

/** 这一组的落点分区；**没有落点就返回 undefined**。
 *  为什么要留这个洞：服务端若加了新组而渲染层还不知道它落在哪个分区，
 *  那一格就**不能**摆成可点的按钮（点了会跳到一个不存在的分区＝点不动）。
 *  宁可这一格不出现，也不要给一个点不动的入口。 */
export function onboardingTarget(id: string): SectionId | undefined {
  return Object.prototype.hasOwnProperty.call(ONBOARDING_TARGET, id)
    ? ONBOARDING_TARGET[id as OnboardingGroup["id"]]
    : undefined;
}

export function OnboardingChecklist(props: {
  /** 七组覆盖面（主进程给的副本；空数组 = 还没取到 ⇒ 整块不渲染，不摆空壳）。 */
  groups: readonly OnboardingGroup[];
  /** 点一格：跳到对应设置分区（由调用方开设置页并定位）。 */
  onOpen: (section: SectionId) => void;
}): React.JSX.Element | null {
  // 只摆**有落点**的组（见 onboardingTarget 的理由）。
  const groups = props.groups.filter((g) => onboardingTarget(g.id) !== undefined);
  if (groups.length === 0) return null;
  const steps = groupByStep(groups);
  return (
    <div className="onboard" role="group" aria-label={STR.onboarding.title}>
      <div className="onboard-t">{STR.onboarding.title}</div>
      {steps.map((s) => (
        <div className="onboard-step" key={s.step}>
          <span className="onboard-n" aria-hidden="true">{String(s.step).padStart(2, "0")}</span>
          <div className="onboard-items">
            {s.groups.map((g) => (
              <button
                key={g.id}
                className="onboard-item"
                title={g.entry}
                onClick={() => {
                  const target = onboardingTarget(g.id);
                  if (target !== undefined) props.onOpen(target);
                }}
              >
                <span className="onboard-label">{g.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
