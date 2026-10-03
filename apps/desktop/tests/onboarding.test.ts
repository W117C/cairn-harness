import { describe, expect, it } from "vitest";
// 纯函数判卷（node 环境不渲染 JSX，同 settings-panel / sidebar-groups 先例：组件文件同源导出）。
import {
  initialOnboardingState,
  needsOnboarding,
  onboardingCompletePatch,
  onboardingReducer,
} from "../src/renderer/components/Onboarding";
import type { OnboardingState } from "../src/renderer/components/Onboarding";

describe("needsOnboarding（首启判据：!onboarded）", () => {
  it("onboarded:false ⇒ 需要首启面（settings.ts 缺省即 false——首次启动必先进向导）", () => {
    expect(needsOnboarding({ onboarded: false })).toBe(true);
  });

  it("onboarded:true ⇒ 不再弹（完成后正常主区）", () => {
    expect(needsOnboarding({ onboarded: true })).toBe(false);
  });

  it("判据只看 onboarded 一个键：其余字段在场不改变裁决", () => {
    const s = { provider: "demo", model: "", theme: "dark", onboarded: false } as const;
    expect(needsOnboarding(s)).toBe(true);
  });
});

describe("onboardingCompletePatch（完成动作唯一 patch：只这一个键）", () => {
  it("恰等于 { onboarded: true }——混入 provider/model 等任何其他键即判红（跳过＝保持 demo 的保通前提）", () => {
    expect(onboardingCompletePatch()).toEqual({ onboarded: true });
  });
});

describe("onboardingReducer（两步状态机：workspace → credentials）", () => {
  const initial: OnboardingState = initialOnboardingState();

  it("初始态：停在 workspace 步、未选工作区", () => {
    expect(initial).toEqual({ step: "workspace", workspace: null });
  });

  it("selectWorkspace：落路径，仍在 workspace 步", () => {
    expect(onboardingReducer(initial, { type: "selectWorkspace", path: "/tmp/proj" })).toEqual({
      step: "workspace",
      workspace: "/tmp/proj",
    });
  });

  it("守卫：未选工作区 advance 原地不动（Step1 是必答题，不能空手进凭据步）", () => {
    expect(onboardingReducer(initial, { type: "advance" })).toEqual(initial);
  });

  it("选定后 advance：进 credentials 步、workspace 保留", () => {
    const picked = onboardingReducer(initial, { type: "selectWorkspace", path: "/tmp/proj" });
    expect(onboardingReducer(picked, { type: "advance" })).toEqual({
      step: "credentials",
      workspace: "/tmp/proj",
    });
  });

  it("credentials 步 advance：无第三步，原地不动", () => {
    const atCredentials: OnboardingState = { step: "credentials", workspace: "/tmp/proj" };
    expect(onboardingReducer(atCredentials, { type: "advance" })).toEqual(atCredentials);
  });

  it("back：回 workspace 步、workspace 保留（改选不丢已选）", () => {
    const atCredentials: OnboardingState = { step: "credentials", workspace: "/tmp/proj" };
    expect(onboardingReducer(atCredentials, { type: "back" })).toEqual({
      step: "workspace",
      workspace: "/tmp/proj",
    });
  });

  it("workspace 步 back：原地不动（没有第零步）", () => {
    expect(onboardingReducer(initial, { type: "back" })).toEqual(initial);
  });

  it("credentials 步仍可改选工作区：更新路径、不跳步", () => {
    const atCredentials: OnboardingState = { step: "credentials", workspace: "/tmp/a" };
    expect(onboardingReducer(atCredentials, { type: "selectWorkspace", path: "/tmp/b" })).toEqual({
      step: "credentials",
      workspace: "/tmp/b",
    });
  });

  it("同一路径重复选择幂等（状态相等）", () => {
    const picked = onboardingReducer(initial, { type: "selectWorkspace", path: "/tmp/proj" });
    expect(onboardingReducer(picked, { type: "selectWorkspace", path: "/tmp/proj" })).toEqual(picked);
  });
});
