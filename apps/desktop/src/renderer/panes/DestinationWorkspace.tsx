import { useEffect, useState } from "react";
import type { AppDestination, AppPageDestination } from "../app-controls";
import { APP_DESTINATION_LABEL } from "../navigation";
import { addVisitedDestination } from "../state/destination-pages";

/** 隐藏面的唯一 inert 写法（聊天树与已访问 durable 页共用）。
 *  本仓装的是 React 18.3.1：`inert` 不在它的布尔属性表里，传 `true` 会被**整个丢掉**（只留一条
 *  "Received `true` for a non-boolean attribute" warning）⇒ 属性根本不上 DOM。空串才是 HTML
 *  布尔属性的「在场」写法，实测落为 `inert=""`。升到 React 19 前不要改成布尔。
 *  后果口径（第 1058 页真机实测，不夸大）：隐藏面 CSS 已有 `visibility:hidden`，它本身就挡住 Tab
 *  与读屏 ⇒ 丢掉 inert 并没有让焦点当天真跑进去。inert 兜的是 visibility 兜不住的那一格：
 *  后代能自行 `visibility:visible` 逃出去，inert 不可被后代覆盖。 */
const INERT = { inert: "" } as unknown as React.HTMLAttributes<HTMLElement>;

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

  const chatInert = hidden ? INERT : {};

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
        const inertProps = pageHidden ? INERT : {};
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
