# Cairn v1 产品化（B1 内测先行）——设计 spec

- 日期：2026-10-06
- 状态：**待业主复核**（复核通过后进 writing-plans 出施工计划，再动代码）
- 决策依据：ADR 0001（`docs/adr/0001-core-only-vs-desktop.md`）裁决记录把 D2（v1 受众）
  明确留成未决（「别把这条读成已定」）。2026-10-06 业主拍板：
  **B1（自用/内测开发者）先行，B2 留门；交付面只做 CLI**（遵循 ADR 0001 的 D1 裁决，桌面端不在本次范围）。
- 本 spec 的落点：施工第一步把 D2 落账为 `docs/adr/0002-v1-audience-b1-internal-beta.md`。

## 0. 一句话范围

把「克隆 → 十分钟可用」做成产品路径：安装脚本、自检（`--doctor`）、版本旗标（`--version`）、
身份面（LICENSE / CHANGELOG / 0.1.0 / tag）、README 增量、B2 升级清单留门。
**不发布 npm、不碰桌面。**

## 1. 交付物与验收判据

| # | 交付物 | 落点 | 验收判据 |
|---|---|---|---|
| 1 | D2 落账 ADR 0002 | `docs/adr/0002-v1-audience-b1-internal-beta.md` | 记录裁决（B1、交付面=CLI）、与 ADR 0001 裁决记录的引用关系、推翻条件（出现真实外部用户 ⇒ 重开 D2） |
| 2 | B2 留门清单 | `docs/b2-checklist.md` | 触发条件（首个真实外部用户）写在文件头；每项带验收判据；含 ADR 0001 推翻条件 #2 的对应方案（npm 源码包＋tsx 进 dependencies） |
| 3 | 安装路径 | `scripts/install.sh` | Node 版本按 `package.json` engines 判（≥20.11 且 <25）；pnpm 在则 `pnpm install`、否则 `npm install`；收尾打印三条下一步（demo / 真跑 / `--doctor`）。`set -euo pipefail`；不自动 link（README 已有 `npm link` 一条路） |
| 4 | `cairn --doctor` | `src/main/doctor.ts`（纯函数核）＋ `src/cli.ts` 接线 | 检查项见 §2；env 值永不进报告（判卷钉脱敏）；node 版本不满足 ⇒ exit 1（环境级阻断），其余项只报不红 |
| 5 | `cairn --version` | `src/cli.ts` | 一行 `cairn <version>`；version 与 engines 同读 `package.json`（单一事实源）；进 `--help` |
| 6 | 身份面 | `LICENSE`（专有：All rights reserved＋内测授权一行；OSS 选型留给 B2 清单）、`CHANGELOG.md`（0.1.0 @ 2026-10-06，如实列 CLI 面、声明桌面不在 v1 交付面）、`package.json` 0.0.1→0.1.0、tag `v0.1.0` | 全部门绿之后才打 tag |
| 7 | README 增量（不重写） | `README.md`、`docs/DOCS-MAP.md`（若 docs-check 要求登记） | 「安装」小节（install.sh 两步走）、`--doctor`/`--version` 两条、ADR 0002 与 b2-checklist 的链；Node 版本口径对齐（README 写 20.3+，engines 实为 ≥20.11——以 package.json 为准）；npm/pnpm 安装口径对齐（以实测＋docs-check 过为准） |

## 2. `--doctor` 检查项（固定清单）

1. Node 版本落在 engines 区间（比较器手写，不引 semver 依赖）
2. 四家 provider key 在位与否（`CAIRN_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`，
   **只报在位与否，不回显值**）＋按既有顺序指出缺省会拨谁；全缺 ⇒ 指路 `--provider demo`
3. 档位表档数（读 `src/providers/registry.ts` 的注册面）
4. 沙箱可用性（复用 `src/main/sandbox.ts` 的状态面，与 `scripts/sandbox-check.ts` 同源；不可用 ⇒ 明说，不假装）
5. 工作区可写性（`fs.access` W_OK；不落探针文件）
6. `search.endpoint` 配了没（只读 `.agent/config.json`）

输出：逐项 ✓/✗ ＋ 一句补救；末行总档（就绪 / 部分就绪 / 未就绪）。

## 3. 判卷与门

- **不新增 GATES 条目**（孤儿验收脚本门会拦 `*check*` 形态的新脚本；产品化不添闸，判卷走 vitest）。
- 新增判卷：`tests/doctor.test.ts` —— 纯函数核（报告构造、脱敏、退出码档、Node 比较器边界）。
- `tests/cli-surface.test.ts` 若钉旗标面 ⇒ 同步（实现时以现读为准）。
- 交笔自检：`node --import tsx scripts/typecheck.ts` ＋ 全量判卷 ＋ `pnpm docs-check`（第 402 页起的交笔口径）。
- 若全量判卷红：先分面定位是否本笔所致（本笔只动 §1 列出的文件）；**别人的在飞改动不背锅、也不替别人修**。
- 不动冻结判卷与夹具。

## 4. 非目标（明确不做）

npm 发布与 un-private（进 B2 清单）、桌面端一切工作（ADR 0001 裁决内）、
M5 / SoL-Pi / judgment 内核轴（ADR 0001「放弃什么」段）、遥测、文档双语、Windows 安装路径、官网。

## 5. 施工顺序

1. ADR 0002 ＋ `docs/b2-checklist.md`（裁决落账先行）
2. doctor 纯函数核 ＋ 判卷（判卷先行：先写 `tests/doctor.test.ts`）
3. `src/cli.ts` 接线 `--doctor` / `--version`，同步 cli-surface 判卷
4. `scripts/install.sh`
5. LICENSE / CHANGELOG / 版本号 /（门全绿后）tag v0.1.0
6. README / DOCS-MAP 增量
7. 交笔自检（§3 口径）

## 6. 回退

每一步独立成笔（journal page 风格，一笔只含本步文件）；
任何一步红 ⇒ 单笔回退，不影响已落账的裁决文档（ADR 0002 是裁决不是施工物，最后回退它）。
