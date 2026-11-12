import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const VITEST_DIRECT = `node "${fileURLToPath(new URL("../../node_modules/vitest/vitest.mjs", import.meta.url))}" run --pool=threads`;

export const SANDBOX_TEST_ALIASES: readonly string[] = ["pnpm test", "pnpm run test"];
export const MODEL_SHELL_TEST_ALIASES: readonly string[] = ["pnpm test"];

export function mapSandboxTestCommand(command: string, aliases: readonly string[] = SANDBOX_TEST_ALIASES): string {
  return aliases.includes(command.trim()) ? VITEST_DIRECT : command;
}

export function workspaceDeclaresVitest(workspace: string): boolean {
  try {
    const { scripts } = JSON.parse(readFileSync(join(workspace, "package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    return typeof scripts?.test === "string" && scripts.test.includes("vitest");
  } catch {
    return false;
  }
}

export function mapSandboxTestCommandForWorkspace(
  command: string,
  workspace: string | undefined,
  aliases: readonly string[] = SANDBOX_TEST_ALIASES,
): string {
  if (!aliases.includes(command.trim())) return command;
  return workspace === undefined || workspaceDeclaresVitest(workspace)
    ? mapSandboxTestCommand(command, aliases)
    : command;
}
