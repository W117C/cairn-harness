import { it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createStudySandbox, prepareStudyModules } from '../scripts/lib/metacognition-sandbox';
import * as studySandbox from '../scripts/lib/metacognition-sandbox';
it.skipIf(process.platform!=='darwin')('allows workspace commands and refuses external writes and oracle reads',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'study-sandbox-')),work=join(dir,'work'),oracle=join(dir,'oracle');
 try{
  await mkdir(work);await mkdir(oracle);await writeFile(join(oracle,'answer'),'hidden');
  const modules=await realpath(resolve('node_modules'));
  await prepareStudyModules(work,modules);
  const sandbox=await createStudySandbox(work,[oracle,dirname(modules)],modules);
  expect((await sandbox.exec('node node_modules/vitest/vitest.mjs --version',work)).ok).toBe(true);
  expect((await sandbox.exec('printf local > result',work)).ok).toBe(true);
  expect(await readFile(join(work,'result'),'utf8')).toBe('local');
  expect((await sandbox.exec(`cat '${join(oracle,'answer')}'`,work)).ok).toBe(false);
  expect((await sandbox.exec(`printf changed > '${join(oracle,'answer')}'`,work)).ok).toBe(false);
  expect(await readFile(join(oracle,'answer'),'utf8')).toBe('hidden');
  expect((await sandbox.exec('rm node_modules/vitest',work)).ok).toBe(false);
  expect((await sandbox.exec('mkdir -p node_modules/.vite-temp; printf local > node_modules/.vite-temp/cache',work)).ok).toBe(true);
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('detects host tool replacement and nested shadow dependencies while allowing cache writes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'study-layout-')),work=join(dir,'work');
 try{
  await mkdir(work);await prepareStudyModules(work,resolve('node_modules'));
  const before=await studySandbox.snapshotStudyDependencies(work);
  await mkdir(join(work,'node_modules/.vite-temp'));await writeFile(join(work,'node_modules/.vite-temp/cache'),'generated');
  expect(await studySandbox.snapshotStudyDependencies(work)).toBe(before);
  await mkdir(join(work,'src/node_modules'),{recursive:true});await writeFile(join(work,'src/node_modules/fake'),'shadow');
  expect(await studySandbox.snapshotStudyDependencies(work)).not.toBe(before);
  await rm(join(work,'src'),{recursive:true});expect(await studySandbox.snapshotStudyDependencies(work)).toBe(before);
  await unlink(join(work,'node_modules/vitest'));await writeFile(join(work,'node_modules/vitest'),'fake runner');
  expect(await studySandbox.snapshotStudyDependencies(work)).not.toBe(before);
 }finally{await rm(dir,{recursive:true,force:true});}
});
