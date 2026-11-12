// 读面失败收口（第 1087 页）：设置页的读调用不能把 IPC/主进程拒绝折成默认值或空态。
// 与 allowed-hosts.ts 的 pushAllowedHosts 同族：把「发出去/读回来」的结果显式交给调用方，
// 由调用方决定回滚、报错还是放行；本函数只保证 reject 不会绕过 UI 直接消失。
export type ReadResult<T> = { ok: true; value: T } | { ok: false; error: string };

export async function readOrError<T>(read: () => Promise<T>): Promise<ReadResult<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
