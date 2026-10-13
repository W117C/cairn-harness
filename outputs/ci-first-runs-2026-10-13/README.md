# 第一次非本地自评：CI 从 13 条红跑到全绿（2026-10-13）

动因：本仓此前 `git remote` = 0 条，`.github/workflows/verify.yml` 一次也没真跑过
（`docs/development-plan-2026-10-12.md` 的 D-B，登记为「非本地自评这一路视点完全不存在」）。
2026-10-12 晚配了远端 `W117C/cairn-harness`（private）并推 `zcode` ⇒ 第一次真跑。

## 逐趟读数（`gh run list` + 每趟的 `--log-failed` 汇总行）

| # | run | 被验的树 | 红 | 绿 | 修的是什么 |
|---|---|---|---|---|---|
| 1 | 38273993449 | `5b97924c` | 13 | 5248 | （首推，红的八类根因见下） |
| 2 | 38328544106 | `f7a6c208` | 8 | — | `.gitignore` 去尾斜杠 + `fetch-depth: 0` |
| 3 | 38330263950 | `60927f97` | 6 | 5260 | 补交 `scripts/gate-manifest.ts`（23 → 25 那笔的一半） |
| 4 | 38344870173 | `baa805e5` | 5 | — | 推 `refs/dsh/cluster-*`（台账引的 22 个提交）+ 逐名断言带取料面 |
| 5 | 38346162200 | `81d0c086` | 4 | — | 补 `scripts/ci/README.md` 的手抄门单 |
| 6 | 38346721806 | `3154102f` | 4 | — | 给 mutate-shards／mutate-verify-gates 的断言补原文 |
| 7 | 38347829159 | `11f5d5bd` | 2 | — | 两把读 vitest 输出的尺剥 ANSI |
| 8 | 38348823342 | `1af11b93` | 2 | — | `sanitizedEnv` 白名单加 `PNPM_HOME` |
| 9 | 38349681373 | `3e826ef9` | 1 | — | `parseTestResults` 加 node 的 spec reporter |
| 10 | 38350670163 | `87a787fc` | **0** | 5266 | format 断言认两种 reporter |

第 10 趟（本目录 `run10-38350670163-green.log` 是它的汇总行原文）：
`Test Files 370 passed (370)｜Tests 5266 passed (5266)`；`desktop tests 14 files / 145 passed`；
`fast gates (cert face, 25)：绿 25 / 25，红 0`；`认证面：判卷四面与 HEAD 逐字一致（工作树 = HEAD）`。
⚠️ 同一份汇总里那句「未证 8 项（gate-check 1｜docs-check 3｜autonomy-check 1｜compaction-check 1｜
provider:check 1｜gym-check 1）」照旧生效——**门自己的原话是「不得宣称全部通过」**。

## 首推那 13 条红的八个根因（逐条都只在干净 clone 里现形）

1. `.gitignore` 的 `node_modules/` 带尾斜杠 ⇒ **不匹配指向目录的软链**；判卷造的临时 worktree
   一出生就是脏的 ⇒ `treeProblem` 拒跑（5 条）。
2. `actions/checkout` 缺省 `fetch-depth: 1` ⇒ 五处吃 git 历史的判据全读成「不可达」。
3. 台账引的 22 个提交只在 `refs/dsh/cluster-p169-*` 上，没推过。
4. `cert face 23 → 25` 那笔共有四处手抄件，只交了两处。
5. CI 里 vitest 强制彩色 ⇒ 两把读 vitest 汇总的尺匹配不上。
6. `sanitizedEnv` 白名单漏 `PNPM_HOME` ⇒ CI 上 `pnpm` 直接 command not found。
7. GitHub Actions 给每个 step 分 PTY ⇒ `node --test` 走 spec reporter，而解析器只认 TAP。
8. 两条 `format` 断言把 reporter 钉成一种。

## 取料

- `run1-38273993449-13red.log`：首推那趟的 `gh run view --log-failed` 原文（13 条红逐条）。
- `run8-38349681373-1red.log`：倒数第二趟（1 条红）的原文——含 `NamedSetSource.head`
  第一次派上用场时印出的 spec reporter 原文。
- `run10-38350670163-green.log`：全绿那趟的汇总行。

口径：逐趟的完整日志没有全量落盘（每份 0.25–0.47MB，且 gh 侧仍可复取：
`gh run view <run> --log-failed`）。本目录只留「首红／最后一条红／首绿」三份关键现场。
