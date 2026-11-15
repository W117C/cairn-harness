// 窗口工作区的「上报 → 读」因果。
//
// setWorkspaceContext 在主进程是**异步校验后才落指针**（select 先 realpath + 查注册表）；
// 而文件窗格 / 空屏装配 / diff / 路径动作读的就是那个指针。渲染层的 effect 在同一拍里
// 既上报切换、又发读请求 ⇒ 读会先到：切项目后的第一屏读到的是**上一个项目**的
// README / package.json（还会按新项目缓存，直到重开）。这里让读侧等最后一次上报落定。
//
// 只包「同一拍里自动发起」的读（空屏装配）；用户点出来的读（文件树、diff、路径动作）
// 发生在切换落定之后，不需要也不该在这里排队。
let applied: Promise<void> = Promise.resolve();

/** 登记一次上报：读侧从此等到它落定（失败也算落定——不许把 UI 卡死在一个坏项目上）。 */
export function noteWorkspaceContext<T extends { ok: boolean }>(call: Promise<T>): Promise<T> {
  applied = call.then(() => undefined, () => undefined);
  return call;
}

/** 等最后一次窗口工作区上报落定（没有上报过 = 立即返回）。 */
export async function windowWorkspaceApplied(): Promise<void> {
  await applied;
}
