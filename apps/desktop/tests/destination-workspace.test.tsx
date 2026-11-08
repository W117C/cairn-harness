import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DestinationWorkspace } from "../src/renderer/panes/DestinationWorkspace";

describe("DestinationWorkspace", () => {
  it("keeps the chat tree mounted but inert while a durable page is visible", () => {
    const html = renderToStaticMarkup(
      <DestinationWorkspace
        destination="plugins"
        renderPage={(destination) => <div>{destination}-page</div>}
      >
        <div>chat-state</div>
      </DestinationWorkspace>,
    );

    expect(html).toContain("chat-state");
    expect(html).toContain('class="chat-workspace"');
    expect(html).toContain('data-hidden="true"');
    expect(html).toContain('inert=""');
    expect(html).toContain('aria-label="插件"');
    expect(html).toContain('data-destination-page="plugins"');
    expect(html).toContain("plugins-page");
  });

  it("leaves chat active and visible on its default destination", () => {
    const html = renderToStaticMarkup(
      <DestinationWorkspace destination="chat" renderPage={() => null}>
        <div>chat-state</div>
      </DestinationWorkspace>,
    );

    expect(html).toContain('data-hidden="false"');
    expect(html).not.toContain("inert");
    expect(html).not.toContain("destination-page");
  });
});
