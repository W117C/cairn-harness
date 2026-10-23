import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AgentApi } from "../../../src/main/ipc-protocol";
import { INVOKE_CHANNELS, PUSH_CHANNELS, type PushChannel } from "../src/main/channels";

// 完整性裁决在类型侧：interface 无运行时形态，Object.keys({} as AgentApi) 恒为 []，
// 「invoke 通道覆盖 AgentApi 全部非推送键」只能由 channels.ts 的 INVOKE_CHANNELS
// 映射类型声明 ＋ tsc（pnpm --filter cairn-desktop typecheck，tsconfig include 含 tests/）
// 静态裁决。运行时用例只验推送三键与 invoke 表非空。

describe("通道名表完整性", () => {
  it("推送通道恰为八条且通道名非空", () => {
    // 2026-10-20：＋onMenu（原生菜单栏 → 渲染层命令分发，蓝本 §5.2 菜单树）。
    expect(Object.keys(PUSH_CHANNELS).sort()).toEqual(["onAsk", "onAskDone", "onBrowserState", "onEvent", "onMenu", "onPreviewState", "onTerminalData", "onTerminalExit"]);
    for (const channel of Object.values(PUSH_CHANNELS)) expect(channel).toBeTruthy();
  });

  it("invoke 通道表非空且每行通道名非空", () => {
    // 运行时计数钉（终审顺手项）：类型侧红线靠 tsconfig include 含 tests/ 才生效，
    // include 一收窄就哑火——表长在运行时也咬得住，漂移（AgentApi 增删方法）当场红。
    // M4-5：＋pickDirectory（dialog 选目录，M3 deferred 收口）⇒ 40；M3 补：＋forkSession ⇒ 41；
    // ＋revertTurn / submitFeedback / listFeedback（v2.16 三面同批）⇒ 44；
    // SEMA §12：＋protocolVersion（协议版本握手）⇒ 45。
    // S7：＋providerDiscover / providerSave（自定义接口：拉取与存盘）⇒ 47。
    // ③：＋createProject（按项目名建文件夹并登记）⇒ 48。
    // 恢复闭环：＋queueGet / queueSet（会话发送队列 sidecar）⇒ 50。
    // v4：＋changeDiff（变更审阅逐 hunk）⇒ 51。
    // v5：＋workspaceListDir / workspaceReadText（file 窗格只读浏览）⇒ 53。
    // v5：＋terminalStart / terminalWrite / terminalKill（terminal 窗格）⇒ 56。
    // v5：＋browserOpen / browserBounds / browserNav / browserClose（browser 窗格）⇒ 60。
    // v5：＋panePopout（独立窗口）⇒ 61。
    // v6：＋projectTemplates / projectCreateFromTemplate / previewStart / previewStop / previewStatus /
    //      projectExport / providerCheck（产品第一批：模板建项 + 预览运行时 + 导出 + 连接自检）⇒ 68。
    // v7：＋workspacePathAction（路径右键菜单：abs/reveal/open）/ speakText / stopSpeaking（朗读）/
    //      browserClearData / browserPickElement（浏览器清除数据 + 元素选择）⇒ 73。
    // v8：＋pickFiles（附件引用「选择文件…」：dialog 选文件多选）⇒ 74。
    // v9：＋suggestNext（Tab 想下一条：按上下文单发模型调用）⇒ 75。
    // v10：＋capabilities（能力在场性：搜索端点配没配——让「模型为什么少一把工具」上屏）⇒ 76。
    // v11：＋gitStatus / gitClone / workspaceSearch / touchProject / saveTempFile / snapshotRestore /
    //      revealInFinder（主界面重做批：git 两闸 / 项目内搜索 / 最近打开 / 粘贴落盘 / 快照还原 / Finder 显示）⇒ 83。
    // v12：＋projectDiagnose（导入诊断批：导入已有文件夹先给三态诊断——ADR 0004 §4）⇒ 84。
    // 2026-10-17：＋setWorkspaceContext（工作区上下文：冷启动/切项目后 diff、文件窗格、回滚可用）⇒ 85。
    // 2026-10-18：＋exportTranscript（导出对话 .md：原生保存面板）⇒ 86。
    // 2026-10-18：＋listSkills（斜杠菜单技能清单）⇒ 87。
    // 2026-10-18：＋skillBody（技能抽屉读正文，§8 #15）⇒ 88；＋attachmentThumb（图片 chip 缩略图）⇒ 89。
    // 2026-10-19：＋browserSetAllowedHosts（授权清单同步到主进程的逐跳导航闸）⇒ 90；
    // ＋pluginUserConfigSet（插件配置写入面）⇒ 91；
    // ＋setMessagePinned / listMessagePins（2026-10-20 消息置顶，销 G6）⇒ 93。
    // 2026-10-20：＋sessionWorktree（会话级 worktree 隔离，销 G4：create/merge/discard 共用一条）⇒ 94。
    // v14（2026-10-21）：＋usageLedger（头像菜单「用量统计」的「全部会话」账本）⇒ 95；
    // v15（2026-10-21）：＋sessionLog（错误条 / 命令面板「查看日志」的只读尾部）⇒ 96。
    // v17：＋terminalResize ⇒ 97。
    // v18：＋sessionSearch（会话正文全文检索；结果三态，「没量到 ≠ 没有」）⇒ 98。
    // 2026-10-23（第 676 页同族，第 9 点）：＋runSteer（轮中插话进正在跑的那一轮；不开新轮）⇒ 99。
    // 2026-10-23（第 689 页）：＋worktreeClean（孤儿工作树页的显式清理；主进程仍判归属）⇒ 100。
    expect(Object.keys(INVOKE_CHANNELS)).toHaveLength(100);
    const keys = Object.keys(INVOKE_CHANNELS) as (keyof typeof INVOKE_CHANNELS)[];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(INVOKE_CHANNELS[key]).toBeTruthy();
  });

  it("类型侧红线：INVOKE_CHANNELS 键集恰为 AgentApi 去掉三条推送键（typecheck 裁决）", () => {
    type Expect<T extends true> = T;
    type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
    // 双向钉死：AgentApi 增删方法或 PushChannel 漂移 ⇒ 此 Equal 破 ⇒ typecheck 红。
    type _invokeKeysAreExact = Expect<Equal<keyof typeof INVOKE_CHANNELS, Exclude<keyof AgentApi, PushChannel>>>;
    expect(true).toBe(true);
  });

  it("wired 覆盖守卫：INVOKE_CHANNELS 每条通道要么接真、要么在带理由的 fail-loud 白名单（防漏行三连复发）", () => {
    // M3 终审防回归守卫：wired 表漏行这一类 bug 已三连同型发生（getProviderInfo → submitClarify
    // → decidePlan）——channels 表/preload/AgentApi 三面齐全，wired 表独缺一行，renderer 调用
    // 即 reject「No handler registered」而被 void 吞掉 ⇒ 静默死路，且只有真开窗冒烟才暴露。
    // B3 修复后判据升一级：不再是"白名单里那 27 条默许静默跳过"，而是**遍历 INVOKE_CHANNELS
    // 全键**——每条要么在 wired 表有真 handler，要么写进 UNWIRED_FAIL_LOUD（带理由）且注册成
    // fail-loud（返回 {ok:false,error}，不是 `if (handler)` 跳过）。
    const indexTs = readFileSync(fileURLToPath(new URL("../src/main/index.ts", import.meta.url)), "utf8");

    // ① wired 必须是**全键** Record，不是 Partial——这是"删掉一条已接通道必须转红"的静态支。
    expect(indexTs).toMatch(/const wired:\s*Record<InvokeChannel,/);
    expect(indexTs).not.toMatch(/Partial<\s*Record<\s*InvokeChannel/);

    // ② 注册循环不许再有静默跳过（`if (handler)` 那一支就是漏行三连的温床）。
    expect(indexTs).not.toMatch(/if\s*\(\s*handler\s*\)\s*ipcMain\.handle/);

    // ③ 接真名单：wired 表里逐行锚定 `key:` 的键。
    const mustWire: readonly string[] = [
      "run",
      "decide",
      "submitClarify",
      "decidePlan",
      "setGoal",
      "runCancel",
      "compact",
      "getState",
      "getProviderInfo",
      "getOnboarding",
      "getSettings",
      "setSettings",
      "listSessions",
      "createSession",
      "openSession",
      // v14：跨会话用量账本（只读扫描，接真有 wired 行）。
      "usageLedger",
      // v15：会话日志尾部（只读；会话归属由 host 解析，接真有 wired 行）。
      "sessionLog",
      "renameSession",
      "deleteSession",
      "listProjects",
      "addProject",
      "removeProject",
      "setSessionPinned",
      "setSessionArchived",
      "setWorkspaceContext",
      "exportTranscript",
      "listSkills",
      "skillBody",
      // 2026-10-20 消息置顶（销 G6）：三面同步直接接真（wired 行 + AgentApi + channels）。
      "setMessagePinned",
      "listMessagePins",
      "assignSessionProject",
      "deleteMemory",
      "pluginDecide",
      "pluginUserConfigSet",
      "sidechatCreate",
      "sidechatAsk",
      "sidechatPromote",
      "sidechatState",
      "cardAction",
      "scheduleSnapshot",
      "scheduleUpsert",
      "scheduleDelete",
      "scheduleRunNow",
      "providerKeySet",
      "providerKeyDelete",
      "providerKeyStatus",
      "checkUpdate",
      "openExternal",
      // M4-5：dialog 选目录——新通道直接接真（wired 行＋AgentApi＋channels 三面同步），不进白名单。
      "pickDirectory",
      // v8：dialog 选文件（附件引用「选择文件…」）——同上三面同步直接接真。
      "pickFiles",
      // v9：Tab 想下一条（按上下文单发模型调用）——三面同步直接接真。
      "suggestNext",
      "forkSession",
      // 2026-10-20 §3.7 · G4 会话级 worktree 隔离：wired 行直调 kernel-host（归属解析/在跑拒绝
      // 都在 host 里），core 侧创建/合并/清理见 src/main/session-worktree.ts。
      "sessionWorktree",
      // v2.16 三面同批的在飞键（channels.ts/index.ts 已有 wired 行，名单在此补齐）。
      "revertTurn",
      "submitFeedback",
      "listFeedback",
      // SEMA §12：协议版本握手（wired 行 + AgentApi + channels 三面同步；renderer 闸见 protocol-version.test）。
      "protocolVersion",
      // S7：自定义接口——拉取（零副作用）与存盘（写工作区配置 + 存钥匙），三面同步直接接真。
      "providerDiscover",
      "providerSave",
      // ③：新建项目（建同名文件夹 + 登记），三面同步直接接真。
      "createProject",
      // 恢复闭环：发送队列 sidecar 读回与覆盖写。
      "queueGet",
      "queueSet",
      // v4：变更审阅逐 hunk（快照 vs 当前文件；三面同步直接接真）。
      "changeDiff",
      // v5：file 窗格只读浏览（三面同步直接接真）。
      "workspaceListDir",
      "workspaceReadText",
      // v5：terminal 窗格（PTY 宿主；三面同步直接接真）。
      "terminalStart",
      "terminalWrite",
      "terminalResize",
      "terminalKill",
      // v5：browser 窗格（WebContentsView 宿主；三面同步直接接真）。
      "browserOpen",
      "browserBounds",
      "browserNav",
      "browserClose",
      "browserSetAllowedHosts",
      // v5：窗格弹出独立窗口。
      "panePopout",
      // v6：产品第一批——模板建项 / 预览运行时 / 项目导出 / 连接自检（三面同步直接接真）。
      "projectTemplates",
      "projectCreateFromTemplate",
      "previewStart",
      "previewStop",
      "previewStatus",
      "projectExport",
      "providerCheck",
      // v7：全量补全批——路径动作（resolve 在工作区模块、shell 动作在主进程）/ 朗读（macOS say）/
      //     浏览器清除数据 / 浏览器元素选择（三面同步直接接真）。
      "workspacePathAction",
      "speakText",
      "stopSpeaking",
      "browserClearData",
      "browserPickElement",
      // v10：能力在场性（搜索端点配没配；口径同 CLI --doctor 的 search 那一格）——三面同步直接接真。
      "capabilities",
      // v11：主界面重做批（七条）——git 两闸（core git-ops）/ 项目内模糊搜索（core workspace-search）/
      //   最近打开（touchProject + listProjects options）/ 粘贴落盘（desktop temp-file）/ 快照还原 /
      //   Finder 显示——三面同步直接接真。
      "gitStatus",
      "gitClone",
      "workspaceSearch",
      // v18：会话正文全文检索（core session-search；主进程扫会话 JSONL，渲染层不碰盘）——三面同步直接接真。
      "sessionSearch",
      "touchProject",
      "saveTempFile",
      "snapshotRestore",
      "revealInFinder",
      // 2026-10-18：附件图片 chip 缩略图（nativeImage 40px data URL）——三面同步直接接真。
      "attachmentThumb",
      // v12：导入诊断（导入已有文件夹先给三态诊断——ADR 0004 §4）——三面同步直接接真。
      "projectDiagnose",
      // 2026-10-23：轮中插话（第 9 点）——三面同步直接接真：host.steer → agent-runner 的
      // RunOverrides.steering → loop 轮界取料。**必须接真**：它不是可选面板而是「运行中再交代一句话」，
      // 落进 fail-loud 白名单就等于让用户以为说出去了。
      "runSteer",
      // 2026-10-23（第 689 页）：孤儿工作树页的显式清理——三面同步直接接真（主进程再判归属）。
      "worktreeClean",
    ];
    // ④ fail-loud 白名单（带理由的未接）：B3 修复后为空——39 条全部接真。要留白须在此
    //    逐条列名并注记理由，且 index.ts 的 UNWIRED_FAIL_LOUD 同步加键（下方断言钉死两者一致）。
    const failLoud: readonly string[] = [];

    // 名单完整性自钉：两份名单并集恰为 INVOKE_CHANNELS 全键、且互不相交（防名单漏列让守卫哑火）。
    const allKeys = Object.keys(INVOKE_CHANNELS) as (keyof typeof INVOKE_CHANNELS)[];
    expect(failLoud.filter((k) => mustWire.includes(k))).toEqual([]);
    expect([...mustWire, ...failLoud].sort()).toEqual([...allKeys].sort());

    // ⑤ 每条接真键在 index.ts 源文里确实有 wired 行（行首锚定 key:）。
    for (const key of mustWire) {
      const row = new RegExp(`^\\s*${key}\\s*:`, "m");
      expect(row.test(indexTs), `wired 表缺行：${key}（通道 ${INVOKE_CHANNELS[key as keyof typeof INVOKE_CHANNELS]}）`).toBe(true);
    }
    // ⑥ fail-loud 名单必须与 index.ts 的 UNWIRED_FAIL_LOUD 集合字面量一致（两侧漂移当场红）。
    const setLit = indexTs.match(/UNWIRED_FAIL_LOUD[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? "";
    const inSource = [...setLit.matchAll(/["']([a-zA-Z]+)["']/g)].map((m) => m[1]).sort();
    expect(inSource).toEqual([...failLoud].sort());
    // ⑦ fail-loud 白名单里的每一键都不许在 wired 表里有行（否则"未接"名不副实）。
    for (const key of failLoud) {
      const row = new RegExp(`^\\s*${key}\\s*:`, "m");
      expect(row.test(indexTs), `fail-loud 白名单里的 ${key} 却在 wired 表接了真——请移出白名单`).toBe(false);
    }
  });
});
