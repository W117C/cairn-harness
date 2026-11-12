// Cairn Evolve 的纯核心（electron-free）：Episode 投影与类型。
// IO/编排住 `src/main/evolve/`；这里不 import main，也不 import Electron/UI。
export {
  EPISODE_POLICY_VERSION,
  EPISODE_VERSION,
  assignmentFromEvents,
  classifyTask,
  finalOutcomeOf,
  outcomeSourceOf,
  projectEpisode,
  taskSignature,
  taskTokens,
} from "./episode";
export type {
  EpisodeArm,
  EpisodeAssembly,
  EpisodeAssignment,
  EpisodeAssignmentSource,
  EpisodeCost,
  EpisodeEvidence,
  EpisodeFinal,
  EpisodeJudge,
  EpisodeOutcomeRecord,
  EpisodeOutcomeSource,
  EpisodeRecord,
  EpisodeRunRef,
  EpisodeTask,
  EpisodeTaskClass,
  EpisodeUser,
  ProjectEpisodeInput,
} from "./episode";
export * from "./playbook";
export * from "./shadow";
export * from "./experiment";
export * from "./candidates";
export * from "./skills";
export * from "./retirement";
export * from "./offline-eval";
export * from "./offline-apply";
export * from "./operators";
