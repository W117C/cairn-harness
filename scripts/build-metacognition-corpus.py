"""Curate actual Cairn regressions using existing immutable tests and reversible commits.
No model is called. Runtime source snapshots live outside the repository.
"""
import argparse, difflib, hashlib, json, os, shutil, subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
CASES=[
 ('C1-malformed-tool','f6ed0552',['src/agent/loop.ts','src/agent/stuck.ts'],'tests/tool-result-malformed.test.ts',['tests/loop.test.ts'],'插件工具返回缺少 output、null 或对象时，任务会崩溃或产生误导性的 undefined 文本。请恢复健壮的工具结果处理，同时保留原有循环行为。'),
 ('C2-truncated-turn','476f8ddd',['src/agent/loop.ts'],'tests/loop-truncation-repair.test.ts',['tests/turn-truncated.test.ts'],'模型输出被预算截断后，执行循环有时把半段回复当成完成，任务无法续跑。请修复终止判断，保留取消与正常完成语义。'),
 ('C3-steering-stagnation','12de22b8',['src/agent/loop.ts'],'tests/steering-injection.test.ts',['tests/loop-no-progress.test.ts'],'用户轮中补充目标后，旧的验证失败仍被当成同一件事累计，导致停滞提示错误。请修复用户插话到停滞判据的接线，并保留正常停滞检测。'),
 ('C4-provider-overload','3413632a',['src/providers/anthropic.ts','src/providers/gemini.ts'],'tests/provider-instream-retry.test.ts',['tests/provider-stream-lifecycle.test.ts'],'部分 provider 的流在尚未产出内容时收到过载错误，任务立即失败。请统一处理可重试流错误，且已输出内容后不能重放或重复执行。'),
 ('C5-lsp-language','e9b9624c',['src/agent/plugins/index.ts','src/tools/lsp.ts'],'tests/lsp-language-id.test.ts',['tests/plugin-lsp-activation.test.ts'],'非 JavaScript 语言服务器不能正确激活和处理文档，入口提供的语言身份丢失。请修复 LSP 接口契约与调用，保留插件边界。'),
 ('C6-mutation-order','e1e17986',['src/main/session-repository.ts'],'tests/session-mutation-order.test.ts',['tests/session-reference-repository.test.ts'],'同一会话的并发修改有时按路径解析完成顺序执行，违反提交顺序。请保证先提交的修改先进入临界区，同时保留错误释放和不同会话的隔离。'),
]
WRAPPER=r'''import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const selected=process.argv.slice(2); const targets=selected.length?selected:__VISIBLE__;
mkdirSync('.tmp',{recursive:true}); const report='.tmp/judge-'+randomUUID()+'.json';
const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',...targets,'--config','tests/vitest.config.ts','--maxWorkers=2','--reporter=json','--outputFile='+report],{encoding:'utf8',maxBuffer:16*1024*1024,timeout:90000,env:{...process.env,pnpm_config_verify_deps_before_run:'false'}});
let data;try{data=JSON.parse(readFileSync(report,'utf8'));rmSync(report)}catch{console.error('Judge did not produce complete JSON');process.exit(2)}
const rows=data.testResults.flatMap(s=>(s.assertionResults??[]).map(a=>({name:(a.fullName??[...(a.ancestorTitles??[]),a.title].join(' ')).replaceAll('\n',' '),status:a.status,failures:a.failureMessages??[]})));
if(!rows.length||data.numTotalTests!==rows.length){console.error('Judge has missing assertions');process.exit(2)}
console.log('TAP version 13');let passed=0,failed=0;
rows.forEach((a,i)=>{const ok=a.status==='passed';passed+=Number(ok);failed+=Number(!ok);console.log(`${ok?'ok':'not ok'} ${i+1} - ${a.name}`);if(!ok)console.log(a.failures.join(' ').slice(0,450).split('\n').map(line=>'# '+line).join('\n'))});
console.log(`1..${rows.length}\n# tests ${rows.length}\n# pass ${passed}\n# fail ${failed}\n# cancelled 0\n# skipped 0\n# todo 0`);
if(r.status!==0||failed)process.exit(1);
'''
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def run(work,targets):
 report=work/'.tmp/curation-report.json';report.parent.mkdir(exist_ok=True)
 r=subprocess.run(['node','node_modules/vitest/vitest.mjs','run',*targets,'--config','tests/vitest.config.ts','--maxWorkers=2','--reporter=json','--outputFile='+str(report)],cwd=work,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=90,env={**os.environ,'pnpm_config_verify_deps_before_run':'false'})
 try:o=json.loads(report.read_text());report.unlink()
 except ValueError:raise RuntimeError('No complete Vitest JSON: '+r.stderr[-300:])
 rows=[{'name':a.get('fullName') or ' '.join([*a.get('ancestorTitles',[]),a['title']]),'status':a['status']} for s in o['testResults'] for a in s.get('assertionResults',[])]
 if not rows or len(rows)!=o['numTotalTests']:raise RuntimeError('Missing assertions')
 return {'exitCode':r.returncode,'rows':rows,'passed':sum(a['status']=='passed' for a in rows),'failed':sum(a['status']!='passed' for a in rows)}
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--out',required=True);args=parser.parse_args();out=Path(args.out).resolve()
 if out.exists():raise SystemExit('Output already exists; preserve the frozen corpus and choose a new directory')
 if out==ROOT or ROOT in out.parents:raise SystemExit('Runtime source snapshots must remain outside the repository')
 out.mkdir(parents=True);tasks=[];ledger=[]
 for task,rev,paths,visible,hidden,instruction in CASES:
  case=out/task;seed=case/'seed';case.mkdir();record={'id':task,'sourceCommit':rev,'sourcePaths':paths,'visible':visible,'hidden':hidden}
  try:
   if not (ROOT/visible).is_file() or any(not (ROOT/f).is_file() for f in hidden):raise RuntimeError('Referenced test file is absent')
   patch=git('diff','--unified=0',rev+'^',rev,'--',*paths)
   if not patch:raise RuntimeError('Source patch is empty')
   for tree in ['src','tests','scripts','fixtures','packages']:
    if (ROOT/tree).exists():shutil.copytree(ROOT/tree,seed/tree,symlinks=True)
   for path in seed.rglob('*metacognition*'):
    if path.is_file():path.unlink()
   for name in ['scripts/native-reasoning-probe.ts']:
    candidate=seed/name
    if candidate.exists():candidate.unlink()
   for path in (seed/'tests').rglob('*.test.ts'):
    if path.relative_to(seed).as_posix()!=visible:path.unlink()
   (seed/'node_modules').symlink_to((ROOT/'node_modules').resolve(),target_is_directory=True)
   (seed/'package.json').write_text(json.dumps({'name':'cairn-regression-'+task.lower(),'private':True,'type':'module','scripts':{'test':'node tests/run-visible.mjs'}})+'\n')
   (seed/'tests/run-visible.mjs').write_text(WRAPPER.replace('__VISIBLE__',json.dumps([visible])))
   (seed/'README.md').write_text('# 历史回归任务\n\n'+instruction+'\n\n仅修改 src/，保留 tests/、package.json 和验收逻辑。\n执行 node tests/run-visible.mjs 复现并检查。隐藏回归会在任务结束后独立运行。\n')
   (case/'historical.patch').write_bytes(patch)
   subprocess.run(['git','apply','--unidiff-zero','--reverse','--check',str(case/'historical.patch')],cwd=seed,check=True,capture_output=True)
   subprocess.run(['git','apply','--unidiff-zero','--reverse',str(case/'historical.patch')],cwd=seed,check=True,capture_output=True)
   red=run(seed,[visible]);record['seed']=red
   if red['failed']==0:raise RuntimeError('Reverted source has no failing assertion')
   repair=''.join(''.join(difflib.unified_diff((seed/name).read_text().splitlines(keepends=True),(ROOT/name).read_text().splitlines(keepends=True),fromfile='a/'+name,tofile='b/'+name)) for name in paths)
   (case/'reference.patch').write_text(repair)
   reference=case/'reference';shutil.copytree(seed,reference,symlinks=True)
   subprocess.run(['git','apply',str(case/'reference.patch')],cwd=reference,check=True,capture_output=True)
   for name in hidden:
    destination=reference/name;destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/name,destination)
   assert all((reference/name).read_bytes()==(ROOT/name).read_bytes() for name in paths),'Reference did not restore current baseline bytes'
   green=run(reference,[visible,*hidden]);record['reference']=green
   if green['failed'] or green['exitCode']!=0:raise RuntimeError('Reference repair is not green')
   green_names={a['name'] for a in green['rows'] if a['status']=='passed'}
   fail=[a['name'] for a in red['rows'] if a['status']!='passed' and a['name'] in green_names]
   passed=[a['name'] for a in red['rows'] if a['status']=='passed' and a['name'] in green_names]
   if not fail:raise RuntimeError('No independent fail-to-pass assertion')
   held=[]
   for name in hidden:
    saved=case/'heldout'/name;saved.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/name,saved);held.append({'src':str(saved),'dest':name})
   protected={str(p.relative_to(seed)):digest(p) for p in (seed/'tests').rglob('*') if p.is_file()}
   protected['package.json']=digest(seed/'package.json')
   record.update(status='ready',historicalPatchSha256=hashlib.sha256(patch).hexdigest(),referencePatchSha256=hashlib.sha256(repair.encode()).hexdigest(),protectedHashes=protected)
   tasks.append({'id':task,'source':'Cairn@'+rev,'instruction':instruction+' 先运行 node tests/run-visible.mjs 复现；只修改 src/，不要修改 tests/、package.json 或判卷逻辑。修复后调用 verify。','seed':{'kind':'dir','path':str(seed)},'verifier':{'command':'node tests/run-visible.mjs'},'judge':{'failToPass':fail,'passToPass':passed},'heldOut':{'files':held,'command':'node tests/run-visible.mjs '+' '.join(hidden)},'expects':['verifyOk','judgeUntouched','onlySrcChanged','heldOutPass']})
   # The reference implementation is an oracle, not a model-visible source snapshot.
   shutil.rmtree(reference)
  except Exception as error:
   record.update(status='excluded-before-model-trials',reason=str(error)[:400])
   if isinstance(error,subprocess.CalledProcessError):record['reason']=error.stderr.decode(errors='replace')[:400] if isinstance(error.stderr,bytes) else str(error.stderr)[:400]
  ledger.append(record);(out/'corpus-ledger.json').write_text(json.dumps(ledger,ensure_ascii=False,indent=2)+'\n');(out/'tasks.json').write_text(json.dumps(tasks,ensure_ascii=False,indent=2)+'\n')
  print(json.dumps({'id':task,'status':record['status'],'seedFailures':record.get('seed',{}).get('failed'),'referenceFailures':record.get('reference',{}).get('failed'),'reason':record.get('reason')},ensure_ascii=False),flush=True)
 if len(tasks)<3:raise SystemExit('Insufficient independently validated tasks; no model experiment should run')
 print(json.dumps({'ready':len(tasks),'manifest':str(out/'tasks.json'),'selection':'Commit applicability and independent red/green checks only; no model outcome used.'}),flush=True)
if __name__=='__main__':main()
