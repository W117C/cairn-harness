import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
const appPath=path.resolve('apps/desktop/src/renderer/App.tsx');

function extract({start,end,name,file,component=false}) {
 const configPath=ts.findConfigFile('apps/desktop',ts.sys.fileExists,'tsconfig.json');
 const config=ts.readConfigFile(configPath,ts.sys.readFile);
 const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,path.dirname(configPath));
 const program=ts.createProgram(parsed.fileNames,parsed.options);
 const checker=program.getTypeChecker(); const source=program.getSourceFile(appPath);
 const text=source.text; const app=source.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='App');
 const from=text.indexOf(start,app.body.pos);const to=end===null?app.body.end-1:text.indexOf(end,from+start.length);
 if(from<0||to<0)throw new Error('range '+name);
 const selected=app.body.statements.filter(s=>s.getStart(source)>=from&&s.end<=to);
 const local=new Map(), deps=new Map(), usedOutside=new Set();
 function walk(n,f){f(n);ts.forEachChild(n,c=>walk(c,f));}
 walk(source,n=>{
  if(!ts.isIdentifier(n))return; const sym=ts.isShorthandPropertyAssignment(n.parent)?checker.getShorthandAssignmentValueSymbol(n.parent):checker.getSymbolAtLocation(n);if(!sym || !(sym.flags & ts.SymbolFlags.Variable))return;
  const declarations=sym.declarations??[];
  if(declarations.some(d=>d.getStart(source)>=from&&d.end<=to)){
   if(n.getStart(source)<from||n.end>to)usedOutside.add(sym);
   if(declarations.some(d=>ts.isVariableDeclaration(d)&&d.parent?.parent?.parent===app.body))local.set(sym,n.text);
   return;
  }
  if(n.getStart(source)<from||n.end>to)return;
  if(declarations.some(d=>d.getSourceFile()===source&&d.getStart(source)>app.body.pos&&d.end<app.body.end))deps.set(sym,n.text);
 });
 const returns=[...local].filter(([s])=>usedOutside.has(s)).map(([,n])=>n);
 const entries=[...deps].map(([s,n])=>[n,checker.typeToString(checker.getTypeOfSymbolAtLocation(s,s.valueDeclaration??s.declarations[0]),undefined,ts.TypeFormatFlags.NoTruncation|ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope)]);
 // Bindings declared via destructuring need explicit collection (nested BindingElements).
 const declared=[];for(const st of selected)if(ts.isVariableStatement(st))for(const d of st.declarationList.declarations)walk(d.name,n=>{if(ts.isIdentifier(n)){const s=checker.getSymbolAtLocation(n);if(usedOutside.has(s)&&!returns.includes(n.text))returns.push(n.text);}});
 const imports=source.statements.filter(ts.isImportDeclaration).map(s=>s.getText(source).replace(/(from\s*["'])(\.\.?\/[^"']+)(["'])/g,(_,a,spec,b)=>{
  let rel=path.relative(path.dirname(path.resolve(file)),path.resolve(path.dirname(appPath),spec)).replaceAll('\\','/');if(!rel.startsWith('.'))rel='./'+rel;return a+rel+b;
 })).join('\n');
 const extras=source.statements.filter(s=>ts.isInterfaceDeclaration(s) || (ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>d.name.getText(source)==='NULL_QUICK_INPUT' || (component&&['PaneDock','CommandPalette','SettingsPanel','Stream'].includes(d.name.getText(source)))))).map(s=>s.getText(source).replace(/(import\(["'])(\.\/[^"']+)(["'])/g,(_,a,spec,b)=>a+'../'+spec.slice(2)+b)).join('\n');
 const depNames=entries.map(([n])=>n);const props=entries.map(([n,t])=>`  ${n}: ${t};`).join('\n');
 const body=text.slice(from,to);
 const result=component?'':`\n  return { ${returns.join(', ')} };\n`;
 const generated=`import type { Dispatch, SetStateAction, MutableRefObject, RefObject } from 'react';\n// ${name}: extracted without changing event or callback behavior.\n${imports}\n${extras}\n\ninterface ${name}Deps {\n${props}\n}\n\nexport function ${name}(deps: ${name}Deps) {\n  const { ${depNames.join(', ')} } = deps;\n${body}${result}}\n`;
 fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,generated);
 const invocation=component?`return <${name} ${depNames.map(n=>`${n}={${n}}`).join(' ')} />;\n`:`  ${returns.length?`const { ${returns.join(', ')} } = `:''}${name}({ ${depNames.join(', ')} });\n\n  `;
 let rel=path.relative(path.dirname(appPath),path.resolve(file)).replaceAll('\\','/').replace(/\.tsx?$/,'');if(!rel.startsWith('.'))rel='./'+rel;
 fs.writeFileSync(appPath,`import { ${name} } from "${rel}";\n`+text.slice(0,from)+invocation+text.slice(to));
 console.log(name, 'lines',generated.split('\n').length,'deps',depNames.length,'returns',returns.length);
}
extract({start:'  // Ctrl+O 循环视图三档',end:'  // 切会话 ⇒',name:'useConversationNavigation',file:'apps/desktop/src/renderer/state/conversation-navigation.ts'});
extract({start:'  const lastError =',end:'  const usage =',name:'useRunReadings',file:'apps/desktop/src/renderer/state/run-readings.ts'});
