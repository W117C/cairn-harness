import { assertFlowShape, assertJson, assertTaskGraph, expandFlow } from "./flow.js";
import type { AgentSpec, FlowNode, FlowTask, OrchPlan } from "./types.js";

function fail(path: string, message: string): never { throw new Error(`${path}: ${message}`); }
function object(value: unknown, path: string, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected object");
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) if (![...required, ...optional].includes(key)) fail(path, `unknown field ${key}`);
  for (const key of required) if (!Object.hasOwn(result, key)) fail(path, `missing ${key}`);
  return result;
}
function text(value: unknown, path: string): void {
  if (typeof value !== "string" || !value.trim()) fail(path, "expected nonempty string");
}
function number(value: unknown, path: string, min = -Infinity, max = Infinity, integer = false): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(path, `expected finite ${integer ? "integer" : "number"} in ${min}..${max}`);
}
function enumeration(value: unknown, path: string, choices: string[]): void {
  if (typeof value !== "string" || !choices.includes(value)) fail(path, `expected ${choices.join(" | ")}`);
}
function array(value: unknown, path: string, min = 0, max = 256): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `expected array length ${min}..${max}`);
  return value;
}
function strings(value: unknown, path: string, min = 0): string[] {
  const items = array(value, path, min);
  items.forEach((item, index) => text(item, `${path}[${index}]`));
  if (new Set(items).size !== items.length) fail(path, "duplicate string");
  return items as string[];
}
function budget(value: unknown, path: string): void {
  const item = object(value, path, ["usd"]);
  number(item.usd, `${path}.usd`, 0);
}
function writeScope(value: unknown, path: string): void {
  text(value, path);
  const scope = value as string;
  if (scope.startsWith("/") || scope.startsWith("~") || /^[A-Za-z]:/.test(scope) || /[\\\x00-\x1f\x7f]/.test(scope) || scope.includes("//") || scope.includes(":")) fail(path, "write scope must be a legal relative path");
  if (scope !== "." && scope.split("/").some((part) => part === ".." || part === "." || part === "")) fail(path, "write scope contains escaping or ambiguous path segment");
}
function scopes(value: unknown, path: string): string[] {
  const values = strings(value, path);
  values.forEach((scope, index) => writeScope(scope, `${path}[${index}]`));
  return values;
}
function artifact(value: unknown, path: string): void {
  const item = object(value, path, ["id", "kind"], ["hash"]);
  text(item.id, `${path}.id`);
  enumeration(item.kind, `${path}.kind`, ["file", "blob", "json", "url"]);
  if (Object.hasOwn(item, "hash")) text(item.hash, `${path}.hash`);
}
function check(value: unknown, path: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected acceptance object");
  const kind = (value as Record<string, unknown>).kind;
  let item: Record<string, unknown>;
  switch (kind) {
    case "command":
      item = object(value, path, ["kind", "id", "run", "timeout_ms"]);
      text(item.run, `${path}.run`); number(item.timeout_ms, `${path}.timeout_ms`, 1, Number.MAX_SAFE_INTEGER, true); break;
    case "artifact":
      item = object(value, path, ["kind", "id", "artifact_id"], ["hash"]);
      text(item.artifact_id, `${path}.artifact_id`);
      if (Object.hasOwn(item, "hash")) text(item.hash, `${path}.hash`);
      break;
    case "evidence":
      item = object(value, path, ["kind", "id", "fields"]);
      strings(item.fields, `${path}.fields`, 1); break;
    case "human":
      item = object(value, path, ["kind", "id", "instruction"]);
      text(item.instruction, `${path}.instruction`); break;
    default: fail(path, "unknown acceptance kind");
  }
  text(item.id, `${path}.id`);
}
function task(value: unknown, path: string): asserts value is FlowTask {
  const item = object(value, path, ["task_id", "goal", "non_goals", "agent_spec", "lane", "depends_on", "write_scopes", "inputs", "contract", "budget", "max_attempts", "priority"], ["deadline_ms"]);
  for (const field of ["task_id", "goal", "agent_spec"]) text(item[field], `${path}.${field}`);
  strings(item.non_goals, `${path}.non_goals`);
  strings(item.depends_on, `${path}.depends_on`);
  scopes(item.write_scopes, `${path}.write_scopes`);
  enumeration(item.lane, `${path}.lane`, ["read", "write", "external"]);
  array(item.inputs, `${path}.inputs`).forEach((entry, index) => artifact(entry, `${path}.inputs[${index}]`));
  const contract = object(item.contract, `${path}.contract`, ["acceptance", "effect"], ["idempotency_key", "rollback"]);
  const checks = array(contract.acceptance, `${path}.contract.acceptance`, 1);
  checks.forEach((entry, index) => check(entry, `${path}.contract.acceptance[${index}]`));
  const ids = checks.map((entry) => (entry as { id: string }).id);
  if (new Set(ids).size !== ids.length) fail(path, "duplicate acceptance ID");
  enumeration(contract.effect, `${path}.contract.effect`, ["none", "workspace", "external"]);
  for (const field of ["idempotency_key", "rollback"]) if (Object.hasOwn(contract, field)) text(contract[field], `${path}.contract.${field}`);
  budget(item.budget, `${path}.budget`);
  number(item.max_attempts, `${path}.max_attempts`, 1, 5, true);
  number(item.priority, `${path}.priority`);
  if (Object.hasOwn(item, "deadline_ms")) number(item.deadline_ms, `${path}.deadline_ms`, 0, Number.MAX_SAFE_INTEGER, true);
}
function agent(value: unknown, path: string): asserts value is AgentSpec {
  const item = object(value, path, ["agent_spec_id", "role", "capability", "max_turns"]);
  text(item.agent_spec_id, `${path}.agent_spec_id`); text(item.role, `${path}.role`);
  number(item.max_turns, `${path}.max_turns`, 1, 256, true);
  const cap = object(item.capability, `${path}.capability`, ["tools", "fs_read", "fs_write", "network", "shell", "git", "external_effects"]);
  for (const field of ["tools", "fs_read", "network"]) strings(cap[field], `${path}.capability.${field}`);
  scopes(cap.fs_write, `${path}.capability.fs_write`);
  enumeration(cap.shell, `${path}.capability.shell`, ["none", "read", "sandboxed"]);
  enumeration(cap.git, `${path}.capability.git`, ["none", "read", "commit", "merge"]);
  enumeration(cap.external_effects, `${path}.capability.external_effects`, ["none", "allowlist"]);
}
function flowTasks(flow: FlowNode): FlowTask[] {
  switch (flow.kind) {
    case "task": return [flow.task];
    case "sequence": case "parallel": case "race": case "gather": return flow.steps.flatMap(flowTasks);
    case "map": case "loop": return flowTasks(flow.body);
    case "branch": return [...flowTasks(flow.then), ...(flow.else ? flowTasks(flow.else) : [])];
    default: return [];
  }
}
function contains(capabilityScope: string, taskScope: string): boolean {
  if (capabilityScope === taskScope || capabilityScope === "." || capabilityScope === "**") return true;
  const root = capabilityScope.endsWith("/**") ? capabilityScope.slice(0, -3) : capabilityScope;
  return !/[?*\[\]{}]/.test(root) && taskScope.startsWith(`${root}/`);
}
function executable(current: FlowTask, specs: Map<string, AgentSpec>): void {
  const spec = specs.get(current.agent_spec);
  if (!spec) fail(`task ${current.task_id}.agent_spec`, `unknown agent_spec ${current.agent_spec}`);
  const cap = spec.capability;
  if (current.write_scopes.some((scope) => !cap.fs_write.some((allowed) => contains(allowed, scope)))) fail(`task ${current.task_id}`, "write scope exceeds agent capability");
  if (current.lane === "read") {
    if (current.contract.effect !== "none" || current.write_scopes.length || cap.fs_write.length || cap.external_effects !== "none" || ["commit", "merge"].includes(cap.git) || cap.shell === "sandboxed") fail(`task ${current.task_id}`, "read lane requires no write/external capability and effect none");
  } else if (current.lane === "write") {
    if (current.contract.effect !== "workspace" || !current.write_scopes.length || cap.external_effects !== "none") fail(`task ${current.task_id}`, "write lane requires workspace effect, nonempty write scopes and no external capability");
  } else if (current.contract.effect !== "external" || cap.external_effects !== "allowlist" || !cap.network.length || !current.contract.idempotency_key || !current.contract.rollback || current.write_scopes.length || cap.fs_write.length) {
    fail(`task ${current.task_id}`, "external lane requires external allowlist, network, idempotency_key and rollback, without workspace writes");
  }
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

/** Parse a strict JSON plan. A static flow, when present, is the authoritative task source. */
export function parsePlan(value: unknown): OrchPlan {
  assertJson(value, "plan");
  const item = object(value, "plan", ["plan_id", "version", "goal", "non_goals", "domain", "tasks", "agents", "budget", "max_concurrency", "policy_ref", "created_by"], ["flow"]);
  for (const field of ["plan_id", "goal", "policy_ref"]) text(item[field], `plan.${field}`);
  number(item.version, "plan.version", 1, 32, true);
  strings(item.non_goals, "plan.non_goals");
  enumeration(item.domain, "plan.domain", ["coding", "research", "ops", "data", "generic"]);
  enumeration(item.created_by, "plan.created_by", ["user", "planner", "policy"]);
  budget(item.budget, "plan.budget");
  number(item.max_concurrency, "plan.max_concurrency", 1, 16, true);
  const tasks = array(item.tasks, "plan.tasks");
  tasks.forEach((entry, index) => task(entry, `plan.tasks[${index}]`));
  const agents = array(item.agents, "plan.agents", 1);
  agents.forEach((entry, index) => agent(entry, `plan.agents[${index}]`));
  const specs = new Map<string, AgentSpec>();
  for (const entry of agents as AgentSpec[]) {
    if (specs.has(entry.agent_spec_id)) fail("plan.agents", `duplicate agent ID ${entry.agent_spec_id}`);
    specs.set(entry.agent_spec_id, entry);
  }
  let expanded = tasks as FlowTask[];
  if (Object.hasOwn(item, "flow")) {
    assertFlowShape(item.flow);
    flowTasks(item.flow).forEach((entry, index) => { task(entry, `plan.flow.tasks[${index}]`); executable(entry, specs); });
    expanded = expandFlow(item.flow);
    if (tasks.length && canonical([...tasks].sort((a, b) => (a as FlowTask).task_id.localeCompare((b as FlowTask).task_id))) !== canonical([...expanded].sort((a, b) => a.task_id.localeCompare(b.task_id)))) fail("plan", "flow and tasks conflict; use empty tasks or identical expanded definitions");
  }
  for (const entry of expanded) executable(entry, specs);
  assertTaskGraph(expanded);
  return structuredClone({ ...item, tasks: expanded }) as unknown as OrchPlan;
}
