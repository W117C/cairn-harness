# 判卷面 shell 绕过收口 · 2026-11-15

提交 `01d2ae2`（`fix(tools): close the shell freeze-gate bypass at the execution layer`）。
台账第 1195 页。本文件是取证件，不是第二份实现说明；所有数字都能在下面的命令里复跑。

## 1. 修前读数（工作树，`evaluate()` 单测口，auto 档 + 一条 run_shell allow）

12 条写命令：`echo x > judge`、`python3 -c "open(...)"`、`node -e "fs.writeFileSync(...)"`、
`f=judge; echo x > $f`、`truncate -s 0 judge`、`ln -sf /tmp/x judge`、`git checkout -- judge`、
`perl -i -pe … judge`、`bash -c 'echo x > judge'`、`install -m 644 /tmp/x judge`、`cp /tmp/x judge`、
`dd if=/dev/zero of=judge …` ⇒ **2 deny（`>`、`cp`）/ 10 approve**。

单独一格：`write_file` 到 `scripts/frozen-sha256.json`（冻结表的基线本身）在 auto 档一条 allow 下
判 **approve**——先把基线改成改过的判卷文件的 sha，再把测试改绿，闸不会响。

## 2. 修后读数

- 词法层（16 条形状）：**14 deny / 2 approve**。两条 approve 是 `python3 -c` 与变量间接，按设计交给
  执行层；不把它们计入「已修」。
- 真 Seatbelt（`tests/sandbox-frozen-deny.test.ts`，darwin，真 `/usr/bin/sandbox-exec`）：**20/20 形状
  被 OS 拒绝、冻结文件逐字未变**；配对臂写非冻结文件成功。
- 无沙箱地板（`tests/frozen-shell-guard.test.ts`）：解释器写 / 删除 / 目录替换 / 改基线表四种越界都被
  逐字节复原并判 `ok=false`；软链别名在 spawn 前被真实落点闸拒绝；后台任务正常退出走同一复查。
- 冻结表自身：`frozenJudgePathSet` 现在包含 `scripts/frozen-sha256.json`，`write_file` 与
  `run_shell` 写它都 `L0-hard` deny。

## 3. 验收命令与读数（HEAD `01d2ae2`）

| 命令 | 读数 |
| --- | --- |
| `pnpm head-cert-check` | 25/25 门绿；核心 678 文件 / 8142 条（`--maxWorkers=2`）；exit 0；六维全过 |
| `pnpm test:capped`（工作树） | 678 文件 / 8143 条；exit 0 |
| `pnpm --filter cairn-desktop test` | 390 文件 / 2518 条；boundary 绿 |
| `node --import tsx scripts/typecheck.ts` | 0 报错 |
| `pnpm sandbox:check` | 全部断言通过（分支 A 沙箱生效） |
| `pnpm docs-check` / `desktop-boundary-check` / `renderer-layer-check` | 全绿 |
| `pnpm gates --only=…`（16 道） | 16/16 绿；3 项未证（与改动无关，门自己登记） |
| `pnpm gates --only=…`（第二批 8 道） | 7/8；`plugins-check` 红（并行会话在改 `src/agent/plugins/**`） |

定向判卷：`tests/judge-frozen-gate.test.ts` 22 条、`tests/frozen-shell-guard.test.ts` 7 条、
`tests/sandbox-frozen-deny.test.ts` 3 条、`tests/sandbox.test.ts` 11 条，全绿。

## 4. 修前/修后各自的边界（不冒充全覆盖）

- 词法层永远只是 blocklist 的快拒；解释器、变量间接、base64 解码后再落盘都认不出。
- Seatbelt 只在 darwin 且 `sandbox-exec` 可用时承重；无沙箱宿主只有「跑后复原」，挡不住同一条命令内
  先改判卷再读测试结果的假绿。
- 后台任务的 `timeout` / `stop` 收束不跑跑后复查；正常 `close` 跑。
- `fs_ops` 的 move/delete 不在本批范围（它拒绝删非空目录；整树搬走会让判卷缺失，不是变绿）。
