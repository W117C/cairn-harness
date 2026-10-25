import type { FlowNode, FlowTask } from "./types.js";

const TASK_LIMIT = 256;
type Fragment = { tasks: FlowTask[]; roots: string[]; leaves: string[] };

function fail(path: string, message: string): never { throw new Error(`${path}: ${message}`); }
function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected an object");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(path, `unknown field ${key}`);
}
function bound(value: unknown, path: string, min: number, max: number): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) fail(path, `expected integer ${min}..${max}`);
}
/** Reject objects that JSON would coerce or omit, before reading their values. */
export function assertJson(value: unknown, path = "value", ancestors = new Set<object>(), depth = 0): void {
  if (depth > 64) fail(path, "JSON nesting exceeds 64");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { if (!Number.isFinite(value)) fail(path, "JSON number must be finite"); return; }
  if (typeof value !== "object") fail(path, `non JSON value ${typeof value}`);
  if (ancestors.has(value)) fail(path, "cyclic JSON object");
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail(path, "expected plain JSON object");
  if (Object.getOwnPropertySymbols(value).length) fail(path, "JSON symbol keys are not supported");
  for (const key of Object.getOwnPropertyNames(value)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable) fail(path, "JSON properties must be enumerable");
    if (!Object.hasOwn(descriptor, "value")) fail(path, "JSON accessors are not supported");
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) fail(path, "sparse JSON array");
      assertJson(value[index], `${path}[${index}]`, ancestors, depth + 1);
    }
    if (Object.keys(value).some((key) => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) fail(path, "unknown JSON array field");
  } else {
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!Object.hasOwn(descriptor, "value")) fail(path, "JSON accessors are not supported");
      assertJson(descriptor.value, `${path}.${key}`, ancestors, depth + 1);
    }
  }
  ancestors.delete(value);
}

function checkExpr(value: unknown, path: string): void {
  const expr = record(value, path);
  keys(expr, ["literal", "ref"], path);
  if (Object.hasOwn(expr, "literal") === Object.hasOwn(expr, "ref")) fail(path, "expected exactly one literal or ref");
  if (Object.hasOwn(expr, "ref") && (typeof expr.ref !== "string" || !expr.ref.trim())) fail(path, "ref must be a nonempty string");
}

function checkNode(value: unknown, path: string, depth = 0): void {
  if (depth > 64) fail(path, "Flow depth exceeds 64");
  const node = record(value, path);
  const child = (item: unknown, label: string) => checkNode(item, `${path}.${label}`, depth + 1);
  const steps = () => {
    if (!Array.isArray(node.steps) || node.steps.length > TASK_LIMIT) fail(path, "steps must be an array with at most 256 nodes");
    node.steps.forEach((item, index) => child(item, `steps[${index}]`));
  };
  switch (node.kind) {
    case "task": {
      keys(node, ["kind", "task"], path);
      const task = record(node.task, `${path}.task`);
      keys(task, ["task_id", "goal", "non_goals", "agent_spec", "lane", "depends_on", "write_scopes", "inputs", "contract", "budget", "max_attempts", "priority", "deadline_ms"], `${path}.task`);
      if (typeof task.task_id !== "string" || !task.task_id.trim() || !Array.isArray(task.depends_on) || task.depends_on.some((id) => typeof id !== "string")) fail(path, "task requires task_id and string depends_on");
      break;
    }
    case "sequence": case "parallel":
      keys(node, ["kind", "steps", "max_concurrency"], path);
      if (Object.hasOwn(node, "max_concurrency")) bound(node.max_concurrency, `${path}.max_concurrency`, 1, 16);
      steps(); break;
    case "map":
      keys(node, ["kind", "items", "body", "max_items", "max_concurrency"], path);
      checkExpr(node.items, `${path}.items`);
      bound(node.max_items, `${path}.max_items`, 0, TASK_LIMIT);
      if (Object.hasOwn(node, "max_concurrency")) bound(node.max_concurrency, `${path}.max_concurrency`, 1, 16);
      child(node.body, "body"); break;
    case "branch":
      keys(node, ["kind", "when", "then", "else"], path);
      checkExpr(node.when, `${path}.when`);
      child(node.then, "then");
      if (Object.hasOwn(node, "else")) child(node.else, "else");
      break;
    case "loop":
      keys(node, ["kind", "while", "max_iterations", "body"], path);
      checkExpr(node.while, `${path}.while`);
      bound(node.max_iterations, `${path}.max_iterations`, 0, TASK_LIMIT);
      child(node.body, "body"); break;
    case "race": keys(node, ["kind", "steps"], path); steps(); break;
    case "gather":
      keys(node, ["kind", "steps", "strategy", "quorum"], path); steps();
      if (!["all", "any", "quorum"].includes(node.strategy as string)) fail(path, "unknown gather strategy");
      if (node.strategy === "quorum") bound(node.quorum, `${path}.quorum`, 1, (node.steps as unknown[]).length);
      else if (Object.hasOwn(node, "quorum")) fail(path, "quorum is only valid for gather quorum");
      break;
    case "checkpoint":
      keys(node, ["kind", "label"], path);
      if (typeof node.label !== "string" || !node.label.trim()) fail(path, "checkpoint requires label");
      break;
    case "escalate":
      keys(node, ["kind", "reason"], path);
      if (typeof node.reason !== "string" || !node.reason.trim()) fail(path, "escalate requires reason");
      break;
    default: fail(path, "unknown Flow kind");
  }
}

/** All branches are shape checked, including statically unselected branches. */
export function assertFlowShape(value: unknown): asserts value is FlowNode {
  assertJson(value, "flow");
  checkNode(value, "flow");
}

function resolve(expr: { literal: unknown } | { ref: string }, bindings: Record<string, unknown>): unknown {
  if ("literal" in expr) return expr.literal;
  const parts = expr.ref.split(".");
  let value: unknown = bindings;
  for (const part of parts) {
    if (!part || ["__proto__", "prototype", "constructor"].includes(part) || value === null || typeof value !== "object" || !Object.hasOwn(value, part)) fail("flow", `unbound ref ${expr.ref}; provide an explicit logged binding`);
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") fail("flow", "branch/loop condition must resolve to a boolean");
  return value;
}
function fragment(tasks: FlowTask[]): Fragment {
  if (tasks.length > TASK_LIMIT) fail("flow", "expanded task limit is 256");
  const ids = new Set(tasks.map((task) => task.task_id));
  const used = new Set(tasks.flatMap((task) => task.depends_on.filter((id) => ids.has(id))));
  return { tasks, roots: tasks.filter((task) => task.depends_on.every((id) => !ids.has(id))).map((task) => task.task_id), leaves: tasks.filter((task) => !used.has(task.task_id)).map((task) => task.task_id) };
}
function addDependencies(tasks: FlowTask[], roots: string[], dependencies: string[]): void {
  const rootSet = new Set(roots);
  for (const task of tasks) if (rootSet.has(task.task_id)) task.depends_on = [...new Set([...task.depends_on, ...dependencies])];
}
function serial(parts: Fragment[]): Fragment {
  let previous: string[] = [];
  const tasks: FlowTask[] = [];
  for (const part of parts) {
    if (!part.tasks.length) continue;
    addDependencies(part.tasks, part.roots, previous);
    tasks.push(...part.tasks);
    if (tasks.length > TASK_LIMIT) fail("flow", "expanded task limit is 256");
    previous = part.leaves;
  }
  return fragment(tasks);
}
/** A batch barrier bounds tasks, including nested parallel groups; it may reduce throughput. */
function concurrency(part: Fragment, limit?: number): Fragment {
  if (limit === undefined || part.tasks.length <= limit) return part;
  for (let index = limit; index < part.tasks.length; index += limit) {
    const previous = part.tasks.slice(index - limit, index).map((task) => task.task_id);
    for (const task of part.tasks.slice(index, index + limit)) task.depends_on = [...new Set([...task.depends_on, ...previous])];
  }
  return fragment(part.tasks);
}
function taskIds(node: FlowNode): string[] {
  switch (node.kind) {
    case "task": return [node.task.task_id];
    case "sequence": case "parallel": case "race": case "gather": return node.steps.flatMap(taskIds);
    case "map": case "loop": return taskIds(node.body);
    case "branch": return [...taskIds(node.then), ...(node.else ? taskIds(node.else) : [])];
    default: return [];
  }
}
function rejectTemplates(value: unknown): void {
  if (typeof value === "string" && value.includes("${")) fail("flow", "task string templates/interpolation are unsupported; use explicit static task data");
  if (value && typeof value === "object") for (const entry of Object.values(value)) rejectTemplates(entry);
}

export function assertTaskGraph(tasks: FlowTask[]): void {
  const byId = new Map<string, FlowTask>();
  for (const task of tasks) {
    if (byId.has(task.task_id)) fail("tasks", `duplicate task ID ${task.task_id}`);
    byId.set(task.task_id, task);
  }
  const complete = new Set<string>(); const visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) fail("tasks", `dependency cycle at ${id}`);
    if (complete.has(id)) return;
    const task = byId.get(id);
    if (!task) fail("tasks", `unknown dependency ${id}`);
    visiting.add(id);
    for (const dependency of task.depends_on) visit(dependency);
    visiting.delete(id); complete.add(id);
  };
  for (const id of byId.keys()) visit(id);
}

/** Static, bounded expansion only. No runtime results, string evaluation, or hidden control tasks. */
export function expandFlow(flow: FlowNode, bindings: Record<string, unknown> = {}): FlowTask[] {
  assertFlowShape(flow);
  assertJson(bindings, "bindings");
  record(bindings, "bindings");
  let emitted = 0; let visited = 0;
  const build = (node: FlowNode, suffix: string, scope: Record<string, unknown>, aliases: Map<string, string>): Fragment => {
    if (++visited > 16_384) fail("flow", "static expansion node limit is 16384, including empty branches");
    const repeat = (body: FlowNode, nextSuffix: string, nextScope: Record<string, unknown>) => {
      const local = new Map(aliases);
      for (const id of taskIds(body)) local.set(id, id + nextSuffix);
      return build(body, nextSuffix, nextScope, local);
    };
    switch (node.kind) {
      case "task": {
        if (++emitted > TASK_LIMIT) fail("flow", "expanded task limit is 256");
        rejectTemplates(node.task);
        const task = structuredClone(node.task);
        task.task_id += suffix;
        task.depends_on = task.depends_on.map((id) => aliases.get(id) ?? id);
        return fragment([task]);
      }
      case "sequence": return concurrency(serial(node.steps.map((step) => build(step, suffix, scope, aliases))), node.max_concurrency);
      case "parallel": return concurrency(fragment(node.steps.flatMap((step) => build(step, suffix, scope, aliases).tasks)), node.max_concurrency);
      case "map": {
        const items = resolve(node.items, scope);
        if (!Array.isArray(items)) fail("flow.items", "map requires an array");
        if (items.length > node.max_items) fail("flow.max_items", "map input exceeds max_items");
        return concurrency(fragment(items.flatMap((item, index) => repeat(node.body, `${suffix}__m${index}`, { ...scope, item, index }).tasks)), node.max_concurrency);
      }
      case "branch": {
        const selected = bool(resolve(node.when, scope)) ? node.then : node.else;
        return selected ? build(selected, suffix, scope, aliases) : fragment([]);
      }
      case "loop": {
        const parts: Fragment[] = [];
        for (let iteration = 0; iteration < node.max_iterations; iteration++) {
          const iterationScope = { ...scope, iteration };
          if (!bool(resolve(node.while, iterationScope))) break;
          parts.push(repeat(node.body, `${suffix}__l${iteration}`, iterationScope));
        }
        return serial(parts);
      }
      case "gather":
        if (node.strategy === "all") return fragment(node.steps.flatMap((step) => build(step, suffix, scope, aliases).tasks));
        fail("flow", `gather ${node.strategy} requires runtime completion/cancellation state; unsupported by a static DAG`);
      case "race": fail("flow", "race requires runtime winner/cancellation state; unsupported by a static DAG");
      case "checkpoint": case "escalate": fail("flow", `${node.kind} requires a runtime control record and cannot be expressed as FlowTask[]`);
    }
  };
  const tasks = build(flow, "", structuredClone(bindings), new Map()).tasks;
  assertTaskGraph(tasks);
  return tasks;
}
