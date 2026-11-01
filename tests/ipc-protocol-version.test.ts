// SEMA Phase 3 判卷（docs/sema-proposal.md §12）：IPC 协议版本化。
// 本文件同时是 src/main/ipc-protocol.ts 运行时出口的**执行路径**（值边 import）——
// src-execution-path 棘轮随版本化撤掉它的纯类型面豁免，执行路径由这一格供给。
import { describe, expect, it } from "vitest";
import { IPC_PROTOCOL_VERSION } from "../src/main/ipc-protocol";

describe("IPC 协议版本（§3.5/§12）", () => {
  it("版本常量是 ≥1 的整数（兼容面事实源的形状契约）", () => {
    expect(Number.isInteger(IPC_PROTOCOL_VERSION)).toBe(true);
    expect(IPC_PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("bump 版本必须有意为之：现钉 51——改协议形状（AgentApi 增删/字段语义变）= bump 常量 + 同步本格，desktop-panel 提案走同一流水线", () => {
    // v8 → v9（2026-10-16 建议批）：＋suggestNext（「Tab 想下一条」按上下文单发模型调用）。
    // v9 → v10（2026-10-16 能力在场性批）：＋capabilities（搜索端点配没配——让「模型为什么少一把工具」上屏）。
    // v10 → v11（2026-10-16 主界面重做批）：＋gitStatus / gitClone / workspaceSearch / touchProject /
    //   saveTempFile / snapshotRestore / revealInFinder；listProjects 收 options（recentFirst/includeRemoved）。
    // v11 → v12（2026-10-16 导入诊断批）：＋projectDiagnose（导入已有文件夹先给三态诊断，ADR 0004 §4）。
    // v12 → v13（2026-10-16 记忆正文批）：MemoryTopicPayload 增 body（「主题正文」快照面接通，无新通道）。
    // v13 → v14（2026-10-21 跨会话用量批）：＋usageLedger（头像菜单「用量统计」→「全部会话」）。
    // v14 → v15（2026-10-21 会话日志批）：＋sessionLog（错误条/命令面板「查看日志」的只读尾部）。
    // v15 → v16（2026-10-21 会话定位批）：openSession 增可选 workspace（跨项目同名 id 开对转录）。
    // v16 → v17（终端尺寸同步）：＋terminalResize，真实 PTY 跟随 xterm 行列。
    // v17 → v18：会话正文搜索通道与三态结果。
    // v20 → v21：完成通知点击直达（push onNotificationOpen，载荷 sessionId + workspace）。
    // v21 → v22：PluginPanelSnapshot 增 MCP active 三格（设置页显示整台/按工具激活）。
    // v22 → v23：RunRequest 增 planRequired（Composer「方案」开关按轮覆盖默认设置）。
    // v23 → v24：编排 submit/control/view，按 workspace + session 寻址。
    // v24 → v25：Evolve 只读报告（evolveReport——经验/实验/候选/预算/冻结态上屏）。
    // v25 → v26：StateResponse 增 settingsIssue（设置文件首读失败上屏，不静默用缺省）。
    // v26 → v27：＋marketplaceCatalog（签名插件目录只读读数）。
    // v27 → v28：＋marketplacePluginInstall/Status/Commit/Cancel、pluginSetEnabled、pluginUninstall、
    //   pluginsInstalled（插件安装后端面；市场 UI 仍由 PLUGIN-2 消费）。
    // v28 → v29：＋统一来源导入/更新/检查、本地目录选择与已安装配置。
    // v29 → v30：ScheduleSnapshot 增 warnings / definitionsCorrupt（自动化文件坏档上屏）。
    // v30 → v31：＋reloadSettings（外部修好设置文件后不重启即可恢复）。
    // v31 → v32：AppSettings 增 notifyOnComplete（完成通知开关，缺省开）。
    // v32 → v33：＋reportViewing（窗口可见会话上报——通知判据「不在看那个会话」）。
    // v33 → v34：＋doctor（桌面「运行诊断」，复用 CLI 检查核）。
    // v34 → v35：会话级 model/thinking 持久化（SessionInfoPayload 增两格 + sessionPrefsSet）。
    // v35 → v36：＋relocateProject（项目目录移动后按同一条记录重新定位，保住 id/name/createdAt）。
    // v36 → v37：listProjects 行增派生 missing（侧栏「目录失联」）；无新通道。
    // v37 → v38：＋importLicense（导入外部签发的 license；先验签后落盘）。
    // v38 → v39：＋exportDiagnostics（诊断报告 + 主进程日志尾部，一个 Markdown）。
    // v39 → v40：＋exportPreferences / importPreferences（只搬界面与行为偏好）。
    // v40 → v41：＋resetPreferences（恢复默认偏好；身份/项目/会话/布局不动）。
    // v41 → v42：about 增可选 build（包内 build-info；开发态缺省）。
    // v42 → v43：＋exportMemory（记忆导出）。
    // v43 → v44：＋evolveSetFrozen（进化冻结开关）。
    // v44 → v45：＋evolveActivate（人工激活过门经验）。
    // v45 → v46：＋evolveDormant（人工转 dormant）。
    // v46 → v47：＋evolveGlobalRevoke（撤销一条全局经验）。
    // v47 → v48：＋evolveGlobalSetFrozen（全局经验冻结开关）。
    // v48 → v49：＋evolveGlobalActivate（恢复 dormant 全局经验）。
    // v49 → v50：runCancel/runSteer 按 workspace 校验目标，拒绝不自动续发。
    // v50 → v51：RunResponse.accepted 区分接收前拒绝与执行失败。
    expect(IPC_PROTOCOL_VERSION).toBe(51);
  });
});
