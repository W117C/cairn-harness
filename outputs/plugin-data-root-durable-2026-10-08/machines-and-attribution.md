# 插件数据根搬家：造红与归属读数（第 424 页簇，2026-10-08）

## 1. 旧落点是什么（现读，取料面＝工作树装配行）

```text
src/main/agent-runner.ts:2853  pluginDataRoot: process.env.M2E_PLUGIN_DATA ?? join(tmpdir(), "m2e-plugin-data"),
```

这一顶同时放着两样东西：

| 内容 | 取料处 | 为什么不能在临时区 |
| --- | --- | --- |
| 信任表 `plugin-trust.json` | `src/agent/plugins/index.ts:93` `trustFilePathOf`（缺省派生自数据根）；verify 命令的信任门**复用同一份文件**（同处注释「一把信任表、两个门」） | 系统清 tmp ⇒ 已批准的安全决议无声蒸发；且目录名固定可猜，tmp 世界可写的平台上别的本机用户可**预建**它来伪造「已信任」 |
| 插件 userConfig（含 safeStorage 里的敏感值） | `src/agent/plugins/index.ts:215` `pluginUserConfigDir(this.opts.pluginDataRoot, p.name)` | 同上，外加「配置没人备份、放在会被回收的地方」 |

本机实测（macOS）：`os.tmpdir()` = `/var/folders/pc/…/T`，模式 **700**，`<tmp>/m2e-plugin-data` **不存在** ⇒ 「别的本机用户可预建」这一格在**这台机器上不可复现**，它是 Linux CI／共享 runner（`/tmp` = 0777+sticky）那一面的推论。两面不许合并成一个分数报：**本机那格是真的（会被清、不可审计、与 memory 全局层不同顶），共享 runner 那格是形状推断**。

## 2. 六台造红（跑完即复原，复原一律用 `cp` 备份 + `cmp` 逐字节校验）

| 台 | 改法 | 红在哪条用例 | 读数 |
| --- | --- | --- | --- |
| A | `defaultPluginDataRoot` 少一层目录名（`PLUGIN_DATA_DIR_NAME` 摘掉） | ①＋⑤ | 3ms / 0ms |
| B | `pluginDataRootOf` 忽略 env（新缺省顶掉显式值） | ③ | 3ms |
| C | 同一行的 truthy 判定改 `??`（空串被当路径） | ④ | 2ms |
| D | 装配行退回 `join(tmpdir(), "m2e-plugin-data")` | ⑦（⑥仍绿：条数没变） | 2ms |
| G | 装配面多写一条 `pluginDataRoot:`（第二条派生） | ⑥（⑦仍绿） | 3ms |
| F | `PluginRuntime.load` 里信任表不再由数据根派生（改落 workspace 固定名） | ⑧ | 7ms |

六台红在**六个互不相同**的读数面上（A 一条主证＋⑤共证，其余各一条）。复原后 `cmp` 全部逐字节一致，`find . -name '*.mutbak'` 残骸 0。

顺手修掉的一处判卷自身毛病：原先 ⑥⑦ 直接对整份 `agent-runner.ts`（3100 行）做 `toMatch`，D 台红起来把整个源文件打进进度行（实测一份红读数 **273894 字节**）。改成先把装配行收成数组、再数「这一格有几条」并判内容 ⇒ 同一台的读数降到 **3128 字节**，而且「不许有第二条派生」从隐含变成被数的量（G 台因此才有得红）。

## 3. 归属（本笔不代走别人的面）

| 文件 | 工作树 vs HEAD | 我的 | 隔壁在飞 |
| --- | --- | --- | --- |
| `src/agent/plugins/index.ts` | +21/−0 | 全部 21 行 | 0 |
| `src/main/agent-runner.ts` | +180/−43 | 3 行（os import、plugins import、装配行） | 177/43（provider 重构、`routing-flags` 装配等） |
| `scripts/mutate-verify.mjs` | +74/−0 | 37 行（4 根） | 37 行（`d13-*` 4 根，钉 `scripts/docs-check.ts` 的在飞实现） |

⇒ `agent-runner.ts` 与 `mutate-verify.mjs` 都混着别人的 hunk，**且同一处 import 区里两家的行相邻**（`resolveRoutingFlags` 那一条就压在我改的那一条上面），hunk 级切分不成立 ⇒ 本笔走**临时 index**：blob 由 `git show HEAD:<path>` 构造，提交面只含我的行，工作树里别人的内容一字不动。

## 4. 门的读数（本轮实测，量纲分开）

- `typecheck`：exit 0（0 报错），跑在含隔壁在飞改动的工作树上。
- `tests/plugin-data-root-durable.test.ts`：8 条全绿，Duration 233ms。
- `mutate-verify --check-needles`（脏主树）：`1496 条 —— 阻断 14，待复认 2，未覆盖 1，逐行式 5，未入库面 4，钉在飞文本 8，killer 指针失效 0`。其中**钉在飞文本 8 ＝ 我的 4 根 ＋ `d13-*` 那 4 根**；未入库面 4 里含我这份新判卷文件（未 add 前 HEAD 读不到）——落库后这两维应各自归零到只剩隔壁那半。
- 表长（同一台机器的消费者 `--list`）：脏树 **1496 行**、四条新 id 各命中 1 次；`node --check scripts/mutate-verify.mjs` 通过。
- `prose-needle-scan`：顶包候选 11（已提交 7 ＋ 在飞 4）＞帽 10 —— **本笔新增 0**（`grep -c plugin-data-root-durable` 在那份读数里＝0），这一格属隔壁 provider 重构，本笔不动别人的断言。
- `repo-hygiene-check`：红在 `src/main/agent-runner.ts` 工作树 3107＞帽 3100（隔壁在飞；HEAD 侧本笔只带 3 行进装配面）。

## 5. 刻意不做（写在纸上，免得被下游读成已做）

- **不做从 tmpdir 的自动迁移。** 把那份文件的条目搬进家目录＝把「来路可以是任何人可写」的内容当可信输入搬进 durable 面，方向正好是 fail-open。老决议因此成为孤儿：第一次装载会重新出一次信任卡（多问一次，不是少问一次）。
- 事件日志缺省仍落 `join(tmpdir(), "m0b-agent-events.jsonl")`（`agent-runner.ts:2317`）。那一格是**转录**不是**决议**，量纲不同（丢了不可重放，但不会把 pending 读成 trusted），本轮不动，登记等有人引用错再说。
- `M2E_LOOSE_SKILLS` 那一顶仍恒 trusted（`discover.ts:61` 的 E3 决策写得很清楚：免信任只留给显式 looseRoots 与用户级安装）。本笔只搬缺省落点，没有碰信任语义。
