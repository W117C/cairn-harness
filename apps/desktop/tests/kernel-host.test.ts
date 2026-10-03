// kernel-host 纵向装配判卷（headless，可进 CI）：createKernelHost 一个入口装配
// 会话目录 / 记忆家 / settings 存储 / 宿主依赖 / 工具注册 / UI 三通道，再跑一场 demo run。
// demo 通道不拨号不花钱（spec §3.2）：settings provider=demo + M3A_AGENTS_DEMO=1 ⇒
// 主模型走 fixtures/agents/main-demo.jsonl 剧本，spawn 的 worker 走同名剧本（read-worker/slow-worker）。
// M3 T1 起装配面升级为多工作区（workspaces + activeWorkspace）：会话→工作区归属、跨工作区
// 列举/建会话走 sessions.ts root 注入族、漂移检测（外部改动拒绝 run 不静默覆盖）。
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createKernelHost, type KernelHost } from "../src/main/kernel-host";
import { createSession as createSessionInRoot, pathOf } from "../../../src/main/sessions";

const dir = mkdtempSync(join(tmpdir(), "m0-host-"));
const workspace = join(dir, "ws");
const wsA = join(dir, "ws-a");
const wsB = join(dir, "ws-b");
const userData = join(dir, "userData");
mkdirSync(workspace, { recursive: true });
mkdirSync(wsA, { recursive: true });
mkdirSync(wsB, { recursive: true });
// seed settings：provider=demo ⇒ 不拨号不花钱（spec §3.2 / agent-runner resolveRunModel）
mkdirSync(userData, { recursive: true });
writeFileSync(join(userData, "settings.json"), JSON.stringify({ provider: "demo", model: "" }));

// 剧本 env 的外部残留会劫持判卷（M3A_MAIN_SCRIPT 优先级最高；M0A_PROVIDER 强推真 provider 会拨号）——
// 进门前清场，出门后还原（本进程只跑 apps/desktop 自己的套件，还原是礼貌不是必须）。
const ambientKeys = ["M3A_MAIN_SCRIPT", "M0A_PROVIDER", "M0_MODEL", "M0B_WORKSPACE"] as const;
const ambientBackup = ambientKeys.map((k) => [k, process.env[k]] as const);
for (const k of ambientKeys) delete process.env[k];
process.env.M3A_AGENTS_DEMO = "1"; // 脚本化主模型：fixtures/agents/main-demo.jsonl，确定性

const outbox: (readonly [string, unknown])[] = [];
const host: KernelHost = createKernelHost({
  workspaces: [workspace],
  activeWorkspace: workspace,
  userDataDir: userData,
  outbox: (channel, payload) => {
    outbox.push([channel, payload]);
  },
});

afterAll(async () => {
  delete process.env.M3A_AGENTS_DEMO;
  for (const [k, v] of ambientBackup) {
    if (v !== undefined) process.env[k] = v;
  }
});

describe("kernel-host 纵向装配", () => {
  it(
    "run：demo 全链路落事件、会话 JSONL 落 <ws>/.agent/sessions",
    async () => {
      const created = await host.createSession();
      // 会话→工作区归属（M3 T1）：createSession 落 activeWorkspace，run 的工作区由归属表给出
      // （kernel-host 以 over.workspace/logPath 第一优先注入，env/settings 残留够不着）——
      // 判卷工作区钉在本临时目录，不随机器漂。
      const res = await host.run({ message: "跑一遍 demo", mode: "default", sessionId: created.id });
      expect(res.ok, JSON.stringify(res)).toBe(true);
      const events = outbox.filter(([ch]) => ch === "onEvent");
      expect(events.length).toBeGreaterThan(0);
      // M2 悬账承接（终审 Important）：live ts 断言——core 统一盖戳（events/index.ts append
      // 落盘处「盖在事件本身上」）后，outbox 收到的每条 onEvent 载荷 ts 必为 number
      // （管线「先 log.append 后 onEvent」，盖戳先于 onEvent 下游可见）。旧链路生产者零散
      // 自盖，真语料 282 条 tool_call 一条不带 ⇒ 事件时间面不可测；此行钉住统一盖戳不回退。
      expect(events.every(([, p]) => typeof (p as { ts?: number }).ts === "number")).toBe(true);
      // worker 面（M1 账本 T3）：demo 剧本派两个 worker，事件流里应见 spawn 与至少一份终态回执。
      // 断言事件类型在场而非内容形状（worker 报告内容不钉死）。实测（2026-10-03）：
      // agent_spawned ×2；agent_result ×1——read-worker 在 run 窗口内收敛，slow-worker 仍
      // running（剧本末条不调 wait_for_agents，父 run 结束即止）⇒ 断言 ≥1，不钉 ×2。
      // agent_result 晚于 run 收束到达（剧本不 wait_for_agents），故 waitFor 收口。
      expect(outbox.some(([c, p]) => c === "onEvent" && (p as { type?: string }).type === "agent_spawned")).toBe(true);
      await vi.waitFor(
        () => expect(outbox.some(([c, p]) => c === "onEvent" && (p as { type?: string }).type === "agent_result")).toBe(true),
        { timeout: 10_000, interval: 200 },
      );
      expect(existsSync(join(workspace, ".agent", "sessions", `${created.id}.jsonl`))).toBe(true);
    },
    60_000,
  );

  it("decide：未知 askId fail-closed 返回 false", () => {
    expect(host.decide("no-such-ask", true)).toBe(false);
  });

  it("createSession：未注册 workspace 被拒（fail-visible，堵 IPC 任意路径注入面）", async () => {
    // M3 终审（Important）：renderer 可经 IPC 传任意路径建会话——无校验即凭空 mkdir
    // <注入路径>/.agent/sessions。白名单外的路径在 mkdir 之前就被拒（与构造期
    // activeWorkspace 校验同式），盘上不得留任何痕迹。缺省参（落 activeWorkspace）的
    // 正路径已由首例 demo run 覆盖——此处不再另建空会话（会污染 openSession 用例的
    // sessions[0] 取样）。
    const injected = join(dir, "unregistered-ws");
    await expect(host.createSession(injected)).rejects.toThrow(/不在 workspaces/);
    expect(existsSync(injected)).toBe(false);
  });

  it("openSession：能读回刚落的会话", async () => {
    const sessions = await host.listSessions();
    expect(sessions.length).toBeGreaterThan(0);
    const opened = await host.openSession(sessions[0]!.id);
    expect(opened.events.length).toBeGreaterThan(0);
  });
});

describe("M3 多工作区运行面", () => {
  it(
    "多工作区：A/B 两工作区各建会话，run 各落各的根，listSessions 带 workspace 归组",
    async () => {
      // 二次装配覆盖进程级出口（见 kernel-host.ts 头注「最后一个赢」）：本用例在前序用例
      // 全部收束后运行，覆盖 setAppHooks 不影响前序断言。
      const multi = createKernelHost({
        workspaces: [wsA, wsB],
        activeWorkspace: wsA,
        userDataDir: userData,
        outbox: (channel, payload) => {
          outbox.push([channel, payload]);
        },
      });
      const a = await multi.createSession(wsA);
      // createSession 缺省名是时间戳（到分钟），同分钟两根各建 ⇒ id 同名（撞名规避只在各自根内）
      // ⇒ 归属表互相覆盖。重试一次拿撞名后缀「(2)」，让 a/b 的 id 必然可分辨。
      let b = await multi.createSession(wsB);
      if (b.id === a.id) b = await multi.createSession(wsB);
      // run 不带 workspace 产品位：工作区由归属表给出（M3 面的本质断言——各落各的根）
      const ra = await multi.run({ message: "demo", mode: "default", sessionId: a.id });
      expect(ra.ok, JSON.stringify(ra)).toBe(true);
      const rb = await multi.run({ message: "demo", mode: "default", sessionId: b.id });
      expect(rb.ok, JSON.stringify(rb)).toBe(true);
      expect(existsSync(join(wsA, ".agent", "sessions", `${a.id}.jsonl`))).toBe(true);
      expect(existsSync(join(wsB, ".agent", "sessions", `${b.id}.jsonl`))).toBe(true);
      const all = await multi.listSessions();
      // 归组断言用 (id, workspace) 对而非单 find：createSession 缺省名是时间戳（到分钟），
      // 同一分钟在两根各建一条 ⇒ id 相同（撞名检测只在各自根内）⇒ 单 find 恒命中先扫描的 wsA。
      // 语义锚不变：每条会话都带着自己根的 workspace 标记进清单。
      expect(all.some((s) => s.id === a.id && s.workspace === wsA)).toBe(true);
      expect(all.some((s) => s.id === b.id && s.workspace === wsB)).toBe(true);
    },
    60_000,
  );

  it(
    "addWorkspace：动态并入扫描面——新工作区会话立即经 listSessions 出现，重复并入幂等",
    async () => {
      const wsC = join(dir, "ws-c");
      mkdirSync(wsC, { recursive: true });
      const dyn = createKernelHost({
        workspaces: [wsA],
        activeWorkspace: wsA,
        userDataDir: userData,
        outbox: (channel, payload) => {
          outbox.push([channel, payload]);
        },
      });
      // 并入前：扫描面恰为 wsA（T1 装配定态）——wsC 的会话不经本 host 的 listSessions 出现。
      // （M3 终审起 createSession 对未注册工作区 fail-visible——白名单外路径拒绝，本用例的
      // wsC 会话改由 core createSessionInRoot 直接落盘，恰等价 addProject 产品场景：
      // 盘上已有会话的工作区被并入扫描面。）
      const createdId = await createSessionInRoot(join(wsC, ".agent", "sessions"));
      // 断言按 workspace 归属而非按 id 全表查：同进程多 host 实例共享盘上根，秒级时间戳名可跨
      // 实例同名（实例级 owner 表互不知晓，撞名修法保证的是 host 实例级唯一——单 main 进程单
      // host ⇒ 产品语义成立），wsA 根里可能有同名文件。
      expect((await dyn.listSessions()).every((s) => s.workspace === wsA)).toBe(true);
      // 并入（重复两次）：立即出现且恰一条——幂等去重（workspaces 数组被 listSessions 按引用
      // 迭代，重复 push 会逐根扫描两遍、清单出重复条目）。
      dyn.addWorkspace(wsC);
      dyn.addWorkspace(wsC);
      const listed = (await dyn.listSessions()).filter((s) => s.workspace === wsC);
      expect(listed).toHaveLength(1);
      expect(listed[0]!.id).toBe(createdId);
    },
  );

  it(
    "漂移检测：会话文件被外部追加后，下一次 run 被拒且报外部修改",
    async () => {
      const driftHost = createKernelHost({
        workspaces: [wsA],
        activeWorkspace: wsA,
        userDataDir: userData,
        outbox: (channel, payload) => {
          outbox.push([channel, payload]);
        },
      });
      const s = await driftHost.createSession(wsA);
      await driftHost.run({ message: "demo", mode: "default", sessionId: s.id });
      appendFileSync(
        pathOf(join(wsA, ".agent", "sessions"), s.id),
        JSON.stringify({ type: "user_message", content: "CLI 插的" }) + "\n",
      );
      const res = await driftHost.run({ message: "demo", mode: "default", sessionId: s.id });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/外部修改/);
      // 恢复缝：「请刷新后重试」——openSession 重立基线后同一会话可继续 run（外部行不丢，并入基线）。
      // 刷新前先等事件面静默（文件 stat 与 outbox 长度 600ms 不再变化）：本端 worker 子流在父 run
      // 收束后仍会落盘（实测 ≥5s），且同进程其他 host 的同分钟同名会话尾随会抬高归因计数——
      // 静默后刷新，恢复判据才钉在「外部行并入基线」本身而非与尾随写的竞速。
      const sessionFile = pathOf(join(wsA, ".agent", "sessions"), s.id);
      const statQuiet = async (p: string) => {
        try {
          const st = await stat(p);
          return { size: st.size, mtimeMs: st.mtimeMs };
        } catch {
          return { size: -1, mtimeMs: -1 };
        }
      };
      for (let quiet = 0, i = 0; quiet < 1 && i < 20; i++) {
        const before = { len: outbox.length, ...(await statQuiet(sessionFile)) };
        await new Promise((r) => setTimeout(r, 600));
        const after = { len: outbox.length, ...(await statQuiet(sessionFile)) };
        quiet = before.len === after.len && before.size === after.size && before.mtimeMs === after.mtimeMs ? 1 : 0;
      }
      await driftHost.openSession(s.id);
      const retry = await driftHost.run({ message: "demo", mode: "default", sessionId: s.id });
      expect(retry.ok, JSON.stringify(retry)).toBe(true);
    },
    60_000,
  );
});

// ---- M4-5 removeWorkspace 缩面（removeProject 成功后的对称面）----
describe("M4-5 removeWorkspace 缩面", () => {
  it(
    "缩面后该组不再经 listSessions 出现、createSession 白名单收窄；归属表与漂移基线同步清理",
    async () => {
      const wsD = join(dir, "ws-d");
      mkdirSync(wsD, { recursive: true });
      const shrink = createKernelHost({
        workspaces: [wsA],
        activeWorkspace: wsA,
        userDataDir: userData,
        outbox: (channel, payload) => {
          outbox.push([channel, payload]);
        },
      });
      // 并入 → 盘上既有会话（addProject 产品场景：createSessionInRoot 直落，显式名防跨根撞名）→
      // openSession 登记归属＋漂移基线（open 即基线）——缩面清理判据的前提。
      shrink.addWorkspace(wsD);
      const sid = await createSessionInRoot(join(wsD, ".agent", "sessions"), "m4-5 缩面用会话");
      await shrink.openSession(sid);
      expect((await shrink.listSessions()).some((s) => s.id === sid && s.workspace === wsD)).toBe(true);
      // 缩面：清单不再出现该组；createSession 白名单同步收窄（同表驱动，fail-visible）。
      shrink.removeWorkspace(wsD);
      expect((await shrink.listSessions()).every((s) => s.workspace !== wsD)).toBe(true);
      await expect(shrink.createSession(wsD)).rejects.toThrow(/不在 workspaces/);
      // 归属表清理的可观察面：同 id 不再解析到被移除工作区——扫描面已无该根 ⇒ openSession
      // fail-visible「会话不存在」（若归属条目残留，会话仍会经被移除根解析成功）。
      await expect(shrink.openSession(sid)).rejects.toThrow(/会话不存在/);
      // 漂移基线清理的可观察面：缩面期间的外部追加不得误判 drift——基线若残留，重并后的
      // run 会把「外部追加 ≠ 本端事件」判成外部修改拒绝；基线已清 ⇒ 无快照直接放行。
      appendFileSync(
        pathOf(join(wsD, ".agent", "sessions"), sid),
        JSON.stringify({ type: "user_message", content: "CLI 插的" }) + "\n",
      );
      shrink.addWorkspace(wsD);
      const res = await shrink.run({ message: "demo", mode: "default", sessionId: sid });
      expect(res.ok, JSON.stringify(res)).toBe(true);
    },
    60_000,
  );

  it(
    "该组有在跑会话 ⇒ fail-visible 拒绝缩面；run 收束后缩面放行（控制器零残留）",
    async () => {
      const wsE = join(dir, "ws-e");
      mkdirSync(wsE, { recursive: true });
      const busy = createKernelHost({
        workspaces: [wsE],
        activeWorkspace: wsE,
        userDataDir: userData,
        outbox: (channel, payload) => {
          outbox.push([channel, payload]);
        },
      });
      const s = await busy.createSession(wsE);
      // 审批门剧本（M3A_MAIN_SCRIPT 第一优先，approval-e2e 同手法）：run 稳定卡在 run_shell 审批
      // ⇒ per-session AbortController 确定在场——「在跑」判据不靠赶在收束前缩面的竞速。
      process.env.M3A_MAIN_SCRIPT = join(
        dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures", "agents", "main-approval-demo.jsonl",
      );
      try {
        const runP = busy.run({ message: "demo", mode: "default", sessionId: s.id });
        const ask = await vi.waitFor(() => {
          const found = [...outbox]
            .reverse()
            .find(([c, p]) => c === "onAsk" && (p as { tool?: string }).tool === "run_shell");
          expect(found).toBeDefined();
          return found as readonly [string, { askId: string }];
        }, { timeout: 10_000, interval: 100 });
        // 在跑 ⇒ 拒绝缩面（错误点名工作区，不静默）
        expect(() => busy.removeWorkspace(wsE)).toThrow(/正在运行/);
        // 放行 run：批准后剧本跑完，控制器在 run 的 finally 清除
        expect(busy.decide(ask[1].askId, true)).toBe(true);
        const res = await runP;
        expect(res.ok, JSON.stringify(res)).toBe(true);
      } finally {
        delete process.env.M3A_MAIN_SCRIPT;
        void busy.cancel(s.id); // 失败路径兜底：不留悬挂 run（已收束时 {ok:false} 无害）
      }
      // 收束后缩面放行：控制器零残留不再阻断，清单同步收窄。
      expect(() => busy.removeWorkspace(wsE)).not.toThrow();
      expect((await busy.listSessions()).every((x) => x.workspace !== wsE)).toBe(true);
    },
    60_000,
  );
});
