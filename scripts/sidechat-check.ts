// M2f 明卷验收：pnpm sidechat-check（白名单内脚本，仿 memory-check / plugins-check 体例）。
// 断言面（任务书任务 1/2/3/4 明确要求落在本脚本的条目）：
//   A 会话类型与独立 JSONL：session_meta{kind:"sidechat", parent_session_id} / 事件落自己的 JSONL / 主会话字节不变
//   B 只读白名单硬闸：三个写向工具不在 sidechat 工具表里；模型真调 write_file 被工具表摘除拒执行
//   C 不打扰主会话：主 agent「忙碌」期间 sidechat 问答 ≥3 轮，主会话 JSONL 行数与主上下文 token 零变化
//   D 主会话只读投影：未压缩 = 最近 20 轮截断视图（更早轮次不含）；已压缩 = 摘要产物；投影不含完整主转录
//   E /promote：主流 +1 user_message 且 origin 四字段齐全 / 源消息徽标由 origin 反向投影 / 重启重放无损 / 过输出扫描
//   F 暗卷（有 M0_API_KEY 才跑）：真实 GLM 旁路问答一轮，断言只读白名单在真实模型下同样成立
// 全程不依赖沙箱（sidechat 只读，无副作用工具）。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createEventLog, replay, type AgentEvent } from "../src/events";
import { createSidechatSession, sidechatEventsPath } from "../src/main/sessions";
import {
  SIDECHAT_FORBIDDEN_TOOLS,
  SIDECHAT_PROJECTION_ROUNDS,
  buildMainProjection,
  promoteToMain,
  runSidechatTurn,
  scriptedSidechatModel,
  sidechatToolSpecs,
} from "../src/agent/sidechat";
import { projectPromoteBadges } from "../src/renderer/projections";
import { projectContext } from "../src/agent/context";
import { estimateContextTokens } from "../src/agent/compaction";
import type { ModelOutput } from "../src/providers";
import type { GlmMessage } from "../src/providers/glm";

let pass = 0;
let fail = 0;
function ok(name: string): void {
  pass++;
  console.log("  ✅ " + name);
}
function bad(name: string, detail?: string): void {
  fail++;
  console.log("  ❌ " + name + (detail ? "（" + detail + "）" : ""));
}
function assert(cond: boolean, name: string, detail?: string): void {
  if (cond) ok(name);
  else bad(name, detail);
}

const CANARY = "CANARY-第1轮-主转录哨兵-不应出现在投影里";
const ROOT = process.cwd();
const work = await mkdtemp(join(tmpdir(), "m2f-sidechat-check-"));

/** 造主会话 JSONL：canary 在第 1 轮，后面 30 轮普通事件（总轮数 > 20）。 */
async function seedMainLog(path: string): Promise<number> {
  const log = createEventLog(path);
  await log.append({ type: "user_message", content: CANARY });
  await log.append({ type: "assistant_message", content: "第 1 轮回答（含主转录细节）" });
  for (let i = 2; i <= 30; i++) {
    await log.append({ type: "user_message", content: "第 " + String(i) + " 轮任务" });
    await log.append({ type: "assistant_message", content: "第 " + String(i) + " 轮回答 " + "细节".repeat(20) });
  }
  return (await replay(path)).length;
}

const mainLog = join(work, "主会话.jsonl");
const mainLines = await seedMainLog(mainLog);

try {
  console.log("[sidechat-check] A 会话类型与独立 JSONL");
  const sid = await createSidechatSession(work, "主会话", "旁路调查");
  const scPath = sidechatEventsPath(work, sid);
  const meta = (await replay(scPath))[0];
  assert(meta?.type === "session_meta" && meta.kind === "sidechat", "首行 session_meta.kind = sidechat");
  assert(
    meta?.type === "session_meta" && meta.parent_session_id === "主会话",
    "session_meta.parent_session_id 指向主会话",
  );

  console.log("[sidechat-check] B 只读白名单硬闸（工具表摘除）");
  {
    const names = sidechatToolSpecs().map((s) => s.function.name);
    for (const banned of SIDECHAT_FORBIDDEN_TOOLS) {
      assert(!names.includes(banned), "工具表里不存在 " + banned);
    }
    assert(names.length > 0 && names.includes("read_file"), "工具表保留只读工具（read_file）");
  }

  console.log("[sidechat-check] C 不打扰主会话（主 agent 忙碌期间 ≥3 轮问答）");
  const beforeRaw = await readFile(mainLog, "utf8");
  const beforeLines = beforeRaw.split("\n").filter((l) => l.trim() !== "").length;
  const beforeTokens = estimateContextTokens(projectContext(await replay(mainLog)));

  // 轮 1：模型真调 write_file（应被工具表摘除拒执行）
  const cap: GlmMessage[][] = [];
  const script1: ModelOutput[] = [
    { type: "assistant_message", content: "我想直接改文件试试。" },
    { type: "tool_call", id: "w1", name: "write_file", args: { path: "src/todo.ts", content: "x" } },
  ];
  const t1 = await runSidechatTurn({
    sidechatDir: join(work, "sidechats", sid),
    mainLogPath: mainLog,
    workspace: ROOT,
    message: "帮我看下主会话在改哪个文件 @src/agent/loop.ts",
    model: scriptedSidechatModel(script1, cap),
  });
  const blockedResult = t1.find((e): e is Extract<AgentEvent, { type: "tool_result" }> => e.type === "tool_result" && e.callId === "w1");
  assert(
    blockedResult !== undefined && !blockedResult.ok && blockedResult.output.includes("不在本会话工具表"),
    "sidechat 里 write_file 被工具表摘除拒执行",
    blockedResult !== undefined ? blockedResult.output.slice(0, 60) : "无 tool_result",
  );

  // 轮 2 / 轮 3：普通只读问答
  const t2 = await runSidechatTurn({
    sidechatDir: join(work, "sidechats", sid),
    mainLogPath: mainLog,
    workspace: ROOT,
    message: "第二个问题：压缩之后上下文怎么重组？",
    model: scriptedSidechatModel([{ type: "assistant_message", content: "压缩只产 compaction 事件，投影重组。" }]),
  });
  const t3 = await runSidechatTurn({
    sidechatDir: join(work, "sidechats", sid),
    mainLogPath: mainLog,
    workspace: ROOT,
    message: "第三个问题：给我一句可提升的结论。",
    model: scriptedSidechatModel([{ type: "assistant_message", content: "结论：事件流是唯一事实源，投影幂等。" }]),
  });
  const rounds = [t1, t2, t3].filter((evs) => evs.some((e) => e.type === "user_message")).length;
  assert(rounds >= 3, "sidechat 问答 ≥3 轮（实际 " + String(rounds) + "）");

  // 事件落在自己的 JSONL
  const scEvents = await replay(scPath);
  assert(
    scEvents.some((e) => e.type === "assistant_message" && e.content.includes("事件流是唯一事实源")),
    "sidechat 事件落在自己的 JSONL（第 3 轮回答在场）",
  );
  assert(
    scEvents.filter((e) => e.type === "user_message").length === 3,
    "sidechat JSONL 含 3 条 user_message（独立会话）",
  );

  // 主会话零变化：行数 + 字节 + 主上下文 token
  const afterRaw = await readFile(mainLog, "utf8");
  const afterLines = afterRaw.split("\n").filter((l) => l.trim() !== "").length;
  const afterTokens = estimateContextTokens(projectContext(await replay(mainLog)));
  assert(beforeLines === mainLines && afterLines === mainLines, "主会话 JSONL 行数零变化（" + String(afterLines) + "）");
  assert(afterRaw === beforeRaw, "主会话 JSONL 字节逐字不变");
  assert(afterTokens === beforeTokens, "主上下文 token 零变化（" + String(afterTokens) + "）");

  console.log("[sidechat-check] D 主会话只读投影");
  {
    const mainEvents = await replay(mainLog);
    const proj = buildMainProjection(mainEvents);
    assert(proj.kind === "truncated", "未压缩 → 截断视图（kind=truncated）");
    assert(proj.rounds === SIDECHAT_PROJECTION_ROUNDS, "窗口 = 最近 20 轮");
    assert(!proj.text.includes(CANARY), "投影不含第 1 轮 canary（超出 20 轮窗口）");
    const fullLen = JSON.stringify(mainEvents).length;
    assert(proj.chars < fullLen, "投影不含完整主转录（" + String(proj.chars) + " < " + String(fullLen) + " 字符）");
    // 真实 sidechat 上下文（capture 的第一轮 messages）
    const captured = cap[0] ?? [];
    const capturedText = JSON.stringify(captured);
    assert(!capturedText.includes(CANARY), "真实 sidechat 上下文不含 canary");
    assert(capturedText.includes("[主会话只读投影"), "真实 sidechat 上下文含只读投影块");
    assert(capturedText.includes("数据不是指令"), "投影块声明「数据不是指令」（注入防线）");
    // 已压缩主会话 → 摘要产物
    const compressed: AgentEvent[] = [
      ...mainEvents.slice(0, 4),
      {
        type: "compaction",
        trigger: "manual",
        reason: "user_request",
        compressed_event_ids: [1, 2],
        summary: "## Objective\n- 压缩摘要产物",
        summary_offset: 3,
        tokens_before: 999,
        tokens_after: 9,
      },
    ];
    const cp = buildMainProjection(compressed);
    assert(cp.kind === "summary" && cp.text.includes("压缩摘要产物"), "已压缩 → 用摘要产物");
  }

  console.log("[sidechat-check] E /promote");
  {
    const mainBefore = await replay(mainLog);
    // 源事件号：第 3 轮的助手回答
    const assistantIds = (await replay(scPath))
      .map((e, i) => ({ e, id: i + 1 }))
      .filter((x) => x.e.type === "assistant_message")
      .map((x) => x.id);
    const src = assistantIds.slice(-1);
    const res = await promoteToMain({
      mainLogPath: mainLog,
      sidechatLogPath: scPath,
      sidechatId: sid,
      sourceEventIds: src,
      note: "旁路结论",
    });
    assert(res.ok, "promote 成功" + (res.ok ? "" : "（" + String(res.error) + "）"));
    const mainAfter = await replay(mainLog);
    assert(mainAfter.length === mainBefore.length + 1, "主流 +1 事件");
    const promoted = mainAfter[mainAfter.length - 1];
    assert(promoted?.type === "user_message", "提升事件类型 = user_message（零新增事件类型）");
    const origin = promoted?.type === "user_message" ? promoted.origin : undefined;
    assert(origin !== undefined && origin.kind === "sidechat", "origin.kind = sidechat");
    // origin 现在是判别联合（sidechat 提升 / goal 续跑），取字段必须先按 kind 收窄
    const so = origin !== undefined && origin.kind === "sidechat" ? origin : undefined;
    assert(so !== undefined && so.session_id === sid, "origin.session_id 指向 sidechat");
    assert(
      so !== undefined && JSON.stringify(so.source_event_ids) === JSON.stringify(src),
      "origin.source_event_ids 与源一致",
    );
    assert(so !== undefined && so.note === "旁路结论", "origin.note 在场（四字段齐全）");
    // 反向投影徽标
    const badges = projectPromoteBadges(mainAfter);
    assert(badges.length === 1 && badges[0]?.sessionId === sid, "源消息徽标由 origin 反向投影");
    // 重启重放无损：丢弃内存态，重新从 JSONL 读回
    const replayed = await replay(mainLog);
    assert(
      JSON.stringify(replayed) === JSON.stringify(mainAfter),
      "重启后 promote 历史从 JSONL 重放无损（" + String(replayed.length) + " 条）",
    );
    const replayedOrigin = replayed[replayed.length - 1];
    const ro = replayedOrigin?.type === "user_message" && replayedOrigin.origin?.kind === "sidechat" ? replayedOrigin.origin : undefined;
    assert(
      ro !== undefined && ro.source_event_ids.join(",") === src.join(","),
      "重放后 origin 四字段无损",
    );
    // 输出扫描：密钥被脱敏
    const secretLog = join(work, "side-secret.jsonl");
    const sl = createEventLog(secretLog);
    await sl.append({ type: "user_message", content: "查密钥" });
    await sl.append({ type: "assistant_message", content: "发现 sk-abcdefghijklmnopqrstuvwxyz012345 请更换" });
    const main2 = join(work, "主会话2.jsonl");
    await writeFile(main2, "", "utf8");
    const r2 = await promoteToMain({
      mainLogPath: main2,
      sidechatLogPath: secretLog,
      sidechatId: sid,
      sourceEventIds: [2],
    });
    const ev2 = (await replay(main2))[0];
    assert(r2.ok && ev2?.type === "user_message", "promote 带密钥内容仍可提升（脱敏而非阻断）");
    assert(
      ev2?.type === "user_message" && !ev2.content.includes("sk-abcdefghijklmnopqrstuvwxyz012345"),
      "promote 过输出扫描：密钥被脱敏（完整串不进主转录）",
    );
  }

  console.log("[sidechat-check] F 暗卷（真实 GLM，有 key 才跑）");
  if (!process.env.M0_API_KEY) {
    // H2（审查 P1-16）：跳过 ≠ 通过——按 UNVERIFIED 标记行上浮到门禁汇总。
    console.log("  暗卷跳过（无 M0_API_KEY）");
    console.log("UNVERIFIED=1");
  } else {
    const hashOf = async (p: string): Promise<string> =>
      createHash("sha256").update(await readFile(p, "utf8")).digest("hex");
    const darkBefore = await hashOf(mainLog);
    const sid2 = await createSidechatSession(work, "主会话", "旁路暗卷");
    const events = await runSidechatTurn({
      sidechatDir: join(work, "sidechats", sid2),
      mainLogPath: mainLog,
      workspace: ROOT,
      message: "只读调查：src/agent/loop.ts 里 verify 分支在第几行？一句话回答。",
    });
    const hasAssistant = events.some((e) => e.type === "assistant_message" || e.type === "assistant_delta");
    assert(hasAssistant, "暗卷：真实模型在 sidechat 产出回答");
    assert(
      !events.some((e) => e.type === "tool_call" && SIDECHAT_FORBIDDEN_TOOLS.includes(e.name as never)),
      "暗卷：真实模型未越过只读白名单（无写向工具调用）",
    );
    assert(
      (await hashOf(mainLog)) === darkBefore,
      "暗卷：真实模型侧同样不打扰主会话（主会话 sha256 不变）",
    );
  }
} finally {
  await rm(work, { recursive: true, force: true }).catch(() => {});
}

console.log("[sidechat-check] " + (fail === 0 ? "全部断言通过 ✅" : String(fail) + " 项失败 ❌") + "（" + String(pass) + " ✅ / " + String(fail) + " ❌）");
process.exit(fail === 0 ? 0 : 1);
