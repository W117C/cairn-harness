# 参与 Cairn 的开发

感谢你愿意参与。Cairn 目前是**开发者预览**：CLI 可用，macOS 桌面壳可构建。请先读
[`README.md`](README.md)、[`LICENSING.md`](LICENSING.md) 与 [`AGENTS.md`](AGENTS.md)。

## 1. 环境

| 项 | 要求 | 事实源 |
|---|---|---|
| Node | `>=20.11.0 <25` | `package.json` 的 `engines` |
| 包管理器 | pnpm（版本由 `packageManager` 单点声明） | `package.json` |
| 凭据 | 只走环境变量，不落文件 | 见 README 的 provider 表 |

开发和运行测试建议使用 Node 24。仓库锁定的 pnpm 11.21.0 需要 Node 22.13 或更高版本。

```sh
git clone https://github.com/W117C/cairn-harness.git
cd cairn-harness
pnpm install --frozen-lockfile
pnpm verify
```

## 2. 常用命令

```sh
pnpm verify          # 公开 CI 的 L1 全套：typecheck + 核心/桌面测试 + 产品契约门
pnpm typecheck      # 只做类型检查
pnpm test           # 核心行为测试
pnpm test:capped    # 核心测试，限两个 worker（8GB 机器上的可复现读数）
pnpm --filter cairn-desktop test   # 桌面行为测试
```

没有 API key 也能看流程：

```sh
./bin/cairn.mjs --provider demo --mode auto --workspace /tmp/cairn-demo "随便写点什么"
```

`demo` 是**预录剧本**：不拨号、不花钱，但剧本内容与你的任务无关，结尾的「任务完成」是台词而不是判卷结论——看退出码。

## 3. 改动纪律

- 先读 [`AGENTS.md`](AGENTS.md) 的架构、渲染层与事件日志规则。
- 不修改冻结 fixtures、不弱化断言、不降低验证要求来换绿灯。
- 一个 PR 只做一件事；提交信息用 `fix:` / `feat:` / `docs:` / `test:` 前缀。
- 行为变更必须带测试；UI 变更请附截图或可复现步骤。
- 不在 PR 里提交 API key、私有会话、真实用户数据或本机绝对路径。

## 4. 测试与验证分层

本仓库把验证分三层，详见 [`docs/TESTING.md`](docs/TESTING.md)：

- **L1 公开契约**：`PUBLIC_GATES`，每个 PR 跑，`pnpm verify`；
- **L2 发布认证**：`head-cert-check`、`mutate-verify` 等，维护者发布前跑；
- **L3 历史审计**：只在私有审计仓，不进入公开 CI。

## 5. 提交 PR 前自检

- [ ] `pnpm verify` 通过；
- [ ] 新增/修改的行为有对应测试；
- [ ] 没有提交密钥、个人路径或内部证据；
- [ ] 文档与 CHANGELOG 已按需更新；
- [ ] 如果改了工具/权限/协议，说明兼容性影响。

## 6. 授权

本项目以 **AGPL-3.0-only** 发布；提交 PR 即表示你同意按 [`LICENSING.md`](LICENSING.md) 的贡献条款授权你的贡献。
