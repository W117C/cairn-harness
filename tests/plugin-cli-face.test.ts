// 第 438 页：`cairn --plugins`／`--trust-plugin`／`--decline-plugin` 与项目 skill 那顶根（#7 的 ②＋①）。
//
// 缺口（现读，不是推断）：装配面只扫 `<ws>/.agent/plugins`，本仓自己的 `.agent/skills/graphflow` 从来没被
// 扫到过——用被测方自己的谓词 `discoverPlugins` 量过一次：plugins 0／loose 0／pending 0，而目录就在盘上。
// 另一半是 CLI 这一面**没有任何信任决议入口**（`grep plugin|trust src/cli.ts` 零命中）：项目作用域的样本
// 默认 pending，v1 交付面上只有桌面面板能批 ⇒ 「扫得到」等于「批不了」，唯一绕行是塞进恒 trusted 的
// M2E_LOOSE_SKILLS，那是为了可用把信任门拆了。这一文件按那两半各自钉：
//   · 纯函数面（文字有没有出声、三态有没有分开）用合成输入；
//   · 装配面与 CLI 面用真盘 + 真 spawn，因为「算出来没接线」这一族只有真跑分得出来。
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  pluginDecideText, pluginFaceRows, pluginFaceText, readTrustCountsFile,
  type PluginFaceContext, type PluginFaceRow,
} from "../src/main/plugin-cli-face";
import { trustCountsText } from "../src/main/doctor";
import { PluginRuntime, projectSkillsRootOf } from "../src/agent/plugins";
import type { PluginScanRoots, PluginsManifest } from "../src/agent/plugins/types";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const BIN = join(ROOT, "bin", "cairn.mjs");
const CLI_SRC = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FACE_SRC = fileURLToPath(new URL("../src/main/plugin-cli-face.ts", import.meta.url));
const DISCOVER_SRC = fileURLToPath(new URL("../src/agent/plugins/discover.ts", import.meta.url));
const INDEX_SRC = fileURLToPath(new URL("../src/agent/plugins/index.ts", import.meta.url));
const textOf = (p: string): string => readFileSync(p, "utf8");

// ---- 合成输入（判分辨力用；真仓数据分辨不了「三态」这类语义差）----
type Trust = PluginsManifest["plugins"][number]["trust"];

const plugin = (o: { name: string; scope?: string; trust?: Trust; root?: string }): PluginsManifest["plugins"][number] => ({
  name: o.name,
  scope: (o.scope ?? "project") as PluginsManifest["plugins"][number]["scope"],
  root: o.root ?? "/r/" + o.name,
  manifest: {}, skills: [], commands: [], agents: [], hooks: [], mcp: [], lsp: {},
  unknownFields: [], userConfigFields: [], errors: [], warnings: [],
  trust: o.trust ?? "pending",
});

const loose = (o: { name: string; scope?: string; trust?: Trust; root?: string }): PluginsManifest["looseSkills"][number] => ({
  name: o.name,
  root: o.root ?? "/s/" + o.name,
  scope: (o.scope ?? "project") as PluginsManifest["looseSkills"][number]["scope"],
  trust: o.trust ?? "pending",
  entry: { plugin: null, name: o.name, description: "", path: "/s/" + o.name + "/SKILL.md", frontmatter: {}, body: "" },
});

const manifest = (over: Partial<PluginsManifest> = {}): PluginsManifest => ({
  plugins: [], looseSkills: [], errors: [], warnings: [], ...over,
});

const row = (name: string, trust: Trust = "pending"): PluginFaceRow => ({
  kind: "散装 skill", name, scope: "project", trust, root: "/s/" + name,
});

const ctx = (over: Partial<PluginFaceContext> = {}): PluginFaceContext => ({
  workspace: "/ws",
  roots: { userPluginsDir: null, projectPluginsDir: "/ws/.agent/plugins", projectSkillsDir: "/ws/.agent/skills", looseRoots: [] },
  rows: [row("solo")],
  pending: 1,
  trustFile: "/data/plugin-trust.json",
  trust: { state: "absent" },
  ...over,
});

describe("发现面的行与文字（纯函数）", () => {
  it("① 插件与散装 skill 合成一张表：顺序先插件后 skill，每行带自己的作用域", () => {
    const rows = pluginFaceRows(manifest({
      plugins: [plugin({ name: "crew", scope: "project", trust: "trusted" })],
      looseSkills: [loose({ name: "solo", scope: "loose", trust: "trusted" })],
    }));
    expect(rows.map((r) => r.name)).toEqual(["crew", "solo"]);
    expect(rows.map((r) => r.scope)).toEqual(["project", "loose"]);
    expect(rows.map((r) => r.kind)).toEqual(["插件", "散装 skill"]);
  });

  it("② 空清单 → 零行（不是把 undefined 读成一行）", () => {
    expect(pluginFaceRows(manifest())).toEqual([]);
  });

  // 反向哨兵：这一格钉的是「不猜」。实现若把 roots 缺省成一份拼出来的路径，只有这条红。
  it("③ 清单不带 roots 那一格 ⇒ 明写未记录，且一个字都不印成路径", () => {
    const out = pluginFaceText(ctx({ roots: null }));
    expect(out).toContain("未记录");
    expect(out).not.toContain("/ws/.agent/skills");
  });

  it("④ 没给的那一顶印「没扫」，给了的那一顶印实际路径（两态不合并）", () => {
    const roots: PluginScanRoots = {
      userPluginsDir: null, projectPluginsDir: null, projectSkillsDir: "/ws/.agent/skills", looseRoots: ["/loose/a"],
    };
    const out = pluginFaceText(ctx({ roots }));
    expect(out).toContain("项目 skill：/ws/.agent/skills");
    expect(out).toContain("免信任散装：/loose/a");
    expect(out).toContain("用户级插件：没给这一顶（没扫）");
  });

  it("⑤ 有待信任样本时，计数与决议入口同拍出声（只报数不给出出口＝半个交付面）", () => {
    const out = pluginFaceText(ctx({ rows: [row("solo"), row("other", "trusted")], pending: 1 }));
    expect(out).toContain("待信任 1 条");
    expect(out).toContain("--trust-plugin");
    expect(out).toContain("--decline-plugin");
  });

  it("⑥ 发现面为空要说「为空」，不是只留一个 0", () => {
    const out = pluginFaceText(ctx({ rows: [], pending: 0 }));
    expect(out).toContain("发现面为空");
  });

  it("⑦ 信任表读得出时复用生产侧那一句整串（不抄第二份文案）", () => {
    const out = pluginFaceText(ctx({ trust: { state: "ok", trusted: 3, declined: 2 } }));
    expect(out).toContain(trustCountsText(3, 2));
    expect(out).toContain("/data/plugin-trust.json");
  });

  // 三态两两不同：absent 与 unreadable 若塌成一态，只有这两条里的某一条红。
  it("⑧ 没写过表 ≠ 读不出表：后者明说不给条数", () => {
    const absent = pluginFaceText(ctx({ trust: { state: "absent" } }));
    const broken = pluginFaceText(ctx({ trust: { state: "unreadable" } }));
    expect(absent).toContain("信任表还没写过");
    expect(broken).toContain("取不到条数");
    expect(broken).not.toMatch(/已信任 \d+ 条/u);
    expect(absent).not.toBe(broken);
  });
});

describe("决议那一拍的措辞（纯函数）", () => {
  it("⑨ 决议没落地就绝不说「已批准」/「已拒绝」", () => {
    const out = pluginDecideText("solo", true, false, [row("solo")]);
    expect(out).toContain("一条决议也没写下");
    expect(out).not.toMatch(/已批准|已拒绝/u);
  });

  it("⑩ 名字不在面上时把候选列出来（让人抄，不让人猜）", () => {
    const out = pluginDecideText("nope", true, false, [row("solo", "pending"), row("crew", "trusted")]);
    expect(out).toContain("solo");
    expect(out).toContain("crew");
  });

  it("⑪ 面为空时指回 --plugins，而不是列一张空候选", () => {
    const out = pluginDecideText("nope", false, false, []);
    expect(out).toContain("--plugins");
  });

  it("⑫ 批准与拒绝两态各说各的（一条写成常量就是恒真）", () => {
    expect(pluginDecideText("solo", true, true, [row("solo")])).toContain("已批准");
    expect(pluginDecideText("solo", true, true, [row("solo")])).not.toContain("已拒绝");
    const declined = pluginDecideText("solo", false, true, [row("solo")]);
    expect(declined).toContain("已拒绝");
    expect(declined).not.toContain("已批准");
  });
});

describe("信任表那一份的三态读取（真盘、临时目录）", () => {
  it("⑬ 文件不在 = absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dsh-p437-"));
    try {
      expect(await readTrustCountsFile(join(dir, "nope.json"))).toEqual({ state: "absent" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("⑭ 坏 JSON = 读不出（不许折成「0 条已批准」）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dsh-p437-"));
    try {
      const file = join(dir, "trust.json");
      await writeFile(file, "{ 这不是 JSON", "utf8");
      expect(await readTrustCountsFile(file)).toEqual({ state: "unreadable" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // 这一格钉的是「CLI 报的数就是装载真在用的那份表」：条数来自 parseTrustFile，脏条目按同口径丢。
  it("⑮ 读得出时报的就是那份表的条目数（脏条目沿用既有口径丢掉）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dsh-p437-"));
    try {
      const file = join(dir, "trust.json");
      await writeFile(file, JSON.stringify({ trusted: ["/a@f1", "/b@f2", 42], declined: ["/c@f3"] }), "utf8");
      expect(await readTrustCountsFile(file)).toEqual({ state: "ok", trusted: 2, declined: 1 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("项目 skill 那顶根真的被扫，且走的是项目信任门（真装配面）", () => {
  const writeSkill = async (ws: string, name: string, body: string): Promise<string> => {
    const dir = join(ws, ".agent", "skills", name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), "---\nname: " + name + "\ndescription: 判卷用\n---\n" + body + "\n", "utf8");
    return dir;
  };
  const load = (ws: string, dataRoot: string) =>
    PluginRuntime.load({ workspace: ws, pluginDataRoot: dataRoot, home: join(ws, "home") });

  it("⑯ 缺省就扫 <ws>/.agent/skills，且首次装载是 pending（不是免信任溜进来）", async () => {
    const ws = await mkdtemp(join(tmpdir(), "dsh-p437-"));
    try {
      const dir = await writeSkill(ws, "demo", "正文");
      const rt = await load(ws, join(ws, "data"));
      try {
        const one = rt.manifest.looseSkills.find((l) => l.name === "demo");
        expect(one?.root).toBe(dir);
        expect(one?.trust).toBe("pending");
        expect(one?.scope).toBe("project");
        // 印出来的根＝扫描用的那份（同一决策点），不是调用方另拼的
        expect(rt.manifest.roots?.projectSkillsDir).toBe(projectSkillsRootOf(ws));
      } finally {
        await rt.shutdown().catch(() => {});
      }
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("⑰ 批准之后重新装载才生效（同一样本、同一次决议出口）", async () => {
    const ws = await mkdtemp(join(tmpdir(), "dsh-p437-"));
    try {
      await writeSkill(ws, "demo", "正文");
      const dataRoot = join(ws, "data");
      const first = await load(ws, dataRoot);
      try {
        expect(await first.trustDecide("demo", true)).toBe(true);
      } finally {
        await first.shutdown().catch(() => {});
      }
      const second = await load(ws, dataRoot);
      try {
        expect(second.manifest.looseSkills.find((l) => l.name === "demo")?.trust).toBe("trusted");
      } finally {
        await second.shutdown().catch(() => {});
      }
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("⑱ 内容一改就回到 pending（决议是绑内容的，这一顶也不例外）", async () => {
    const ws = await mkdtemp(join(tmpdir(), "dsh-p437-"));
    try {
      await writeSkill(ws, "demo", "正文");
      const dataRoot = join(ws, "data");
      const first = await load(ws, dataRoot);
      try {
        expect(await first.trustDecide("demo", true)).toBe(true);
      } finally {
        await first.shutdown().catch(() => {});
      }
      await writeSkill(ws, "demo", "正文改了内容");
      const second = await load(ws, dataRoot);
      try {
        expect(second.manifest.looseSkills.find((l) => l.name === "demo")?.trust).toBe("pending");
      } finally {
        await second.shutdown().catch(() => {});
      }
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});

/** 真跑 CLI：抹掉全部 provider key，证「看面和决议这两件事不需要钥匙」（读路径不被无关闸门挡住）。 */
function runCli(args: string[], env: Record<string, string> = {}): { status: number | null; out: string } {
  const e: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", M2E_FOREIGN_SOURCES: "off", ...env };
  for (const k of ["CAIRN_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "M2E_LOOSE_SKILLS", "M2E_USER_PLUGINS"]) delete e[k];
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: ROOT, encoding: "utf8", env: e, input: "", timeout: 60_000 });
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("CLI 交付面：列得出、批得了、批不动就说没批（真 spawn）", () => {
  const fixture = async (): Promise<{ ws: string; trustFile: string }> => {
    const ws = await mkdtemp(join(tmpdir(), "dsh-p437-cli-"));
    const dir = join(ws, ".agent", "skills", "demo");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), "---\nname: demo\ndescription: 判卷用\n---\n正文\n", "utf8");
    return { ws, trustFile: join(ws, "data", "trust.json") };
  };

  it("⑲ --plugins 列出项目 skill 与其作用域/状态，并给出决议入口", async () => {
    const { ws, trustFile } = await fixture();
    try {
      const r = runCli(["--workspace", ws, "--plugins"], { M2E_TRUST_FILE: trustFile });
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain(projectSkillsRootOf(ws));
      expect(r.out).toContain("demo");
      expect(r.out).toContain("pending");
      expect(r.out).toContain("--trust-plugin");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  }, 90_000);

  it("⑳ 批准后信任表里那条是「绝对路径@内容指纹」，再列一次就成了 trusted", async () => {
    const { ws, trustFile } = await fixture();
    try {
      const decide = runCli(["--workspace", ws, "--trust-plugin", "demo"], { M2E_TRUST_FILE: trustFile });
      expect(decide.status, decide.out).toBe(0);
      expect(decide.out).toContain("已批准");
      const stored = JSON.parse(await readFile(trustFile, "utf8")) as { trusted: string[] };
      expect(stored.trusted.length).toBe(1);
      expect(stored.trusted[0]).toMatch(/\/\.agent\/skills\/demo@[0-9a-f]{32}$/u);
      const again = runCli(["--workspace", ws, "--plugins"], { M2E_TRUST_FILE: trustFile });
      expect(again.out).toContain("trusted");
      expect(again.out).toContain("待信任 0 条");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  }, 90_000);

  it("㉑ 名字不在面上 ⇒ 退 1 且信任表一个字都没写（fail-closed 的物理证据）", async () => {
    const { ws, trustFile } = await fixture();
    try {
      const r = runCli(["--workspace", ws, "--trust-plugin", "nosuch"], { M2E_TRUST_FILE: trustFile });
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain("一条决议也没写下");
      expect(existsSync(trustFile)).toBe(false);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  }, 90_000);

  it("㉒ 带着任务描述就拒跑（退 2）——不能让插件面抢跑把任务悄悄吃掉还报 0", async () => {
    const { ws, trustFile } = await fixture();
    try {
      const r = runCli(["--workspace", ws, "--plugins", "干点活"], { M2E_TRUST_FILE: trustFile });
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain("不跑任务");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  }, 90_000);

  it("㉓ 相反的两枚决议同时给 = 用法错，而不是后一枚赢", async () => {
    const { ws, trustFile } = await fixture();
    try {
      const r = runCli(["--workspace", ws, "--trust-plugin", "demo", "--decline-plugin", "demo"], { M2E_TRUST_FILE: trustFile });
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain("--trust-plugin 与 --decline-plugin 只能给一枚：批准与拒绝是相反的决议");
      expect(existsSync(trustFile)).toBe(false);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  }, 90_000);
});

describe("接线：面与决议只有一个出口，两根各算一遍就是漂", () => {
  const cli = () => textOf(CLI_SRC);
  const face = () => textOf(FACE_SRC);

  it("㉔ argv 分派接的是 opts.plugins 连入参一起（只钉函数名则「算出来不接」存活）", () => {
    expect(cli()).toContain("return await runPluginFace(opts.plugins, opts.workspace);");
  });

  it("㉕ 取值型旗标表里有这两枚（少了就把名字读成位置参数，批准错对象比拒了更坏）", () => {
    expect(cli()).toMatch(/"--trust-plugin", "--decline-plugin"/u);
  });

  it("㉖ 扫面吃装配面那一份配置：取来的 opts 既喂 load 也喂信任表路径（不是各拼一遍）", () => {
    const src = cli();
    expect(src).toMatch(/const runtimeOpts = pluginRuntimeOpts\(workspace\);[\s\S]{0,160}?PluginRuntime\.load\(runtimeOpts\)/u);
    expect(src).toContain("trustFilePathOf(runtimeOpts)");
  });

  it("㉗ 决议只走 PluginRuntime.trustDecide，两处都不许出现第二个写点", () => {
    expect(cli()).toContain("rt.trustDecide(req.name, req.trusted)");
    expect(cli()).not.toContain("new TrustStore(");
    expect(face()).not.toMatch(/new TrustStore\(|\.decide\(/u);
  });

  it("㉘ 待信任条数用的是现成谓词 pendingPlugins（不在调用点数第二遍）", () => {
    expect(cli()).toContain("pending: pendingPlugins(rt.manifest).length");
  });

  it("㉙ 项目 skill 那一顶在发现侧走的是项目信任门，不是恒 trusted", () => {
    const src = textOf(DISCOVER_SRC);
    expect(src).toContain('scanScopeRoot(opts.projectSkillsDir, "project", trustOf)');
    expect(src).not.toContain('scanScopeRoot(opts.projectSkillsDir, "project", () => "trusted")');
  });

  it("㉚ 缺省根只有一个算法：装载面接的是 projectSkillsRootOf 连入参", () => {
    expect(textOf(INDEX_SRC)).toContain("opts.projectSkillsDir ?? projectSkillsRootOf(opts.workspace)");
  });

  it("㉛ 帮助文本把三条旗标都列出来（文档说不存在的东西＝教一条不存在的命令）", () => {
    const help = cli();
    for (const flag of ["--plugins", "--trust-plugin <名>", "--decline-plugin <名>"]) {
      expect(help).toContain(flag);
    }
  });
});
