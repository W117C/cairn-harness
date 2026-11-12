// 站点授权清单提交路径判卷（第 1080 页）：IPC 失败必须回滚并出声。
// 旧形态：四处 `void …browserSetAllowedHosts(...).catch(() => undefined)` —— 菜单/徽标已经
// 显示成功，主进程逐跳闸仍按旧清单走（第 952／1073 页「视图说成功、事实没发生」同族）。
import { describe, expect, it } from "vitest";
import { pushAllowedHosts } from "../src/renderer/allowed-hosts";
import { readAppSurface } from "./helpers/app-surface";

describe("pushAllowedHosts：把「发出去」变成带结果的对象", () => {
  it("ok ⇒ {ok:true}，且发的是副本（调用方随后改本地集合不影响载荷）", async () => {
    const sent: string[][] = [];
    const hosts = ["a.example"];
    const r = await pushAllowedHosts(hosts, async (list) => { sent.push(list); return { ok: true }; });
    hosts.push("b.example");
    expect(r.ok).toBe(true);
    expect(sent).toEqual([["a.example"]]);
  });

  it("主进程回 ok:false ⇒ {ok:false}＋理由（不冒充成功）", async () => {
    const r = await pushAllowedHosts(["a.example"], async () => ({ ok: false }));
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("IPC 抛错 ⇒ {ok:false}＋错误文本（不吞异常）", async () => {
    const r = await pushAllowedHosts(["a.example"], async () => { throw new Error("renderer gone"); });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("renderer gone");
  });
});

describe("PaneDock 的四处授权写都走同一提交口", () => {
  const src = readAppSurface();
  it("至少三处用户动作走 commitHosts，启动同步走 pushAllowedHosts", () => {
    expect((src.match(/commitHosts\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(src).toContain("pushAllowedHosts([...hosts]");
    // 旧的静默写法一处都不许留（含启动那支）
    expect(src).not.toContain("browserSetAllowedHosts([...next]).catch(() => undefined)");
    expect(src).not.toContain("browserSetAllowedHosts([...hosts]).catch(() => undefined)");
  });

  it("失败会回滚本地状态并出声（授权未生效要说出来）", () => {
    expect(src).toContain("allowedRef.current = prev;");
    expect(src).toContain("授权未生效");
    expect(src).toContain("主进程仍按旧清单放行");
  });
});
