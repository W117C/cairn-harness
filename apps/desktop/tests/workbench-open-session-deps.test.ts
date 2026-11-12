// 第 1143 页：openSession 的 queueKey 读 activeWorkspace，依赖表必须带上它，避免切工作区后读旧闭包。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("openSession 依赖 activeWorkspace", () => {
  it("回调依赖表含 activeWorkspace", () => {
    expect(src).toContain("runKey(sessionWs ?? activeWorkspace, id)");
    expect(src).toContain("}, [activate, openDestination, setLastError, setQueueLocal, touchWorkspace, activeWorkspace]);");
  });
});
