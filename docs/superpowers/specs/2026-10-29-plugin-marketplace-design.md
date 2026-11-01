# 插件市场与统一安装来源设计

日期：2026-10-29

状态：待用户批准。批准前不写 PLUGIN-2 产品代码。

父设计：[Agent OS 桌面端设计与分阶段交付](./2026-10-29-agent-os-desktop-design.md)

## 目标

把当前只能查看本地插件快照的“插件”目的地升级为完整插件生态：

- 从第一方签名目录发现、筛选、审查和安装插件。
- 从公开 HTTPS Git 仓库导入插件。
- 从用户通过系统目录选择器挑出的本地目录导入插件。
- 管理已安装插件的版本、来源、作用域、启用状态、配置、风险与卸载。
- 只对有真实版本/来源证据的插件显示可更新状态，并执行来源绑定的更新。
- 保留当前 Warm Cairn 工作台语言，不把插件页做成营销页或通用卡片墙。

本轮只交付 PLUGIN-2。记忆库、自动化和其他页面迁移继续由父设计分阶段推进。

## 已确认事实

- 用户选择“全部都需要，按照最优解来”：签名市场、Git 导入、本地导入、发现、审查、安装、启用/停用、更新、卸载均在范围内。
- 当前后端已有验证过的签名目录、HTTPS 包下载、SHA-256 校验、安全解包、manifest/能力扫描、内容指纹、禁用态发布、rollback、registry、启用/停用和卸载。
- 当前协议为 v28；渲染层尚未消费市场与安装通道。
- 现有插件安装只在任意 agent run 活跃时拒绝变更，因为运行开始时固定插件启用集与内容。
- 现有 registry 没有来源信息，更新比较前必须补齐 provenance。
- 现有 `AppPage.tsx` 已达 1,075 行；插件市场必须拆成独立 state、derived 和 components 模块，不能继续堆入该文件。

## 方案与取舍

### A · 统一来源管线 + 编辑精选货架（已选）

官方目录、Git、本地目录都解析成同一种“已暂存插件包”，随后复用同一套 manifest 验证、能力扫描、内容指纹、审查、禁用态发布、registry 与 rollback。发现页使用编辑精选、最近上架和分类货架；已安装与更新保持紧凑控制台。

优点：

- 三种来源的信任与错误语义一致。
- Git/local 不会形成绕过风险审查的快捷路径。
- 来源字段可用于阻止跨来源替换。
- 新来源以后可以继续接入，不需要重写生命周期。

代价：

- 需要把当前只接受 `MarketplaceEntry` 的安装 job 抽象成来源解析器 + 统一 staged package。
- registry schema 需要迁移并保留旧记录。

### B · 三种来源各自独立流程

市场安装、Git 导入、本地导入分别有自己的任务、审查、发布和更新实现。

优点：入口容易解释，最初实现可分头推进。

缺点：安全检查、回滚和状态处理重复；后续极易产生能力不一致。update 也很难可靠判断来源。放弃。

### C · 本地目录控制台优先

先只做已安装列表与本地导入，签名目录发现延后。

优点：最快形成可用管理页。

缺点：不满足完整插件市场，也没有供应链验证；与已完成的 PLUGIN-1 后端不匹配。放弃。

## 产品信息架构

插件目的地的页面级视图固定为：

1. **发现**
2. **已安装**
3. **更新**

上下文侧栏提供：

- 发现
- 已安装
- 可更新
- 精选
- 分类

数量只来自真实数据：

- 已安装数来自 registry 与运行时快照合并。
- 可更新数来自真实的 source-bound 比较。
- 不显示下载量、评分、评论、热度、关联用户或虚构推荐语。

### 发现

首屏不是 Hero。内容由一个紧凑工具带和 2–3 个货架组成：

- 工具带：搜索、来源/能力筛选、导入按钮、刷新。
- 精选：目录维护者编排的真实条目。
- 最近上架：按签名目录的 `publishedAt`。
- 分类：在目录 schema 有稳定分类字段后使用；第一版可按 capability/primary capability 形成非虚构分组。

插件卡只展示：

- 名称。
- 一句话用途。
- 作者与来源类型。
- 版本。
- 真实能力摘要。
- 兼容性。
- 安装/启用状态。

卡片不使用伪造的截图为必填项。若目录未来提供经过校验的真实媒体，在详情中展示；没有时以能力结构承担视觉层级。

### 已安装

使用无外框的紧凑运维列表，而不是重复市场卡片：

- 名称与用途。
- 来源：官方目录 / Git / 本地。
- 版本。
- 作用域：全局 / 当前项目。
- 启用状态。
- 更新状态。
- 风险/异常标记。

行操作保持图标化：启用/停用、更新、卸载、查看详情。危险操作进入确认层。

### 更新

只显示有真实证据的项：

- 官方目录：同 `entryId`，目录版本高于已安装版本。
- Git：同规范化 repository identity 与 ref，远端 commit 与已安装 commit 不同。
- 本地：用户在“从目录更新”中选择了同一 manifest identity 的目录，并且内容指纹/版本变化。

“检查 Git 更新”是显式网络动作。未检查、离线、被拒绝和已是最新是四种不同状态。

批量更新可只在每项来源、目标作用域和风险均已展示后提供。第一版优先单项更新，避免把多个未审查内容一次性提交。

## 详情与安装审查

点击市场条目打开宽详情抽屉；宽度不足时变为全高 sheet。

详情固定分区：

- 概述：名称、用途、作者、许可证。
- 来源：目录 revision、source URL、Git URL/ref/commit 或本地路径。
- 版本：当前版本、可用版本、兼容性。
- 能力：skills、commands、agents、hooks、MCP、LSP 的实际数量。
- 权限与配置：声明权限、敏感配置项、需要用户补全的字段。
- 风险：manifest warnings、路径/软链问题、无法完整指纹、来源不匹配。
- 动作：安装、更新、启用、停用、卸载。

安装/更新审查与市场详情共用骨架，但审查必须先有暂存包，因此内容以下列真实结果为准：

- 来源 identity。
- 目标作用域与实际 workspace 归属。
- 版本/revision/commit。
- 内容 SHA-256 与 bounded fingerprint。
- 实际扫描能力。
- 声明权限。
- userConfig 字段。
- warnings。

审查页必须明确“这一步只发布为 disabled；启用是下一步”。更新也先进入 disabled，确认后再启用。

如果用户切换了当前项目，任何尚未 commit 的来源审查立即关闭并显示原因，不能把同一审查静默改到新目标。

## 来源模型

共享 discriminant：

```ts
type PluginSource =
  | {
      kind: "catalog";
      catalogId: string;
      entryId: string;
      sourceUrl: string;
      revision: string;
    }
  | {
      kind: "git";
      repositoryUrl: string;
      ref: string;
      commit: string;
    }
  | {
      kind: "local";
      sourcePath: string;
    };
```

约束：

- `entryId` / manifest name 是安装 key 的一部分，但不是 update 的来源 identity。
- 同一次运行可见范围内，manifest name 必须唯一。已有同名 user/project 插件时，新安装 fail closed；不能让同名插件在技能、MCP 命名空间或 userConfig 上互相覆盖。
- 相同 manifest name 的不同来源不能互相覆盖；若目标 key 已有不同来源，更新必须拒绝并要求先卸载。
- 本地路径写入 registry 时保持本机私有：registry mode `0600`，界面可显示路径，日志只显示脱敏后的 basename。
- Git URL 在入库前规范化；只允许 HTTPS 公网仓库，不接受 credentials、loopback、私网 IP 或保留域名。

### Git 导入

输入：

- repository URL。
- 可选 ref；缺省用远端默认分支。

主进程流程：

1. 验证 URL、协议、host、端口与 credentials。
2. 通过受控环境执行非交互 Git clone。
3. 禁止本地/扩展协议、submodules、hooks、interactive prompts 与 credential helper。
4. 只 checkout 一个目标 commit。
5. 拒绝 `.gitmodules`、符号链接与超出文件数/总大小/单文件大小的目录。
6. 移除 `.git` 等版本控制元数据后进入统一 staged package。
7. 记录规范化 URL、ref 与解析后的 commit。

Git clone 不能执行仓库代码、安装脚本、Git hooks、LFS smudge 或 submodule update。

### 本地目录导入

- 只能从系统目录选择器得到源路径；渲染层手输路径不能直接启动导入。
- 主进程记住当前会话中被真实选择过的目录。
- 复制时不跟随符号链接，不复制 `.git`，执行文件数/大小上限。
- 必须存在 `.claude-plugin/plugin.json`。
- 复制源与桌面应用数据目录、目标安装目录不能重叠。
- 导入后重新从 staged 副本扫描；不从活动目录直接安装。
- 本地更新必须来自同一规范化 `sourcePath`。源目录被移动到新路径时，registry 把它视为 source-changed，要求卸载后重新安装，不能借同名覆盖来源。

### 官方目录

- 保持单一第一方签名目录。
- 客户端不接受任意 catalog URL。
- 目录过期时只可读取上次通过签名验证的缓存，并显式显示缓存时间与过期状态。
- 坏缓存、无缓存、目录配置缺失和网络失败必须分别呈现。

## 统一安装 Job

当前 job manager 的 download/archive 分支变为来源解析前置：

```ts
interface ResolvedPluginStage {
  root: string;                 // 已安全落盘的插件目录
  source: PluginSource;
  packageSha256: string;        // archive digest or deterministic directory digest
  declaredCapabilities?: MarketplaceCapabilities;
  declaredPermissions: readonly string[];
}

interface PluginSourceResolver {
  resolve(input, stageDir, signal): Promise<ResolvedPluginStage>;
}
```

解析后，所有来源执行相同步骤：

1. 拒绝 JS entry。
2. 解析 manifest。
3. 扫描 skills/commands/agents/hooks/MCP/LSP。
4. catalog 来源比较签名能力与实际能力。
5. 计算完整内容指纹；bounded 即失败。
6. 生成 review。
7. 等用户 commit。
8. 发布到 disabled root。
9. 写 registry v2。
10. 用户显式 enable 后移动到 active root。

Job states 扩展为：

- `queued`
- `resolving`（目录下载、Git clone、本地复制共同入口）
- `verifying`
- `review`
- `installing`
- `succeeded`
- `failed`
- `cancelled`

为兼容现有 UI/测试，底层子阶段可在 note/progress 中显示“下载 / 克隆 / 复制 / 扫描”，但不要把同一个 review 生命周期复制成三套。

## Registry 迁移

Registry schema 升为 v2：

```ts
interface InstalledPluginRecord {
  entryId: string;
  manifestName: string;
  version: string | null;
  sha256: string;
  fingerprint: string;
  source: PluginSource;
  scope: "user" | "project";
  workspace: string | null;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
}
```

读取 v1 时把旧记录迁移为 `{ kind: "catalog", catalogId: "cairn", entryId, sourceUrl: "", revision: "" }`，下一次写入时落 v2。迁移失败不能静默清空；registry 的 malformed/error 与空列表必须分开。

官方目录条目必须声明 semver。Git/local manifest 可以没有版本：

- registry 保存 `version: null`，界面显示“未声明版本”，不能伪造 `0.0.0`。
- Git 更新比较 commit。
- 本地更新比较内容 fingerprint 与实际扫描结果。
- 已安装列表排序回退到 `updatedAt`。

## Builder Check 收敛

独立 builder check 指出的决策点按以下规则实现：

1. **安装身份。** registry key 仍为 `(entryId, scope, workspace)`，manifest name 在一次运行可见集合内唯一。跨来源同名、跨 scope 同名都禁止新建；手工插件冲突只展示不可操作的“名称冲突”。
2. **Git/local 权限。** 不信任 manifest 自报的权限字段。审查页写明“来源未提供签名权限清单”，并展示实际扫描出的 hooks/MCP/LSP 等执行面；官方目录继续使用签名 `permissions`。
3. **未托管插件。** runtime snapshot 中不在 registry 的记录进入“未托管”只读分组，可查看、信任和配置，但不提供受管更新、启停移动或卸载。界面明确区分 registry-owned 与手工目录。
4. **安装时配置。** review 可展示并收集 `userConfig`，但值直到 commit 成功后才写入。commit 后调用新增的 installed-config 通道；服务端从 disabled package 重新解析字段并校验，不信任 renderer 传入的 schema。required 缺项阻止 enable，不阻止 disabled publication。配置写入失败时 package 保持 disabled。
5. **本地来源绑定。** 本地 update 只接受同一 canonical source path。路径变化、basename 变化或 manifest name 变化都不算同源更新。
6. **缺失版本。** catalog 仍要求 semver；Git/local 允许 `version: null`，稳定身份由 repository commit 或 local source identity + fingerprint 提供。
7. **卸载与配置。** disable 保留 package、userConfig 和 secret。uninstall 的确认文案明确会同时删除 registry-owned package、trust、userConfig 与 safeStorage 敏感值。删除过程纳入同一事务；任一步失败都恢复原 package/registry/trust/config 状态并显式报错。

这些决定不改变用户确认的产品范围，只补齐实现语义。

## 协议与 IPC

协议版本升级，新增/调整以下面：

- `marketplacePluginImport(source, scope, workspace?)`
- `marketplacePluginCheckUpdate(entryId, scope, workspace?)`
- `pluginPickLocalSource()`（只返回用户通过对话框选择的目录）
- `pluginConfigureInstalled(req: { entryId, scope, workspace?, values })`（从磁盘上的安装记录重新解析字段并校验，允许配置 disabled package）
- 现有 catalog/install/status/commit/cancel/enable/uninstall/installed 通道继续使用。

`marketplacePluginImport` 可复用统一 install job 类型，但 renderer 仍不能提供：

- package URL。
- archive digest/size。
- target root。
- disabled root。
- manifestName 作为命令权威。

Git URL/ref 与目录路径是用户选择的 source input，不是安装目标。主进程负责所有 target 解析。

## 渲染层拆分

新增模块建议：

```text
src/renderer/
  state/plugins-marketplace.ts
  derived/plugins.ts
  components/plugins/
    PluginsWorkspace.tsx
    PluginDiscover.tsx
    PluginInstalled.tsx
    PluginUpdates.tsx
    PluginDetail.tsx
    PluginReview.tsx
    PluginImportMenu.tsx
  components/plugins.css
```

职责：

- state hook：catalog、registry、runtime snapshot、active jobs、selection、search/filter、workspace scope、error states。
- derived：shelf/section projection、install state merge、source-safe update comparison、search/filter。
- components：props in / events out；不直接下载、解包或读文件。
- `AppPageBody` 只负责 composition 与现有 operation error 转交。

### 状态

每个数据面独立：

- catalog: loading / ready(live) / ready(cache) / stale / corrupt-cache / unavailable / error。
- registry: loading / ready / error。
- runtime snapshot: loading / ready / unavailable。
- job: queued / resolving / verifying / review / installing / succeeded / failed / cancelled。
- update: unknown / checking / current / available / failed / source-changed。

错误恢复必须提供有效动作：刷新、重试、改用本地导入、重新选择目录、查看缓存时间等。

## 视觉与响应式

### 视觉

- 沿用现有 warm cream、terracotta、hairline、system sans 和既有字号/尺寸 token。
- 页面标题只写“插件”；不使用功能说明副标题。
- 页签无 pill 嵌套，用一条明确的下划线/底色当前态。
- 发现货架用横向分组和不同信息密度表达编辑感；不采用阴影重的重复营销卡。
- 已安装与更新为行式控制台。
- 精选条目可以用更宽的“主推行”承载一项真实能力组合，但不使用大 Hero、背景图或伪造截图。
- 圆角不大于 8px；无卡片套卡片；lucide 图标承担工具动作。

### 1440

- 48px 全局 rail + 200px context sidebar。
- 内容最大宽度约 1080px；货架双列或三列自适应。
- 详情为 380–440px 右侧抽屉，列表保持可见。

### 1120

- context sidebar 仍可显示；货架降到两列。
- 详情抽屉优先覆盖右侧内容，不压缩操作列到不可用宽度。

### 880

- context sidebar 收起，同义视图/筛选进入页头工具带。
- 货架单列或可横向滚动但不隐藏主要条目信息。
- 详情切换为全高 sheet。
- 页签、搜索、导入、刷新不得重叠；长名称换行或省略但保留 title/可访问名称。

## 空态、错误与离线

- 无安装：显示“还没有插件”和一个真实主操作“导入插件”。
- 市场无 cached data：显示 unavailable + 配置/网络原因 + 本地/Git 导入入口。
- 市场为空但有效：显示空目录状态，不推荐伪造条目。
- 缓存损坏：显示缓存损坏，允许 force refresh；不可用坏缓存冒充空市场。
- 离线且有 cache：展示 stale origin、fetchedAt/expiresAt 和可继续浏览的条目。
- 安装失败：保留 review 可取消/重试；已安装版本不改变。
- 更新失败：明确当前版本仍可用。
- run 活跃：操作控件禁用并说明“下一轮生效”的实际阻塞；不是通用灰色无解释。

## 安全与生命周期

- 安装/更新/停用/卸载在 run 活跃时 fail closed。
- 已安装内容在启用前重新核对 fingerprint。
- catalog、Git、local 的 source identity 与内容 fingerprint 均要落 registry。
- 更新不能跨来源。
- 所有发布先 disabled，再显式 enable。
- 提交串行化沿用 install key。
- rollback 失败要保留原可执行副本；不是删除后重试。
- Git、本地导入与目录下载都限制字节/文件/条目数量并有超时。
- 不执行任何第三方构建脚本。

## 测试

### 纯函数与 state

- catalog/registry/runtime 合并。
- 搜索、capability/source filter、shelves。
- source-bound update comparison。
- 项目切换关闭未 commit review。
- job polling 只允许新 generation 覆盖旧响应。

### 组件

- 发现/已安装/更新三种视图。
- loading / live / cache / stale / corrupt / unavailable。
- 详情和审查的真实来源、目标 scope、digest、能力、权限、配置、风险。
- 启用/停用/卸载/更新状态与确认。
- 1440/1120/880 的布局契约和 keyboard/focus 返回。

### 后端

- Git URL 拒私网/credentials/非 HTTPS。
- Git clone 禁用 hooks/submodules/prompts，记录 commit。
- local source 必须来自系统选择路径；拒绝 symlink、超帽、路径重叠。
- 三来源都经过统一 capability scan 和 fingerprint。
- v1 registry 迁移。
- source mismatch 拒绝更新。
- install failure 保留旧版本。
- run-active gate 对所有 mutation 生效。

### 端到端

- 从签名 fixture catalog 安装 disabled plugin。
- 启用后下一轮可发现。
- Git fixture / local fixture 导入同一 review 流程。
- 更新失败不改变已安装版本。
- 离线 cache 与损坏 cache 可辨。
- 真实 Electron screenshot 覆盖 1440、1120、880、亮/暗主题。

## 非目标

- 任意第三方 marketplace URL。
- 评分、评论、下载量、社交证明。
- 在应用内发布插件或写入第三方仓库。
- 执行 JavaScript 插件、安装脚本、Git hooks 或 submodules。
- 插件热替换运行中的 agent。
- 本轮顺带重做记忆、自动化、技能或设置页。

## 实施顺序

1. 共享 source/provenance 类型与 registry v2 迁移。
2. 将 install job 抽象为 source resolver + 统一 staged pipeline。
3. Git resolver、local picker/resolver 与安全测试。
4. IPC v29、preload 类型、main 装配。
5. derived/state 与组件拆分，替换现有 PluginsPane。
6. 更新检测与操作完整性。
7. Electron 截图、离线/错误/窄窗/键盘验收与 detector。

## 验收

- 官方目录、Git、本地目录三条路径都能进入同一个 review 并安装 fixture。
- 三种来源都能在已安装页显示，且来源不相同时不会互相更新。
- 目录 live/cache/stale/corrupt/unavailable 五态可辨。
- 每个 mutation 在 run active 时可见拒绝。
- 更新失败不改变当前版本；卸载只删除 registry-owned 内容。
- 1440、1120、880 下无重叠或不可达操作。
- 组件/state/后端/桌面测试、typecheck、renderer layer、desktop boundary、build、docs-check 通过。
- 真实 Electron 合成 API smoke 与截图作为工作树证据，并明确未验证真实生产目录/密钥/GitHub 网络边界。
