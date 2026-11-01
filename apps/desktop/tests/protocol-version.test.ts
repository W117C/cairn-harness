// SEMA Phase 3 判卷（docs/sema-proposal.md §12）：协议版本握手的桌面接线。
// 形状裁决在类型侧（AgentApi.protocolVersion ↔ channels.ts 映射红线，channels.test 同款）；
// 这里钉的是四格**接线事实**：通道行、wired 行、vite define、renderer 闸——缺一格 = 版本化哑火。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INVOKE_CHANNELS } from "../src/main/channels";
import { IPC_PROTOCOL_VERSION } from "../../../src/main/ipc-protocol";
import { readAppSurface } from "./helpers/app-surface";

function repo(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("协议版本握手接线（§3.5/§12）", () => {
  it("通道行在：protocolVersion → agent:protocol-version", () => {
    expect(INVOKE_CHANNELS.protocolVersion).toBe("agent:protocol-version");
  });

  it("main 侧 wired 行在，且递的是协议面常量（不是就地另抄一份数字）", () => {
    const indexTs = repo("../src/main/index.ts");
    expect(indexTs).toMatch(/^\s*protocolVersion\s*:\s*\(\)\s*=>\s*IPC_PROTOCOL_VERSION,/m);
    expect(indexTs).toMatch(/import\s*\{[^}]*IPC_PROTOCOL_VERSION[^}]*\}\s*from\s*"[^"]*src\/main\/ipc-protocol"/);
  });

  it("vite define 在：__IPC_PROTOCOL_VERSION__ 构建期注入（renderer 产物零运行时 import src，类型红线不破）", () => {
    const viteCfg = repo("../vite.config.ts");
    expect(viteCfg).toMatch(/import\s*\{\s*IPC_PROTOCOL_VERSION\s*\}\s*from\s*"[^"]*src\/main\/ipc-protocol"/);
    expect(viteCfg).toMatch(/__IPC_PROTOCOL_VERSION__\s*:\s*JSON\.stringify\(IPC_PROTOCOL_VERSION\)/);
  });

  it("renderer 闸在：挂载比对实况版本，失配/查询失败 fail-closed 早退", () => {
    const appTsx = readAppSurface();
    expect(appTsx).toMatch(/declare const __IPC_PROTOCOL_VERSION__: number/);
    expect(appTsx).toMatch(/window\.agent\.protocolVersion\(\)/);
    expect(appTsx).toMatch(/live !== __IPC_PROTOCOL_VERSION__/);
  });

  it("版本事实源单点：桌面侧不许另抄一份版本数字（期望值从协议面 import）", () => {
    // 升版即在此钉新号：v8 → v9（建议批：suggestNext「Tab 想下一条」单发模型调用）；
    // v9 → v10（能力在场性批：capabilities——搜索端点配没配，让「模型为什么少一把工具」上屏）；
    // v10 → v11（主界面重做批：git 两闸 / 项目内搜索 / 最近打开 / 粘贴落盘 / 快照还原 / Finder 显示）；
    // v11 → v12（导入诊断批：导入已有文件夹先给三态诊断，ADR 0004 §4）；
    // v12 → v13（记忆正文批：MemoryTopicPayload 增 body——「主题正文」快照面接通，无新通道）。
    // v13 → v14（跨会话用量批：＋usageLedger——头像菜单「用量统计」→「全部会话」）。
    // v14 → v15（会话日志批：＋sessionLog——错误条/命令面板「查看日志」的只读尾部）。
    // v15 → v16（会话定位批：openSession 增可选 workspace——跨项目同名 id 开对转录）。
    // v16 → v17（终端尺寸同步：＋terminalResize）。
    // v17 → v18（会话正文全文检索：＋sessionSearch——结果三态，「没量到 ≠ 没有」由类型层面分开）。
    // v20 → v21（完成通知点击直达：push onNotificationOpen——点击载荷带 sessionId + workspace）。
    // v21 → v22（插件面板 MCP 激活态：PluginPanelSnapshot 增 activeMcpServers / activeMcpTools / mcpServerSummaries）。
    // v22 → v23（Plan 模式一等入口：RunRequest 增 planRequired）。
    // v23 → v24：编排 submit/control/view（独立于旧 PlanGate）。
    // v24 → v25：Evolve 只读报告（evolveReport——经验/实验/候选/预算/冻结态上屏）。
    // v25 → v26：StateResponse 增 settingsIssue（设置文件首读失败上屏）。
    // v26 → v27：＋marketplaceCatalog（签名插件目录只读读数）。
    // v27 → v28：＋安装 job、已装列表、启用与卸载后端通道。
    // v28 → v29：＋Git/本地导入、来源绑定更新、本地目录选择与已安装配置通道。
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
    // v43 → v44：＋evolveSetFrozen（进化冻结开关；写/删 STOP）。
    // v44 → v45：＋evolveActivate（人工激活过门经验；写 playbook active）。
    // v45 → v46：＋evolveDormant（人工把 active 经验转 dormant）。
    // v46 → v47：＋evolveGlobalRevoke（撤销一条全局经验；全局账 patch 转 dormant）。
    // v47 → v48：＋evolveGlobalSetFrozen（全局经验冻结开关；写/删全局 STOP）。
    // v48 → v49：＋evolveGlobalActivate（恢复 dormant 全局经验；复核 ≥3 库证据）。
    // v49 → v50：runCancel/runSteer 携带 workspace，目标校验拒绝不触发自动续发。
    // v50 → v51：RunResponse.accepted 区分接收前拒绝与执行失败。
    expect(IPC_PROTOCOL_VERSION).toBe(51);
  });
});
