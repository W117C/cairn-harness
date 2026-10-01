// 索引命中 vs 冷建 计时读数（M1 验收「索引命中时建图耗时必须低于冷建」）：夹具拷进临时 git 仓，
// persistIndex:true 冷建一次（全解析＋落盘）→ 热载一次（同 sha 命中），贴两次读数。
import { mkdtemp, cp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
const exec = promisify(execFile);

const work = await mkdtemp(join(tmpdir(), "idx-timing-"));
const repo = join(work, "repo");
await cp(new URL("../../fixtures/impact/accuracy-repo-multilang/", import.meta.url), repo, { recursive: true });
await exec("git", ["init"], { cwd: repo });
await exec("git", ["config", "user.email", "p@t"], { cwd: repo });
await exec("git", ["config", "user.name", "p"], { cwd: repo });
await exec("git", ["add", "."], { cwd: repo });
await exec("git", ["commit", "-m", "init"], { cwd: repo });

const { buildImpact } = await import("../../src/agent/impact/index.js");
const cacheDir = join(work, "cache");
const t0 = performance.now();
await buildImpact({ workspace: repo, cacheDir, persistIndex: true });
const cold = performance.now() - t0;
const t1 = performance.now();
await buildImpact({ workspace: repo, cacheDir, persistIndex: true });
const warm = performance.now() - t1;
console.log(`冷建（全解析＋落盘）= ${cold.toFixed(0)} ms | 索引命中（热载）= ${warm.toFixed(0)} ms | 加速 ${(cold / warm).toFixed(1)}x`);
await rm(work, { recursive: true, force: true });
