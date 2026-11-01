import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { AppDestination, AppPageDestination } from "../app-controls";
import { defaultPageFilter } from "../navigation";

export type PageFilters = Record<AppPageDestination, string>;

export function createPageFilters(): PageFilters {
  return {
    plugins: defaultPageFilter("plugins"),
    memory: defaultPageFilter("memory"),
    automation: defaultPageFilter("automation"),
  };
}

export function pageFilterFor(destination: AppDestination, filters: PageFilters): string {
  return destination === "chat" ? "" : filters[destination];
}

export function withPageFilter(
  filters: PageFilters,
  destination: AppPageDestination,
  filter: string,
): PageFilters {
  return { ...filters, [destination]: filter };
}

export function useWorkbenchDestination(
  setSettingsOpen: Dispatch<SetStateAction<boolean>>,
) {
  const [destination, setDestination] = useState<AppDestination>("chat");
  const [pageFilters, setPageFilters] = useState<PageFilters>(createPageFilters);

  const openDestination = useCallback((next: AppDestination): void => {
    setSettingsOpen(false);
    setDestination(next);
  }, [setSettingsOpen]);

  const pageFilter = pageFilterFor(destination, pageFilters);
  const setPageFilter = useCallback((filter: string): void => {
    if (destination === "chat") return;
    setPageFilters((current) => withPageFilter(current, destination, filter));
  }, [destination]);

  return { destination, pageFilter, openDestination, setPageFilter };
}
