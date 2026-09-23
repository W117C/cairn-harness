// `autoVerifyRepair` 的**生产入口那一腿**：设置盘上的键必须真能走到 runLoop。
//
// 为什么单开一份：上一轮那 7 条全部从 `runLoop` 直接进（自己传 opts），所以
// `agent-runner.ts` 里这句 `autoVerifyRepair: (await store().get()).autoVerifyRepair`
// **整行换成 `false`，一条用例都不会红**——这正是本仓点过 13 次名的「两头断」：
// 机器建好、线接上、但生产那一段没有观测者（`tests/impact-runner-wiring.test.ts` 第四环
// 当初就是为同一件事立的，形状这里照抄：overrides 一个都不给，只写 settings.json）。
//
// 判据形态：只数**看得见的后果**——收束闸拍了几次、模型真被多要了几轮。
// 盘上 `autoVerifyRepair:true` ⇒ 两拍 + 第二次写盘；不写（缺省关）⇒ 一拍 + 一次写盘。
// 反向一侧（缺省关那一格）不是装饰：少了它，"永远开" 也能全绿。
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { handleAgentRun, initSettingsStore } from "../src/main/agent-runner";
import type { AgentEvent } from "../src/events";

const dirs: string[] = [];
afterAll(async () => {
  delete process.env.M3A_MAIN_SCRIPT;
  for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
});

/** 走生产入口跑一轮：模型 = `M3A_MAIN_SCRIPT` 剧本，验证面 = 目标仓 .agent/config.json 的 verify.test。 */
async function runViaProduction(settingsRaw: Record<string, unknown>): Promise<AgentEvent[]> {
  const home = await mkdtemp(join(tmpdir(), "av-repair-runner-"));
  const ws = await mkdtemp(join(tmpdir(), "av-repair-ws-"));
  dirs.push(home, ws);
  initSettingsStore(join(home, "settings.json"));
  await writeFile(join(home, "settings.json"), JSON.stringify(settingsRaw), "utf8");
  await mkdir(join(ws, ".agent"), { recursive: true });
  // 批条必须在场：auto + 无人值守 + 无批条 ⇒ 权限门先拒写，那一拍**正确地**不发生，
  // 于是"只拍一次"可以被"根本没写盘"满足（同 auto-verify-wiring ② 与影响面第四环的教训）。
  await writeFile(
    join(ws, ".agent", "permissions.json"),
    JSON.stringify({ rules: [{ behavior: "allow", tool: "write_file", scope: "always" }] }),
    "utf8",
  );
  // 一个**必失败**的验证面：返修那一支只认代码红，所以这里不能是"没得验"（那会被归成因 no-surface 而整段跳过）。
  await writeFile(
    join(ws, ".agent", "config.json"),
    JSON.stringify({ verify: { test: ["echo 'FAIL: 断言不过' && exit 1"] } }),
    "utf8",
  );
  const script = join(home, "main.jsonl");
  // 剧本 = 四轮（`round_end` 是装配期哨兵，见 `src/providers/mock.ts`）：
  //   ① 写一笔 + 「改完了」 →（收轮）② 「还在红，再改一处」＝没调工具的中间轮 ⇒ 收束闸补第一拍，红 →（收轮）
  //   ③ 第二笔写盘 + 「这回真改完了」 →（收轮）④ 空轮 ⇒ 第二拍
  // ON 与 OFF 的分歧只在 ③④ 那两轮：不开返修时，第一拍红完就直接 return，③ 根本不会被要到。
  await writeFile(
    script,
    [
      { type: "tool_call", id: "w1", name: "write_file", args: { path: "src/a.ts", content: "x" } },
      { type: "assistant_message", content: "改完了。" },
      { type: "round_end" },
      { type: "assistant_message", content: "还在红，我再改一处。" },
      { type: "round_end" },
      { type: "tool_call", id: "w2", name: "write_file", args: { path: "src/fix.ts", content: "y" } },
      { type: "assistant_message", content: "这回真改完了。" },
    ].map((o) => JSON.stringify(o)).join("\n") + "\n",
    "utf8",
  );
  process.env.M3A_MAIN_SCRIPT = script;
  const seen: AgentEvent[] = [];
  const res = await handleAgentRun(
    { message: "修那个失败的测试", mode: "auto" },
    { workspace: ws, logPath: join(home, "events.jsonl"), unattended: true, onEvent: (e) => { seen.push(e); } },
  );
  expect(res.ok, JSON.stringify(res)).toBe(true);
  // 前置自检：写盘真成功过。少了它，"一拍"可以是"根本没写"（那条假绿的形状本仓栽过两次）。
  expect(successfulWrites(seen).length, "写工具没成功 ⇒ 这两格都测不到收束闸").toBeGreaterThanOrEqual(1);
  return seen;
}

const countBeats = (events: AgentEvent[]): number => events.filter((e) => e.type === "verify_result").length;
const countAutoBeats = (events: AgentEvent[]): number =>
  events.filter((e) => e.type === "verify_result" && (e as { auto?: boolean }).auto === true).length;
/** 成功落盘的 write_file 次数：按 callId 配 tool_call 的名字（tool_result 自己不带工具名）。 */
const successfulWrites = (events: AgentEvent[]): AgentEvent[] => {
  const nameByCall = new Map<string, string>();
  for (const e of events) if (e.type === "tool_call") nameByCall.set(e.id, e.name);
  return events.filter((e) => e.type === "tool_result" && e.ok && nameByCall.get(e.callId) === "write_file");
};

describe("返修开关的 runner 那一腿：只写 settings.json 也真能走到 runLoop", () => {
  it(
    "开（只写进 settings.json，overrides 一律不给）：红拍之后真多要一轮并再验一拍",
    { timeout: 300_000 },
    async () => {
      const events = await runViaProduction({ autoVerifyRepair: true });
      const beats = countAutoBeats(events);
      expect(beats, "设置里的 true 没穿到 runLoop ⇒ 盘上那个键是空的（自动拍只落了一次）").toBe(2);
      expect(countBeats(events)).toBe(2);
      // 多出来的那一拍必须对应「模型真的又被要了一轮并动了手」，不是同一拍的重复计数。
      expect(successfulWrites(events).length, "第二拍前没有第二次成功写盘 ⇒ 那一轮根本没去修").toBe(2);
      expect(
        events.filter((e) => e.type === "verify_result").every((e) => (e as { ok?: boolean }).ok === false),
        "这个验证面本就设计成必失败；出了绿拍说明测的根本不是那条路",
      ).toBe(true);
    },
  );

  it(
    "关（盘上没这个键 = 缺省）：同一个生产入口只拍一次，多出来的那一轮不发生",
    { timeout: 300_000 },
    async () => {
      const events = await runViaProduction({});
      expect(countAutoBeats(events), "缺省就该与今日同形：一拍。红了两边说明这格没有分辨力").toBe(1);
      expect(countBeats(events)).toBe(1);
      // 反向一侧同刻度：剧本里那第二笔写盘根本没被要到（第一拍红完直接收束）。
      expect(successfulWrites(events).length, "缺省关却出现第二次写盘 ⇒ 返修那一轮被无条件要了").toBe(1);
    },
  );
});
