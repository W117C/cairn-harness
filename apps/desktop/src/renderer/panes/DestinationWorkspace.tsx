import { useEffect, useState } from "react";
import type { AppDestination, AppPageDestination } from "../app-controls";
import { APP_DESTINATION_LABEL } from "../navigation";
import { addVisitedDestination } from "../state/destination-pages";

interface DestinationWorkspaceProps {
  destination: AppDestination;
  renderPage: (destination: AppPageDestination) => React.ReactNode;
  children: React.ReactNode;
}

export function DestinationWorkspace(props: DestinationWorkspaceProps): React.JSX.Element {
  const hidden = props.destination !== "chat";
  const [visited, setVisited] = useState<readonly AppPageDestination[]>(
    () => addVisitedDestination([], props.destination),
  );
  const visiblePages = addVisitedDestination(visited, props.destination);
  useEffect(() => {
    setVisited((current) => addVisitedDestination(current, props.destination));
  }, [props.destination]);

  // React 19 起 `inert` 是布尔 attribute（React 18 的 @types 缺这个 prop，旧实现用空串绕过）。
  // 传空串会被当成 false，React 19 还会发 warning；这里直接走真布尔。
  const chatInert = hidden ? { inert: true } : {};

  return (
    <div className="workspace-host">
      <div
        className="chat-workspace"
        data-hidden={hidden ? "true" : "false"}
        aria-hidden={hidden ? "true" : undefined}
        {...chatInert}
      >
        {props.children}
      </div>
      {visiblePages.map((destination) => {
        const pageHidden = props.destination !== destination;
        const inertProps = pageHidden ? { inert: true } : {};
        return (
          <section
            key={destination}
            className="destination-page"
            data-destination-page={destination}
            data-hidden={pageHidden ? "true" : "false"}
            aria-label={APP_DESTINATION_LABEL[destination]}
            aria-hidden={pageHidden ? "true" : undefined}
            {...inertProps}
          >
            {props.renderPage(destination)}
          </section>
        );
      })}
    </div>
  );
}
