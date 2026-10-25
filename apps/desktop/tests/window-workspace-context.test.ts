import { describe, expect, it } from "vitest";
import { WindowWorkspaceContext } from "../src/main/window-workspace-context";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("窗口工作区归属", () => {
  it("新窗口没有上下文；隐式文件操作必须拒绝", () => {
    const context = new WindowWorkspaceContext(async (path) => path);
    context.run({}, () => {
      expect(context.current()).toBeNull();
      expect(() => context.require()).toThrow("工作区未知");
    });
    expect(() => context.require()).toThrow("工作区未知");
  });

  it("弹窗继承调用窗口的快照，主窗切换或清空不影响弹窗", async () => {
    const context = new WindowWorkspaceContext(async (path) => path);
    const main = {}, popup = {};
    await context.run(main, () => context.select("A"));
    context.run(main, () => context.inherit(popup));
    await context.run(main, () => context.select("B"));
    expect(context.run(popup, () => context.require())).toBe("A");
    await context.run(main, () => context.select(""));
    expect(context.run(main, () => context.current())).toBeNull();
    expect(context.run(popup, () => context.require())).toBe("A");
  });

  it("并行 IPC 跨 await 仍属于各自窗口，且使用调用时的工作区", async () => {
    const context = new WindowWorkspaceContext(async (path) => path);
    const a = {}, b = {}, finish = deferred<void>();
    await context.run(a, () => context.select("A"));
    await context.run(b, () => context.select("B"));
    const reads = [a, b].map((owner) => context.run(owner, async () => {
      await finish.promise;
      return context.require();
    }));
    await context.run(a, () => context.select("A2"));
    finish.resolve();
    expect(await Promise.all(reads)).toEqual(["A", "B"]);
    expect(context.run(a, () => context.require())).toBe("A2");
  });

  it("较早的慢校验不能覆盖较新的选择", async () => {
    const slow = deferred<string | null>();
    const context = new WindowWorkspaceContext(async (path) => path === "slow" ? slow.promise : path);
    const owner = {};
    const old = context.run(owner, () => context.select("slow"));
    await context.run(owner, () => context.select("new"));
    slow.resolve("old");
    expect((await old).ok).toBe(false);
    expect(context.run(owner, () => context.require())).toBe("new");
  });

  it("清空也使未完成的校验失效", async () => {
    const slow = deferred<string | null>();
    const context = new WindowWorkspaceContext(() => slow.promise);
    const owner = {};
    const old = context.run(owner, () => context.select("A"));
    await context.run(owner, () => context.select(""));
    slow.resolve("A");
    expect((await old).ok).toBe(false);
    expect(context.run(owner, () => context.current())).toBeNull();
  });

  it("拒绝未登记路径，保留窗口原选择", async () => {
    const context = new WindowWorkspaceContext(async (path) => path === "A" ? path : null);
    const owner = {};
    await context.run(owner, () => context.select("A"));
    expect((await context.run(owner, () => context.select("/"))).ok).toBe(false);
    expect(context.run(owner, () => context.require())).toBe("A");
  });

  it("关窗使未完成的校验失效，不把旧工作区复活", async () => {
    const slow = deferred<string | null>();
    const context = new WindowWorkspaceContext(() => slow.promise);
    const owner = {};
    const old = context.run(owner, () => context.select("A"));
    context.forget(owner);
    slow.resolve("A");
    expect((await old).ok).toBe(false);
    expect(context.run(owner, () => context.current())).toBeNull();
  });
});
