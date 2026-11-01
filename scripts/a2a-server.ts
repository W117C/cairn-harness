/** A2A loopback HTTP 服务器入口：
 *
 *    pnpm a2a-server --workspace <dir> [--host 127.0.0.1] [--port 0] [--trusted-repo] [--auth-token <t>]
 *
 *  远端只读：运行时拒绝 write 模式任务；没有 TLS/SSE。
 *  设置 --auth-token 后所有请求必须带 Authorization: Bearer <token>，否则 401。
 *  端口 0 = 随机端口，实际 URL 打到 stderr。 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createA2AHandler } from "../src/interop/a2a";
import { serveA2AHttp } from "../src/interop/a2a-http";
import { createProductA2ARuntime } from "../src/main/interop-a2a-runtime";

interface Args {
  workspace: string;
  host: string;
  port: number;
  trustedRepo: boolean;
  authToken: string | null;
  help: boolean;
}

function usage(): string {
  return [
    "用法: pnpm a2a-server --workspace <dir> [--host 127.0.0.1] [--port 0] [--trusted-repo] [--auth-token <t>]",
    "",
    "  --workspace <dir>  固定工作区",
    "  --host <host>      监听地址，缺省 127.0.0.1；对外暴露需自行加反向代理/TLS",
    "  --port <n>         端口，缺省 0（随机）",
    "  --trusted-repo     允许该工作区的 verify 命令自动执行",
    "  --auth-token <t>   要求 Bearer token；所有请求须带 Authorization: Bearer <t>",
    "  -h, --help         显示本帮助",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): Args {
  let workspace = process.cwd();
  let host = "127.0.0.1";
  let port = 0;
  let trustedRepo = false;
  let authToken: string | null = null;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") { help = true; continue; }
    if (arg === "--trusted-repo") { trustedRepo = true; continue; }
    if (arg === "--workspace" || arg === "--host" || arg === "--port" || arg === "--auth-token") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(arg + " 需要一个值");
      if (arg === "--workspace") workspace = resolve(value);
      else if (arg === "--host") host = value;
      else if (arg === "--auth-token") authToken = value;
      else {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0 || n > 65_535) throw new Error("--port 必须是 0..65535 的整数");
        port = n;
      }
      i++;
      continue;
    }
    throw new Error("未知参数：" + arg);
  }
  return { workspace, host, port, trustedRepo, authToken, help };
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write("[a2a-server] " + (error instanceof Error ? error.message : String(error)) + "\n\n" + usage() + "\n");
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    process.stderr.write(usage() + "\n");
    return;
  }
  if (!existsSync(args.workspace)) {
    process.stderr.write("[a2a-server] workspace 不存在：" + args.workspace + "\n");
    process.exitCode = 2;
    return;
  }
  const runtime = await createProductA2ARuntime({
    workspace: args.workspace,
    trustedRepo: args.trustedRepo,
  });
  const server = await serveA2AHttp({
    handler: createA2AHandler({ runtime }),
    host: args.host,
    port: args.port,
    ...(args.authToken !== null ? { authToken: args.authToken } : {}),
  });
  process.stderr.write(
    "[a2a-server] listening " + server.url
    + "（read-only；" + (args.authToken !== null ? "Bearer 认证已启用" : "无鉴权") + "；无 TLS/SSE）\n",
  );
  await new Promise<void>((resolveSignal) => {
    const stop = (): void => { resolveSignal(); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await server.close();
}

await main().catch((error: unknown) => {
  process.stderr.write("[a2a-server] 失败：" + (error instanceof Error ? error.stack ?? error.message : String(error)) + "\n");
  process.exitCode = 1;
});
