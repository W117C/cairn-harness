type SonnerModule = typeof import("sonner");
type ToastKind = "default" | "success" | "error";

let modulePromise: Promise<SonnerModule> | null = null;
let loadedModule: SonnerModule | null = null;
let requested = false;
const listeners = new Set<(module: SonnerModule) => void>();

function loadSonner(): Promise<SonnerModule> {
  if (loadedModule !== null) return Promise.resolve(loadedModule);
  modulePromise ??= import("sonner").then(
    (module) => {
      loadedModule = module;
      for (const listener of listeners) listener(module);
      return module;
    },
    (err: unknown) => {
      // 瞬时读取失败不能让本轮进程永久失去提示能力；下一次请求重新试。
      modulePromise = null;
      throw err;
    },
  );
  return modulePromise;
}

function show(kind: ToastKind, message: string): void {
  requested = true;
  void loadSonner().then(
    (mod) => {
      if (kind === "default") mod.toast(message);
      else mod.toast[kind](message);
    },
    (err: unknown) => { console.error("[toast] 提示组件加载失败:", err instanceof Error ? err.message : String(err)); },
  );
}

/** 轻量提示入口：首次调用时才加载 sonner；调用点不依赖返回 id。 */
export const toast = Object.assign(
  (message: string): void => { show("default", message); },
  {
    success: (message: string): void => show("success", message),
    error: (message: string): void => show("error", message),
  },
);

/** ToastHost 订阅首次请求；早于订阅发生的请求也会在订阅时立即补触发。 */
export function subscribeToastHost(listener: (module: SonnerModule) => void): () => void {
  listeners.add(listener);
  if (requested) {
    if (loadedModule !== null) listener(loadedModule);
    else void loadSonner().catch(() => undefined);
  }
  return () => { listeners.delete(listener); };
}
