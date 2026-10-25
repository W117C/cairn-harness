import ts from 'typescript';import fs from 'node:fs';import path from 'node:path';
const root='apps/desktop/src/renderer/';
function transfer(file,name,target,header,kind='type'){
 const p=root+file,s=fs.readFileSync(p,'utf8'),a=ts.createSourceFile(p,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const n=a.statements.find(n=>n.name?.text===name||(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(a)===name)));
 if(!n)throw Error(name);const src=n.getText(a);fs.writeFileSync(root+target,header+src+'\n');
 const imp=`import ${kind==='type'?'type ':''}{ ${name} } from "../${target.replace(/\.tsx?$/,'')}";\nexport ${kind==='type'?'type ':''}{ ${name} } from "../${target.replace(/\.tsx?$/,'')}";`;
 fs.writeFileSync(p,s.slice(0,n.getStart(a))+imp+s.slice(n.end));
}
transfer('components/Stream.tsx','StreamActions','stream-actions.ts','import type { StreamRow } from "./projections";\n');
transfer('components/UsagePanel.tsx','UsageAllState','usage-state.ts','import type { UsageLedgerPayload } from "../../../../src/main/ipc-protocol";\n');
transfer('components/PermissionMenu.tsx','MODE_LABEL','permission-labels.ts','import type { PermissionMode } from "../../../../src/main/ipc-protocol";\nimport { STR } from "./strings";\n','value');
transfer('components/Popover.tsx','usePopoverDismiss','usePopoverDismiss.ts','import { useRef, useEffect, type RefObject } from "react";\n','value');
// The stream model contains only pure projection helpers; preserve its old import surface.
const old=root+'components/stream-model.ts';fs.writeFileSync(root+'stream-model.ts',fs.readFileSync(old,'utf8').replace('"../projections"','"./projections"').replace('"../fold-rounds"','"./fold-rounds"'));
fs.writeFileSync(old,'export { truncateSummary, turnSummaries, foldAllButLast, canFoldRound } from "../stream-model";\n');
let s=fs.readFileSync(root+'App.tsx','utf8');const a=ts.createSourceFile('App.tsx',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const fn=a.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='App');const ret=fn.body.statements.at(-1);
const props=ret.expression.attributes.properties.map(p=>p.name.text);
const prefix=s.slice(0,fn.getStart(a));let body=s.slice(fn.body.pos+1,ret.getStart(a));
const fatalStart=body.indexOf('  // SEMA §3.5/§12：协议失配 fatal 早退面。');const fatalEnd=body.indexOf('  // P1 侧栏数据面',fatalStart);body=body.slice(0,fatalStart)+body.slice(fatalEnd);
const model=(prefix+'export function useWorkbenchModel() {\n'+body+'  return {\n'+['protocolMismatch',...props].map(p=>'    '+p+',').join('\n')+'\n  };\n}\n')
 .replaceAll('"../../../../src/','"../../../../../src/').replaceAll('"./','"../')
 .replaceAll('"../state/','"./').replaceAll('"../components/Stream"','"../stream-actions"').replaceAll('"../components/UsagePanel"','"../usage-state"')
 .replaceAll('"../components/PermissionMenu"','"../permission-labels"').replaceAll('"../components/stream-model"','"../stream-model"')
 .replaceAll('"../components/Popover"','"../usePopoverDismiss"').replaceAll('"../components/FindBar"','"../app-controls"').replaceAll('"../components/settings-nav"','"../app-controls"').replaceAll('"../components/CommandPalette"','"../app-controls"').replaceAll('"../components/panes"','"../pane-registry"');
fs.writeFileSync(root+'state/workbench.ts',model);
fs.writeFileSync(root+'App.tsx',`import { WorkbenchView } from "./panes/WorkbenchView";\nimport { useWorkbenchModel } from "./state/workbench";\n\nexport function App() {\n  const model = useWorkbenchModel();\n  if (model.protocolMismatch !== null) {\n    return (\n      <div className="app">\n        <div className="fatal">\n          <h1>Cairn</h1>\n          <div className="fatal-note">{model.protocolMismatch}</div>\n        </div>\n      </div>\n    );\n  }\n  return <WorkbenchView {...model} />;\n}\n`);
// Correct generated types to their original defining modules.
for(const f of ['panes/WorkbenchView.tsx','state/app-commands.ts']){
 let t=fs.readFileSync(root+f,'utf8').replace('import type { ClarifyQuestion, PlanProposal } from "../../../../../src/main/ipc-protocol";','import type { ClarifyQuestion, PlanProposal } from "../../../../../src/events";');fs.writeFileSync(root+f,t);
}
const nav=root+'state/conversation-navigation.ts';fs.writeFileSync(nav,'import type { ViewMode } from "../view-mode";\n'+fs.readFileSync(nav,'utf8'));
