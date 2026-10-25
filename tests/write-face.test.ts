// 「这次调用会不会改盘」——收成一份判据（任务 #23）。
//
// 现状（本轮逐条读到，四份清单已经各自漂移）：
//   ⑴ `src/permissions/autonomy.ts` 的 `SIDE_EFFECT_TOOLS` = write_file, edit_file, **run_shell, shell_rw**, spawn_agent
//      ——权限门这一份是**认得 shell 会写盘**的（注释原文：「shell_rw 可执行任意非 git 命令，必须计入写向」）。
//   ⑵ `src/agent/loop.ts` 收束闸的触发条件却是内联两支：`name === "write_file" || name === "edit_file"`。
//   ⑶ `src/agent/worker-report.ts` 的 `WRITE_TOOLS` 同样只有两支（还自称「与 spec 同源」）。
//   ⑷ `src/agent/no-progress.ts` 那一份有五个名字（含 apply_patch/delete_file/move_file）——第四份，又一副样子。
// 后果两条，都在能力 5 的正中央：
//   A. 改动**只经 shell** 落盘 ⇒ 收束闸永不补拍 ⇒ 回程 `artifacts.verified` 恒 `absent`：
//      「写过盘必须留验证证据」这条在 shell 这条路是空的（gate 认它写、闸不认）。
//   B. 绿拍**之后**再用 shell 改盘 ⇒ `lastWrite` 不动 ⇒ 证据仍是 `verified`：
//      即将合并的代码不是被验过的那份 —— 这是能力 5 最忌的**假绿**，比漏拍更贵。
// 修法不另立第五张表：写向那半边复用权限门的 `isWriteCall`（MCP 走注解、fail-closed），
// shell 那半边复用执行面已在用的 `isReadOnlyShellCommand`（同一份白名单 + 写面元字符一票否决）。
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mayHaveWrittenDisk } from "../src/agent/write-face";
import { hasSessionWrites, workerVerificationEvidence } from "../src/agent/worker-report";
import { runLoop } from "../src/agent/loop";
import { TOOLS } from "../src/tools";
import { shell_ro } from "../src/agent/worker-shell-tools";
import type { AgentEvent } from "../src/events";
import type { ProviderMessage } from "../src/providers";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const shellCall = (id: string, name: string, command: string): AgentEvent => ({
  type: "tool_call",
  id,
  name,
  args: { command },
});
const okResult = (id: string): AgentEvent => ({ type: "tool_result", callId: id, ok: true, output: "done" });
const beat = (ok: boolean): AgentEvent => ({ type: "verify_result", callId: "v", ok, attempt: 1, maxAttempts: 3, results: [] });
const writePair = (id: string): AgentEvent[] => [
  { type: "tool_call", id, name: "write_file", args: { path: "a.ts" } },
  okResult(id),
];
/** 动作融合：写已落盘，随后 lint 红 ⇒ 工具 ok:false，但结构字段 fusedWrite 为真。 */
const fusedPair = (id: string): AgentEvent[] => [
  { type: "tool_call", id, name: "write_file", args: { path: "a.ts" } },
  { type: "tool_result", callId: id, ok: false, output: "written then lint failed", fusedWrite: true },
];

describe("融合写盘的证据面（ok:false 不等于没写）", () => {
  it("hasSessionWrites：fusedWrite 的写盘算产出，不许把 goal 判成「压根没产出」", () => {
    expect(hasSessionWrites(fusedPair("w1"))).toBe(true);
  });

  it("workerVerificationEvidence：绿拍之后的融合写盘让证据变 stale，不是 verified", () => {
    expect(workerVerificationEvidence([...writePair("w0"), beat(true), ...fusedPair("w1")])).toBe("stale");
  });
});

describe("mayHaveWrittenDisk：写向判据的唯一事实源", () => {
  it("两个显式写工具 ⇒ 算改盘", () => {
    expect(mayHaveWrittenDisk("write_file", { path: "a.ts" })).toBe(true);
    expect(mayHaveWrittenDisk("edit_file", { path: "a.ts" })).toBe(true);
  });

  it(
    "shell 落盘算改盘：`shell_rw` 跑 `printf … >> note.txt` ⇒ true（旧的两名字清单在这一格判 false ⇒ 收束闸与 stale 双双漏）",
    () => {
      expect(mayHaveWrittenDisk("shell_rw", { command: "printf 'x' >> note.txt" })).toBe(true);
      expect(mayHaveWrittenDisk("run_shell", { command: "sed -i '' 's/a/b/' src/app.ts" })).toBe(true);
    },
  );

  it(
    "反向一侧（不这么钉，看一次目录就要跑一遍全量测试）：`run_shell` 跑 `ls -la` 与 `git status` ⇒ false",
    () => {
      expect(mayHaveWrittenDisk("run_shell", { command: "ls -la" })).toBe(false);
      expect(mayHaveWrittenDisk("run_shell", { command: "git status --short" })).toBe(false);
      expect(mayHaveWrittenDisk("run_shell", { command: "cat src/app.ts | wc -l" })).toBe(false);
    },
  );

  it("shell 里的写动作不许靠「首词是 git」蒙过去：`git commit` ⇒ true", () => {
    expect(mayHaveWrittenDisk("run_shell", { command: "git commit -m x" })).toBe(true);
  });

  it(
    "`shell_ro` 恒 false，且这不是命名照顾而是执行面事实：写到一半的命令会被同一份静态过滤拒掉（ok:false ⇒ 根本没执行）",
    async () => {
      expect(mayHaveWrittenDisk("shell_ro", { command: "ls -la" })).toBe(false);
      expect(mayHaveWrittenDisk("shell_ro", { command: "printf 'x' >> note.txt" })).toBe(false);
      const res = await shell_ro.run({ command: "printf 'x' >> note.txt" }, { workspace: await mkdtemp(join(tmpdir(), "wf-")) });
      expect(res.ok, "这条是上一条的前提：shell_ro 真写不了盘，判它 false 才不是漏判").toBe(false);
    },
  );

  it("只读工具（读文件/搜索/地图/等待/方案）⇒ false；`remember` 只写记忆区，不改被验的代码 ⇒ false", () => {
    // read_image 与 read_file 同族：读一张图片进上下文，一个字节都不改盘。
    // render_image 起浏览器进程，但**截图落 OS 临时目录**（mkdtemp，用完即删）
    // ⇒ 同样不改本工作区的盘。
    for (const name of ["read_file", "read_image", "render_image", "grep", "glob", "lsp", "impact_query", "wait_for_agents", "propose_plan", "clarify", "remember"]) {
      expect(mayHaveWrittenDisk(name, {}), name + " 不该被算成改盘").toBe(false);
    }
  });

  it("派生 worker 本身不改盘（它写的是自己那块 worktree）⇒ false", () => {
    expect(mayHaveWrittenDisk("spawn_agent", { task: "改一下" })).toBe(false);
  });

  it(
    "覆盖性棘轮：工具表里每个名字都必须被显式归类（算改盘 或 在只读名单里）⇒ 新增工具没登记就红",
    () => {
      const READ_ONLY_SURFACE = [
        "read_file", "grep", "glob", "lsp", "impact_query", "wait_for_agents", "clarify",
        "propose_plan", "remember", "spawn_agent", "shell_ro", "snapshot", "process",
        "web_fetch",
        // 2026-10-15 识图：与 read_file 同族（读界内图片进上下文，不改盘）。
        "read_image",
        // 2026-10-16 渲染：起浏览器进程但截图落临时目录，不改本工作区的盘。
        "render_image",
      ] as const;
      const names = Object.keys(TOOLS);
      const unclassified = names.filter(
        (n) => !mayHaveWrittenDisk(n, {}) && !(READ_ONLY_SURFACE as readonly string[]).includes(n),
      );
      expect(unclassified, "新工具没被写向面登记 ⇒ 收束闸会把它当只读放过：" + unclassified.join("、")).toEqual([]);
      // 反向一侧：只读名单里不许藏着「其实会被判成改盘」的名字（名单与判据分叉即红）
      const mislisted = READ_ONLY_SURFACE.filter((n) => mayHaveWrittenDisk(n, {}));
      expect(mislisted, "只读名单里有名字被判成改盘 ⇒ 名单已过期：" + mislisted.join("、")).toEqual([]);
    },
  );

  it(
    "接线棘轮：TOOLS 里每个写向工具都必须在 installAppTools 里被 gatedTool 包装（不包装＝权限门对它整条缺席）",
    () => {
      // 为什么钉源文本而不是跑 installAppTools：那函数会拉起 AskGate / 调度器，单测里起它等于
      // 起半个主进程（口径同 tool-surface-parity 的实例面）。文本对账的失效方向是**假绿**，
      // 所以末尾配一条反向对照——「全都包了」与「检查器瞎了」必须分得开。
      const runner = readFileSync(join(ROOT, "src", "main", "agent-runner.ts"), "utf8");
      const unwrappedIn = (src: string, names: readonly string[]): string[] =>
        names.filter((n) => !src.includes(`TOOLS.${n} = gatedTool("${n}", TOOLS.${n})`));
      const writeNames = Object.keys(TOOLS).filter((n) => mayHaveWrittenDisk(n, {}));
      expect(writeNames.length, "一个写向工具都没数出来 ⇒ 取料坏了，不是没问题").toBeGreaterThan(0);
      const unwrapped = unwrappedIn(runner, writeNames);
      expect(
        unwrapped,
        "写向工具没被门包装 ⇒ 它直连 TOOLS 执行，权限门/只读摘除/方案门整条缺席：" + unwrapped.join("、"),
      ).toEqual([]);
      const fake = 'TOOLS.write_file = gatedTool("write_file", TOOLS.write_file);';
      expect(unwrappedIn(fake, ["write_file", "ghost_write"]), "检查器在假源文本上认不出缺的那把＝它自己瞎了").toEqual(["ghost_write"]);
    },
  );
});

describe("凭据面（B 那条假绿）：shell 改盘必须能推翻绿拍", () => {
  it("绿拍之后经 shell 改盘 ⇒ stale（旧实现 lastWrite 看不见 shell，证据停在 verified）", () => {
    const stream: AgentEvent[] = [
      ...writePair("w1"),
      beat(true),
      shellCall("s1", "shell_rw", "printf 'x' >> src/app.ts"),
      okResult("s1"),
    ];
    expect(workerVerificationEvidence(stream)).toBe("stale");
  });

  it("反向一侧：绿拍之后只跑了只读命令 ⇒ 仍算 verified（不许把每次 ls 都判成过期）", () => {
    const stream: AgentEvent[] = [...writePair("w1"), beat(true), shellCall("s1", "run_shell", "ls -la"), okResult("s1")];
    expect(workerVerificationEvidence(stream)).toBe("verified");
  });

  it("只经 shell 改过盘 ⇒ hasSessionWrites 为真（goal 模式据此区分「还没验」与「压根不产出」）", () => {
    const stream: AgentEvent[] = [shellCall("s1", "shell_rw", "printf 'x' >> note.txt"), okResult("s1")];
    expect(hasSessionWrites(stream)).toBe(true);
    expect(hasSessionWrites([shellCall("s1", "run_shell", "ls -la"), okResult("s1")])).toBe(false);
  });
});

describe("收束闸（A 那条漏拍）：shell 写盘也要补一拍", () => {
  const failHook = {
    async run() {
      return { ok: false as const, results: [{ command: "pnpm test", ok: false as const, output: "1 failed" }] };
    },
  };

  /** 剧本：第 1 轮用 shell 改盘（全程不碰 write_file/edit_file），之后纯文本收工。 */
  async function runShellWritesFirst(opts: Record<string, unknown> = {}) {
    const log: AgentEvent[] = [];
    const requests: ProviderMessage[][] = [];
    const home = await mkdtemp(join(tmpdir(), "wf-loop-"));
    try {
      await runLoop({
        workspace: home,
        userMessage: "给待办加个开关",
        mode: "auto",
        interactive: true,
        events: { async append(event) { log.push(event); } },
        tools: { shell_rw: { name: "shell_rw", async run() { return { ok: true, output: "1 file changed" }; } } } as never,
        provider: {
          async *stream(messages: ProviderMessage[]) {
            requests.push(messages);
            if (requests.length === 1) yield { type: "tool_call", id: "s1", name: "shell_rw", args: { command: "printf 'x' >> src/app.ts" } };
          },
        } as never,
        ...opts,
      });
    } finally {
      await rm(home, { recursive: true, force: true }).catch(() => {});
    }
    return { log, requests };
  }

  it("只经 shell 落盘 + 纯文本收束 ⇒ 补一拍（零额外模型请求），证据落流", async () => {
    const { log, requests } = await runShellWritesFirst({ verify: failHook, autoVerify: true });
    expect(log.filter((e) => e.type === "verify_result")).toMatchObject([
      { type: "verify_result", callId: "harness-auto-verify", ok: false, auto: true },
    ]);
    expect(requests).toHaveLength(2);
  });

  it("反向一侧：只跑只读命令收束 ⇒ 一拍都不补（否则「看一眼目录」也要跑全量测试）", async () => {
    const log: AgentEvent[] = [];
    const home = await mkdtemp(join(tmpdir(), "wf-loop2-"));
    let requests = 0;
    try {
      await runLoop({
        workspace: home,
        userMessage: "数一下有几个文件",
        mode: "auto",
        interactive: true,
        events: { async append(event) { log.push(event); } },
        tools: { run_shell: { name: "run_shell", async run() { return { ok: true, output: "3" }; } } } as never,
        provider: {
          async *stream() {
            requests++;
            if (requests === 1) yield { type: "tool_call", id: "s1", name: "run_shell", args: { command: "ls | wc -l" } };
          },
        } as never,
        verify: failHook,
        autoVerify: true,
      });
    } finally {
      await rm(home, { recursive: true, force: true }).catch(() => {});
    }
    expect(log.filter((e) => e.type === "verify_result")).toHaveLength(0);
  });
});
