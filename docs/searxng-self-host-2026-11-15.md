# SearXNG 自托管接入（F6 B，2026-11-15）

- **状态**：运维指南（不改代码、不新增依赖、不选默认厂商）。对应 F6 裁决输入的 C2/B 路径。
- **适用**：希望搜索数据面在自己机器上、不接 Brave/Tavily 付费 API 的部署。
- **代码现状**：客户端已支持 SearXNG——`src/tools/web-search.ts:89-92` 会把端点补成 `/search` 并加
  `format=json`；`src/tools/web-search.ts:63-67` 对 SearXNG 不要求 API Key；`src/tools/web-search.ts:44-45`
  的 `allowLocalEndpoint` 显式允许 loopback/私网端点（默认仍走 SSRF 闸拒绝）。

## 一、起一个本机实例（示例，按上游版本核对）

> 下面命令是上游 `searxng/searxng` 镜像的常见形态，**本仓未在本机实测**；执行前按上游 README 与镜像
> 版本调整卷路径/端口。目标只是把 JSON API 开在 127.0.0.1，不暴露公网。

```bash
# 1) 准备配置目录（首次可让容器生成，再按需改 settings.yml）
mkdir -p "$PWD/searxng"

# 2) 只绑回环，避免把搜索服务暴露到局域网
docker run --rm --name cairn-searxng \
  -p 127.0.0.1:8080:8080 \
  -v "$PWD/searxng:/etc/searxng" \
  -e SEARXNG_BASE_URL=http://127.0.0.1:8080/ \
  searxng/searxng:latest
```

在 `searxng/settings.yml` 的 `search.formats` 里至少保留 `html` 与 `json`（SearXNG 默认可能只开 html；
JSON 关着时客户端会收到 HTML/403，不是本仓的解析问题）。改完重启容器。

验证：

```bash
curl -s 'http://127.0.0.1:8080/search?q=cairn&format=json' | head -c 400
```

期望看到 `{"query":...,"results":[...]}`；返回登录页/HTML 或 403 时先查 `formats` 与 limiter。

## 二、在 Cairn 里配置

1. 设置 → 联网搜索 → 服务选 **SearXNG**。
2. 地址填 `http://127.0.0.1:8080`（客户端会补 `/search` 与 `format=json`）。
3. 打开「允许本机/内网端点」（只对这条本地端点；公网端点仍走 SSRF 闸）。
4. 点「测试连接」；应返回结果条数。
5. 保存后让助手执行 `web_search`，或直接在对话里问需要联网检索的问题。

## 三、安全与边界

- **只绑 127.0.0.1**：`-p 127.0.0.1:8080:8080`；不要把 8080 开到 `0.0.0.0`。
- `allowLocalEndpoint` 是显式开关，不是默认放开；公网端点仍要求 https、拒重定向、走 pinned transport。
- 不要把 API Key/用户名密码写进端点 URL；SearXNG 本身不需要 Cairn 的搜索 Key。
- SearXNG 是第三方 OSS，不是本仓自研；它聚合的上游引擎各有 ToS/robots，部署者自己承担。
- 本仓不做默认搜索页（A2 未裁）；这条指南不改变 `web_search` 的 fail-closed 默认。

## 四、与 F6 其他路径的关系

- **A1**：`html` provider 已落（`9b1a50d4`）；适合没有 SearXNG、但有一个 HTML 搜索页的场景。
- **B（本文件）**：SearXNG 自托管，稳定 JSON、数据面自持；需要用户维护实例。
- **C3**：自有 crawler + 本地索引，仍是独立项目；本文件不涉及。

## 五、参考

- `docs/web-search-self-host-2026-11-15.md`（F6 裁决输入）
- `src/tools/web-search.ts`、`src/main/search-settings.ts`
- SearXNG 上游 README / settings 文档（版本以实际镜像为准）
