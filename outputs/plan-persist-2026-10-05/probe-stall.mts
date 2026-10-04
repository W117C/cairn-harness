// #84 排障探针（不是判卷，是一次性取数）：写成功之后那一拍到底卡在哪一环。
// 用法：node --import tsx outputs/plan-persist-2026-10-05/probe-stall.mts
// 打印每个事件到达的相对毫秒；20s 不收束就点名「最后一个事件是什么」再退出（退 7）。
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleAgentRun, initSessionsDir, initSettingsStore, setSettings } from "../../src/main/agent-runner";
import { pathOf } from "../../src/main/sessions";

const root = await mkdtemp(join(tmpdir(), "dsh-stall-probe-"));
const workspace = join(root, "ws");
const sessions = join(root, "sessions");
const scriptPath = join(root, "script.jsonl");
const settingsPath = join(root, "settings.json");
await mkdir(workspace, { recursive: true });
await mkdir(sessions, { recursive: true });
initSessionsDir(sessions);
initSettingsStore(settingsPath);
await writeFile(scriptPath,
  '{"type":"tool_call","id":"w1","name":"write_file","args":{"path":"probe-write.ts","content":"export const x = 1;\\n"}}\n' +
  '{"type":"assistant_message","content":"写完了。"}\n', "utf8");
process.env.M3A_MAIN_SCRIPT = scriptPath;

const mode = process.argv[2] ?? "auto-interactive";
if (mode === "auto-interactive-nomemory") await setSettings({ autoMemory: false });

const t0 = Date.now();
let last = "<none>";
const logPath = pathOf(sessions, "s-probe");
const watchdog = setTimeout(() => {
  console.log("STALLED 最后事件=" + last + " 已等 " + String(Date.now() - t0) + "ms");
  process.exit(7);
}, 20_000);

const res = await handleAgentRun(
  { message: "写个文件", mode: "auto", sessionId: "s-probe" },
  {
    workspace, sessionId: "s-probe", logPath,
    unattended: mode.startsWith("unattended"),
    planRequired: false,
    // 臂 E：给一个「立刻批准」的 askGate，用来回答两件事——
    // ① 写向在自主档为什么会被判 ask（把 reason/risk 打出来）；② 悬挂是不是卡在审批卡没人接。
    ...(mode === "auto-interactive-gate" ? {
      askGate: {
        request: async (tool: string, _args: unknown, o: { reason?: string; risk?: string }) => {
          console.log("ASK " + tool + " risk=" + String(o.risk) + " reason=" + String(o.reason));
          return { outcome: "approved" as const, scope: "once" as const };
        },
        resolve: () => true,
        pendingIds: [],
      },
    } : {}),
    onEvent: (e) => {
      last = e.type + (e.type === "tool_result" ? ":ok=" + String((e as { ok?: boolean }).ok) : "");
      console.log(String(Date.now() - t0) + "ms " + last);
    },
  },
);
clearTimeout(watchdog);
console.log("RESULT " + String(Date.now() - t0) + "ms " + JSON.stringify(res));
process.exit(0);
