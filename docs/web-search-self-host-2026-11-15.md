# F6 自研联网搜索：方向裁决输入（2026-11-15）

- **状态**：裁决输入（未实现、未改默认）。F6 在第 1194 页普查里是「`web_search` 仅付费第三方后端（brave/tavily），无自研」；
  本文件把「自研」的三种口径、可选路径、代价与判据摆出来，供业主选。
- **现状基线**：HEAD `907deda7`（工作树另有并发会话的第 1206 页改动，未入库，不影响本文件的引用点）。

## 一、现状（有代码证据）

1. **四个 provider，两个是付费第三方**：`src/tools/web-search.ts:35` 的 `SearchProvider` 是
   `searxng | brave | tavily | custom`；只有 Brave/Tavily 有默认端点（`src/tools/web-search.ts:37-39`），
   两者都要求 API Key（`:63-67` 的 `searchKeyEnv`；`:220-222` 缺 key 直接拒）。
2. **没有默认后端**：`parseSearchConfig` 在 `endpoint` 为空时只给 Brave/Tavily 补默认端点，SearXNG/custom
   仍要求用户填地址（`src/tools/web-search.ts:57-58`）；未配置时工具回「不做默认厂商，没配即 fail-closed」
   （`:200-204`）。
3. **结果契约是 JSON**：`extractResults` 只认 `{results:[{title,url,snippet|content|description}]}`
   （`src/tools/web-search.ts:121-138`）；端点返回 HTML 时只降级为**有界原文**，不抽结果
   （`:295-303`）。也就是说「自研解析」目前只做了 JSON，没做 HTML。
4. **网络纪律已自研且与 `web_fetch` 同源**：SSRF 闸、pinned transport、manual redirect、密钥脱敏、
   出网审批（`src/tools/web-search.ts:9-12`、`:225-238`）。这部分不是 F6 的缺口。
5. **UI 四个选项**：`apps/desktop/src/renderer/components/settings/NetworkSection.tsx:11-16` 的
   `PROVIDERS` 是 Tavily / Brave / SearXNG / custom；前两个要 key，后两个要地址。
6. **测试面**：`tests/web-search.test.ts`（16 条）＋ `tests/web-search-providers.test.ts`＋
   `tests/web-search-pinning.test.ts`；改 provider 语义必须同时过这三份与 `pnpm web-fetch-check`。

## 二、「自研」的三种口径（先对齐这个词）

| 口径 | 含义 | 现在到哪 |
|---|---|---|
| **C1 自研代码** | 不新增依赖；请求、SSRF、解析、排序、回执都是本仓写的；数据来自第三方端点 | JSON 解析、SSRF、回执已自研；缺 HTML 解析与「无 key 也能跑」的 provider |
| **C2 自托管数据面** | 自己跑一个搜索服务（SearXNG 等），本仓只做客户端 | 客户端已支持 SearXNG；没有部署/运维文档，也没有默认地址 |
| **C3 自有索引** | 自己爬、自己存、自己排；不依赖任何第三方检索结果 | 完全没有；这是一件独立的大工程，不是 `web_search` 的一个 provider |

**关键区别**：C1 是「代码自研」，C2 是「部署自持」，C3 才是「数据自研」。三者的成本差一个数量级，
不能用一个「自研」把 C3 偷偷塞进 C1 的预算里。

## 三、可选路径

### A. 自研 HTML 检索适配器（C1）

- 新增 `provider: "html"`（或复用 `custom` 加 `format: "html"`），把 HTML 结果页抽成 `SearchResult[]`：
  标题、URL、摘要、去重、同源过滤、10 条帽；纯函数 + fixture 判卷。
- **无 API Key、无新依赖**；端点仍由用户填（A1），或由业主选一个默认页（A2，涉及供应商/ToS，另裁）。
  **2026-11-15 已落 A1 的 provider 层**：`html` provider 端到端（`9b1a50d4`，第 1216 页）；A2 默认页仍未做。
- 代价：解析器 + 3 种页面 fixture + 负向（空页/登录墙/编码）约 150–250 行实现 + 100–200 行判卷；
  1–2 个工作日量级。
- 风险：HTML 会漂；页面可能反爬/要 JS；ToS 与 robots 要逐站确认；不能承诺 SLA。
- 与现状的关系：不删 Brave/Tavily/SearXNG；只多一个**无 key 的兜底**，默认仍 fail-closed。

### B. SearXNG 自托管（C2）

- 代码零改动（`src/tools/web-search.ts:89-92` 已按 `/search?format=json` 请求）；补一份「本机/内网部署 +
  `allowLocalEndpoint` + 端口/防火墙」的运维文档，或一个仓库内的 compose 示例。
- 代价：文档 0.5 天；用户要装 Docker/Python 并维护实例。
- 风险：SearXNG 本身是第三方 OSS（不是本仓自研），且它聚合的上游引擎仍有各自 ToS；但数据面在用户手里。

### C. 自有 crawler + 本地索引（C3）

- 需要：抓取调度、robots/频率、正文抽取、倒排/向量索引、排序、增量更新、存储与配额；
  还要处理「索引里没有新页面」的新鲜度问题。
- 代价：独立项目级（周/月），会引入新的存储面与后台进程，和「零新依赖、无浏览器、离线判卷」三条纪律
  正面冲突；不适合塞进 `web_search` 这一轮。
- 只有一种情况值得做：业主明确要求「搜索结果的数据也不许来自第三方」。那时应单独立项，不要把它伪装成
  「给 web_search 加个 provider」。

### D. 保留 Brave/Tavily 现状（不做）

- 代价最低，但与「功能都需要自研」直接冲突；且两者都要 key、要付费/额度。可作为可选连接器保留，
  不能作为默认或唯一路径。

## 四、建议

1. **先按 C1 做 A1**：自研 HTML 解析器，`provider: "html"`，端点由用户填，无默认厂商、无 key、
   默认仍 fail-closed。它把「无 key 可用」这一格补上，且不引入新依赖。
2. **同时补 B 的运维文档**：SearXNG 仍是稳定部署的首选；代码已支持，缺的是「怎么起、怎么填、
   怎么开 `allowLocalEndpoint`」的可复跑步骤。
3. **A2（默认 HTML 页）单独裁决**：默认页是供应商/ToS/可用性决定，不由实现顺手选。
4. **C3 暂不做**：除非业主明确「数据面也必须自有」；那时另立项目，按 crawler/index 的判据走。
5. **D 保留为可选**：Brave/Tavily 连接器不删，但不作为默认；与「自研」不冲突的部分是「接入代码是本仓的」。

## 五、若批准 A1，判据（先写判据再写实现）

- `extractHtmlResults(html, baseUrl)` 是纯函数：3 种真实页面 fixture（标题/链接/摘要）各抽出预期条数；
  重复 URL 去重；相对链接按 base 解析；`javascript:`/`data:` 丢弃；空页/登录墙返回空数组而不是抛。
- `provider: "html"` 走同一套 SSRF/redirect/限额/信封；缺 endpoint 仍 fail-closed；HTML 解析成功时
  不再走「有界原文」降级。
- 不新增依赖（`package.json` 零 diff）；`tests/web-search*.test.ts` 三份全绿；`pnpm web-fetch-check` 绿。
- 负向哨兵：HTML 里混入 `<script>`/`<style>`/隐藏块，抽出的摘要不得包含脚本内容。

## 六、未决（需业主回答）

1. 「自研」指 C1（代码）、C2（自托管）还是 C3（自有索引）？
2. 若选 A1：接受「用户自己填搜索页地址」吗？还是要 A2 的默认页？默认页选谁、ToS 谁担？
3. 若选 B：允许仓库带一份 compose/运维文档吗？还是只写 README 链接？
4. 若选 C3：是否接受独立项目（新存储面、后台抓取、非离线判卷）？

## 七、参考

- 第 1194 页 F6 普查：`PROGRESS.md`（`b8cefbb3` 批次）
- `src/tools/web-search.ts`、`src/main/search-settings.ts`、`apps/desktop/src/renderer/components/settings/NetworkSection.tsx`
- `tests/web-search.test.ts`、`tests/web-search-providers.test.ts`、`tests/web-search-pinning.test.ts`
- 网络边界：`README.md:302`「网络与沙箱边界」
