// 技能候选 CLI（Cairn Evolve · P4）：读历史 Episode，提炼同签名成功序列为 strategy candidate。
// 只写 candidate；不注入、不晋升。用法：
//   node --import tsx scripts/evolve-skill.ts [workspace] [--min 3] [--json]

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { seedSkillCandidates, type SeedSkillResult } from "../src/main/evolve/skill-synthesis";

export interface EvolveSkillOutput {
  workspace: string;
  result: SeedSkillResult;
}

export async function runEvolveSkill(args: readonly string[]): Promise<EvolveSkillOutput> {
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const workspace = resolve(positional[0] ?? process.cwd());
  const minIndex = args.indexOf("--min");
  const min = minIndex >= 0 ? Number(args[minIndex + 1]) : 3;
  const result = await seedSkillCandidates(workspace, {
    ...(Number.isFinite(min) ? { minEpisodes: Math.max(2, Math.trunc(min)) } : {}),
  });
  return { workspace, result };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  runEvolveSkill(args)
    .then((out) => {
      if (args.includes("--json")) {
        console.log(JSON.stringify(out, null, 2));
        return;
      }
      console.log("workspace: " + out.workspace);
      console.log("skill: proposed " + String(out.result.proposed)
        + " / added " + String(out.result.added)
        + " / existing " + String(out.result.skippedExisting)
        + " / invalid " + String(out.result.skippedInvalid));
      console.log("playbook: " + out.result.path);
    })
    .catch((err: unknown) => {
      console.error("[evolve-skill] " + (err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    });
}
