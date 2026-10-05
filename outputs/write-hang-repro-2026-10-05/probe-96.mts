// #96 排障探针（一次性取数，不是判卷）：交互档 run 的写向「无回执即悬挂」到底停在哪一环。
// 用法：node --import tsx outputs/write-hang-repro-2026-10-05/probe-96.mts <arm>
// 零 src 改动：所有观测点都是 agent-runner 已导出的公开缝（setAppHooks / handleAgentDecide /
// initSandbox / handleAgentRun）＋ permissions 的纯函数 evaluate，不打补丁、不改文件。
//
// 臂位：
//   A-nopump     复刻台账 #96 的形状：unattended:false + mode:auto + 一次 write_file，无应答人
//   A-full60     同 A-nopump，但看到 66s（跨过 AskGate 的 60s 缺省看门狗）——量「有没有超时」
//   B-hookonly   只注册 onAsk（打印卡片、不作答）——量「没打印 ASK」是不是等于「没到门」
//   C-approve    onAsk 里 handleAgentDecide(approve) ——量「悬挂是否恰好等于那张没人接的卡」
//   C-reject     onAsk 里 handleAgentDecide(reject)
//   D-initsandbox 先跑生产装配里的 initSandbox()，再走 A-nopump ——量「ask 是谁武装的」
//   E-unattended 台账里 8ms 收束那条基线（unattended:true）
//   F-injected   复刻旧探针臂 E：把 askGate 塞进 handleAgentRun 的第二参，看它被不被调用
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  handleAgentRun, handleAgentDecide, handleRunCancel, initSessionsDir, initSettingsStore, initSandbox, setAppHooks,
} from "../../src/main/agent-runner";
import { pathOf } from "../../src/main/sessions";
import { evaluate, newAutonomySession, type PermissionMode } from "../../src/permissions";

const arm = process.argv[2] ?? "A-nopump";
const root = await mkdtemp(join(tmpdir(), "dsh-96-probe-"));
process.env.PI_SCRATCH_DIR = join(root, "scratch");
process.env.M7_IMPACT_TAGS_DIR = join(root, "impact-tags");
await mkdir(process.env.PI_SCRATCH_DIR, { recursive: true });
await mkdir(process.env.M7_IMPACT_TAGS_DIR, { recursive: true });

const workspace = join(root, "ws");
const sessions = join(root, "sessions");
const scriptPath = join(root, "script.jsonl");
await mkdir(workspace, { recursive: true });
await mkdir(sessions, { recursive: true });
initSessionsDir(sessions);
initSettingsStore(join(root, "settings.json"));
await writeFile(scriptPath,
  '{"type":"tool_call","id":"w1","name":"write_file","args":{"path":"probe-write.ts","content":"export const x = 1;\\n"}}\n' +
  '{"type":"assistant_message","content":"写完了。"}\n', "utf8");
process.env.M3A_MAIN_SCRIPT = scriptPath;

const t0 = Date.now();
const at = (): string => String(Date.now() - t0) + "ms";
let last = "<none>";
const say = (line: string): void => { console.log(line); };

// —— 纯函数读数（不跑 run，先量「自主档 + 沙箱三态」这一格 evaluate 判什么）——
if (arm === "G-evaluate") {
  const args = { path: "probe-write.ts", content: "export const x = 1;\n" };
  for (const mode of ["default", "auto"] as PermissionMode[]) {
    for (const sb of [false, null, true] as Array<boolean | null>) {
      const d = evaluate("write_file", args, newAutonomySession(mode, { sandboxAvailable: sb }));
      say("evaluate mode=" + mode + " sandboxAvailable=" + String(sb) + " => verdict=" + d.verdict +
        " layer=" + d.layer + " risk=" + String((d as { risk?: string }).risk ?? "-") +
        " reason=" + String((d as { reason?: string }).reason ?? "-"));
    }
  }
  process.exit(0);
}

const answerer = arm === "C-approve" || arm === "C-reject";
const hookOnly = arm === "B-hookonly" || answerer || arm === "F-injected";
if (hookOnly) {
  setAppHooks({
    onAsk: (req) => {
      say("ASK " + at() + " tool=" + req.tool + " askId=" + req.askId +
        " risk=" + String(req.risk) + " reason=" + String(req.reason));
      if (arm === "C-approve") handleAgentDecide(req.askId, true);
      if (arm === "C-reject") handleAgentDecide(req.askId, false);
    },
    onAskOutcome: (p) => say("ASK_OUTCOME " + at() + " " + p.outcome + "/" + p.reason),
  });
}

if (arm === "D-initsandbox") {
  const sb = await initSandbox();
  say("INIT_SANDBOX " + at() + " available=" + String(sb.available) + " reason=" + String(sb.reason ?? ""));
}

const stallBudgetMs = arm === "A-full60" ? 75_000 : 8_000;
const watchdog = setTimeout(() => {
  say("STALLED " + at() + " 最后事件=" + last + " 臂=" + arm + "（无回执）");
  process.exit(7);
}, stallBudgetMs);

// 臂 H：无应答人，2s 后经生产取消入口 handleRunCancel()（IPC agent:run-cancel 那条）收场
// ——量「这扇 60s 等待能不能被打断」。
if (arm === "H-cancel") {
  setTimeout(() => { say("CANCEL " + at() + " " + JSON.stringify(handleRunCancel())); }, 2_000);
}

const sessionId = "s-96";
const res = await handleAgentRun(
  { message: "写个文件", mode: "auto", sessionId },
  {
    workspace, sessionId, logPath: pathOf(sessions, sessionId),
    unattended: arm === "E-unattended",
    planRequired: false,
    // 旧探针臂 E 的形状：这键在 RunOverrides 上根本不存在，运行时会怎样？
    ...(arm === "F-injected" ? { askGate: { request: async () => ({ outcome: "approved", scope: "once" }) } } : {}),
    onEvent: (e) => {
      last = e.type + (e.type === "tool_result"
        ? ":ok=" + String((e as unknown as { ok?: boolean }).ok) +
          ":gate=" + JSON.stringify((e as unknown as { gate?: { verdict?: string; layer?: string } }).gate ?? null) +
          ":blockedBy=" + String((e as unknown as { blockedBy?: string }).blockedBy ?? "-")
        : "");
      say("EVENT " + at() + " " + last);
    },
  },
);
clearTimeout(watchdog);
say("RESULT " + at() + " " + JSON.stringify(res));
process.exit(0);
