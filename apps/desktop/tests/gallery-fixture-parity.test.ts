// 画廊 preload 夹具与真 DEFAULT_SETTINGS 的形状对齐判卷（第 1329 页纪律 2 的机械化）。
//
// 病灶（2026-11-19 重估跑批）：ui-gallery-preload.cjs 的 SETTINGS 夹具 wallpaper 子树缺
// rotation 整格 ⇒ 读 rotation.weather 的三个冒烟（error-boundary / form-recovery /
// workbench-tools）集体红。判法：桩化 electron **真加载** preload（不读源文本、不 eval
// 字面量——量的是暴露面实现），断言 agent.getSettings()（真接口名见 src/main/ipc-protocol.ts:
// `getSettings(): Promise<AppSettings>`；preload 桩同名暴露）给出的 wallpaper 叶子键集与
// DEFAULT_SETTINGS.wallpaper **恰好相等**：少 = 夹具过期，多 = 夹具发明字段，都是假证人。
// 测二是判卷自身的反向锚点：抽掉 rotation 后比较器必须报不等——判卷自己也能红。
//
// 教训（preload 注释同文）：不能把 wallpaper 形状抽成共享 .cjs 再相对 require——探针窗口
// 是沙箱化 preload，相对 require 不可用（实测「Script failed to execute」），v1 方案被真机
// 跑批推翻。本判卷只量 preload 的夹具字面量；preload 本体不许改。
import { beforeAll, describe, expect, it } from "vitest";
import Module from "node:module";
import { createRequire } from "node:module";
import { DEFAULT_SETTINGS } from "../../../src/main/settings";

const require = createRequire(import.meta.url);

type LoadFn = (request: string, parent: unknown, isMain: boolean) => unknown;

/** 桩化 electron 真加载 ui-gallery-preload.cjs，收集 exposeInMainWorld 的暴露面。 */
function loadPreloadAgent(): Record<string, unknown> {
  const exposed = new Map<string, unknown>();
  const loader = Module as unknown as { _load: LoadFn };
  const original = loader._load;
  loader._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === "electron") {
      return {
        contextBridge: { exposeInMainWorld: (name: string, api: unknown) => void exposed.set(name, api) },
        ipcRenderer: {
          on: () => undefined, once: () => undefined, send: () => undefined,
          invoke: async () => undefined, removeAllListeners: () => undefined, sendSync: () => ({}),
        },
        app: { whenReady: async () => undefined, getPath: () => "/tmp", setPath: () => undefined, on: () => undefined },
        BrowserWindow: class {},
        nativeTheme: { themeSource: "light" },
      };
    }
    return original(request, parent, isMain);
  };
  try {
    require("../scripts/ui-gallery-preload.cjs");
  } finally {
    loader._load = original;
  }
  const agent = exposed.get("agent");
  if (agent === undefined) throw new Error("preload 没暴露 agent（判据自身失效，要出声）");
  return agent as Record<string, unknown>;
}

/** 递归收集叶子键路径：对象走 Object.entries；数组取首元素形状（prefix+"[]"），空数组收自身
 * 路径；标量（含 null）收 prefix。空对象无叶子（两侧同形即可比）。 */
function leafPaths(v: unknown, prefix = ""): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(v)) {
    if (v.length === 0) {
      out.add(prefix);
      return out;
    }
    for (const p of leafPaths(v[0], `${prefix}[]`)) out.add(p);
    return out;
  }
  if (v !== null && typeof v === "object") {
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      for (const p of leafPaths(child, prefix === "" ? k : `${prefix}.${k}`)) out.add(p);
    }
    return out;
  }
  out.add(prefix);
  return out;
}

let agent: Record<string, unknown>;

describe("画廊夹具形状对齐（桩化 electron 真加载暴露面）", () => {
  beforeAll(() => {
    agent = loadPreloadAgent();
    if (typeof agent.getSettings !== "function") {
      throw new Error("preload 暴露面没有 getSettings（判据自身失效，要出声）");
    }
  });

  it("agent.getSettings() 暴露的 wallpaper 叶子键集 == DEFAULT_SETTINGS.wallpaper", async () => {
    const settings = (await (agent as { getSettings: () => Promise<Record<string, unknown>> }).getSettings()) as Record<string, unknown>;
    expect(leafPaths(settings.wallpaper)).toEqual(leafPaths(DEFAULT_SETTINGS.wallpaper));
  });

  it("判据自检：从响应拷贝里抽掉 rotation 后比较器必须报不等（判卷自身可红的反向锚点）", async () => {
    const settings = (await (agent as { getSettings: () => Promise<Record<string, unknown>> }).getSettings()) as Record<string, unknown>;
    const wallpaper = { ...(settings.wallpaper as Record<string, unknown>) };
    delete wallpaper.rotation;
    expect(leafPaths(wallpaper)).not.toEqual(leafPaths(DEFAULT_SETTINGS.wallpaper));
  });
});
