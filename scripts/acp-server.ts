/** ACP stdio 服务器入口：
 *
 *    pnpm acp-server --workspace <dir> [--mode default|read-only|auto] [--trusted-repo] [--permission-bridge]
 *
 *  stdout 只走 JSON-RPC 帧；所有日志强制到 stderr，避免污染协议。
 *  默认 `--mode default` + unattended：写工具 fail-closed。`--mode auto` 会放行写工具，
 *  只应在受信任的本地客户端使用。`--permission-bridge` 把审批转发给客户端的
 *  `session/request_permission`（只给 allow_once/reject_once，超时/断开按拒绝）。 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serveAcpStdio } from "../src/interop/acp-stdio";
import { createProductAgentClientV1 } from "../src/main/interop-host";
import { createAcpAskGate } from "../src/main/interop-acp-ask-gate";
import { PERMISSION_MODES, type PermissionMode } from "../src/permissions/modes";

interface Args {
  workspace: string;
  mode: PermissionMode;
  trustedRepo: boolean;
  permissionBridge: boolean;
  help: boolean;
}

function usage(): string {
  return [
    "用法: pnpm acp-server --workspace <dir> [--mode default|read-only|guided|auto|full-access] [--trusted-repo] [--permission-bridge]",
    "",
    "  --workspace <dir>   要服务的固定工作区（session/new 的 cwd 必须解析到它）",
    "  --mode <mode>       权限档，缺省 default",
    "  --trusted-repo      允许该工作区的 verify 命令自动执行（缺省请由信任表/人批准）",
    "  --permission-bridge 审批转发到客户端 session/request_permission（allow_once/reject_once）",
    "  -h, --help          显示本帮助",
    "",
    "stdout 只输出 ACP JSON-RPC；日志在 stderr。",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): Args {
  let workspace = process.cwd();
  let mode: PermissionMode = "default";
  let trustedRepo = false;
  let permissionBridge = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") { help = true; continue; }
    if (arg === "--trusted-repo") { trustedRepo = true; continue; }
    if (arg === "--permission-bridge") { permissionBridge = true; continue; }
    if (arg === "--workspace" || arg === "--mode") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(arg + " 需要一个值");
      if (arg === "--workspace") workspace = resolve(value);
      else {
        if (!(PERMISSION_MODES as readonly string[]).includes(value)) {
          throw new Error("--mode 非法：" + value + "（允许 " + PERMISSION_MODES.join(" / ") + "）");
        }
        mode = value as PermissionMode;
      }
      i++;
      continue;
    }
    throw new Error("未知参数：" + arg);
  }
  return { workspace, mode, trustedRepo, permissionBridge, help };
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write("[acp-server] " + (error instanceof Error ? error.message : String(error)) + "\n\n" + usage() + "\n");
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    process.stderr.write(usage() + "\n");
    return;
  }
  if (!existsSync(args.workspace)) {
    process.stderr.write("[acp-server] workspace 不存在：" + args.workspace + "\n");
    process.exitCode = 2;
    return;
  }
  // stdout 是协议面：任何 stray console.log 都改走 stderr。
  console.log = (...items: unknown[]) => { console.error(...items); };
  if (args.mode === "auto" || args.mode === "full-access") {
    process.stderr.write("[acp-server] 警告：--mode " + args.mode + " 会在无人审批下放行写工具；请只在受信任客户端使用。\n");
  }
  process.stderr.write(
    "[acp-server] workspace=" + args.workspace + " mode=" + args.mode
      + (args.trustedRepo ? " trustedRepo=1" : "")
      + (args.permissionBridge ? " permission-bridge=1" : "")
      + "（stdio JSON-RPC；Ctrl-D 退出）\n",
  );
  // 权限桥：AskGate 先建好，出站传输在 serveAcpStdio 的 attach 里接上（晚绑定）。
  // 桥未接上（不会发生——attach 在请求循环前回调）或传输故障时，AskGate fail-closed 拒绝。
  let outbound: ((method: string, params: unknown) => Promise<unknown>) | null = null;
  const askGate = createAcpAskGate({
    send: (method, params) => {
      if (outbound === null) throw new Error("permission bridge transport is not attached");
      return outbound(method, params);
    },
  });
  const client = await createProductAgentClientV1({
    workspace: args.workspace,
    mode: args.mode,
    trustedRepo: args.trustedRepo,
    unattended: true,
    ...(args.permissionBridge ? { askGate } : {}),
  });
  await serveAcpStdio({
    client,
    input: process.stdin,
    output: process.stdout,
    ...(args.permissionBridge ? { attach: (transport) => { outbound = (method, params) => transport.request(method, params); } } : {}),
  });
}

await main().catch((error: unknown) => {
  process.stderr.write("[acp-server] 失败：" + (error instanceof Error ? error.stack ?? error.message : String(error)) + "\n");
  process.exitCode = 1;
});
