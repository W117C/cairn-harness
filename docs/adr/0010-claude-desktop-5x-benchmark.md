# ADR 0010：对标 Claude Desktop 5.1231.2 的全量一手取证与差距清单（报告轮，不改代码）

- 状态：**已接受**——2026-11-12 业主在两问里定案：「**只出对标报告，不动代码**」＋「**app.asar + ion-dist.asar 都跑**」
- 日期：2026-11-12
- 决策者：仓库所有者
- 取代：无（**不推翻**任何既有契约；本 ADR 只把 ADR 0009 的一条**路径事实**更新为现读，并登记一批待办）
- 关联：`docs/adr/0009-codex-claude-benchmark.md`、`apps/desktop/src/renderer/vendor/cds-official/UPSTREAM.json`、
  `apps/desktop/scripts/extract-cds-tokens.py`、`outputs/claude-desktop-benchmark-2026-11-12/`

## 一、取证路径：这次 REA **可用**（更新 ADR 0009 第一节的记录）

ADR 0009 记的是「插件声明的 `rea` stdio MCP 未挂载、`npx -y rea-agents@6.4.0 mcp doctor` 报 `EPERM unlink` ⇒ REA 不可用」。
**本轮现读：那条路径现在通了**——`mcp list` 仍为空，但 `tool_search` 能搜到 `mcp__rea__*` 全套工具
（`analyze_javascript_application` / `inspect_analysis_view` / `trace_application_feature` / `get_evidence_bundle` 等）。
⇒ 0009 那条记录是**当时的**事实，本轮改走 **REA 主分析 + 字节层补读**这条路。

目标与产物（`/Applications/Claude.app`，短版本 **5.1231.2**）：

| 产物 | 大小 | sha256 | REA 证据 |
|---|---|---|---|
| `Contents/Resources/app.asar` | 84,138,194 B | `cfe170ed5c2a0db693ca7f13f1b859c45bd707c924e93f1eece3a92545d9bd96` | `ev_aacd3955699086c06ebb4ed16da9bb92fa0ada7e4088396151f9825498c77dab`（完整分析） |
| `Contents/Resources/ion-dist.asar` | 207,574,690 B | `d7957c54e70073b6a143e09421d456e268a4fc7cb600bf9bfec791c99c7cdaf4` | `ev_0a80171e2f1218f0fbcb738680a90a39ae927a9691c58f573fd2bccf53823d4c` |

**一次如实记录的拦路**：首跑撞 `artifact_integrity_mismatch`——unpacked 成员
`node_modules/@ant/claude-native/claude-native-binding.node` 的**声明摘要**（`36872b74…`）与**实算摘要**（`a2a33b2d…`）对不上
（打包流程签名/剥离原生二进制的常见副作用）。按 REA 自己的 remediation 改用 `integrity_policy=record-and-continue` 重跑，
**观察到的字节被标为不可信后保留**，没有换版本、没有改宿主配置。

> 注：`ion-dist.asar` 那次分析在客户端 120 s 上限处超时，**但服务端已完成**；
> 按 REA 的证据取回路径用 `get_evidence_bundle`（summary）找回 `ev_0a80171e…`，未重跑分析。

## 二、一手证据（指针在 `outputs/claude-desktop-benchmark-2026-11-12/`）

完整取证摘要、原始日志与对照表在 `outputs/claude-desktop-benchmark-2026-11-12/`（`01-取证摘要.md` / `02-CDS-上游漂移差分.md` /
`03-产品面对照表.md` ＋ `logs/`）。本节只列**对决策有影响**的几条。

1. **桌面端 5.x 的渲染层主体不是自绘的 Electron UI**：`ion-dist.asar` 是**打包在桌面端里的 claude.ai Web 应用**
   （5190 个资产 / 4717 个 JS chunk / `index.html` 与 `frame-shell.html` / `client-shell-v1.html`），
   Electron 壳负责 7 个渲染层窗口族（main / quick / about / buddy / find_in_page / file_viewer / local_exec_consent）、
   4 个 utility process 与原生能力。
2. **能力面是版本化契约**：frame 运行时带 **129 个契约版本**（0.1.0 – 0.2.96），每版声明
   `capabilities`(27) / `changes`(97) / `inertChanges`(69) / `core:["permissions"]`；
   运行时代码按能力**切分成 chunk**。
3. **桥面是多命名空间的**：**21** 个 `exposeInMainWorld` 全局名 + 约 24 个 `claude.<域>` 命名空间对象
   （`claude.web` / `claude.settings` / `claude.internal.ui` / `claude.internal.computerUse` / `claude.skills` …）；
   通道名结构化拼装为 `$<uuid>_$_<namespace>_$_<method>`，同一支序列化格式还落在 **35 个具名状态切片**上。
4. **本仓的插件生命周期比上游深**：上游是 6 个**静态内置**技能（`.skill` 是 ZIP，manifest 带 `tier`）；
   本仓是 11 个 `plugin-*.ts` 模块（marketplace / install-jobs / registry / source / update-check / path-safety / …）。
   ⇒ 这一面**本仓领先，不抄**。
5. **动效词汇比 0009 记的厚**：本版编译产物 **56** 个 `@keyframes`（0009 记的那批之外多出 working-dot 三件、
   scroll-fade 六件、sticky-edge 三件、skeleton 两件、tab/标题进场、grid-rows-in、morph-in 等）；
   时长令牌化（`--cds-dur-fast/slow/snap` + `--cds-btn-spring`）；状态钩子 `[data-mode]` 212 处、`[data-reduce-motion]` 88 处。

## 三、最要紧的一条：CDS vendored 已落后上游两个大版本

**这是本轮唯一一条「既有的仓内资产已经不准」的发现。**

`apps/desktop/src/renderer/vendor/cds-official/UPSTREAM.json` 记的上游是 **3.6556.2**（asar sha `b2dfbbb4…`）；
本机上游已是 **5.1231.2**（asar sha `cfe170ed…`）。仓库自带的取证脚本给出的判定是 **`FAIL`**：

| 项 | vendored 记录（3.6556.2） | 本机上游（5.1231.2） |
|---|---|---|
| tokens 成员 | `.vite/build/index.chunk-CbnfBP-3.js` | `.vite/build/index.chunk-SLtcb4nU.js` |
| tokens 字节 / 声明 / 名 | 41,505 / 1,021 / 704 | 38,913 / 957 / 674 |
| 渲染层 CSS | `MainWindowPage-BjVtjJFx.css`（237,153 B） | `MainWindowPage-CinbABxl.css`（246,160 B） |

令牌级差分：**新增 0 个；删除 30 个，全部是 git-diff 状态色族**（`--fill-git-*` / `--on-git-*` / `--text-git-*` / `--bg-git-*` / `--border-git-*`）；
同名字段值变 **1 个**（`--opacity-icon-secondary`：`0.4` → `0.3`）。

**三条要紧的推论**（前两条是观察，第三条是推断）：

1. 被删的 30 个令牌与改值的那个，在本仓**无人消费**——`grep` 命中的 54 处**全部落在 vendored 薄自身**，
   自有组件与适配层一处都没有。⇒ 重抽取时它们会被自然带走，本仓不需要先做适配。
2. `cds-parity.test.ts` **此刻仍绿**：它钉的是「vendored 文件自身与 `UPSTREAM.json` 记录一致」，
   **不是**「vendored 与本机上游一致」。⇒ **上游漂移不会被现有判卷发现**，这是判卷缺口。
3. ADR 0009 照抄的那条「值变了要弹一下」，**本仓的端口形状与 5.1231.2 逐字同形**：
   新版上游是 `cds-pill-pop-up` + `cds-pill-pop-down` 两条关键帧（`to{transform:scale(1.32)}` /
   `0%{transform:scale(1.32)}`），本仓 `styles.css` 里是 `mp-name-pop-up` + `mp-name-pop-down`，
   关键帧体与 40%／60%（回落用 overshoot）的时间切分都一致 ⇒ **本仓不需要改代码**。
   两代之间真正变的是**上游的关键帧命名**（0009 记的 `cds-pill-pop` / `cds-pill-dip` 这条单名没有了，
   变成 `-up`/`-down` 一对，另新增 `cds-pill-roll-in-down` / `cds-pill-roll-out` / `cds-pill-out`），
   而本仓从不引用上游的关键帧名（自有 `mp-name-*`），所以命名变化对本仓无影响。
   > **更正（2026-11-12 晚些时候）**：本条初稿写的是「本仓照抄的是旧一代形状」——**那句话是错的**，
   > 它把「上游改了关键帧命名」误读成「本仓的形状落后」。上游 5.1231.2 的关键帧体与本仓端口逐字相同，
   > 详见 `docs/adr/0011-claude-desktop-5x-reextract.md` 与台账第 1173 页。

## 四、裁决

1. **本轮只出报告，不改代码**（业主 2026-11-12 定）。本 ADR 与 `outputs/claude-desktop-benchmark-2026-11-12/`
   是本轮全部产出；vendor 目录、渲染层源码、判卷**一律不动**。
2. **CDS 漂移登记为待办，不在本轮落地**。理由：重抽取要改 vendor 的四件产物 + `UPSTREAM.json` 的六个摘要字段，
   而 `component-map.json`（45 个组件逐条 ported / no-cairn-counterpart 的人工账）**不能由脚本生成**，必须逐条重判——
   这是一件独立的批次，不该混进一轮报告。
3. **「漂移不被判卷发现」登记为判卷缺口**（待办清单第 2 条）。补法方向已定：另立一条检查，
   钉「vendored vs 本机上游」；**难点是 CI 上没有本机 Claude.app ⇒ 不能钉本机摘要，得钉上游版本或摘要**，
   否则那条判卷会永远红。
4. **桥面归属域**列为候选（待办清单第 3 条）：本仓桥是单一扁平面（`contextBridge.exposeInMainWorld("agent", api)`），
   好处是窄；代价是渲染层拿不到「这块能力属于哪个域」。取的是**域可枚举**这一点，不是上游的 21 个全局名的数量。
   ⇒ **已落地**：见 `docs/adr/0011-claude-desktop-5x-reextract.md` 的姊妹页 `docs/adr/0012-bridge-channel-domains.md`。
5. **`[data-reduce-motion]` 同形属性开关**——**这条候选的判法要改**：机制**早已实装**，但覆盖面缺了一块。
   > **更正（2026-11-12 晚些时候）**：本条初稿写「本仓已有媒体查询归零；上游用根节点属性承载 ⇒ 本仓可考虑加同形属性开关」，
   > **机制那半是错的**：本仓在 **2026-10-28 第 758 页**就已经照上游做了根节点属性开关
   > （`apps/desktop/src/renderer/state/motion-pref.ts`，文件头原话「对标 Claude 的 `data-reduce-motion` 根属性」）——
   > 偏好（跟系统 / 应用内强制减弱）、localStorage 持久化、根属性 `html[data-reduce-motion="true"]`、
   > CSS 侧停动规则。**（更正：`appMotionReduced()` 那半在 HEAD 上没有**——`git show HEAD:…/motion-pref.ts` 里没有这个函数，`useStickyScroll.ts` 只读 `matchMedia`；它是并发会话在共享工作树里的**未提交**工作，见 ADR 0013 第一节的更正块与台账第 1180 页。）
   > **真缺口是覆盖面**：上游那 88 处 `[data-reduce-motion]` 钩子**逐族覆盖**，本仓的应用内开关只停了**自有**动效，
   > **官方 CDS 组件层一条都没盖** ⇒ 用户在应用里关掉动效，**骨架照样呼吸、消息操作条照样显现**
   > （系统偏好那条走全局媒体查询，才停得住）。
   > ⇒ 该缺口已由 `docs/adr/0013-reduce-motion-official-layer.md` 补上（对官方层一刀切）。
   > 同批被更正的是第 3 条（pill 弹跳形状，见上），两条都是同一个病根：**先断言「本仓没有 X」、
   > 再去改，其实 X 早就在**（或早就在、只是覆盖不全）。教训记在 ADR 0011 与台账第 1174/1175 页。
6. **明确不抄**（理由见 `outputs/claude-desktop-benchmark-2026-11-12/03-产品面对照表.md` 第七节）：
   artifact/frame 的进程边界与 `cowork-artifact://` 协议（是 Web 应用架构的产物，本仓无 artifact 概念）、
   129 版 frame 契约的规模（本仓没有那份历史）、动态通道 uuid 拼装（本仓显式 `IPC_PROTOCOL_VERSION` 更强）、
   内置 6 个静态技能（本仓插件生命周期更深）。

## 五、边界（明确不冒充的）

- **REA 的语义图两侧都 `partial` 且被截断**（app.asar 截于 100,000 节点天花板；ion-dist 的 call-flow 仅 223 条、boundary 仅 8 条，
  跨模块关系基本未建成）。上面所有计数是**静态观察**，不是运行时行为。
- **无 source map 随包**（构建产物引用 `//# sourceMappingURL=*.js.map`，但 `.map` 不在 asar 内）
  ⇒ 渲染层组件名只能从 hash 化的 chunk 名与字符串字面量反推，**拿不到原始符号**。
- **本轮未逐条量新 CSS 的关键帧时长/缓动值**，所以 0009 那条「上冲 1.32 / 40% 时长 / overshoot」在新版是否仍同值**未证**；
  `components.css` 那 45 个组件在新 CSS 里是否逐条不变，**未实测**（第 3 条推论是推断）。
- **真机观感未验收**：本轮零视觉改动；即便有，观感仍归业主在真机上看。
- **本轮未跑 `pnpm gates` / `head-cert-check` / `mutate-verify`**：本轮不改代码，这三个量的是 HEAD，跑了也不证明本轮。
  本轮跑的是 `pnpm docs-check`（台账与文档门）。
- **上游 3.6556.2 → 5.1231.2 之间经历了哪些版本**，本轮没查（只知两端）。
