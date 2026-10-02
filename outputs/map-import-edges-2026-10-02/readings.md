# 第 300 页取证 · 能力 1：给符号图补上 import 精确边（正哨兵从「三档全 MISS」变第 34 位命中）

现读时间 2026-10-02 12:10–12:28（本机）。取料面：一次性 AST 探针（普查／形状／收益三份日志在本目录）、`scripts/probe-locate-recall.ts`（能力 1 那把尺）、`tests/map-import-edge.test.ts`（新判卷 20 条）。

## 1. 普查先行（决定形状，也推翻了我自己一次的读数）

对候选面 583 个文件跑 AST 计数（`import-census-ast.log`）：

| 读数 | 值 |
| --- | --- |
| 具名说明符总数 | **7875** |
| 值导入（运行边） | 6721 |
| 类型导入（`import type`／`{ type X }`） | **1154** |
| default／namespace 形 | 15 |
| 裸 side-effect `import "./x.js"` | 3 |
| `export * from` | 0 |
| 值说明符解析命中（指向候选集里的真实文件） | **3556** |
| 未解析 | 3165 —— **全部是外部包**（`node:*`／`vitest`／pkg），**仓内相对路径漏解析 = 0 条** |

「漏解析 = 0」这一格决定成败：它说明补边的覆盖面是**完整的**，不是「先接上看看」。
反面教训要写下来：第一版探针只试 `.js→.ts` 而没试**无后缀**形状，命中率读到 **5.0%（337/6721）**、
`settings.ts` 读到 **0 条入边**——那是一次量法错误，不是事实（本仓源码写 `./x.js` 而盘上是 `x.ts`，
测试与脚本还大量写无后缀）。按「读数一片 0 先怀疑 join 键」重做解析次序后才是上面这组数。

## 2. 实现（三处，一处都不能少）

1. `src/agent/map/import-edge.ts`（新，纯函数不碰盘）：`isInternalSpecifier`／`normalizeRelPath`／`resolveModuleSpecifier`。
   候选次序是语义次序：原样命中 → 换 ESM 后缀（`.ts`/`.tsx`/`.d.ts`）→ 目录 `index` 兜底；越出仓根给 `null` 而不是留一串 `../`。
2. `src/agent/map/parse.ts`：一次解析**两个出口** `fileSymbols() = {tags, imports}`；`fileTags()` 降级成薄壳（不留第二份解析实现）。
   import 面单独一把 Query（深嵌 pattern 与 `source:` 字段同写会被拒，实测三种写法全报 Bad pattern structure ⇒ 捕整条语句再走 AST）。
   `EXTRACT_LOGIC_REV` 手工 **3→4**：老缓存条目没有 imports，命中即给出「没边的图」。
3. `src/agent/map/rank.ts`：`buildGraph` 对**解析成功且对面真有同名 def** 的导入建**精确边并钉住该 ref**（同名全连那支跳过它 ⇒ #9 的歧义在这一格闭合）；
   解析不到 def 的**回落原样**（新维度绝不让现有边变少）；`typeOnly` **不入图**；五个计数 `importStats{refs,edges,external,resolvedNoDef,typeOnlySkipped}` 全部带出。
   缓存：`TagsCacheEntry` 加 `imports`，读的时候 `Array.isArray(e.imports)` 与 tags 同判 ⇒ 冷/热两支一张图。

## 3. 收益读数（这一格是能力 1 的第一次可引用命中）

- `gain-first-build.log`：三档预算（1024／2048／4096）渲染面**都含** `src/main/settings.ts`（此前是**三档全不含**）；
  冷建 1890ms（全量重解析一次，版本位阶所致），其后 215ms／209ms ⇒ 建图代价没有可见增长。
- `locate-recall-after-import-edges.log`：候选 584、进图 584、渲染 60（1024 档）；
  A 臂（条件化）**6/16**（改动前 4/16）、B 臂（不条件化）**5/16**（前 3/16）；
  正哨兵 `L-POS` = **第 34 位命中**（三档同值，前为 MISS）；负控 `L-NEG` 三档仍 MISS（命中定义没被放松）；
  末行 `自检 ✅ 正哨兵命中、负控未命中 ⇒ 上面的命中率可以引用`、`PROBE_EXIT=0`。
  **这是那把尺开张以来第一次绿着退场**——第 299 页那句「命中率这一列不可引用」到此作废。
- 两臂差值仍只有 1 题（6 vs 5），且 16 题里 10 题条件化输入为空 ⇒ 这一格的差值**不许**归因给条件化（页上那条老限定继续有效）。

## 4. 判卷／造红／门

- `tests/map-import-edge.test.ts` **20 条**（解析 5＋精确边 7＋parse 端 4＋接线 2＋缓存两支 2），全为合成输入或 tmp 工作区，不碰真仓。
- 主树全量判卷 **3987 passed／290 文件／182.46s／SUITE_EXIT=0**（`suite-full.log`；这一跑起跑时新判卷还是 18 条，
  其后补的 2 条接线判卷使当前总数为 3989——认证那一拍在干净树上重取，页里的引用值以认证为准）。
- 七台造红（`redmachines.log`，每台复原逐字节一致）：

| 台 | 锚点 | 独有的那条红 |
| --- | --- | --- |
| M1 | `map-import-precise-edge-not-consulted` | 只连 b 不连 c（#9 闭合） |
| M2 | `map-import-type-edge-pooled` | 类型导入不入图＋分母自证 |
| M3 | `map-import-unused-ref-node-dropped` | import 了但没用仍建节点 |
| M4 | `map-import-cache-imports-guard-dropped` | 缺 imports 的旧条目按 miss |
| M5 | `map-import-cold-path-not-wired` | 冷建／热缓存两支都递 imports |
| M6 | `map-import-export-pattern-dropped` | import 与 export 两档图案都在 |
| M7 | `map-import-statement-level-type-ignored` | 语句级 type 与行内 type 都认 |

- typecheck 0 报错；针脚表 1275 → **1282**（+7 ✓）。门耗时口径：本簇不新增门，只有既有门的读数。

## 5. 边界与未闭合（写清楚，别让下一位猜）

1. **类型边 1154 条不入图**——2026-09-23 的裁决要求先分类型边／运行边并在读端分开呈现；`importStats.typeOnlySkipped` 把这一格的数量留在读数里。
   重开条件：先做边的分类与读端分开，再谈把它们并进来（`settings.ts` 的 19 条里有多少是类型边，本轮未拆——那一格归裁决）。
2. default／namespace 形 15 条**没有可对齐的名字**（本地别名≠对面导出名）⇒ 需要**文件级边**，本轮未做。
3. python/go/java 的 import 形状不同 ⇒ `IMPORT_PATTERNS` 编译失败即跳过（不假装覆盖）；本仓候选面今天只有 ts/tsx/js 系。
4. 波及面（`impact/index.ts`）**没接** imports：它按同名全连自建 refs，混进去会静默改掉边集精度 ⇒ 留给 #9 的根治那一笔（届时精确性判卷可以直接吃这轮的解析器）。
5. A 臂 6/16 里剩下的 MISS 是否同因（符号名歧义／渲染 cut）未拆——下一格该问的是「MISS 的那 10 题，真值文件在图里排第几」。
