// M0 复盘 E-2：redactSecrets 曾对每条规则只取首个匹配（`p.re.exec(line)`），
// 同一行出现两个同模式密钥时第二个原样留在文本里 —— 而该函数的产物会经 worker 回传、
// 子流落 JSONL、sidechat promote、安全报告多处流转，等于明文外泄。
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactSecrets } from "../src/agent/security/scan";
import { scanStreamEvent } from "../src/agent/worker-projection";
import type { AgentEvent } from "../src/events";

describe("redactSecrets 全局掩码（E-2 回归）", () => {
  it("同一行多个同模式密钥全部掩码", () => {
    const a = "sk-" + "A".repeat(24);
    const b = "sk-" + "B".repeat(24);
    const r = redactSecrets(`a="${a}" b="${b}"`);
    expect(r.text).not.toContain(a);
    expect(r.text).not.toContain(b);
    expect(r.findings.length).toBeGreaterThan(0);
  });

  it("跨行多个密钥全部掩码", () => {
    const a = "sk-" + "C".repeat(24);
    const b = "sk-" + "D".repeat(24);
    const r = redactSecrets(`${a}\n${b}`);
    expect(r.text).not.toContain(a);
    expect(r.text).not.toContain(b);
  });

  it("无密钥文本原样返回", () => {
    const r = redactSecrets("hello world");
    expect(r.text).toBe("hello world");
    expect(r.findings).toHaveLength(0);
  });
});

// 高熵候选的**边界**（2026-09-22 量测）：旧字符集 `[A-Za-z0-9+/=_-]` 把 `=` 和 `/` 也算进候选，
// 于是一条候选不是「一个密钥」而是「整段赋值 + 整条绝对路径」；mask() 只留前 4 字符 ⇒
// 实测 `scratch=/var/folders/pc/fqvmb…gn/T` 变成 `scra****`（键名连同路径一起没了），
// `created /var/folders/…` 变成 `created /var****`。这条路今天就在生效（子流落流、solpi 归档都过它），
// 且没有任何地方看见它——所以这里成对钉：该掩的仍然掩（漏一个＝假安全），不该掩的别碰（掩一个＝毁正文）。
describe("高熵候选边界：掩值，不吃键名与路径", () => {
  const KEY = "Zx9Qm2Lp7Rk4Tv8Nw3Yb6Hc1Jd5Fs0Ga";

  it("赋值式：值掩掉、键名逐字留着", () => {
    expect(redactSecrets(`SESSION=${KEY}`).text).toBe("SESSION=Zx9Q****");
  });

  it("base64 串中段含 / 与 + 时仍按整串掩（否决只看候选开头）", () => {
    const blob = "qkvHj3d/sdLk2jJQ9xYvBm+cRt2Nw5Zk";
    const r = redactSecrets(`blob=${blob}`);
    expect(r.text).not.toContain(blob);
    expect(r.text).toContain("blob=");
  });

  it("尾部 padding 属于候选（不把 == 留在明文里）", () => {
    const r = redactSecrets(`x ${KEY}== y`);
    expect(r.text).not.toContain(KEY);
  });

  it("绝对路径形状否决：真实 mkdtemp 目录与其下的文件逐字不变", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-entropy-"));
    const line = `wrote ${join(dir, "out.jsonl")} done`;
    const r = redactSecrets(line);
    expect(r.findings).toHaveLength(0);
    expect(r.text).toBe(line);
  });

  it("同一条落流事件：路径完整 + 同行的 sk- 密钥仍被擦（两边都要，缺一边就是假话）", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-entropy-"));
    const out = `read ${join(dir, "config.env")} → API="sk-abcdefghijklmnopqrstuvwxyz012345"`;
    const e = { type: "tool_result", callId: "t1", ok: true, output: out } as unknown as AgentEvent;
    const scanned = scanStreamEvent(e) as Extract<AgentEvent, { type: "tool_result" }>;
    expect(scanned.output).toContain(dir);
    expect(scanned.output).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
  });

  it("相对路径也要整段可读（agent 最高频的 token 就是工作区相对路径）", () => {
    // 上一笔只否决了「以 / 开头」的候选，而这批形状都不以 / 开头：dated 目录、worktree 名、
    // session 文件名。它们被吃掉后模型拿不到路径 ⇒ 只能重跑命令或猜文件名（返工 + 白花 token）。
    // 断言写成「整条逐字不变」而不是「不含 ****」：前半句才判得出段首被截的失真。
    const lines = [
      "read outputs/ga-strategy-2026-09-23/measure-overmask.mts ok",
      "opened fixtures/no-progress/session-2026-09-20T04-11-52.jsonl",
      "worktree .agents/worktrees/dsh-anchor-3f/src/main.ts dirty",
      "plan docs/superpowers/plans/2026-09-20-goal-plan-modes.md done",
    ];
    for (const line of lines) {
      const r = redactSecrets(line);
      expect(r.text, "相对路径被脱敏吃掉：" + line).toBe(line);
      expect(r.findings, "路径不该产出 secret finding：" + line).toHaveLength(0);
    }
  });

  it("反向那一半：相对路径里真藏高熵串时仍然要擦（否决不许把密钥一起放过）", () => {
    // 这一条与上一条同分母（都含 `/`），差别只在**某一段**自身是高熵随机串。
    // 只测「路径放过」而不测这条，等于允许用「一律放过含 / 的候选」蒙过上一格。
    const secret = "xk39Fd8Qz2Lp7Vm4Rt6Bn";
    const line = `write src/config/${secret} ok`;
    const r = redactSecrets(line);
    expect(r.text).not.toContain(secret);
    expect(r.text).toContain("src/config/"); // 键名与目录仍在（只掩值，不吃上下文）
    expect(r.findings.length).toBeGreaterThan(0);
  });

  it("刻意接受的口子（钉住，不是遗漏）：以 / 开头的 base64 串不再由熵分支覆盖", () => {
    // 命中概率 ≈1/64（首字符恰为 `/`）。换来的是绝对路径整段可读。
    // 有名字的密钥形状不受影响——私钥块 / sk- / AIza / AKIA / ghp_ / xox / 赋值式各自独立成规则。
    expect(redactSecrets("slash=/9xKzvLm2pQ7rT4wYbNcHdJsFk8Vg3Rt").text).toBe("slash=/9xKzvLm2pQ7rT4wYbNcHdJsFk8Vg3Rt");
    expect(redactSecrets("cp /home/deploy/AKIAIOSFODNN7EXAMPLE /tmp/x").text).toContain("AKIA****");
  });
});

/** 赋值式凭据的**漏检一侧**（任务 #5）。旧规则的强制引号等于宣布：
 *  `.env` / `docker run -e` / shell 里最常见的写法（`API_KEY=xxxx`）不是凭据。
 *  这里同时钉住"只掩值、键名逐字留"（否则修漏检会新造一条把键名一起吃掉的过掩）。 */
describe("赋值式凭据：无引号写法（.env / -e / YAML）", () => {
  const rules = (line: string): string[] => redactSecrets(line).findings.map((f) => f.ruleId);

  it("无引号 api_key=<32 位 hex>：命中赋值式，且键名留着、值擦掉", () => {
    const r = redactSecrets("api_key=bf9ccaa2dab744fa83c232deef772ad0");
    expect(rules("api_key=bf9ccaa2dab744fa83c232deef772ad0")).toContain("secret.assigned");
    expect(r.text).toContain("api_key=");
    expect(r.text).not.toContain("bf9ccaa2dab744fa83c232deef772ad0");
  });

  it("大写键 + base64 值（中段含 / 与 +）：整值擦，等号左侧不动", () => {
    const val = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
    const r = redactSecrets(`AWS_SECRET_ACCESS_KEY=${val}`);
    expect(rules(`AWS_SECRET_ACCESS_KEY=${val}`)).toContain("secret.assigned");
    expect(r.text).toContain("AWS_SECRET_ACCESS_KEY=");
    expect(r.text).not.toContain(val);
  });

  it("带引号的旧形状行为一字不变（双引号 / 单引号两种都仍算）", () => {
    for (const line of [`token: "ghtok_abcdefghijklmnop1234"`, "password: 'hunter2hunter2hunter2'"]) {
      expect(rules(line), line).toContain("secret.assigned");
      expect(redactSecrets(line).text, line).not.toContain("abcdefghijklmnop1234".slice(0, 12));
      expect(redactSecrets(line).text, line).not.toContain("hunter2hunter2hunter2");
    }
  });

  it("负控：非凭据键名、变量引用、短值、空值不算赋值式凭据", () => {
    const lines = [
      "token_count: 12",                       // 键不是整词（token 后面还跟着 _count）
      "DB_TOKEN=${VAULT_TOKEN}",               // 变量引用，不是凭据本身
      "password=",                             // 空值（模板 / 未配置）
      "token=short12",                         // 值不足 12
      "secret_key_rotation_policy=annual",     // 键名里含 secret，但值不是凭据
      "api_keys_file: /etc/keys.json",
    ];
    for (const line of lines) {
      expect(rules(line), "不该命中赋值式：" + line).not.toContain("secret.assigned");
    }
  });
});

/** 纯 hex 长串不该由**熵分支**判定（任务 #6 的读数定的方向）。
 *
 *  实测规模（同一支探针 measure-naked-hex.mts，本仓一次 `git ls-tree -r` + `rev-list`）：
 *  3727 条 naked 长 hex 里 **0 条是凭据形状**，而 63 行今天就已被熵分支改写过——
 *  因为 40 位 hex 的香农熵上界就是 log2(16)=4.0，随机 SHA 一半会**撞过**阈值。
 *  掩掉 commit/blob id = 模型没法 `git show`、核对或回滚（能力 3/5 的直接损伤）。
 *  反向那一半由赋值式规则兜：`api_key=<32hex>` 靠**键名上下文**命中（3502d7c），不靠猜熵。 */
describe("纯 hex：熵分支不判，凭据交给上下文规则", () => {
  const rules = (line: string): string[] => redactSecrets(line).findings.map((f) => f.ruleId);

  it("git 输出形状（ls-tree / rev-list / log --format=%H）逐字不变", () => {
    // 前两条取自本仓一次真实 `git ls-tree -r HEAD` 的输出（当时实测就被改写），
    // 不是手造的"看起来高熵"样本——样本造错就会把判据钉在一个不存在的形状上。
    const lines = [
      "209fbeed34dfee992102d511233f0bf41fea3127 blob docs/superpowers/specs/2026-09-18-r1b-renderer-subtraction-design.md",
      "9451ee71c3a7875072d451cfc910ebf226975c53 blob docs/superpowers/specs/2026-09-19-doc-layer-budget-design.md",
      "commit 0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c",
    ];
    for (const line of lines) {
      expect(redactSecrets(line).text, "git 对象 id 被吃了：" + line).toBe(line);
      expect(rules(line), line).not.toContain("secret.high_entropy");
    }
  });

  it("md5 / sha256 校验和行（lockfile 风格）不被当密钥", () => {
    const line = "resolution: {integrity: sha512-9f2b1c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff}";
    expect(redactSecrets(line).text).toBe(line);
  });

  it("混合大小写的随机串仍然算密钥（否决只收**小写纯 hex**，不许把检测面一起关掉）", () => {
    const line = "blob: xK9fQz2Lp7Vm4Rt6Bn8HdJ3sFk5Wg1Yc";
    expect(rules(line)).toContain("secret.high_entropy");
    expect(redactSecrets(line).text).not.toContain("xK9fQz2Lp7Vm4Rt6Bn8HdJ3sFk5Wg1Yc");
  });

  it("hex 值放在赋值式里仍然必须被抓（两半合起来才不漏：熵让路，上下文接手）", () => {
    for (const line of [
      "api_key=bf9ccaa2dab744fa83c232deef772ad0",
      "SECRET=0123456789abcdef0123456789abcdef0123",
    ]) {
      expect(rules(line), line).toContain("secret.assigned");
      const hex = line.split("=")[1]!;
      expect(redactSecrets(line).text, line).not.toContain(hex);
    }
  });
});

/** 本文件后加的判据共用的取料助手（上面两个 describe 里各有一份同名局部 helper，
 *  这里在模块作用域再要一份——`ruleId` 在类型上是可选的，缺的当空串处理）。 */
const ruleIdsOf = (line: string): string[] =>
  redactSecrets(line).findings.map((f) => f.ruleId ?? "");

// ---- 2026-10-19：连接串凭据 + 值带括号（三条独立实测漏检）----
// 判据形状与上面几条不同：不只问"有没有命中规则"，而是问**任何一段真凭据还留在不在文本里**。
// 半掩比不掩更坏——`PASSWORD=post****` 那种只掩到第一个 `/` 的输出会给人"已脱敏"的假象，
// 而 `//` 之后的真密码原样在场。
describe("连接串内嵌凭据：整条掩，不许留下 // 之后那一段", () => {
  const URIS = [
    "postgres://appuser:s3cr3tp4ssw0rd@db.internal:5432/prod",
    "postgresql://appuser:s3cr3tp4ssw0rd@db.internal:5432/prod",
    "redis://:r3d1sp4ssw0rd@cache.internal:6379/0",
    "mongodb://admin:hunter2hunter2@mongo.internal:27017/db",
    "mongodb+srv://admin:hunter2hunter2@cluster0.abcd.mongodb.net/db",
    "amqp://guest:guestpass1234@mq.internal:5672/%2F",
    "mysql://root:rootpassw0rd@127.0.0.1:3306/app",
  ];
  /** 每一段可能凭据的东西：用户名、密码、主机。任何一个还在文本里就是漏。 */
  const FRAGMENTS = ["s3cr3tp4ssw0rd", "r3d1sp4ssw0rd", "hunter2hunter2", "appuser",
    "db.internal", "cache.internal", "mongo.internal", "cluster0.abcd.mongodb.net",
    "guestpass1234", "rootpassw0rd"];

  for (const uri of URIS) {
    it(`键名是 url/uri/dsn 的也抓：${uri.slice(0, 22)}…`, () => {
      for (const key of ["DATABASE_URL", "REDIS_URL", "MONGO_URI", "DSN"]) {
        const line = `${key}=${uri}`;
        const r = redactSecrets(line);
        expect(ruleIdsOf(line), line).toContain("secret.connection_string");
        for (const frag of FRAGMENTS) {
          expect(r.text, `${line} 之后还留着 ${frag}`).not.toContain(frag);
        }
      }
    });
  }

  it("同一行里连接串与普通赋值各掩各的（两条规则不互相破坏）", () => {
    const line = "DATABASE_URL=postgres://appuser:s3cr3tp4ssw0rd@db.internal:5432/prod API_KEY=bf9ccaa2dab744fa83c232deef772ad0";
    const r = redactSecrets(line);
    expect(r.text).not.toContain("s3cr3tp4ssw0rd");
    expect(r.text).not.toContain("bf9ccaa2dab744fa83c232deef772ad0");
  });

  it("反向验证：连接串规则排在 assigned **之后**时会退化成半掩（顺序即优先级，不是风格）", () => {
    // 旧行为实测：assigned 先跑，把 `postgres:` 掩成 `post****`，整串匹配随后再也找不到
    // ⇒ 输出 `PASSWORD=post****`，而 `//appuser:s3cr3tp4ssw0rd@db.internal…` 原样留下。
    // 这里把那个退化解法现造出来钉住：它必须被"任何一段凭据都不许留"判为红。
    const degraded = "PASSWORD=post****//appuser:s3cr3tp4ssw0rd@db.internal:5432/prod";
    for (const frag of ["s3cr3tp4ssw0rd", "appuser", "db.internal"]) {
      expect(degraded, "退化解法里凭据还在").toContain(frag); // 前提：它确实是坏的
    }
    const good = redactSecrets("PASSWORD=postgres://appuser:s3cr3tp4ssw0rd@db.internal:5432/prod");
    for (const frag of ["s3cr3tp4ssw0rd", "appuser", "db.internal"]) {
      expect(good.text, `退化解法不该是现状（${frag} 竟还在）`).not.toContain(frag);
    }
  });

  it("普通 URL 不是凭据：不许把 https 链接整条掩掉（误伤的代价是看不见排查信息）", () => {
    for (const line of [
      "see https://example.com/path?x=1 for details",
      "docs at http://docs.internal/guide#section",
      "redis.io client library, not a URI",
    ]) {
      const r = redactSecrets(line);
      expect(ruleIdsOf(line), line).not.toContain("secret.connection_string");
      expect(r.text, line).toBe(line);
    }
  });
});

describe("赋值式凭据的值带括号（被 {12,} 卡掉的那一类）", () => {
  it("值自带括号的密码也要掩（旧 charset 把 ( ) 排除在外 ⇒ 截断后够不到 12 字）", () => {
    for (const line of [
      "ADMIN_PASSWORD=Tr0ub4dor&3(x)99",
      "password = Correct-Horse(Battery)9",
      "api_key=abc123(def456)ghi789",
    ]) {
      const r = redactSecrets(line);
      expect(r.text, line).not.toContain("Tr0ub4dor&3(x)99");
      expect(r.text, line).not.toContain("Correct-Horse(Battery)9");
      expect(r.text, line).not.toContain("abc123(def456)ghi789");
    }
  });

  it("反向验证：括号被排除时这条会漏（现造旧 charset 的后果钉住）", () => {
    // 旧正则的 charset 排除 ( ) ⇒ `Tr0ub4dor&3` 只有 11 字，够不到 {12,} ⇒ 零命中。
    const oldStyle = /(?:api[_-]?key|secret|token|password|passwd|access[_-]?key)\s*[:=]\s*["'`]?([^\s"'`,;{}()<>$]{12,})["'`]?/i;
    expect(oldStyle.test("ADMIN_PASSWORD=Tr0ub4dor&3(x)99"), "旧 charset 确实漏").toBe(false);
    expect(ruleIdsOf("ADMIN_PASSWORD=Tr0ub4dor&3(x)99")).toContain("secret.assigned_bracketed");
  });

  it("括号放行不放变量引用与空值进来（放行的边界要钉住）", () => {
    for (const line of [
      "DB_TOKEN=${VAULT_TOKEN}",
      "password: (short)",
      "token_count: 42",
      "the password field is empty",
    ]) {
      expect(ruleIdsOf(line), line).not.toContain("secret.assigned_bracketed");
      expect(redactSecrets(line).text, line).toBe(line);
    }
  });
});
