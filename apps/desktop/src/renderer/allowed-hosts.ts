// 站点授权清单的提交路径（2026-11-12 · 第 1080 页）。
//
// 为什么单开一支：旧写法在四处（启动同步 / 允许并记住 / 移除 host / 忘记全部）都是
// `void window.agent.browserSetAllowedHosts(...).catch(() => undefined)`。IPC 一旦失败，
// 菜单与徽标已经显示「已授权/已移除」，而主进程的逐跳闸还按旧清单放行或拒绝——
// 正是第 952／1073 页裁决过的「视图说成功、事实没发生」同族。本模块把「发出去」收敛成
// 一个带结果的对象；调用方据 `ok` 决定提交还是回滚，不再靠 `.catch` 吞掉。
//
// 纯函数（send 注入）：不碰 window、不碰 localStorage，判卷直接喂假 send。
export interface AllowedHostsPushResult {
  readonly ok: boolean;
  readonly error?: string;
}

export async function pushAllowedHosts(
  hosts: readonly string[],
  send: (hosts: string[]) => Promise<{ ok: boolean }>,
): Promise<AllowedHostsPushResult> {
  try {
    const r = await send([...hosts]); // 副本：调用方随后改本地 Set 不会污染已发出的载荷
    return r.ok ? { ok: true } : { ok: false, error: "主进程拒绝了这次授权变更" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
