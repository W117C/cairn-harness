# 第 432 页 · `--doctor` 第七项：信任落点的尺形与造红计划

本页只记「这把尺怎么定形状、六根锚点各咬哪一格」；认证读数在凭证页（单独一笔）。

## 1. 这一格要报什么（判据来源）

- 动因：第 424 页把插件数据根从 `<os.tmpdir()>/m2e-plugin-data` 搬进 `<home>/.config/cairn/plugin-data`。
  搬完之后的状态没人报：它在哪、权限位多少、表里有几条决议。信任决议是静默落盘的动作，
  自检面不报它，用户只能靠读代码知道「我的决议写进了自己家里」。
- 落点与表名都**复用装配面那两个出口**（`pluginDataRootOf` / `trustFilePathOf`），doctor 侧不出现
  `plugin-data`、`plugin-trust.json` 这两个字面量——第二份事实源正是那次搬家会让它指到旧地址的形状。
- 条数取自 `parseTrustFile` 返回的那份**数组**（与 `TrustStore.load` 同一个函数），
  于是报告里的数字与装载时真正生效的那份表同源；doctor 不 `JSON.parse`、不 `Array.isArray`。

## 2. 三态的分配（每一格都有「读不出」那一档）

| 维度 | 取值 | 判读 |
| --- | --- | --- |
| `dirState` | `ok` / `absent` / `unreadable` | 只有 `ENOENT` 算 absent；`EACCES`、路径中段是文件一律 unreadable |
| `dirMode` | 数字 / `null` | 非 ok 时 `null`，不许由 0 顶成「不可写」；世界可写按 `mode & 0o002` |
| `storeState` | `ok` / `absent` / `unreadable` | 坏 JSON 与 0 字节都算 unreadable；不存在才算 absent |
| `entries` | `{trusted, declined}` / `null` | 只从 `storeState === "ok"` 那条分支取长度 |

纯核另有一格「状态与条数不自洽」（state 说 ok 却没给数、说 absent 却给了数）⇒ 也判红：
那种输入只可能是取料面写错，读成「干净」就是拿没尺当没问题。`fatal` 仍只留给 node 那一项。

## 3. 六根锚点 → killer 用例（每根咬不同一条）

| 锚点 id | 突变 | killer 用例 |
| --- | --- | --- |
| `doctor-trust-world-writable-silent` | `worldWritable` 折成 `false` | 世界可写（0777）⇒ ✗ 并点名这条洞，但仍不是致命项 |
| `doctor-trust-stat-error-folds-to-absent` | stat 的所有抛都读成 ENOENT | 只有 ENOENT 才读成 absent，其余抛（EACCES／ENOTDIR）留在 unreadable |
| `doctor-trust-not-a-directory-counts-as-ok` | 去掉 `isDirectory()` 判断 | 落点同名但是个文件 ⇒ ✗（stat 成功不等于它是目录，不许落成「还没建」） |
| `doctor-trust-broken-store-reads-as-ok-empty` | 表读不出时状态折成 ok | 表是坏 JSON ⇒ ✗ 并说「读不出」；同一路径换成 0 字节也是读不出，两条都不许报成 0 条决议 |
| `doctor-trust-root-recomputed-not-shared` | doctor 自己拼数据根 | 表里有决议 ⇒ 如实报条数，且报的是 env 给的那个落点（不是 home 下拼出来的第二个） |
| `doctor-trust-check-computed-not-pushed` | 摘掉 `checks.push(trustFaceCheck(f.trust))` | 固定清单＝七项，顺序即渲染顺序，第七项是 trust（第 432 页带进来的那一格） |

## 4. 落库前的取料自证（只读探针，`/private/tmp/p432-needle-selfcheck.mjs` 本轮实跑）

```
OK   doctor-trust-world-writable-silent 针脚=1 标题=1
OK   doctor-trust-stat-error-folds-to-absent 针脚=1 标题=1
OK   doctor-trust-not-a-directory-counts-as-ok 针脚=1 标题=1
OK   doctor-trust-broken-store-reads-as-ok-empty 针脚=1 标题=1
OK   doctor-trust-root-recomputed-not-shared 针脚=1 标题=1
OK   doctor-trust-check-computed-not-pushed 针脚=1 标题=1
哨兵（应当 0）针脚=0 标题=0
```

每条针脚在 `src/main/doctor.ts` 逐字命中 1 处、每条 `expectFail` 在 `tests/doctor.test.ts` 命中 1 处，
并配一个已知不可能为 0 的反面哨兵（把突变后的写法拿去问盘，必须 0）——否则「全是 1」没有含义。

## 5. 判卷面（`tests/doctor.test.ts` 本轮改动）

- 纯核 12 条（`trustFaceCheck` 一节）＋ 固定清单 1 条 ＋ verdictOf 1 条（第七项红 ⇒ 部分就绪/0）
  ＋ IO 壳真盘 5 条（env 落点／坏 JSON 与 0 字节／世界可写／同名文件／目录不存在）
  ＋ 装配面 5 条（push 恰好一条、取址恰好一条、不自己拼路径与表名、条数不重算、ENOENT 分支两条）。
- 真盘那五条不走 `inject`：走 inject 只验了纯核，验不到「装配面真把这一格收进了事实」。
- 反证形状的一处教训：最初写的是 `not.toContain("已信任 0 条")`，而这句话正被我自己的文案引用着
  （「这不等于『已信任 0 条』」）⇒ 反例那行被反例的尺抓。改钉**分支形状** `not.toMatch(/信任表 已信任/)`。

## 6. 本轮跑过的读数（落库前，脏主树）

- `tests/doctor.test.ts` ＋ 全部 plugin/trust 判卷：15 支文件 180 条全绿（`EXIT=0`）
  —— `TrustStore.load` 换成共用解析是**行为保持**的回归证人（旧实现里 JSON 坏／顶层非对象也落成空表）。
- `node --import tsx scripts/typecheck.ts` ⇒ `TC_EXIT=0`（0 条报错）。
- `mutate-verify --check-needles`（脏主树）⇒ `1506 条｜阻断 12｜待复认 2｜未覆盖 1｜逐行式 5｜未入库面 0｜钉在飞文本 10｜killer 指针失效 0（HEAD 侧 0）`。
  12 条 ❌ 逐条读过：本簇 6 条（`doctor-trust-*`，同笔未落库＝预期读数）＋ 隔壁 4 条（`d13-*`，钉 `scripts/docs-check.ts` 的在飞实现）
  ＋ 2 条待复认（`cascade-ladder-cross-provider`、`goal-stopped-flag-ignored`，针脚已不在源文件，非本簇文件）。
