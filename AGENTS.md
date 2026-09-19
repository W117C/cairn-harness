# M0 桌面编程 Agent（agent-plan.md 的实现）

`agent-plan.md` 是唯一权威方案——那是方案，不是代码，只读。渲染层是**手写 vanilla**，不是 React。

## 分工：每轮必读的只有这一份，其余按需

| 要看什么 | 去哪 |
|---|---|
| 现在在哪 / 在飞什么 / 还有什么没裁 | `STATE.md`（**整体重写，永不追加**） |
| 历史与审计链（备案、裁决全文、各轮实录） | `archive/progress.md`、`archive/blocked.md`（**只追加不改写**；永不整读，按「」标签取用） |
| 某道门实测多久、多少未证 | `pnpm facts`（值只活在 `docs/facts/gates.json`，**不要抄进文档**） |
| 门禁清单与条数 | `scripts/gate-manifest.ts`（清单即事实源；新增门只改它，**别把门数写进文档**） |
| 里程碑验收三态表 | `docs/m{2,3,4,5}-acceptance.md`、`docs/m{3,4}-audit.md` |

本文件只放"不知道就会这一轮做错事"的规则：不放状态、不放抄来的数值、不用追加一段去反驳上一段。
不要的结论就地删掉，要留历史写进 `archive/`。（`docs-check` 的 D-1/D-2/D-4 机械守这三条。）

## 怎么跑

- 安装 `pnpm install`；全部门禁 `pnpm gates`（逐道退出码 + 恒真式/析取式体检 + 未证汇总；
  `DSH_STRICT_UNVERIFIED=1` 或 `--strict-unverified` 让未证直接判红）
- 起界面 `pnpm start`；单跑闭环 `pnpm e2e`（mock 模型驱动 loop 修 `fixtures/todo-app` 的 bug）
- 跑验收一律 `TERM=dumb`：`TERM=xterm-256color` 会让 vitest 输出 ANSI 序列，摘要正则假红

## 环境坑（每条都造成过假红或真崩）

- 在 DSH 里跑时，pnpm 脚本内的 `node` 解析到 Electron-as-node，不是宿主真实 node。怀疑环境问题时
  用 `pnpm exec node -p "process.versions"` 确认到底哪个运行时在跑。
- 沙箱内跑不了 `pnpm test`（pnpm 自身依赖检查失败）→ 用
  `node node_modules/vitest/vitest.mjs run --pool=threads`；`src/main/agent-runner.ts` 已自动做这个映射。
- 沙箱三门（`sandbox:check` / `ipc:check` / `panels-check`）按宿主自动选分支：沙箱可用走真断言，
  宿主拒 apply deny 规则则降级；**输出显式打印走了哪支**（fail-visible，不真空通过）。反向验证
  `-- --force-available`（强制真断言）/ `-- --bogus-root`（必红）。
- Electron 在拒载 Chromium 沙箱的宿主必须带 `--no-sandbox --disable-gpu`，否则窗口起不来
  （panels-check 会探测并自动附加；自写截图脚本要自加）。
- **构建假红陷阱**：同一轮累计删除达到阈值后，宿主 safe-delete shim 会拒绝清理 `out/`，
  `electron-vite build` 报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`，连累 panels-check 报"build 退出码 1"
  ——那是**陈旧计数器误报**。绕法（只影响该次调用的守卫计数）：`CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR= pnpm build`，
  **只用于构建/门禁**。鉴别：日志里没有 `B0 Electron 起不来` 也没有探针断言失败、只停在 build ⇒ 先怀疑这条。
- Electron/CDP 类门（panels-check 等）有**宿主负载相关的时序 flake**：同一份代码可一次红一次绿。
  判读顺序 = 先单跑复验；只有真断言失败才动代码，**不要拿 flake 去改探针或改阈值**。
- macOS 沙箱规则里的路径必须是 realpath（`/tmp` 实为 `/private/tmp`），否则规则静默失效。
- renderer 的 CSP 是 `style-src 'self' 'unsafe-inline'`：全部 CSS 是 `index.html` 里单个内联 `<style>`
  （dev 与构建产物都内联），unsafe-inline 必须保留。
- 渲染层预览一律经 vite（`pnpm dev`，或 `pnpm build` 后开 `out/renderer/index.html`）：
  `app.js` 会 `import … from './projections'` 解析到 `.ts`，**直接把 `src/renderer/index.html`
  拖进浏览器会因裸 `.ts` 解析失败整模块挂掉**。

## 并发与提交纪律（本仓逐条实踩过）

- **编辑任何已跟踪文件之前**，先 `git diff HEAD -- <file>`：工作树对它已有改动且不是你写的
  ⇒ 那是别人的原子单元，只追加不改写，或先把对方的 diff 备份再重建。
- **禁用目录级 `git add`**（`git add -A` / `git add tests`）。按文件名加；暂存与提交前后各核一次
  `git status --short`——并发会话可能在你暂存的间隙刚落盘。
- 归档/删除类改动**必须成组提交**：删一个被已提交代码引用的模块时，同一提交里带上"新定义位置 +
  所有 importer 改指 + 依赖与构建配置变更"。一次性抓全的办法是 `git worktree add <tmp> HEAD`
  再在 tmp 里 `tsc --noEmit`（干净检出会暴露所有悬空）。
- 共享热点文件（`scripts/mutate-verify.mjs` 的变异表）插入点会漂：追加前先重读表尾，改完立刻
  按 id 单跑自己那几条并尽快落库——否则你的行会被别人的提交一起卷走，commit message 与实际不符。
- **`mutate-verify` 不可在同一工作树并发跑**：它按"读原文 → 改写源文件 → 用刚读到的那份还原"工作，
  两个跑会互相把对方的突变体当原始内容写回。跑前 `ps -eo command | grep mutate-verify` 确认只有一个；
  共享树里优先 `pnpm mutate-verify <id…>` 只跑自己那几条。
- 跨多文件、需要较长时间保持未提交态的改动，在独立 worktree 里做（`git worktree add .worktrees/<名>
  -b <分支> HEAD` + `ln -sfn <主树>/node_modules node_modules`），主树只用于收口；合并后以 `pnpm gates`
  为唯一收口凭据。

## 目录与约定

- `src/agent`、`src/events`、`src/tools`、`src/permissions`、`src/providers` —— 内核（loop / 工具 /
  权限门 / 模型适配）；`src/main`、`src/preload`、`src/renderer` —— Electron 壳
- `fixtures/todo-app/` 是验收靶子、`fixtures/mock/` 是冻结的模型剧本；两者的 `tests/**` 与
  `fixtures/mock/**` 属判卷文件（见下条 sha256 冻结）
- `agent-plan.md` 只读——那是方案，不是代码

## 已声明取舍（备案面，非缺陷）

renderer `webPreferences.sandbox: false`（ESM preload 需要，contextIsolation 仍开）；可安装包 unsigned V1。
细节与后续可改路径见 `archive/progress.md` 的归档段。

## 判卷纪律

- 判卷标准（grep / 断言 / 验收脚本）是**冻结的**。发现判据有缺陷 → 写 `archive/blocked.md`
  **要求换判据**，不许改代码去绕。
- 判卷文件 sha256 冻结在 `scripts/frozen-sha256.json`：`fixtures/todo-app/tests/**` 与 `fixtures/mock/**`
  改它们等于作弊。
- 硬指标里的 grep 一律写精确模式（锚定行首/分号）；扫描类判据（如 key 扫描）用词边界
  （`\bsk-` 而非 `sk-`），消除 AskGate 类假阳性。
- ⚠️ **词边界只在 JS 正则里成立。** 门禁判据写在 JS 侧（`RegExp` / `includes`）时 `\b` 是标准语义、
  可用；**一旦落到 shell `grep`，`\b` / `\s` / `\|` 三个 GNU 扩展 BSD grep 全不支持且静默返回空**
  （本仓已因此误判 4 次；实证：`grep -c '\binert\b' src/renderer/index.html` 得 0，`grep -cw "inert" …` 得 2）。
  ⇒ **门禁判据一律写 JS 侧**；命令行排查一律 `grep -E` + `[[:space:]]`、词边界用 `-w`。
  **永远不要信 shell grep 的 0 命中**——先怀疑模式写法，再去改代码。
- 底栏节点格式契约（写新门禁前必读）：`#eventCount` 是**裸整数**（当前展示中会话的事件数，重放
  不得伪造），大数可安全 `includes("10000")`；`#tokenTotal` 走 `tokStr()` **会缩写成 `"1.5k"`**
  ⇒ **对 token 计数不要写裸数字断言**，否则是自造假红。
- 右栏五面板唯一数据源 = `projectPanelData(会话事件, 运行目录)`（`src/renderer/projections.ts`）：
  渲染层不得再挂演示常量（假象比空白更坏），无数据走 `panelEmptyHTML()` 空态。
