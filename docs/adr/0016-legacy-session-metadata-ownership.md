# ADR 0016：重复 id 的历史会话 metadata 归属——不猜、可枚举、显式认领

- **状态**：**已接受**——2026-11-15 业主令「先裁决重复 id 历史记录的归属」，并授权按最优解收口
- **日期**：2026-11-15（Asia/Shanghai）
- **决策者**：仓库所有者（授权范围内由当前 agent 定稿）
- **取代**：`STATE.md`「未决」里「两个工作区同 id 的历史旧记录……其归属需业主裁决」那一条
- **关联**：`src/main/session-handlers.ts`、`src/main/session-metadata.ts`、`apps/desktop/src/main/kernel-host.ts`、
  `tests/session-metadata-workspace-routing.test.ts`、`PROGRESS.md` 第 1238 / 1241 页
- **证据基线**：代码提交 `fb5a0344`；本文的 `path#symbol` 都在该提交的树上核过，行号会漂，符号名不会

## 一、动因

第 1238 页把 `session-metadata.json` 按会话根分卷：新写入带 `workspaceScoped`，旧装配根全局卷
只在 id **唯一归属**某根时回退。剩下的棘手面是：旧版桌面把所有工作区的记录写进装配根的同一卷，
两个根里同时存在同 id 会话时，那条无标记旧记录**从数据本身无法判断属于哪一边**。

按 mtime、标题相似度、根遍历顺序、或「装配根离得近」自动选边，都是把猜测写进盘——正是本轮在修的
串根 bug 的形状。而「归属」是业务事实：哪条标题是 A 项目的、哪条置顶是 B 项目的，只有业主知道。

## 二、裁决

1. **不猜**：重复 id 且无 `workspaceScoped` 的记录永不自动选边、不批量迁移、不静默丢弃。
2. **不冒充**：装配根读面同样过滤无主的重复 id（旧全局卷就是装配根自己的卷，直读会把未决记录
   当成 A 的组织事实展示）；桌面渲染层 `listSessions` 的 duplicate 兜底保留为第二道。
   单根 CLI/headless 形态（根集合只有装配根自己）照旧读，不误伤。
3. **可枚举**：`listUnattributedSessionMetadata()` 只报「0 个或 2 个以上拥有者」的无标记记录，
   带原始标题/置顶/审计字段；枚举不写盘，唯一归属的旧记录不算未决（沿用既有回退）。
4. **显式认领**：`claimSessionMetadata(sessionId, sessionsRoot)` 是唯一消解入口。三道闸：
   目标根必须在已登记根集合内、该根里当场存在这条会话日志、只允许认领无标记的旧全局记录；
   本地卷已有权威记录时原样返回不覆盖。成功后写 `workspaceScoped: true` 并从旧全局卷移出该 id。
5. **不进 IPC / 不进 UI / 不 bump 协议**：认领是低频数据修复动作。为它新增 invoke 通道会连锁
   协议版本、`channels.test.ts` 表长、11 个契约判据与 `invoke-consumer-census` 强制的渲染层调用点，
   还会给界面加一个平时不用的次要入口——与「Avoid unnecessary secondary labels」相违。
   桌面侧要过 `explicitSessionsRoot` 那把已登记根闸；本轮只交付 core API 与行为判据。

## 三、判卷与红绿证明

载体：`tests/session-metadata-workspace-routing.test.ts`（`describe("重复 id 历史记录的裁决")`）。

| 造的红 | 应该变红的格 |
|---|---|
| 装配根读面直读全局卷、不过滤无主重复 id | 孤儿枚举用例里 A 侧 `listSessionMetadataForRoot` 断言（本轮实际抓到并修掉） |
| 认领允许未登记根 / 根里无会话 / 无旧记录 / 已落卷 | 拒绝路径用例的四条 `ok === false` 与「不写盘」断言 |
| 枚举把唯一归属的旧记录也算成未决 | 「唯一归属不算孤儿」与单根 CLI 形态两条 |
| 认领覆盖目标根已有的权威记录 | 「本地卷赢」用例的 `B 的新标题` 断言 |
| 认领后另一根读到旧记录 | 「显式认领到 B」用例里 A 侧为空与旧卷移出断言 |

全部走真实 `SessionMetadataRepository` 读写临时树，无源码文本断言、无恒真式。

## 四、明确不做（并附理由）

- **不做自动归属**：数据本身无法判定，任何启发式都是猜测，且会把错误固化进 sidecar。
- **不做批量迁移**：本机实测 `~/Library/Application Support/cairn*` 下没有 `session-metadata.json`，
  当前是理论存量面；没有实数据可搬，也没有可核的迁移目标。
- **不删旧卷、不改 SCHEMA_VERSION**：旧记录保留可回查；`workspaceScoped` 是可选标记，缺席 ≠ false。
- **不新增 IPC 通道 / 协议版本 / UI 控件**：理由见 §二第 5 条；真要做桌面认领入口时按
  `src/main/ipc-protocol.ts#IPC_PROTOCOL_VERSION` 的完整契约面另立一次裁决。
- **不把反馈/置顶 sidecar 扯进来**：它们已在第 1237 页按根分卷，本题只管 metadata。

## 五、边界

- `claimSessionMetadata` 的「已登记根集合」由 `setSessionRootsProvider` 注入；调用方须先过
  `apps/desktop/src/main/index.ts#explicitSessionsRoot` 的 realpath 严格相等闸，core 侧不采信路径字符串。
  桌面若接这条通道，不回落、不接受子目录、不接受空 workspace。
- 认领成功后旧卷 `remove` 失败只出声（本地卷优先的读面已挡住残留，第 1238 页判据覆盖重复写入不复活）。
- 零拥有者的记录（会话日志已不在任何根里）也进未决清单：它是孤儿，但认领闸会拒（没有目标会话），
  需业主先恢复日志或明确废弃；本 ADR 不替它决定删除。
