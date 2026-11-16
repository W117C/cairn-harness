# bot 团队核心：三件最小件的纯逻辑与判卷（2026-11-16）

本目录是本批 bot 侧的取料面。壁纸侧的证据在同日的 `outputs/wallpaper-deep-2026-11-16/`。

## 一、这批落的是什么

ADR 0015 §四 授权的新增件只有三件：**成员档案 / 发言权 / 段**。这一批把三件的
**纯逻辑 + 判卷**落下来，接线（IPC、面板、调度）没动 —— 措辞是「件已落、线未接」。

| 件 | 落点 | 判卷 |
|---|---|---|
| 段 | `src/agent/segments.ts` | `tests/segments.test.ts`（8 条） |
| 发言权 | `src/orchestration/speech.ts` | `tests/orchestration-speech.test.ts`（9 条） |
| 成员档案 | `src/agent/team/members.ts` | `tests/team-members.test.ts`（8 条） |

三条不变量都守住：**没有新增事件种类**（段与档案都走既有 `session_meta_update.patch` 的键）、
**没有新增存储面**（档案是投影）、**没有新增权限档**（`clampTier` 直接复用）。

## 二、读数（复跑命令见 `readings.log`）

| 判据 | 读数 |
|---|---|
| 三件判卷 | 3 文件 / 25 条全绿 |
| `node --import tsx scripts/typecheck.ts` | 0 条报错 |

## 三、实现期被自己判卷咬住的两处（如实记）

1. **成员档案的「先建后拒」**：第一版对新成员边建边校验，导致「一半字段非法」的成员
   带着默认档出现在名单里，同时又记一条拒绝 —— 两套口径。改成**整组校验再应用**：
   新成员这一组只要有一条不合法就整组不建。
2. **段读错了事件面**：第一版用 `effectiveEntries`（它按设计过滤掉 `session_meta_update`），
   于是分界永远看不见。改用 `effectiveControlEntries`（保留控制记录的那一面）。

## 四、边界

- 只盖工作树，不是提交态 HEAD 认证；变异复验未跑。
- 三件都还没有调用方：`orchestrator` 不读发言权、会话不写段、档案没有落盘入口。
  因此**不能**说「bot 团队功能可用」，只能说「三件的语义与判据成立了」。
