// 第 1118 页：自动化页标题「自动化 工作流」已说明域，闲时队列副标题不再复述「保持运行/对话和定时任务」。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("闲时队列副标题", () => {
  it("只留执行条件与计费后果，不复述标题域", () => {
    expect(src).toContain("电脑保持唤醒、Cairn 空闲时执行；模型调用按服务商规则计费。");
    expect(src).not.toContain("电脑保持唤醒、Cairn 保持运行且对话和定时任务均空闲时执行。");
  });
});
