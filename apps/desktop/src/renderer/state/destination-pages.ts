import type { AppDestination, AppPageDestination } from "../app-controls";

export function addVisitedDestination(
  visited: readonly AppPageDestination[],
  destination: AppDestination,
): readonly AppPageDestination[] {
  if (destination === "chat" || visited.includes(destination)) return visited;
  return [...visited, destination];
}
