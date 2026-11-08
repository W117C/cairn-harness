import { assertFlowShape, assertJson } from "./flow";
import type {
  Expr,
  FlowNode,
  FlowTask,
  RuntimeCandidate,
  RuntimeControlGroup,
  RuntimeNode,
} from "./types";

const TASK_LIMIT = 256;

function fail(path: string, message: string): never {
  throw new Error(path + ": " + message);
}

function resolve(expr: Expr, bindings: Record<string, unknown>): unknown {
  if ("literal" in expr) return expr.literal;
  const parts = expr.ref.split(".");
  let value: unknown = bindings;
  for (const part of parts) {
    if (!part || ["__proto__", "prototype", "constructor"].includes(part) ||
        value === null || typeof value !== "object" || !Object.hasOwn(value, part)) {
      throw new Error("flow: unbound ref " + expr.ref + "; provide an explicit logged binding");
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("flow: branch/loop condition must resolve to a boolean");
  return value;
}

function taskIds(node: FlowNode): string[] {
  switch (node.kind) {
    case "task": return [node.task.task_id];
    case "sequence":
    case "parallel":
    case "race":
    case "gather": return node.steps.flatMap(taskIds);
    case "map":
    case "loop": return taskIds(node.body);
    case "branch": return [...taskIds(node.then), ...(node.else ? taskIds(node.else) : [])];
    default: return [];
  }
}

function rejectTemplates(value: unknown): void {
  if (typeof value === "string" && value.includes("${")) {
    fail("flow", "task string templates/interpolation are unsupported; use explicit static task data");
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) rejectTemplates(entry);
  }
}

interface Part {
  tasks: FlowTask[];
  roots: string[];
  anchors: string[];
  groups: RuntimeControlGroup[];
}

interface Built {
  node: RuntimeNode;
  part: Part;
}

function addDependencies(tasks: FlowTask[], roots: readonly string[], dependencies: readonly string[]): void {
  if (dependencies.length === 0) return;
  const rootSet = new Set(roots);
  for (const task of tasks) {
    if (rootSet.has(task.task_id)) {
      task.depends_on = [...new Set([...task.depends_on, ...dependencies])];
    }
  }
}

function sequenceParts(parts: readonly Part[]): Part {
  const tasks: FlowTask[] = [];
  const roots: string[] = [];
  let anchors: string[] = [];
  const groups: RuntimeControlGroup[] = [];
  for (const part of parts) {
    if (part.tasks.length === 0) continue;
    if (tasks.length === 0) roots.push(...part.roots);
    addDependencies(part.tasks, part.roots, anchors);
    tasks.push(...part.tasks);
    groups.push(...part.groups);
    anchors = [...part.anchors];
  }
  return { tasks, roots, anchors, groups };
}

function parallelParts(parts: readonly Part[]): Part {
  return {
    tasks: parts.flatMap((part) => part.tasks),
    roots: parts.flatMap((part) => part.roots),
    anchors: parts.flatMap((part) => part.anchors),
    groups: parts.flatMap((part) => part.groups),
  };
}

function boundConcurrency(part: Part, limit?: number): Part {
  if (limit === undefined || part.tasks.length <= limit) return part;
  for (let index = limit; index < part.tasks.length; index += limit) {
    const previous = part.tasks.slice(index - limit, index).map((task) => task.task_id);
    for (const task of part.tasks.slice(index, index + limit)) {
      task.depends_on = [...new Set([...task.depends_on, ...previous])];
    }
  }
  return part;
}

export function hasRuntimeControl(node: FlowNode): boolean {
  switch (node.kind) {
    case "race": return true;
    case "gather": return node.strategy !== "all" || node.steps.some(hasRuntimeControl);
    case "sequence":
    case "parallel": return node.steps.some(hasRuntimeControl);
    case "map":
    case "loop": return hasRuntimeControl(node.body);
    case "branch": return hasRuntimeControl(node.then) || (node.else !== undefined && hasRuntimeControl(node.else));
    default: return false;
  }
}

/** Resolve static branches/maps/loops while retaining race and non-all gather groups. */
export function expandRuntimeFlow(flow: FlowNode, bindings: Record<string, unknown> = {}): RuntimeNode {
  assertFlowShape(flow);
  assertJson(bindings, "bindings");
  if (bindings === null || typeof bindings !== "object" || Array.isArray(bindings)) fail("bindings", "expected an object");

  let emitted = 0;
  let visited = 0;
  let groupSeq = 0;

  const build = (
    node: FlowNode,
    suffix: string,
    scope: Record<string, unknown>,
    aliases: Map<string, string>,
  ): Built => {
    if (++visited > 16_384) fail("flow", "runtime expansion node limit is 16384, including empty branches");
    const repeat = (body: FlowNode, nextSuffix: string, nextScope: Record<string, unknown>): Built => {
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
        const part: Part = { tasks: [task], roots: [task.task_id], anchors: [task.task_id], groups: [] };
        return { node: { kind: "task", task }, part };
      }
      case "sequence": {
        const built = node.steps.map((step) => build(step, suffix, scope, aliases));
        return {
          node: { kind: "sequence", steps: built.map((item) => item.node) },
          part: sequenceParts(built.map((item) => item.part)),
        };
      }
      case "parallel": {
        const built = node.steps.map((step) => build(step, suffix, scope, aliases));
        const part = boundConcurrency(parallelParts(built.map((item) => item.part)), node.max_concurrency);
        return {
          node: {
            kind: "parallel",
            steps: built.map((item) => item.node),
            ...(node.max_concurrency !== undefined ? { max_concurrency: node.max_concurrency } : {}),
          },
          part,
        };
      }
      case "map": {
        const items = resolve(node.items, scope);
        if (!Array.isArray(items)) fail("flow.items", "map requires an array");
        if (items.length > node.max_items) fail("flow.max_items", "map input exceeds max_items");
        const built = items.map((item, index) => repeat(node.body, suffix + "__m" + String(index), { ...scope, item, index }));
        const part = boundConcurrency(parallelParts(built.map((item) => item.part)), node.max_concurrency);
        return { node: { kind: "sequence", steps: built.map((item) => item.node) }, part };
      }
      case "branch": {
        const selected = booleanValue(resolve(node.when, scope)) ? node.then : node.else;
        return selected
          ? build(selected, suffix, scope, aliases)
          : {
              node: { kind: "sequence", steps: [] },
              part: { tasks: [], roots: [], anchors: [], groups: [] },
            };
      }
      case "loop": {
        const built: Built[] = [];
        for (let iteration = 0; iteration < node.max_iterations; iteration++) {
          const iterationScope = { ...scope, iteration };
          if (!booleanValue(resolve(node.while, iterationScope))) break;
          built.push(repeat(node.body, suffix + "__l" + String(iteration), iterationScope));
        }
        return {
          node: { kind: "sequence", steps: built.map((item) => item.node) },
          part: sequenceParts(built.map((item) => item.part)),
        };
      }
      case "gather": {
        if (node.strategy === "all") {
          const built = node.steps.map((step) => build(step, suffix, scope, aliases));
          const part = parallelParts(built.map((item) => item.part));
          return { node: { kind: "parallel", steps: built.map((item) => item.node) }, part };
        }
        const built = node.steps.map((step) => build(step, suffix, scope, aliases));
        return controlGroup("gather", node.strategy, node.quorum ?? 1, built);
      }
      case "race": {
        const built = node.steps.map((step) => build(step, suffix, scope, aliases));
        return controlGroup("race", "race", 1, built);
      }
      case "checkpoint":
        return {
          node: { kind: "checkpoint", label: node.label },
          part: { tasks: [], roots: [], anchors: [], groups: [] },
        };
      case "escalate":
        return {
          node: { kind: "escalate", reason: node.reason },
          part: { tasks: [], roots: [], anchors: [], groups: [] },
        };
    }
  };

  const controlGroup = (
    kind: RuntimeControlGroup["kind"],
    strategy: RuntimeControlGroup["strategy"],
    quorum: number,
    built: readonly Built[],
  ): Built => {
    const id = "g" + String(groupSeq++);
    const candidates: RuntimeCandidate[] = built.map((item, index) => ({
      candidate_id: "c" + String(index),
      task_ids: item.part.tasks.map((task) => task.task_id),
    }));
    const group: RuntimeControlGroup = {
      id,
      kind,
      strategy,
      quorum,
      candidates,
      steps: built.map((item) => item.node),
    };
    const anchor = "@group:" + id;
    return {
      node: { kind: "control", group },
      part: {
        tasks: built.flatMap((item) => item.part.tasks),
        roots: built.flatMap((item) => item.part.roots),
        anchors: [anchor],
        groups: [...built.flatMap((item) => item.part.groups), group],
      },
    };
  };

  return build(flow, "", structuredClone(bindings), new Map()).node;
}

export function runtimeTasks(node: RuntimeNode): FlowTask[] {
  switch (node.kind) {
    case "task": return [node.task];
    case "control": return (node.group.steps ?? []).flatMap(runtimeTasks);
    case "sequence":
    case "parallel": return node.steps.flatMap(runtimeTasks);
    default: return [];
  }
}

export function runtimeGroups(node: RuntimeNode): RuntimeControlGroup[] {
  switch (node.kind) {
    case "control": {
      const nested = (node.group.steps ?? []).flatMap(runtimeGroups);
      return [...nested, node.group];
    }
    case "sequence":
    case "parallel": return node.steps.flatMap(runtimeGroups);
    default: return [];
  }
}

export interface RuntimeControlDecision {
  status: "pending" | "satisfied" | "failed";
  winners: string[];
  cancelled: string[];
  reason?: string;
}

export function decideRuntimeControl(
  group: RuntimeControlGroup,
  states: Readonly<Record<string, string>>,
): RuntimeControlDecision {
  const candidates = [...group.candidates].sort((left, right) =>
    left.candidate_id.localeCompare(right.candidate_id) ||
    left.task_ids.join("\n").localeCompare(right.task_ids.join("\n")));
  const success = candidates.filter((candidate) =>
    candidate.task_ids.every((id) => states[id] === "done"));
  const pending = candidates.filter((candidate) =>
    !candidate.task_ids.every((id) => states[id] === "done") &&
    !candidate.task_ids.some((id) => ["failed", "cancelled", "needs_you"].includes(states[id] ?? "")));
  const required = group.strategy === "race" || group.strategy === "any" ? 1 : group.quorum;
  const allTaskIds = candidates.flatMap((candidate) => candidate.task_ids).sort();
  if (success.length >= required) {
    const winning = success.slice(0, required);
    const winners = winning.flatMap((candidate) => candidate.task_ids).sort();
    return {
      status: "satisfied",
      winners,
      cancelled: allTaskIds.filter((id) => !winners.includes(id)),
    };
  }
  if (success.length + pending.length < required) {
    return {
      status: "failed",
      winners: [],
      cancelled: allTaskIds,
      reason: "not enough candidates can succeed",
    };
  }
  return { status: "pending", winners: [], cancelled: [] };
}
