# 文档 ↔ HEAD 一致性取证 — 2026-10-05

作者：只读子代理（无写权，由主线程落盘）。事实源一律 **HEAD**（`git show HEAD:<path>`）。
主线程补充：`README.md`、`docs/CODE-WIKI.md`、`docs/DOCS-MAP.md`、`docs/README.md`、`AGENTS.md` 这五个文件**此刻在别人手里**（主树未提交）⇒ 下面的文档改法只登记，不动手；`scripts/lib/agents-command-face.ts`、`tests/agents-command-face.test.ts`、`scripts/probe-promise-recall.ts`、`scripts/gate-manifest.ts`、`.github/workflows/verify.yml` 现读为干净。

## 先说两条「没成立的不成立」
- 桌面边界那条**是对的**：HEAD 的 `src/` 对 `electron`/`apps/desktop` 零 import，与 `HEAD:AGENTS.md:14-16`、`scripts/desktop-boundary-check.ts:22-34` 一致。
- `mutate-verify`「测 HEAD、主检出拒跑」也**没讲反**（`HEAD:AGENTS.md:22-26`，证人 `scripts/mutate-verify.mjs:9163-9177`、`13907-13926`）。
- 过期集中在两件事：**文档自称 core-only** ＋ **改名只改了一半**。

## 结构性缺口（最该记住的一条）
专抓此事的尺 `scripts/lib/agents-command-face.ts:1-7` 的注释里就点名「`bin/m0.mjs` 改名后文档没跟上」，但 HEAD 上它**只被自己的判卷 import**，真仓面 `tests/agents-command-face.test.ts:84` **只读 `AGENTS.md`，不读 README/CODE-WIKI**；而 `scripts/probe-promise-recall.ts:19-40` 的取料是 `src/` 源码字面量 AST，`CLAIM_UNWITNESSED_CAP=0`（`:244`）**管不到 markdown**。
⇒ **「文档对模型/用户许的诺」今天既没有证人也没有门**。（快照、只读摘写这两诺本身有证人：`:961`＋`outputs/…probe-snapshot-copy-restore.ts:30-40`；`src/agent/sidechat.ts:239` 登记于 `:436`。）

## 过期清单（按严重度）
| # | 文档位置（HEAD:file:line） | HEAD 实际（file:line） | 改法 | 撞门风险 |
|---|---|---|---|---|
| 1 | `README.md:328`、`docs/CODE-WIKI.md:3`、`docs/DOCS-MAP.md:3`、`docs/README.md:3` 自称「Electron/renderer/preload 已移除」 | `apps/desktop/` 40 个文件（`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/App.tsx`）；`AGENTS.md:3-4` 明说有；ADR `:23` 已列这 5 处，`BLOCKED.md:5` 宣称「对齐已落」＝假 | 改文档 | 无门（尺不读 md） |
| 2 | `README.md:1,4,7,10,13,65,68,71,74,82,103,117,144,155,163` 全族 `bin/m0.mjs`/`npx m0` | `git show HEAD:bin` 只有 `cairn.mjs`；`package.json:6-8` bin＝`cairn`；改名笔 `7d19ec4f` | 改文档 | 无门；`tests/…:74` 是合成夹具 |
| 3 | `docs/superpowers/plans/2026-10-03-desktop-m4-byok-onboarding.md:9`「实况：包名 cairn-desktop、env CAIRN_SMOKE」 | `apps/desktop/package.json:2`＝`m0-desktop`；开关是 `M0_SMOKE`（`smoke.mjs:28`、`index.ts:35,47`）；`CAIRN_SMOKE` 只在 `index.ts:262` 的注释里 | 改代码（同笔落改名）＋改文档 | 撞 `agents-command-face` 真仓面：filter 名≠包名即红 |
| 4 | `.github/workflows/verify.yml:31,33,37`「cert face, 22」 | `scripts/gate-manifest.ts:182` 的 `CERT_GATES` 现读 **23**；本轮认证原文 `认证门面=23 道（跑到 23）｜绿 23 道` | 改文档（22→23） | `cert-gate-face.test.ts` 核的是集合不是标注 ⇒ 不红 |
| 5 | `docs/adr/0001:24,26,28`「39 通道/6 接线」「投影 4/30」「renderer 零引用 runCancel」 | `channels.ts:14`＝40 项、`index.ts` wired＝14；`projections.ts:49-81` 7 个 case 含 error；`App.tsx:318` 真调 `runCancel` | 改文档（逐行重测） | 无门 |
| 6 | `docs/DOCS-MAP.md:3`「Desktop plans…absent」＋表 `:5-15` 无桌面行 | HEAD 有 5 份：`plans/…m1/m2/m3/m4`、`specs/2026-10-02-desktop-shell-design.md` | 改文档 | 无门 |
| 7 | `scripts/probe-promise-recall.ts:90` `UI_ROOTS=["src/renderer/","src/preload/"]` | 这两目录 HEAD **不存在**（`git ls-tree -d` 空）；UI 实在 `apps/desktop/src/renderer` ⇒ 这把尺的 UI 面是**空取料**（读数恒 0，不是「没问题」） | 改代码：先把死面改成**出声**，再决定要不要接桌面层 | 接门会撞 `CERT_GATES`「≤1.5s 全进」预算线 |
| 8 | 承诺面覆盖：`README.md:328`、`:4` 无证人 | `agents-command-face.ts:82` 无 `scripts/` 调用点；`README.md:285` 静态 10 工具＝`tools/base.ts:69-72` 减 `verify`，与 `tools-check.ts:55` 一致（这条**不错**） | 改代码（把尺的输入面扩到 md） | 帽不许抬；新格须先配行为观测者 |

## 未证（子代理自陈）
ADR 分母「30 种事件类型」没逐个数（`src/events/index.ts` 形状未采到）；`review…:38` 提议的 `desktop-check` 是否已排期未查。

## 台账动作
新立工单：**`#91`**（文档自称 core-only／改名只改一半＝1·2·3·5·6 那批，前置＝`README.md`＋`docs/*` 腾出手）；**`#92`**（「文档里的诺没有尺」＝把 `agents-command-face` 的输入面扩到 md，先量现读再定帽）；`verify.yml:31/33/37` 的 22→23 与 `UI_ROOTS` 死面出声这两格文件是干净的，本线程自己接。
