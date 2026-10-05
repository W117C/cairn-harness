# ADR 0002：v1 受众与交付面

- 状态：**已接受（范围裁决）**——2026-10-06 业主拍板，见文末「裁决记录」
- 日期：2026-10-06
- 决策者：仓库所有者
- 依据材料：docs/adr/0001-core-only-vs-desktop.md（其 D2 被明确留成未决）、
  docs/superpowers/specs/2026-10-06-productization-b1-design.md

## 背景

ADR 0001 把 D2（v1 受众）明确留成未决（「别把这条读成已定」）。2026-10-06 业主拍板落案，
本 ADR 即为那份裁决的落账；施工面见 spec（2026-10-06-productization-b1-design.md §1）。

## 裁决记录

1. **D2（v1 受众）落案 B1**：自用/内测开发者先行；B2（更广受众）留门，触发条件见
   `docs/b2-checklist.md` 文件头。
2. **交付面只做 CLI**（遵循 ADR 0001 的 D1 裁决）：桌面端不在 v1 交付面，不碰 `apps/`。

## 推翻条件

- 出现**第一个真实外部用户** ⇒ 重开 D2（B2 门启动：先过 `docs/b2-checklist.md` 的清单再谈扩受众）。

## 后果

- 产品化施工面收窄为：安装路径、`--doctor`、`--version`、身份面、README 增量（spec §1）。
- npm 发布、桌面端、文档双语、Windows 安装路径、官网、遥测全部出 v1 范围（进 B2 门或永不）。
