# HEAD-only 门禁整表体检与逐道归因（2026-09-24）

**为什么跑这个**：主树被另一会话占着（25 个非图片文件在飞），所以我这几轮一直在**混合作业树**上验证——
那只能证明"没有回归"，不能证明 **HEAD 自洽**。做法按 AGENTS.md：`git worktree add --detach` +
`cp -al node_modules`（真依赖，不是软链）+ `pnpm gates --direct` 的等价执行（`node --import tsx scripts/gates.ts --direct`），
靶 HEAD = `88565f3`（含我这几笔：`f6bc24f` 19-L0、`0ed7c8a` 31-C1、`88565f3` 20-L0）。

## 一、结论先说

**HEAD 不是全绿的**，8 道非零退出，但**没有一道属于这三笔**：全部归到「别人未落库的在飞修复」＋
「未裁的 A-5」＋「一道的负载 flake」＋「整表预算」。所以任何"HEAD 全绿"的说法今天都不该写；
下表每一行都给了判据与复跑命令，不靠"应该不是我"。

## 二、逐道归因（红 = 8）

| 门 | 失败的那一条 | 归因 | 判据（怎么知道的） |
|---|---|---|---|
| `ipc:check` | 「重放等价：事件数与内容与跑前一致（20 条）」 | 别人在飞 | HEAD 的 `src/events/index.ts` 里落盘是 `const stamped = { ...event, ts: … }` 一份**只存在于盘上的副本**；工作树同一处已改成"盖在事件本身上"，其注释自记「ipc:check / schedule-check J1 J2 三门同时红」。`git diff 1bf573e HEAD -- src/events/index.ts` **为空** ⇒ 与我的笔无关 |
| `schedule-check` | J1「append→replay 逐字无损」+ J2「JSONL 行字节 = 事件原样序列化」 | 同上（同一个因） | 同一条 `stamped` 副本；两条都是"live 与盘必须同一个式子"的老不变量 |
| `agents-check` | A1「旧形态日志重放逐字无损」 | 同上（第三个受害者） | standalone 复跑打出 ❌ 行；254 ✅ 全过，另 `UNVERIFIED=1`（暗卷无 `M0_API_KEY`，属未证不属红） |
| `gate-check` | H7「冻结表与判卷区双向一致」把 `fixtures/no-progress/*.events.jsonl` 报成 `inTableNotOnDisk` | 别人在飞 | HEAD 的比对写法把"表里有、区没扫"读成"盘上没有"；修它在别人未落库的 `src/frozen.ts` + `scripts/gate-check.ts`（两者都是 `M`）。**这些文件盘上都在**：我这几轮就是拿 `fixtures/no-progress` 当零膨胀分母的（54 条 / 16362 字节） |
| `panels-check` | 整表里 1 项失败（142.8s）；**standalone 复跑 ✅ 全绿 exit 0** | 负载 flake | AGENTS.md 的判读法（只有 CDP/时延类红、无真断言失败 ⇒ 单跑复验）。整表里它紧接 `test`(≈87s) 与一串 CPU 密集门，standalone 即绿 |
| `gym-check` | B1 两条「明卷两次跑逐字段一致」+ 共 4 项 | **未裁的 A-5** | 差异只在 `changedFiles` 里的 `.agent/snapshots/<毫秒>--c2/src/config.js`：harness 自己的回滚产物带 `Date.now()`，于是**同一份剧本两次跑必然不等**。这正是合册 §三 A-5 那条（BLOCKED #56：快照路径污染 `changedFiles` + id 带毫秒），**仍待人裁** |
| `mutate-verify` | `exit=124`（1200s 预算到点被杀） | 预算/宿主 | 整表在本宿主 >1200s 跑不完。**注意**：我前段与它并发过（探针 + 两个单文件测试），所以这句只是"本宿主这轮没跑完"，不是"表本身该多久" |
| `mutate-needles-check` | 「残留 `src/renderer/app.js.mutbak` ⇒ 针脚是从突变体算的，不可信」 | 上一条的**正确后果** | 被 SIGKILL ⇒ `finally` 没跑，突变留在临时树里。**这道门当场点名并拒绝信任自己的输入 = 期望行为**（不是新缺陷）；`mutate-verify` 启动侧也有按证据自愈的分支（`leftoverBackupPaths` + `leftoverActionOf`，三份内容同时在盘时自动还原） |

## 三、顺手记两条事实

1. **临时树被杀会留突变**：`.mutbak` 的残留由下一道门检测并拒绝读数——这条链**有效**（本轮实证）。
   但请别在**主树**上半途 kill `mutate-verify`：主树里留下的就是未还原的产品源文件，
   下一轮 `git add .` 会把它一起提交（历史上真踩过一次，靠 `.mutbak` 三份证据还原）。
2. **gym 的 A-5 有两个方向**，裁决时得选一个：从 `changedFiles` 里剔除 harness 自己的 `.agent/snapshots/**`
   （它不是用户面的改动），还是把快照 id 改成内容派生（不带毫秒）。
   前者动"前进"的口径（合册 ⑦：越界写被计入前进 ⇒ 成本÷前进算得偏便宜），后者动快照文件名；
   **两者都会让 B1 那两条从"必然不等"变"可比"**，但只有后者不掩盖"harness 自己写了东西"这件事。

## 四、复跑

```
git worktree add --detach /tmp/dsh-gates-head <HEAD> && cp -al node_modules /tmp/dsh-gates-head/node_modules
cd /tmp/dsh-gates-head && TERM=dumb node --import tsx scripts/gates.ts --direct      # 整表
TERM=dumb node --import tsx scripts/agents-check.ts                                   # A1 那条
TERM=dumb node --import tsx scripts/panels-check.ts                                   # flake 复验
```

临时树跑完已 `git worktree remove --force` 删除；主树未留任何 `.mutbak`（`find` 核过），
`src/renderer/app.js` 仍是别人那份 +350/−14 的在飞改动，我没碰过。

## 五、追记（同日）：第一节里那条 SIGKILL 缺陷已修，但**修不到我以为的那格**

上面第二节的 `mutate-verify` 那行，动因是 `killTree()` 在超时当场整组 SIGKILL。已改成阶梯
（`scripts/lib/gate-kill.ts`：整组 SIGTERM → 宽限 15s → 才整组 SIGKILL；跑命令本身抽到
`scripts/lib/gate-runner.ts`，判卷共用一份）。**但落地前重测，我原先的因果句是错的**：

- 独立探针（子进程 `execFileSync("sleep", ["6"])`、1s 处发 SIGTERM、2.5s 后看）：**处理器一次都没跑**；
  而阻塞一结束进程直接走到退出，**TERM 被吞**。⇒ 阶梯救不了 `mutate-verify` 的还原窗口，
  那格仍由「下次开跑按证据自愈」（`lib/mutate-gates.ts` 的 `leftoverActionOf`）负责——与它自己
  注释里 09-23 的实测一致。
- 阶梯真买到的是：JS 活着那一刻的收尾机会（`restoreInFlight` 那类）、组内其他成员按自己方式退场，
  以及**不再悬着不出结论**（落定挂 `exit` 而非 `close`：被留下的孙进程占着管道时 close 永不到）。
- 引出的新口子（原实现没有）：宽限内子进程可以带着自己的退出码先落定 ⇒ 一支把 SIGTERM 当
  "干完了"、退出码 0 的门会**假绿**。已在 gate-runner 锁死（预算用掉后结论固定 124）。

变异读数（三条都是当场造红，跑完即删，还原后 `diff` 为空）：
M1 `gate-kill` 的 `signal("SIGTERM")` → `signal("SIGKILL")` ⇒ 5 条红（lib 三支 + 接缝两支）。
M2 剪断接缝（gate-runner 超时支不走阶梯）⇒ **只有**接缝两支红、lib 七支全绿 = 「两头断」的形状。
M3 摘掉超时锁 ⇒ 6/6 次运行红（其中"以退出码 0 收场仍判 124"那条 5/6 红，另一次红在隔壁那条）。
