# 复测：地图正文到底会不会自己漂（2026-09-30 第 214 页）

两组探针都**自带取料面自证**：每次构建前抓 `scanSourceFilesAll` 的 `rel@mtimeMs` 快照并比对。
这正是第 213 页那条结论翻车后补上的必备条件——共享工作树里，"等一会儿再测"本身不是控制变量。

- `probe-determinism-with-snapshot.mts`：暖缓存后建一次 → 等 95s → 再建一次
  读数：`repoSnapshotStableDuringWindow=true, charsA=3485, charsC=3485, after95s_same=true, firstDiff=-1`
- `probe-cold-vs-warm.mts`：空 tags 缓存建一次 → 同一热缓存再建一次
  读数：`repoStable=true, coldChars=3485, warmChars=3485, coldEqualsWarm=true, firstDiff=-1`

⇒ 撤掉「地图正文吃相对年龄／同一 sha 给两份文本」。成立的只剩「正文随**文件内容与 mtime**变」（规则 276 那个老缺陷）。
⇒ 第 213 页那次 90s 对照是在**我自己正在往这份仓库写文件**的窗口里做的（改 PROGRESS、建 tests/map-turn-gate.test.ts、插锚点），
   它只控制了时间、没控制取料面，所以那句"决定性"根本不成立。
⇒ 成本模型往回收一句、且朝有利方向：未改动仓库里重送是**字节相同**的 ⇒ 落在缓存读那一档；
   会抖前缀的是"自己改了文件"的那些轮，代价按**改动次数**记而不是按**轮次**记。
