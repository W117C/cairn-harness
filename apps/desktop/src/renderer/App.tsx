import { WorkbenchView } from "./panes/WorkbenchView";
import { useWorkbenchModel } from "./state/workbench";

export function App() {
  const model = useWorkbenchModel();
  if (model.protocolMismatch !== null) {
    return (
      <div className="app">
        <div className="fatal">
          <h1>Cairn</h1>
          <div className="fatal-note">{model.protocolMismatch}</div>
        </div>
      </div>
    );
  }
  return <WorkbenchView {...model} />;
}
