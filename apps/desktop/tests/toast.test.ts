import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("sonner");
  vi.resetModules();
});

describe("懒加载 toast", () => {
  it("首次请求前不加载 sonner；直接调用与 success/error 均保留", async () => {
    let sonnerLoads = 0;
    const direct = vi.fn();
    const success = vi.fn();
    const error = vi.fn();
    const sonnerToast = Object.assign(direct, { success, error });
    vi.doMock("sonner", () => {
      sonnerLoads += 1;
      return { toast: sonnerToast };
    });

    const { toast } = await import("../src/renderer/toast");
    expect(sonnerLoads).toBe(0);
    expect(toast).toBeTypeOf("function");

    toast("普通提示");
    toast.success("成功提示");
    toast.error("失败提示");

    await vi.waitFor(() => {
      expect(direct).toHaveBeenCalledWith("普通提示");
      expect(success).toHaveBeenCalledWith("成功提示");
      expect(error).toHaveBeenCalledWith("失败提示");
    });
    expect(sonnerLoads).toBe(1);
  });

  it("订阅前发生的请求不会被吞；加载完成后通知宿主", async () => {
    const error = vi.fn();
    const sonnerToast = Object.assign(vi.fn(), { success: vi.fn(), error });
    vi.doMock("sonner", () => ({ toast: sonnerToast }));

    const { subscribeToastHost, toast } = await import("../src/renderer/toast");
    toast.error("加载前的提示");

    let notifications = 0;
    const unsubscribe = subscribeToastHost(() => { notifications += 1; });
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("加载前的提示"));
    expect(notifications).toBe(1);
    unsubscribe();
  });

  it("一次加载失败不会永久卡死；下一次提示会重新加载", async () => {
    const loadError = new Error("chunk missing");
    const firstLoad = vi.fn(() => { throw loadError; });
    vi.doMock("sonner", firstLoad);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { toast } = await import("../src/renderer/toast");
    toast("第一次失败");
    await vi.waitFor(() => {
      expect(console.error).toHaveBeenCalledWith("[toast] 提示组件加载失败:", expect.stringContaining("error when mocking"));
    });

    const direct = vi.fn();
    vi.doMock("sonner", () => ({ toast: Object.assign(direct, { success: vi.fn(), error: vi.fn() }) }));
    toast("第二次成功");

    await vi.waitFor(() => expect(direct).toHaveBeenCalledWith("第二次成功"));
    expect(firstLoad).toHaveBeenCalledTimes(1);
  });
});
