// 定时轮换的**执行**部分：每隔一会儿问一次「该不该换」，该换就写设置。
//
// 决定在核心纯函数里（`decideRotation`），这里只负责：读设置、探测文件、写回、报错。
// 原则：**不静默**——跳过读不到的候选要在返回值里点名；写失败要交给 onError。
import { decideDayNight, decideRotation, type RotationDecision } from "../../../../src/wallpaper/rotation";
import type { WallpaperSettings } from "../../../../src/main/settings";
import { wallpaperKindOf } from "./wallpaper";

export interface RotationTickResult extends RotationDecision {
  /** 这次真的写设置了吗。 */
  applied: boolean;
}

export interface InstallRotationInput {
  intervalMs?: number;
  now?: () => number;
  read: () => Promise<WallpaperSettings | null>;
  apply: (next: { kind: "image" | "video"; path: string }) => Promise<void>;
  exists?: (path: string) => boolean;
  onError?: (error: unknown) => void;
}

export interface RotationHandle {
  tick: () => Promise<RotationTickResult>;
  stop: () => void;
}

export function installWallpaperRotation(input: InstallRotationInput): RotationHandle {
  const intervalMs = input.intervalMs ?? 30_000;
  const now = input.now ?? (() => Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const tick = async (): Promise<RotationTickResult> => {
    if (running) return { rotate: false, path: null, reason: "上一轮还在跑", missing: [], applied: false };
    running = true;
    try {
      const wallpaper = await input.read();
      if (wallpaper === null) return { rotate: false, path: null, reason: "读不到设置", missing: [], applied: false };
      // 日出日落模式：白天/夜里各一张，按当前时刻选；已经是那张就不写。
      if (wallpaper.rotation.enabled && wallpaper.rotation.mode === "dayNight") {
        const dn = decideDayNight({
          dayPath: wallpaper.rotation.dayPath,
          nightPath: wallpaper.rotation.nightPath,
          now: new Date(now()),
          latitude: wallpaper.rotation.latitude,
          longitude: wallpaper.rotation.longitude,
          ...(input.exists === undefined ? {} : { exists: input.exists }),
        });
        if (dn.path === null || dn.path === wallpaper.path) {
          return { rotate: false, path: null, reason: dn.reason, missing: [], applied: false };
        }
        const kind = wallpaperKindOf(dn.path);
        if (kind === null) return { rotate: false, path: null, reason: "选中的那张不是图片/视频", missing: [], applied: false };
        await input.apply({ kind, path: dn.path });
        return { rotate: true, path: dn.path, reason: dn.reason, missing: [], applied: true };
      }
      const decision = decideRotation({
        enabled: wallpaper.rotation.enabled,
        everyMinutes: wallpaper.rotation.everyMinutes,
        paths: wallpaper.rotation.paths,
        current: wallpaper.path,
        lastAt: wallpaper.rotation.lastAt,
        now: now(),
        ...(input.exists === undefined ? {} : { exists: input.exists }),
      });
      if (!decision.rotate || decision.path === null) return { ...decision, applied: false };
      const kind = wallpaperKindOf(decision.path);
      if (kind === null) return { ...decision, applied: false, reason: "下一个候选不是图片/视频" };
      await input.apply({ kind, path: decision.path });
      return { ...decision, applied: true };
    } catch (error) {
      input.onError?.(error);
      return { rotate: false, path: null, reason: "轮换出错", missing: [], applied: false };
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => { void tick(); }, intervalMs);
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    (timer as unknown as { unref: () => void }).unref();
  }
  return { tick, stop: () => { if (timer !== null) clearInterval(timer); timer = null; } };
}
