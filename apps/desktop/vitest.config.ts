import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// 与根 tests/vitest.config.ts 对齐宿主家目录隔离纪律：桌面测试含真实 KernelHost / handleAgentRun 用例，
// 缺省不设时会把影响面建图缓存、LSP 运行态、进化账写入用户真实家目录，或扫入宿主的 ~/.claude 插件源。
if (!process.env.PI_SCRATCH_DIR) process.env.PI_SCRATCH_DIR = join(tmpdir(), "dsh-desktop-pi-scratch");
mkdirSync(process.env.PI_SCRATCH_DIR, { recursive: true });
if (!process.env.M7_IMPACT_TAGS_DIR) process.env.M7_IMPACT_TAGS_DIR = join(tmpdir(), "dsh-desktop-impact-tags");
mkdirSync(process.env.M7_IMPACT_TAGS_DIR, { recursive: true });
if (!process.env.M2E_FOREIGN_SOURCES) process.env.M2E_FOREIGN_SOURCES = "off";
if (!process.env.CAIRN_EVOLVE_HOME) process.env.CAIRN_EVOLVE_HOME = join(tmpdir(), "dsh-desktop-evolve-home");
mkdirSync(process.env.CAIRN_EVOLVE_HOME, { recursive: true });
if (!process.env.CAIRN_LSP_HOME) process.env.CAIRN_LSP_HOME = join(tmpdir(), "dsh-desktop-lsp-runtime-home");
mkdirSync(process.env.CAIRN_LSP_HOME, { recursive: true });
if (!process.env.M2D_MEMORY_HOME) process.env.M2D_MEMORY_HOME = join(tmpdir(), "dsh-desktop-memory-home");
mkdirSync(process.env.M2D_MEMORY_HOME, { recursive: true });
if (!process.env.DSH_APPDATA) process.env.DSH_APPDATA = join(tmpdir(), "dsh-desktop-appdata-home");
mkdirSync(process.env.DSH_APPDATA, { recursive: true });

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
  },
});
