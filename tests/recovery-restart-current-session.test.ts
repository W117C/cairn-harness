// 判卷 · 崩溃恢复重派的**真·重启**那一支：会话日志只能从设置盘里已持久化的 `currentSession` 找。
//
// 为什么单独一份文件（而不是并到 `tests/recovery-parent-mode.test.ts` 里）：
// vitest 按文件隔离模块状态，而 `lastLogPath` 是 agent-runner 的模块级内存态。
// 同一文件里先跑过一轮 run，`lastLogPath` 就非空 ⇒ 这一格即使**不**读 `currentSession` 也能蒙对，
// 判据当场失去分辨力。本文件从头到尾不调 `handleAgentRun` ⇒ `lastLogPath` 必为 null，
// 「只有 currentSession 撑得住」才是被证出来的，不是被假设出来的。
//
// 这也是能力 49 那处修复的另一半：重启后三个内存态（session / activeOrchestrator / lastLogPath）全归零，
// 少这一支，恢复卡的「重派」在真重启后依旧点不动。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { initSettingsStore, handleCardAction } from "../src/main/agent-runner";
import { initSessionsDir } from "../src/main/session-handlers";
import { pathOf } from "../src/main/sessions";

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
});

describe("真重启形状：只有设置盘里的 currentSession，没有本进程跑过任何 run", () => {
  it(
    "会话留痕是 read-only + 设置盘默认 auto ⇒ 重派 write worker 被拒（拒因点名 read-only）",
    { timeout: 120_000 },
    async () => {
      const home = await mkdtemp(join(tmpdir(), "rec-restart-"));
      dirs.push(home);
      const sessionsDir = join(home, "sessions");
      await mkdir(sessionsDir, { recursive: true });
      initSessionsDir(sessionsDir);
      initSettingsStore(join(home, "settings.json"));
      await writeFile(
        join(home, "settings.json"),
        JSON.stringify({ mode: "auto", currentSession: "s-restart" }),
        "utf8",
      );
      // 这条会话崩溃前的现场：一次 read-only 档的权限判定留痕（门直接把写盘拒了）。
      await writeFile(
        pathOf(sessionsDir, "s-restart"),
        [
          { type: "user_message", content: "只读调研一下" },
          {
            type: "tool_result", callId: "w1", ok: false, output: "[gate] read-only 档拒绝",
            gate: { layer: "L2-risk", verdict: "denied", mode: "read-only" },
          },
        ].map((e) => JSON.stringify(e)).join("\n") + "\n",
        "utf8",
      );

      const res = await handleCardAction({
        cardId: "recovery-card-1", sourceEventId: 1,
        action: "respawn", cardType: "agent_result",
        payload: { respawn: { mode: "write", task: "把那个 bug 修了" } },
      });
      expect(res.ok, "重派被放行 ⇒ 会话档位没从 currentSession 那条日志里读回来").toBe(false);
      // 两向都钉：报「无可用事件管线」/「无可用会话日志」= 那一支根本没接通；报别的 = 档位读错了。
      expect(res.error, "拒因不是「read-only 父不得派 write」这一道闸").toContain("read-only");
    },
  );
});
