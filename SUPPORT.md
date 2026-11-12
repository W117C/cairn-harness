# 获取支持 / Support

## 这个仓库是给谁用的

Cairn 目前处于 **B1 内测**阶段：受众是仓库所有者**明确授权**的个人或团队。
范围裁决见 [`docs/adr/0002-v1-audience-b1-internal-beta.md`](docs/adr/0002-v1-audience-b1-internal-beta.md)。

如果你还没被授权，请先走授权流程，不要直接提 Issue。

## 按问题类型选渠道

| 你要问的 | 去哪儿 |
|---|---|
| 怎么装、怎么跑、参数什么意思 | [`README.md`](README.md) 与 [`docs/`](docs/README.md) |
| 功能缺陷 / 行为与文档不一致 | GitHub Issues → 选 **Bug report** 模板 |
| 要一个新能力 | GitHub Issues → 选 **Feature request** 模板 |
| **安全漏洞** | **不要开公开 Issue** → 见 [`SECURITY.md`](SECURITY.md) |
| 贡献流程、提交规范、门禁 | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| 架构与符号索引 | [`docs/CODE-WIKI.md`](docs/CODE-WIKI.md) |
| 现在的状态、在飞什么、还没裁什么 | [`STATE.md`](STATE.md) |
| 历史与审计链 | [`PROGRESS.md`](PROGRESS.md)（页号是引用单位） |

## 提 Issue 之前

这三条能省掉一整轮往返：

1. **先自己量一遍**。`pnpm facts` 给的是**当下**的读数，不是你手抄进正文的那份。
2. **核心套件的读数请带并发档位**。8GB 机器上默认并发会超订，
   报出来的超时是**负载假象**；用 `pnpm test:capped` 拿可复现读数。
3. **说清读数覆盖的是工作树还是某个提交**。`pnpm mutate-verify` 与
   `pnpm head-cert-check` 量的是 **HEAD**，不是工作树——
   改动没提交之前它们量不到你这次的改动。

## 期望响应

| 问题类型 | 目标 |
|---|---|
| 安全漏洞 | 见 [`SECURITY.md`](SECURITY.md) 的响应表 |
| 阻塞性缺陷 | 尽快 |
| 一般缺陷与需求 | 按排期，不承诺具体日期 |

维护者是单人维护，真实节奏可能不同；如果你需要更快的响应，
在 Issue 里说明**为什么急**比单纯催促有用。
