// cairn --doctor 的判卷（spec：docs/superpowers/specs/2026-10-06-productization-b1-design.md §2/§3）。
// 纯函数核全量钉死：脱敏（env 值结构性进不来）、七项固定清单、fatal 只留给 node、三态 search、
// 信任落点的三态（读不出不许折成「没建」或「0 条」）、末行总档。
// IO 壳（runDoctor）另用 tmpdir 验最薄的几条路——沙箱探测注入，不在判卷里赌机器状态。
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  collectDoctorChecks,
  nodeVersionOk,
  parseEngines,
  renderDoctor,
  runDoctor,
  trustFaceCheck,
  verdictOf,
  type DoctorCheck,
  type DoctorFacts,
  type TrustFaceFacts,
} from "../src/main/doctor";
import { PROVIDER_ENV_KEYS } from "../src/providers/env-keys";
import { DEFAULT_MODEL_TABLE, specsByTier } from "../src/providers/registry";

const RANGE = parseEngines(">=20.11.0 <25")!;

describe("nodeVersionOk（手写比较器，不引 semver）", () => {
  it("区间边界：20.10.9 拒 / 20.11.0 收 / 24.9.9 收 / 25.0.0 拒", () => {
    expect(nodeVersionOk("20.10.9", RANGE)).toBe(false);
    expect(nodeVersionOk("20.11.0", RANGE)).toBe(true);
    expect(nodeVersionOk("24.9.9", RANGE)).toBe(true);
    expect(nodeVersionOk("25.0.0", RANGE)).toBe(false);
  });

  it("v 前缀收；预发布与脏串一律拒（宁可误报也不放行不认识的串）", () => {
    expect(nodeVersionOk("v22.23.2", RANGE)).toBe(true);
    expect(nodeVersionOk("25.0.0-pre.1", RANGE)).toBe(false);
    expect(nodeVersionOk("abc", RANGE)).toBe(false);
    expect(nodeVersionOk("", RANGE)).toBe(false);
  });

  it("engines 读不出来 ⇒ parseEngines 返回 null（fail-closed，不猜区间）", () => {
    expect(parseEngines(">=20")).toBeNull();
    expect(parseEngines("随便")).toBeNull();
  });
});

const TIER_COUNTS = {
  total: DEFAULT_MODEL_TABLE.length,
  cheap: specsByTier(DEFAULT_MODEL_TABLE, "cheap").length,
  standard: specsByTier(DEFAULT_MODEL_TABLE, "standard").length,
  strong: specsByTier(DEFAULT_MODEL_TABLE, "strong").length,
};

/** 信任落点的「一切正常」基线：目录在、0755、表读得出且有条目。其余用例都从这一格改一维。 */
const TRUST_OK: TrustFaceFacts = {
  root: "/fixture/home/.config/cairn/plugin-data",
  source: "default",
  dirState: "ok",
  dirMode: 0o755,
  storeState: "ok",
  entries: { trusted: 2, declined: 1 },
};

function trust(over: Partial<TrustFaceFacts> = {}): TrustFaceFacts {
  return { ...TRUST_OK, ...over };
}

function facts(over: Partial<DoctorFacts> = {}): DoctorFacts {
  return {
    nodeVersion: "v22.23.2",
    engines: ">=20.11.0 <25",
    // 键名 = env 变量名（PROVIDER_ENV_KEYS 的值）；判卷里只可能有「在位与否」，不可能有值
    keyPresence: { CAIRN_API_KEY: true, OPENAI_API_KEY: false, ANTHROPIC_API_KEY: false, GEMINI_API_KEY: false },
    sandbox: { available: true },
    workspaceWritable: true,
    search: { kind: "unset" },
    tierCounts: TIER_COUNTS,
    trust: TRUST_OK,
    ...over,
  };
}

describe("collectDoctorChecks（七项固定清单，spec §2 ＋ 第 432 页的信任落点）", () => {
  it("脱敏：sk- 形态的串进不了渲染面（事实结构里就没有值的字段）", () => {
    const checks = collectDoctorChecks(
      facts({ keyPresence: { CAIRN_API_KEY: false, OPENAI_API_KEY: true, ANTHROPIC_API_KEY: false, GEMINI_API_KEY: false } }),
    );
    const text = renderDoctor({ checks, ...verdictOf(checks) });
    expect(text).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it("keys：全缺 ⇒ ✗＋指路 --provider demo（只报不红，非致命）", () => {
    const c = collectDoctorChecks(
      facts({ keyPresence: { CAIRN_API_KEY: false, OPENAI_API_KEY: false, ANTHROPIC_API_KEY: false, GEMINI_API_KEY: false } }),
    );
    const keys = c.find((x) => x.id === "keys")!;
    expect(keys.ok).toBe(false);
    expect(keys.fatal).toBe(false);
    expect(keys.hint).toContain("--provider demo");
  });

  it("keys：部分在位 ⇒ detail 点名缺省将拨谁（按 ENV_KEYED_PROVIDERS 表序第一个在位的）", () => {
    const keys = collectDoctorChecks(facts()).find((x) => x.id === "keys")!;
    expect(keys.ok).toBe(true);
    expect(keys.detail).toContain(PROVIDER_ENV_KEYS.glm);
  });

  it("node：版本不满足 ⇒ fatal（唯一 exit 1 项）；engines 解析失败 ⇒ 同样 fatal", () => {
    expect(collectDoctorChecks(facts({ nodeVersion: "18.0.0" })).find((x) => x.id === "node")!.fatal).toBe(true);
    expect(collectDoctorChecks(facts({ engines: "随便" })).find((x) => x.id === "node")!.fatal).toBe(true);
    expect(collectDoctorChecks(facts({ nodeVersion: "18.0.0" })).find((x) => x.id === "node")!.ok).toBe(false);
  });

  it("sandbox 不可用 ⇒ ✗ 但非致命，detail 带原因，不假装可用", () => {
    const s = collectDoctorChecks(facts({ sandbox: { available: false, reason: "no sandbox-helper" } })).find((x) => x.id === "sandbox")!;
    expect(s.ok).toBe(false);
    expect(s.fatal).toBe(false);
    expect(s.detail).toContain("no sandbox-helper");
  });

  it("search 三态分开：未配＝ok（web_search 本来就可选）；JSON 坏＝✗ 非致命；已配＝ok", () => {
    expect(collectDoctorChecks(facts()).find((x) => x.id === "search")!.ok).toBe(true);
    const broken = collectDoctorChecks(facts({ search: { kind: "broken", message: "Unexpected token" } })).find((x) => x.id === "search")!;
    expect(broken.ok).toBe(false);
    expect(broken.fatal).toBe(false);
    expect(collectDoctorChecks(facts({ search: { kind: "ok" } })).find((x) => x.id === "search")!.ok).toBe(true);
  });

  it("tiers：只报数，恒 ok，detail 带三档分布", () => {
    const t = collectDoctorChecks(facts()).find((x) => x.id === "tiers")!;
    expect(t.ok).toBe(true);
    expect(t.fatal).toBe(false);
    expect(t.detail).toContain(" 条（cheap " + TIER_COUNTS.cheap + " / standard " + TIER_COUNTS.standard + " / strong " + TIER_COUNTS.strong);
  });

  it("固定清单＝七项，顺序即渲染顺序，第七项是 trust（第 432 页带进来的那一格）", () => {
    expect(collectDoctorChecks(facts()).map((c) => c.id)).toEqual([
      "node",
      "keys",
      "tiers",
      "sandbox",
      "workspace",
      "search",
      "trust",
    ]);
  });
});

describe("trustFaceCheck（第七项：落点／权限位／条数，两处「读不出」都不许折成干净）", () => {
  it("基线（0755 ＋ 表里 2 条）⇒ ✓，detail 同时给出路径、来路、权限位与条数", () => {
    const c = trustFaceCheck(trust());
    expect(c.ok).toBe(true);
    expect(c.id).toBe("trust");
    expect(c.fatal).toBe(false);
    expect(c.hint).toBeUndefined();
    expect(c.detail).toContain(TRUST_OK.root);
    expect(c.detail).toContain("来路 缺省");
    expect(c.detail).toContain("权限 0755");
    expect(c.detail).toContain("已信任 2 条／已拒绝 1 条");
  });

  it("env 给的落点要说明来路（缺省与 env 两种成因不许报成同一句）", () => {
    expect(trustFaceCheck(trust({ source: "env" })).detail).toContain("来路 env M2E_PLUGIN_DATA");
    expect(trustFaceCheck(trust()).detail).not.toContain("M2E_PLUGIN_DATA");
  });

  it("世界可写（0777）⇒ ✗ 并点名这条洞，但仍不是致命项", () => {
    const c = trustFaceCheck(trust({ dirMode: 0o777 }));
    expect(c.ok).toBe(false);
    expect(c.fatal).toBe(false);
    expect(c.detail).toContain("目录世界可写，本机任何用户都能预置这份信任表");
    expect(c.hint).toContain("chmod go-w");
  });

  it("只有组可写（0775）不算世界可写——掩码取的是 0o002 那一维，不是 0o077", () => {
    const c = trustFaceCheck(trust({ dirMode: 0o775 }));
    expect(c.ok).toBe(true);
    expect(c.detail).not.toContain("世界可写");
  });

  it("目录读不出 ⇒ ✗，且不许写成「还没建」（EACCES 不是 ENOENT）", () => {
    const c = trustFaceCheck(trust({ dirState: "unreadable", dirMode: null }));
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("目录读不出，权限位与信任表都无从判断");
    expect(c.detail).not.toContain("还没建");
  });

  it("目录还没建 ⇒ ✓ 并说明「还没有信任决议落盘」，这是合法空态不是病", () => {
    const c = trustFaceCheck(trust({ dirState: "absent", dirMode: null, storeState: "absent", entries: null }));
    expect(c.ok).toBe(true);
    expect(c.detail).toContain("还没建");
    expect(c.detail).not.toMatch(/信任表 已信任/);
  });

  it("表读不出 ⇒ ✗ 并明说这不等于「已信任 0 条」——折成 0 就是把没尺报成干净", () => {
    const c = trustFaceCheck(trust({ storeState: "unreadable", entries: null }));
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("信任表读不出");
    expect(c.detail).toContain("这不等于「已信任 0 条」");
    // 反证取「报数那一条分支没跑」这个形状，不取「已信任 0 条」那串字面量——
    // 后者正被我在这句话里引用着（本仓记过的同一形状：反例那行会被反例的尺抓）。
    expect(c.detail).not.toMatch(/信任表 已信任/);
  });

  it("表还没写 ⇒ ✓，报「还没写」而不是条数", () => {
    const c = trustFaceCheck(trust({ storeState: "absent", entries: null }));
    expect(c.ok).toBe(true);
    expect(c.detail).toContain("信任表还没写");
    expect(c.detail).not.toMatch(/信任表 已信任/);
  });

  it("状态与条数不自洽的两个方向都红（ok 却没给数／absent 却给了数）", () => {
    const noCounts = trustFaceCheck(trust({ storeState: "ok", entries: null }));
    expect(noCounts.ok).toBe(false);
    expect(noCounts.detail).toContain("状态与条数不自洽");
    const withCounts = trustFaceCheck(trust({ storeState: "absent" }));
    expect(withCounts.ok).toBe(false);
    expect(withCounts.detail).toContain("状态与条数不自洽");
  });
});

describe("verdictOf（末行总档：就绪/部分就绪/未就绪；只有 fatal 才 exit 1）", () => {
  it("全绿 ⇒ 就绪/0；非致命红 ⇒ 部分就绪/0；fatal ⇒ 未就绪/1", () => {
    expect(verdictOf(collectDoctorChecks(facts()))).toEqual({ verdict: "就绪", exitCode: 0 });
    expect(verdictOf(collectDoctorChecks(facts({ workspaceWritable: false })))).toEqual({ verdict: "部分就绪", exitCode: 0 });
    expect(verdictOf(collectDoctorChecks(facts({ nodeVersion: "18.0.0" })))).toEqual({ verdict: "未就绪", exitCode: 1 });
  });

  it("第七项红 ⇒ 部分就绪/0，不进 exit 1（它只报不阻断，fatal 仍然只有 node）", () => {
    const checks = collectDoctorChecks(facts({ trust: trust({ dirMode: 0o777 }) }));
    expect(verdictOf(checks)).toEqual({ verdict: "部分就绪", exitCode: 0 });
    expect(checks.filter((c) => c.fatal && !c.ok).map((c) => c.id)).toEqual([]);
    expect(renderDoctor({ checks, ...verdictOf(checks) })).toContain("✗ trust：");
  });
});

describe("renderDoctor", () => {
  it("逐项 ✓/✗＋末行总档", () => {
    const checks = collectDoctorChecks(facts());
    const text = renderDoctor({ checks, ...verdictOf(checks) });
    expect(text).toContain("✓ node");
    expect(text.trim().endsWith("总档：就绪")).toBe(true);
  });
});

describe("runDoctor（IO 壳，tmpdir 真工作区）", () => {
  it("空目录：workspace 可写 ✓、search 未配不抛（loadSearchConfig 的 ENOENT ⇒ null ⇒ unset）", async () => {
    const ws = mkdtempSync(join(tmpdir(), "doctor-"));
    try {
      const r = await runDoctor(ws, { sandbox: { available: true } });
      expect(r.checks.find((c) => c.id === "workspace")!.ok).toBe(true);
      expect(r.checks.find((c) => c.id === "search")!.detail).toContain("search.endpoint 未配");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it(".agent/config.json 是坏 JSON ⇒ search 落在 broken（报告不抛、非致命）", async () => {
    const ws = mkdtempSync(join(tmpdir(), "doctor-"));
    try {
      mkdirSync(join(ws, ".agent"), { recursive: true });
      writeFileSync(join(ws, ".agent", "config.json"), "{bad json");
      const r = await runDoctor(ws, { sandbox: { available: true } });
      const search = r.checks.find((c) => c.id === "search")!;
      expect(search.ok).toBe(false);
      expect(search.fatal).toBe(false);
      expect(search.detail).toContain("config.json 存在但解析失败");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

/** 把落点交给 env，真跑一次 runDoctor，取回 trust 那一项（用完 restore）。
 *  这几条不走 inject：走 inject 就只验了纯核，验不到「装配面真的把这一格收进了事实」。 */
async function doctorTrust(envValue: string): Promise<DoctorCheck> {
  const prev = process.env.M2E_PLUGIN_DATA;
  process.env.M2E_PLUGIN_DATA = envValue;
  const ws = mkdtempSync(join(tmpdir(), "doctor-"));
  try {
    const r = await runDoctor(ws, { sandbox: { available: true } });
    return r.checks.find((c) => c.id === "trust")!;
  } finally {
    rmSync(ws, { recursive: true, force: true });
    if (prev === undefined) delete process.env.M2E_PLUGIN_DATA;
    else process.env.M2E_PLUGIN_DATA = prev;
  }
}

describe("runDoctor × 信任落点（真盘上的四种温度，判卷不赌本机状态）", () => {
  it("表里有决议 ⇒ 如实报条数，且报的是 env 给的那个落点（不是 home 下拼出来的第二个）", async () => {
    const root = mkdtempSync(join(tmpdir(), "doctor-trust-"));
    try {
      writeFileSync(join(root, "plugin-trust.json"), JSON.stringify({ trusted: ["/a@f", "/b@f"], declined: ["/c@f"] }));
      const t = await doctorTrust(root);
      expect(t.ok).toBe(true);
      expect(t.detail).toContain(root);
      expect(t.detail).toContain("来路 env M2E_PLUGIN_DATA");
      expect(t.detail).toContain("已信任 2 条／已拒绝 1 条");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("表是坏 JSON ⇒ ✗ 并说「读不出」；同一路径换成 0 字节也是读不出，两条都不许报成 0 条决议", async () => {
    const root = mkdtempSync(join(tmpdir(), "doctor-trust-"));
    try {
      for (const body of ["{bad json", ""]) {
        writeFileSync(join(root, "plugin-trust.json"), body);
        const t = await doctorTrust(root);
        expect(t.ok).toBe(false);
        expect(t.detail).toContain("信任表读不出");
        expect(t.detail).not.toMatch(/信任表 已信任/);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("落点目录世界可写 ⇒ ✗（这条洞从前住在 tmpdir 里，搬家之后仍然要看得见）", async () => {
    const root = mkdtempSync(join(tmpdir(), "doctor-trust-"));
    try {
      chmodSync(root, 0o777);
      const t = await doctorTrust(root);
      expect(t.ok).toBe(false);
      expect(t.detail).toContain("权限 0777");
      expect(t.detail).toContain("目录世界可写");
    } finally {
      chmodSync(root, 0o755);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("落点同名但是个文件 ⇒ ✗（stat 成功不等于它是目录，不许落成「还没建」）", async () => {
    const root = mkdtempSync(join(tmpdir(), "doctor-trust-"));
    try {
      const file = join(root, "not-a-dir");
      writeFileSync(file, "x");
      const t = await doctorTrust(file);
      expect(t.ok).toBe(false);
      expect(t.detail).toContain("目录读不出");
      expect(t.detail).not.toContain("还没建");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("落点还不存在 ⇒ ✓ 并报「还没建」（合法空态，不是病）", async () => {
    const root = join(mkdtempSync(join(tmpdir(), "doctor-trust-")), "missing");
    try {
      const t = await doctorTrust(root);
      expect(t.ok).toBe(true);
      expect(t.detail).toContain("还没建");
    } finally {
      rmSync(dirname(root), { recursive: true, force: true });
    }
  });
});

describe("装配面（第七格的两半同笔：接进事实 ＋ 接进对账面；落点与表名都只有一份来源）", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/main/doctor.ts", import.meta.url)), "utf8");
  const io = src.slice(src.indexOf("async function readTrustFace"), src.indexOf("/** IO 壳"));

  it("纯核里 trustFaceCheck 被 push 恰好一条，且吃的是 f.trust（算出来不接＝这一格永不生效）", () => {
    const lines = src.split("\n").filter((l) => /^\s*checks\.push\(trustFaceCheck/.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("f.trust");
  });

  it("IO 壳里这一格只有一条取址，交的是 process.env 与 homedir()", () => {
    const lines = src.split("\n").filter((l) => /^\s*trust: await readTrustFace\(/.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("process.env, homedir()");
  });

  it("落点与表名复用装配面那两个出口，doctor 侧不再出现目录名或表名（第二份事实源就是搬家那天漂的）", () => {
    expect(io).toContain("pluginDataRootOf(env, home)");
    expect(io).toContain("trustFilePathOf({ pluginDataRoot: root })");
    expect(io).not.toMatch(/plugin-data/);
    expect(io).not.toMatch(/plugin-trust\.json/);
  });

  it("条数取自 parseTrustFile 那份数组，不在 doctor 里再 JSON.parse 一遍", () => {
    expect(io).toContain("parseTrustFile");
    expect(io).not.toMatch(/JSON\.parse/);
    expect(io).not.toMatch(/Array\.isArray/);
  });

  it("只有 ENOENT 才读成 absent，其余抛（EACCES／ENOTDIR）留在 unreadable", () => {
    const absentBranches = io.split("\n").filter((l) => l.includes('"ENOENT"'));
    expect(absentBranches).toHaveLength(2);
    for (const line of absentBranches) expect(line).toContain('"unreadable"');
  });
});
