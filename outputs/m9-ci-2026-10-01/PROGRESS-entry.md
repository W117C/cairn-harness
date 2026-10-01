### 2026-10-01 · M9 · CI 兜底 L1 落地：`.github/workflows/verify.yml`（install→typecheck→全量判卷→快门面 20 道）+ 取舍文档；L2 pre-commit 未做（业主拍板项）

取料面（全名逐支）：`outputs/m9-ci-2026-10-01/` 下 `LEDGER.md`、`yaml-parse.log`、`ci-chain-local.log`、`reverse-verify-typecheck-probe.log`、`reverse-verify-typecheck-restored.log`；全量判卷读数在 `../m8-fork-replay-2026-10-01/full-suite.log`。

1. **动因（仓库自己的账）**：31 道门全靠人记得跑，而历史上有 **86 笔提交跑在红灯上**；`.git/hooks/*` 是空壳、无 husky、`core.hooksPath` 未设置 ⇒ 质量没有任何自动保险丝。
2. **L1（本笔落地，零打扰）**：workflow 三步——`pnpm install --frozen-lockfile`（锁文件同步检查）→ `pnpm typecheck` → `pnpm test`（全量判卷）→ 快门面 `pnpm gates --only=…`（`CERT_GATES` **减两道已知红**：`gate-check`＝任务 #9、`mutate-needles-check`＝任务 #23；不是遗漏，两道的出处与"修好加回"的注释都在文件里）。不装钩子、不改本地行为。
3. **本地按同组命令复现**：install `Already up to date`；**快门面 20/20 绿 exit=0**；全量判卷 **269 文件 / 3613 条全绿 exit=0**（读数见 `../m8-fork-replay-2026-10-01/full-suite.log`）。
4. **反向验证（PLAN §M9 要求）**：临时放 `src/__ci-typecheck-probe.ts`（`const x: number = "boom"`）⇒ 同款 `pnpm typecheck` 报 `TS2322` 且 **exit=2**；删掉复绿。CI 抓类型错的能力＝同一行命令，本地已证。
5. **runner 与诚实标注**：选 `macos-latest` 是为与开发环境同构（沙箱/平台分支判卷按 macOS 写）；**GitHub 上的首次真实运行本机无法验证**，首次推上去视作联调；ubuntu 未做任何验证，迁移前先跑一轮真实 CI（`scripts/ci/README.md` 写了这两条）。
6. **L2（pre-commit）明确不做**：形态（只跑 typecheck，约 5–8s）与验收前提（可一键关、反向验证、实测耗时）已写进 README；但它作用于本机**所有并行会话**的每次提交 ⇒ 必须业主明确同意（路线图 §M9 禁区），本笔不越权。
7. **刻意不做**：不改 `package.json` scripts（CI 直接用既有 `pnpm` 脚本，不新增别名）；不给重门（head-cert 123.7s / mutate-verify 18–25min）排进每次 push；不动任何本地钩子。
