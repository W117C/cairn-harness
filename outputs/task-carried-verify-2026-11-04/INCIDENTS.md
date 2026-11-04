# 第一批事故（真模型跑，hy3）

来源：`cairn --provider custom --model cn:hy3 --mode auto --verify …` 的一次真实任务（2026-11-04 20:58–21:08）。
工作区 `.worktrees/verify-census`（HEAD 干净树 + 符号链接 node_modules），会话 `cli-1793797080999`。
任务：新增 `scripts/verify-census.ts` + `tests/verify-census.test.ts`。

## 任务本身其实是做成了

沙箱外复跑（判据就是它自己声明的两条）：

```
node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/verify-census.test.ts
→ 5 tests passed
node --import tsx scripts/verify-census.ts --json
→ {"sessions":2,"withVerify":1,"firstGreen":0,"userTurns":2,"skippedLines":0,"ratio":0.5}   exit 0
```

## 事故 1：环境写权限被归因成代码错（假红）

事件流 `verify_result`：

```
{"ok":false,"source":"task","cause":"code","auto":true}
cmd: vitest … tests/verify-census.test.ts
exit: 1  cause: code
out: Error: EPERM: operation not permitted, open '…/.worktrees/verify-census/node_modules/.vite-temp/vitest.config.ts.timestamp-…'
```

- **实际**：vite 要把打包后的配置写进 `node_modules/.vite-temp`；该路径经符号链接落在工作区外，被沙箱拒绝。
- **判成**：`code`（`classifyVerifyFailure` 只认 pkg-manager 自有错误码 / 127 / timeout / 无退出码，落默认 `code`）。
- **代价**：模型据此认定自己代码有问题，反复改道，烧到 `maxSteps=50` 中止。一条本该绿的跑被判红并杀死。

## 事故 2：失败的跑不入账

同一个工作区：`.agent/evolution-ledger.jsonl` **不存在**。而同一天 demo 成功跑的那次工作区有账本，
`verifyOutcome:"green"`。

- 推断（未逐行证实）：`emitPostRunReadings` 位于 `runAgent` 正常收尾路径；`maxSteps` 中止走的是异常/提前返回。
- 代价：最该拿来学习的失败跑，恰恰没有记录。自进化面看到的全是幸存者。

## 事故 3：非交互档下清理命令被拒后重试

`rm -f vc-validate.mjs vc-vitest-shim.mjs` 在 `--mode auto` + 非交互下被门拒绝（fail-closed），
模型连续三次重试同一命令，每次烧一轮。产物 `vc-validate.mjs`、`vc-vitest-shim.mjs` 留在工作区。

## 冻结为 case 的草稿（下一步进 gym）

| id | 输入 | 期望 | 现状 |
| --- | --- | --- | --- |
| `verify-eprem-is-env` | verify 输出含 `EPERM: operation not permitted` 且无 pkg-manager 码 | 不得判 `cause:"code"`；应为环境类（新增 `env-fs` 或复用 `pkg-manager` 之外的环境桶） | 判成 `code` |
| `failed-run-still-ledgers` | 一次以 maxSteps 中止的 run | 账本仍追加一条 `run`，`verifyOutcome` 取最后一拍 | 无账本文件 |
| `cleanup-denied-no-retry` | 非交互档 + 工作区内临时文件删除 | 一次拒绝后不再重试；或事前放行工作区内临时文件 | 重试 3 次 |

## 修复状态（2026-11-04 21:13）

**事故 1 — 已修**：`VerifyCause` 新增 `env-fs`（进环境集，不烧模型修复额度）；
`classifyVerifyFailure` 在 pkg-manager 之后加一条窄例外 `FS_PERMISSION_DENIED_LINE`。
判卷 `tests/verify-cause-fs.test.ts` 4 条（含同形对照：普通测试失败仍是 `code`）。
用事故现场的原始输出复跑归因：`cause: "env-fs"`（原来是 `code`）。

**事故 2 — 已修**：`withPostRunReadingsOnThrow`（`src/main/post-run-readings.ts`）在 runLoop 抛错时
先落一次读数再抛原错；读数自己失败不掩盖原错。`runAgent` 的 `runLoop` 调用点已包进这个壳。
判卷 `tests/post-run-readings-on-throw.test.ts` 3 条（抛错落读数 / 读数失败不掩盖 / 成功路径不重复读）。
**未做端到端复证**：需要再撞一次 maxSteps 才会看到账本文件，留到下一跑。

**事故 3 — 未修**（按约定单独一轮）：非交互档下 `rm` 被拒后重试。

## 事故 4（第二跑暴露）：绿不可复现——判据依赖 TMPDIR

第二跑（hy3，`cli-1793798121212`）补 `--workspace` 用例。事件流：

```
#3674 verify_result {"ok":true,"source":"task","auto":true}   两条命令全过
账本 {"session":"cli-1793798121212","verifyOutcome":"green"}
```

但同一命令在普通 shell 里复跑：`1 failed | 5 passed`。

```
FAIL 显式 --workspace 指向另一个目录时…
Error: Command failed: node --import tsx …/scripts/verify-census.ts --workspace /var/folders/…/T/verify-census-xxxx
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx'
```

**根因（实测确认，不是推的）**：该用例把子进程 cwd 设成 `os.tmpdir()` 下的临时目录，靠祖先目录的
`node_modules` 解析 `tsx`。沙箱把 `TMPDIR` 指到工作区内 ⇒ 临时目录在仓内 ⇒ 解析得到 ⇒ 绿；
普通 shell 的 `TMPDIR` 在 `/var/folders` ⇒ 解析不到 ⇒ 红。

```
TMPDIR="$PWD/.tmp-t" vitest … → 6 passed
（默认 TMPDIR）      vitest … → 1 failed | 5 passed
```

**性质**：不是代码错，是**判据不 hermetic**；而 harness 的沙箱恰好掩盖了它。
这意味着「沙箱里绿」不能直接当成「用户环境里绿」——读数保真度的一处已知缺口。

**case 草稿**：`verify-hermetic-tmpdir` —— 同一判据在系统 TMPDIR 与工作区 TMPDIR 下必须同结论；
不同则判据本身不合格（不是代码不合格）。

**事故 4 — 已修**：`tests/verify-census.test.ts` 的临时工作区从 `os.tmpdir()` 改到仓内 `.tmp/`，
子进程的 `node --import tsx` 靠祖先 `node_modules` 稳定解析。默认 TMPDIR 下复跑 6/6。
连同 `scripts/verify-census.ts` 一起入库：这条命令把 spec §6 的三条读数变成可重复读数。

**事故 3 — 已修**：三支拒单文案（user / timeout / unattended）现在都带同一句
「不要用相同参数重发同一个调用」；unattended 那支此前只说了「改用非交互允许的路径」，没说不许重试。
判卷 `tests/ask-denial-text.test.ts` 4 条（三支各一条 + timeout 同形对照）。
