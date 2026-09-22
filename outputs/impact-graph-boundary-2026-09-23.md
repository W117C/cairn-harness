# 影响面的两道静默排除（符号图候选集）——实测与修法草案

日期：2026-09-23 01:3x（HEAD `695e86e`）。本仓自己的仓库就是靶子，所有数字都能按下面的命令复算。

## 结论先说

M7 那条被当成「减少返工」护栏的能力——**改一处立刻看到跨文件波及**——在**本仓当前状态下对
36 个源码文件根本不发生**，而且**一句话都不说**。它不是权限问题、不是设置没开：
`write_file`/`edit_file` 成功后调 `fileImpact`，该函数第一句是「这文件在图里吗」，不在就 `return null`
（`src/agent/impact/index.ts:263`）；`appendImpact` 见 null 原样返回工具输出（`src/tools/base.ts:171`）。
于是模型收到的是一条**成功的写入 + 关于影响面的彻底沉默**。沉默有两种读法：
「这里没有跨文件调用点」（真相往往是这句的反面），或「没算」。界面与模型都分不出来。

## 复算命令与读数

```bash
node --import tsx -e '
const { scanSourceFiles } = await import("./src/agent/map/build.ts");
const { fileImpact } = await import("./src/agent/impact/index.ts");
const cwd = process.cwd();
const capped = await scanSourceFiles(cwd);            // 缺省帽 MAX_FILES_DEFAULT = 400
const all = await scanSourceFiles(cwd, 100000);       // 同一取料面、不截断
const inCap = new Set(capped.map(f => f.rel));
const evicted = all.filter(f => !inCap.has(f.rel)).map(f => f.rel);
console.log({ candidates: all.length, cap: capped.length,
  evictedSrc: evicted.filter(r => r.startsWith("src/")),
  probe: await fileImpact(cwd, evicted.filter(r => r.startsWith("src/"))[0]) });'
```

当场读数（2026-09-23 01:3x）：

| 量 | 值 |
|---|---|
| 候选源码文件 | **436** |
| 进图的帽 | **400**（`MAX_FILES_DEFAULT`，`src/agent/map/build.ts:17`） |
| 落在图外 | **36**，其中 `src/**` **7** 个、`tests/**` **15** 个 |
| 图外的 `src/**` | `src/tools/read_file.ts`、`src/net.ts`、`src/agent/plugins/frontmatter.ts`、`src/agent/recovery.ts`、`src/agent/stuck.ts`、`src/tools/index.ts`、`src/tools/clarify.ts` |
| 端到端证据 | `fileImpact(cwd, "src/tools/read_file.ts")` → **null**（不发事件、不写说明） |

## 为什么「谁在图外」会自己变：按 mtime 取最新

`scanSourceFiles` 末尾是 `out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, maxFiles)`——**帽按最近改动时间取**。
后果不是"少算几个文件"这么简单，而是**同一句问题的答案会随你刚改过别的文件而翻转**：

- 本会话第一次跑上面那段时，被挤在图外的名单里有 **`src/renderer/app.js`**（本项目最热被改的文件）；
- 我随后编辑了它，第二次跑时它已经在图内，图外名单换成上面那 7 个。

⇒ 影响面对同一个文件的答复是**易碎**的：它取决于此刻哪些文件恰好更新。一个"有时会说、有时沉默"的
护栏，比一个不会说话的护栏更坏——模型会把沉默读成"没有波及"。

还有一条放大效应值得单独记：**帽对内容完全无感，只按时间分**。本仓 400 个图位的实际分配
（`scanSourceFiles` 图内文件按顶层目录计数，同一命令可复算）：

| 顶层目录 | 占帽位 |
|---|---|
| `tests/**` | **184**（46%） |
| `src/**` | 127 |
| `scripts/**` | 58 |
| `fixtures/**` | 16 |
| `proto/**` | 7 |
| `outputs/**` | 5 |
| `tmp/**`、`.qoder/**` | 各 1 |

⇒ 一半预算花在被改次数多、但**通常不需要"它波及谁"**的测试文件上，而 `src/tools/*.ts` 这类
天天被引用的实现反而排在外面。（把 `outputs/**`、`tmp/**` 加进噪声只省 6 个位——**杠杆不在噪声表，在帽的分配**。
先前草稿里"产物目录吃掉一大截"那句是我没测就写下的，已按上表改回实测数。）

## 第二道成因：`.gitignore` 里的源码永远不进图

枚举用的是 `rg --files --hidden` 加噪声 glob 取反，而 **ripgrep 默认尊重 `.gitignore`**（`ignore` crate 的
`require_git` 缺省为真，只在 git 仓库内生效）。所以被忽略的源码（常见：生成后再被 import 的客户端桩、
本地 vendor 目录、`.env` 旁的配置代码）永远不会成为调用点，也永远不会出现在图里——同样不吭声。

这两道成因在结果里**同形**：文件不存在、后缀不支持、帽外、被忽略——`fileImpact` 都只说 `null`。
所以修法必须先把这四件事分开说。

## 探针已落在仓内

`tests/map-build.test.ts` 末尾新增一组两条（本文件 7 条全绿，含这两条）：

1. **帽外不吭声**：造 5 个受支持后缀的文件并用 `utimes` 定出严格递增的 mtime，`scanSourceFiles(ws, 3)`
   逐字交出最新 3 个；被挤掉的 `src/m1.ts` 用 `access` 证其**确实在盘上**，而返回值里没有任何
   `truncated`/`candidates` 痕迹（这条断言写的是"今天它什么都没说"——#36 落地时要反过来断言）。
2. **`.gitignore` 掉的源码不进图**：临时目录 `git init` 后写 `gen/hidden.ts` + 对照组 `src/kept.ts`，
   成对判：被排除的那条确实在盘上、对照组确实在图里、`gen/hidden.ts` 不在图里。
   （排除类断言一律成对，单向"扫不到"永远可能是门瞎了。）

## 修法草案（为什么这一轮没动产品码）

**A. 让缺席说出原因（推荐，最小）**：`ImpactHook` 的返回把 `event` 变成可选
（`{ event?: ImpactReportEvent; contextNote: string } | null`），`fileImpact` 在 `null` 前先分辨原因：
后缀不支持 → 不说（本来就不该说）；文件不存在 → 不说；在图外 → 一行
`[impact] src/tools/read_file.ts：该文件不在本次符号图内（原因：超出 400 文件帽 / 被忽略规则排除），波及半径未知`。
**面板不得收这条**——它不发 `impact_report` 事件，这正是本仓已钉死的判据
（`impact-panel-absent-as-zero`：缺席不许写成「波及 0」）。代价：每次编辑最多一行 token。
需改：`src/tools/base.ts`（类型 + `appendImpact`）、`src/agent/impact/index.ts`、`src/agent/map/build.ts`
（把"是否被截断/为什么缺席"暴露出来）。

**B. 让被问的那个文件永远在图内**：`scanSourceFiles(ws, max, mustInclude)`，`fileImpact` 传入被编辑文件。
把"沉默"变成"少数旁路文件仍未知"，A 则负责说清剩下那部分。代价：图内文件集合随每次写入变化 →
tags 缓存命中率下降（缓存按 `{mtime,size}` 键控，被换入换出的文件会反复重解析）。

**C. 帽的分配换成"像实现的先入图"**：先常规源码根（`src`/`lib`/`app`/`packages`）再其余，同层内按 mtime；
噪声表顺带补上 `proto/**`、`tmp/**`、`.qoder/**` 这类明显产物位（实测本仓只省个位数位，**别把它当主杠杆**）。
代价：启发式，非常规布局的项目可能被反向挤出更多——**要配一条"候选数 vs 图内数、以及图内 `src/` 占比"的
读数判据**才知道有没有变好（这条判据本身就该长在 A 的截断标记上）。

**为什么不照直把 400 调大**：真实 monorepo 是 5k–50k 文件量级，帽必须存在；调大只是把悬崖往后挪，
而且把"沉默"的代价换成"每次写入的固定延迟"。反转条件：若某天实测「图内文件数 ÷ 候选数」在本仓
长期 > 90%，说明帽位已经不吃紧，那时可以谈 B/C 的取舍。

**表面在飞**：A 与 B 都要碰 `src/tools/base.ts`，而它此刻在别人未提交的改动集里（`lsp` 联合类型与工具表
那笔，见 AGENTS.md「提交前相交检查」与待办 #33）。同一表面两个 writer 是本仓明令避免的事故形态，
所以这一轮只落探针、数字与这份草案，不动产品码。已立待办 #36；待办 #30（"被 .gitignore 忽略的源码
是否值得点出来"）由本轮实测**升格并入 #36**——真正的支配性成因是 400 帽，不是忽略规则。

## 顺手量出来的现红：`mutate-needles-check` 这道门在 HEAD 上是红的（本会话无关，记名移交）

在 `d0282af` 的**干净 worktree** 里跑针脚体检，报 **阻断 3**；而主树工作树里同一道门只报 1（另一条是
`request-face-tools-ignored`，别人在飞的 `glm-session` 改动把 `face.tools` 改成了 `surface.specs`）。
三条失效的针脚都在 `src/main/sandbox.ts`：

- `sbx-network-branch-dropped` → `if (opts.network === "allow") {`
- `sbx-network-escort-ors-conditions` → `return input.wantsNetwork && input.asked && input.approved ?`
- `sbx-note-gate-dropped` → `network === "allow" || !looksLikeNetworkDenial`

成因不是"实现搬走了忘了改指"，而是**锚点先落地、被测码从未入库**：
`git log -S'if (opts.network === "allow") {' -- src/main/sandbox.ts` **零命中**——这三条串在该文件的
已提交历史里从来没存在过；锚点是 `bdaa6f4`（2026-09-21）提交的，配套沙箱码至今留在工作树。
⇒ 门从 09-21 起就在 HEAD 上红，而任何人主树里跑 `pnpm gates` 都看不见（在飞的 sandbox.ts 把串补回来了）。

这正是 AGENTS.md「HEAD 自洽性」那条的同族：**锚点与它的被测码是一个原子簇**，分在两个表面提交就会留下
"表上守护、实则空转"的窗口——区别只是这次空转的方向反过来（针脚摸不到码，而不是码没了针）。
处置：不代改（`src/main/sandbox.ts` 在别人手里），已立待办 #37 记名给那笔提交；同时这轮把我自己
撞断的旧针脚 `impact-query-deps-ghost-file-silent` 改指到新行（那条是我的责任面，见 `d0282af`）。
