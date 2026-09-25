// 能力 5 的**唯一一条真闭环见证**：验证结果由模型真写过的盘决定，红 → 返修 → 绿。
//
// 已有的两支都测不到这一格：
//  - `tests/auto-verify-repair.test.ts` 的验证拍是 `sequenceHook`（手喂 ok 序列），
//    写工具也是 stub（不真落盘）——它钉的是 loop 的**控制流**（多要一轮、上界、环境红不返修），对；
//  - `tests/auto-verify-repair-runner.test.ts` 走生产入口，但它的验证面是
//    `echo 'FAIL: 断言不过' && exit 1` ——**与盘无关的恒红**，所以那一支永远只能停在红。
// ⇒ 全仓没有任何一条用例证明"收束闸拍到的红，能被返修那一轮真的翻成绿"。
// 而这一条正是目标里那句"普通模型能写代码，顶尖 Agent 能证明代码真的能跑"的字面内容。
//
// 本文件的形状：验证命令**读盘上的一个字**（`grep -q FIXED src/a.ts`），
// 剧本第一轮故意写错 ⇒ 第一拍真红；返修轮写对 ⇒ 第二拍真绿。
// 反向那一格（返修关着）不是装饰：它断"文件里留下的仍是错的 + 终局是红"，
// 少了它，"永远绿"的验证命令也能让第一格全绿（同族教训：判据要钉在会翻的那一位上）。
// 全程 mock provider ⇒ 零模型花费；只花两次 grep。
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { handleAgentRun, initSettingsStore } from "../src/main/agent-runner";
import type { AgentEvent } from "../src/events";
import { scoreStream } from "../scripts/replay/run-scorecard";

const dirs: string[] = [];
afterAll(async () => {
  delete process.env.M3A_MAIN_SCRIPT;
  for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
});

/** 验证命令：盘上有没有 `FIXED` 决定退出码——这是本文件与另两支的唯一实质差别。 */
const GREENER = "grep -q FIXED src/a.ts";
/** 与盘无关的恒绿（反向格用：它证明"翻绿"是返修挣来的，不是验证命令自己送的）。 */
const ALWAYS_GREEN = "true";

async function run(opts: { repair: boolean; test: string; secondWrite: string }): Promise<{ events: AgentEvent[]; ws: string }> {
  const home = await mkdtemp(join(tmpdir(), "rp-real-"));
  const ws = await mkdtemp(join(tmpdir(), "rp-ws-"));
  dirs.push(home, ws);
  initSettingsStore(join(home, "settings.json"));
  await writeFile(
    join(home, "settings.json"),
    JSON.stringify({ ...(opts.repair ? { autoVerifyRepair: true } : {}) }),
    "utf8",
  );
  await mkdir(join(ws, ".agent"), { recursive: true });
  // 批条在场：auto + 无人值守 + 无批条 ⇒ 权限门先拒写，红拍根本不发生（那条假绿的形状）。
  await writeFile(
    join(ws, ".agent", "permissions.json"),
    JSON.stringify({ rules: [{ behavior: "allow", tool: "write_file", scope: "always" }] }),
    "utf8",
  );
  await writeFile(join(ws, ".agent", "config.json"), JSON.stringify({ verify: { test: [opts.test] } }), "utf8");
  // 四轮（`round_end` = 装配期哨兵，见 src/providers/mock.ts）：
  //   ① 写**错**的一版 → ② 空轮（无工具）⇒ 收束闸第一拍，真红 → ③ 写对的一版 → ④ 空轮 ⇒ 第二拍
  await writeFile(
    join(home, "main.jsonl"),
    [
      { type: "tool_call", id: "w1", name: "write_file", args: { path: "src/a.ts", content: "STATUS: BROKEN\n" } },
      { type: "assistant_message", content: "改完了。" },
      { type: "round_end" },
      { type: "assistant_message", content: "还在红，我再改一处。" },
      { type: "round_end" },
      { type: "tool_call", id: "w2", name: "write_file", args: { path: "src/a.ts", content: opts.secondWrite } },
      { type: "assistant_message", content: "这回真改完了。" },
      { type: "round_end" },
      { type: "assistant_message", content: "收工。" },
    ].map((o) => JSON.stringify(o)).join("\n") + "\n",
    "utf8",
  );
  process.env.M3A_MAIN_SCRIPT = join(home, "main.jsonl");
  const seen: AgentEvent[] = [];
  const res = await handleAgentRun(
    { message: "让验证通过", mode: "auto" },
    { workspace: ws, logPath: join(home, "events.jsonl"), unattended: true, onEvent: (e) => { seen.push(e); } },
  );
  expect(res.ok, JSON.stringify(res)).toBe(true);
  return { events: seen, ws };
}

const beats = (es: AgentEvent[]): (AgentEvent & { ok: boolean; auto?: boolean })[] =>
  es.filter((e) => e.type === "verify_result") as (AgentEvent & { ok: boolean; auto?: boolean })[];

describe("返修那一轮把真红翻成真绿（验证结果取决于盘）", () => {
  it(
    "开返修：第一拍因盘上写的是错的而红，返修改对后第二拍真绿 ⇒ green-after-rework",
    { timeout: 120_000 },
    async () => {
      const { events, ws } = await run({ repair: true, test: GREENER, secondWrite: "STATUS: FIXED\n" });
      const b = beats(events);
      expect(b.length, "两拍：收束闸一拍 + 返修后重验一拍").toBe(2);
      expect(b[0]!.ok).toBe(false);
      expect(b[1]!.ok, "第二拍必须是绿——且它是被返修那次写盘挣来的").toBe(true);
      expect(b.every((x) => x.auto === true), "两拍都是 harness 补的（模型从未自调 verify）").toBe(true);
      // 真盘读回：不是"模型说改好了"，是文件里真的留着那一版
      expect(await readFile(join(ws, "src", "a.ts"), "utf8")).toContain("FIXED");
      const s = scoreStream(events);
      expect(s.outcome).toBe("green-after-rework");
      expect(s.reworkRounds).toBe(1);
    },
  );

  it(
    "关返修（缺省）：同一份剧本停在红，且盘上留下的仍是错的那一版",
    { timeout: 120_000 },
    async () => {
      const { events, ws } = await run({ repair: false, test: GREENER, secondWrite: "STATUS: FIXED\n" });
      const b = beats(events);
      expect(b.length, "不开返修就不该有第二拍").toBe(1);
      expect(b[0]!.ok).toBe(false);
      expect(await readFile(join(ws, "src", "a.ts"), "utf8")).toContain("BROKEN");
      expect(scoreStream(events).outcome).toBe("ended-red");
    },
  );

  it(
    "返修那一轮改完**还是错的** ⇒ 两拍都红，停在 ended-red（钉住第二拍真重读了盘）",
    { timeout: 120_000 },
    async () => {
      // 这一格是反"假绿"的那一半：模型第二轮照样宣称"这回真改完了"，但写的内容仍然没让
      // 验证命令过。若第二拍只是把上一拍的结果抄一遍（或干脆信模型那句话），这里就会绿。
      const { events, ws } = await run({ repair: true, test: GREENER, secondWrite: "STATUS: STILL_BROKEN\n" });
      const b = beats(events);
      expect(b.length, "改了盘 ⇒ 第二拍必须真跑").toBe(2);
      expect(b[0]!.ok).toBe(false);
      expect(b[1]!.ok, "第二拍必须重读盘：还是错的就还是红").toBe(false);
      expect(await readFile(join(ws, "src", "a.ts"), "utf8")).toContain("STILL_BROKEN");
      expect(scoreStream(events).outcome).toBe("ended-red");
    },
  );

  it(
    "验证命令与盘无关地恒绿 ⇒ 第一拍就绿，一次返修都不需要（钉住「翻绿」是返修挣来的）",
    { timeout: 120_000 },
    async () => {
      const { events } = await run({ repair: true, test: ALWAYS_GREEN, secondWrite: "STATUS: BROKEN\n" });
      const b = beats(events);
      expect(b.length).toBe(1);
      expect(b[0]!.ok).toBe(true);
      expect(scoreStream(events).outcome, "恒绿面必须是首验即过，不许被读成返修成功").toBe("green-first-try");
    },
  );
});
