# bot 规格第一篇 ＋ 壁纸首帧底色（2026-11-16）

本目录是本批的取料面：两条线一件事一份证据，读数在 `readings.log`（原始输出，未改字）。

## 一、这批改了什么

1. **bot 团队协作核心的 Phase 4 第一篇**：`docs/superpowers/specs/2026-11-16-bot-team-core-design.md`。
   只补 ADR 0015「§九 未决」的五个口（Q11 段 / Q12 长文本 / Q17 命名 / Q18 差异点 / UI 定价），
   不改 ADR 已裁决的任何一项；ADR 状态仍是 Proposed，仍不许写实现代码。
2. **壁纸首帧底色（规格 §10 的 v1.1 项、§11 表 3 的默认裁决）**：
   `apps/desktop/src/main/wallpaper-tint.ts` ＋ `apps/desktop/src/main/index.ts` 接线。
   图片壁纸时主进程取 1×1 平均色当 `BrowserWindow.backgroundColor`；
   读不出（文件没了 / 解码失败 / 几乎全透明）⇒ 回落主题底色，与今天逐字节一致；视频不走近路。

## 二、判据与读数（复跑命令在 `readings.log` 的每个小节）

| 判据 | 读数 |
|---|---|
| `node --import tsx scripts/typecheck.ts` | 通过（0 条报错） |
| `pnpm renderer-layer-check` | 绿（247 个渲染层源文件） |
| `apps/desktop/tests/wallpaper-tint.test.ts`（新增） | 7/7 绿 |
| `pnpm --filter cairn-desktop test` | 397 文件 / 2581 条全绿，exit 0 |
| `pnpm desktop-boundary-check` | 绿 |

## 三、边界（这份证据不能证明什么）

- **只盖工作树的桌面面**：未跑提交态 HEAD 认证，也未跑变异复验；本页不宣称提交态结论。
- **只在 node 里判**：平均色换算、回落、只对图片生效都由注入的假 `TintSource` 判；
  `nativeImage.createFromPath` 与真实首帧闪烁**没有真机读数**（本机没有 Electron 二进制，
  也无法在沙箱里起 GUI）。因此「闪得少了多少」这一定性判断没有量化证据。
- **renderer 一个字没动**：本批一度加过「文件不可用」标记（规格 §7 的第三格），
  实测发现一条硬约束——`apps/desktop/tests/helpers/renderer-evidence.ts#rendererDigest` 对
  整个 `src/renderer`（.ts/.tsx/.css）取摘要，四份密封证据（cds-parity / ime-guard / overlay-mutex /
  queue-key）会因此转红，而重封密封证据要真机跑探针（本机无 Electron）。**已整体回滚**，
  规格 §7 的「设置里标记文件不可用」仍是未落项，留给能跑真机探针的一轮。
- 核心套件（`pnpm test:capped`）本批**未跑**：改动面只有桌面主进程与文档，核心零触碰。

## 四、未做（如实列）

- 壁纸规格 §10 的两格老账仍未验：视频失焦暂停（本机无 osascript/ffmpeg 之外的视频工具，且真要 Electron）、
  亮色主题真机截图（同一原因）。
- 长文本分布数字（规格 §3 的探针口径）本机无真实会话日志可量，只定帽与探针，不填数。
