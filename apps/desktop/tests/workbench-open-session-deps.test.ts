// 第 1143 页：openSession 的 queueKey 读 activeWorkspace，依赖表必须带上它，避免切工作区后读旧闭包。
// 第 1219 页之后：归属未知时键按回包解析出的根算（resolvedQueueWs 初值仍是 sessionWs），
// activeWorkspace 仍是兜底，依赖表也仍必须带上它。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("openSession 依赖 activeWorkspace", () => {
  it("回调依赖表含 activeWorkspace", () => {
    expect(src).toContain("runKey(resolvedQueueWs ?? activeWorkspace, id)");
    expect(src).toContain("}, [activate, openDestination, setLastError, setQueueLocal, setActiveWorkspace, touchWorkspace, activeWorkspace]);");
  });
});
