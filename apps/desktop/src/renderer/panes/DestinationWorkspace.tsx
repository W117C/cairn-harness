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

  const chatInert = hidden
    ? ({ inert: "" } as unknown as React.HTMLAttributes<HTMLDivElement>)
    : {};

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
        const inertProps = pageHidden
          ? ({ inert: "" } as unknown as React.HTMLAttributes<HTMLElement>)
          : {};
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
