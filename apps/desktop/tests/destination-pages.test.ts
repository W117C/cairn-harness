import { describe, expect, it } from "vitest";
import { addVisitedDestination } from "../src/renderer/state/destination-pages";

describe("visited destination pages", () => {
  it("keeps each opened destination once while chat never owns a page surface", () => {
    let visited = addVisitedDestination([], "chat");
    expect(visited).toEqual([]);

    visited = addVisitedDestination(visited, "plugins");
    visited = addVisitedDestination(visited, "plugins");
    visited = addVisitedDestination(visited, "memory");

    expect(visited).toEqual(["plugins", "memory"]);
    expect(addVisitedDestination(visited, "chat")).toBe(visited);
  });
});
