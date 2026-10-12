// 插件数据根（信任表 + 插件 userConfig 的落点）的取址面（2026-10-08 第 424 页）。
//
// 缺口（实测取证于本仓装配面）：缺省数据根原先是 `join(tmpdir(), "m2e-plugin-data")`。
// 这一顶放着两样东西——信任表（`trustFilePathOf` 的缺省，且 verify 命令的信任门复用同一份文件）
// 与插件 userConfig（`pluginUserConfigDir(this.opts.pluginDataRoot, …)`，里面是 safeStorage 的值）。
// 后果两格都不在「重启一下就好」的量纲上：
//   ① 系统清 tmp ⇒ 用户批准过的信任决议与插件配置**无声蒸发**（与第 302 页 memory 那族同形）；
//   ② tmp 世界可写的平台（Linux CI、共享 runner）上目录名固定可猜 ⇒ 本机其他用户预建
//      `<tmp>/m2e-plugin-data/plugin-trust.json` 就把 pending 写成 trusted，钩子/MCP/verify 免审批激活。
// 修法只换缺省落点（env 显式覆盖的行为一字不动）：判卷因此既钉新形状，也钉「旧形状不再出现」。
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PLUGIN_TRUST_FILE_NAME, defaultPluginDataRoot, pluginDataRootOf, trustFilePathOf, PluginRuntime,
} from "../src/agent/plugins";

const RUNNER_SRC = fileURLToPath(new URL("../src/main/agent-runner.ts", import.meta.url));
// 2026-10-11 拆分：`pluginRuntimeOpts`（那一格唯一的取址行）搬去 ./state-handlers ⇒ 取料跟着读两处
// （判据仍是「装配面上只有一条取址」；只看一处会把搬走的实现读成 0 条，红在取料面而不是产品面）。
const STATE_SRC = fileURLToPath(new URL("../src/main/state-handlers.ts", import.meta.url));

describe("插件数据根的缺省落点（信任表与 userConfig 同顶）", () => {
  it("① 缺省 = 用户级 .config/cairn/plugin-data（与 memory 全局层同顶，不是各算一遍）", () => {
    expect(defaultPluginDataRoot("/home/u")).toBe(join("/home/u", ".config", "cairn", "plugin-data"));
  });

  // 反向哨兵（A≠旧值）：只钉新路径的那一条会被「随便换个家目录」顶包；这一条钉的是
  // 「不许再落在会被回收/世界可写的临时区」——实现退回 tmpdir 时**只有这条**红。
  it("② 缺省落点不在临时目录下（旧形状 join(tmpdir(), …) 已摘掉）", () => {
    const root = defaultPluginDataRoot("/home/u");
    expect(root.startsWith(tmpdir())).toBe(false);
    expect(root).not.toContain("m2e-plugin-data");
  });

  it("③ 显式 M2E_PLUGIN_DATA 优先，且原样返回（老行为一字不动）", () => {
    expect(pluginDataRootOf({ M2E_PLUGIN_DATA: "/explicit/root" }, "/home/u")).toBe("/explicit/root");
  });

  // 钉的是 truthy 那一支：改成 `explicit ?? …` 后空串会被当成路径用（join("", …) 造出相对落点）。
  it("④ 空串按「没给」处理，回落到用户级缺省（不许把空 env 当路径）", () => {
    expect(pluginDataRootOf({ M2E_PLUGIN_DATA: "" }, "/home/u")).toBe(defaultPluginDataRoot("/home/u"));
    expect(pluginDataRootOf({}, "/home/u")).toBe(defaultPluginDataRoot("/home/u"));
  });

  it("⑤ 信任表从同一个根派生：一把信任表、两个门共用这一份算法", () => {
    const file = trustFilePathOf({ pluginDataRoot: pluginDataRootOf({}, "/home/u") });
    expect(file).toBe(join("/home/u", ".config", "cairn", "plugin-data", PLUGIN_TRUST_FILE_NAME));
    // 显式 trustFile 仍然优先（不许被新缺省顶掉）。
    expect(trustFilePathOf({ pluginDataRoot: pluginDataRootOf({}, "/home/u"), trustFile: "/elsewhere/t.json" }))
      .toBe("/elsewhere/t.json");
  });
});

describe("装配面真的用这条取址（不是纯函数自证）", () => {
  const source = readFileSync(RUNNER_SRC, "utf8") + "\n" + readFileSync(STATE_SRC, "utf8");
  // 先收成「这一处装配有几行」再判内容：直接对整份 3100 行文件做 toMatch，红起来把全文打进度里
  // （实测一份红读数 270KB），而「不许有第二条取址」这件事本身就是条要数的量。
  const lines = source.split("\n").filter((l) => /^\s*pluginDataRoot:/.test(l));

  it("⑥ 装配面上这一格只有一条取址（不许有第二条派生）", () => {
    expect(lines).toHaveLength(1);
  });

  it("⑦ 那一条接的是 pluginDataRootOf 连入参，且同一行不再出现临时区", () => {
    // 接线钉整条调用连入参（规则 230）：只钉函数名的话「算出来不接」这一变异照样存活。
    expect(lines[0]).toMatch(/pluginDataRoot:\s*pluginDataRootOf\(process\.env,\s*homedir\(\)\)/u);
    expect(lines[0]).not.toMatch(/tmpdir\(\)/u);
  });

  // 行为证人：决议**物理落在**取址函数给出的那一顶。它同时钉住两件事——
  // PluginRuntime 确实用 pluginDataRoot 派生信任文件（不是另算一份），且落点随注入的根走。
  // 故意不读真家目录：根由测试自己造，tmpdir 那一顶只用来做「不该出现」的对照。
  it("⑧ 批准一次项目级 skill ⇒ 信任文件落进数据根，而不是临时区那个固定名", async () => {
    const ws = await mkdtemp(join(tmpdir(), "dsh-p424-"));
    try {
      const skillDir = join(ws, ".agent", "plugins", "p424-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "---\nname: p424-skill\ndescription: 一条用于取址判卷的技能\n---\n正文\n", "utf8");
      const dataRoot = join(ws, "home", ".config", "cairn", "plugin-data");
      const rt = await PluginRuntime.load({
        projectPluginsDir: join(ws, ".agent", "plugins"),
        workspace: ws,
        pluginDataRoot: dataRoot,
      });
      try {
        expect(rt.snapshot().looseSkills.map((l) => l.name)).toContain("p424-skill");
        expect(rt.snapshot().looseSkills.find((l) => l.name === "p424-skill")?.trust).toBe("pending");
        expect(await rt.trustDecide("p424-skill", true)).toBe(true);
        expect(existsSync(join(dataRoot, PLUGIN_TRUST_FILE_NAME))).toBe(true);
        expect(rt.snapshot().looseSkills.find((l) => l.name === "p424-skill")?.trust).toBe("trusted");
        // 旧落点不许被写：那一顶是「任何本机用户可预建」的那个固定名。
        expect(existsSync(join(tmpdir(), "m2e-plugin-data", PLUGIN_TRUST_FILE_NAME))).toBe(false);
      } finally {
        await rt.shutdown().catch(() => {});
      }
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});
