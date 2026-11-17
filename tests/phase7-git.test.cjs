const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {copyOnBase,transferPreview}=require('../desktop/worktree-update.cjs');
const {splitFilePatch,undoGuards,verifyUndoGuards}=require('../desktop/linked-transfer.cjs');
const exec=promisify(execFile),git=async(cwd,args)=>(await exec('git',['-c','core.hooksPath=NUL','-c','core.autocrlf=false','-c','user.name=QA','-c','user.email=qa@example.invalid','-c','commit.gpgSign=false',...args],{cwd,windowsHide:true,maxBuffer:20*1024*1024})).stdout;
async function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck-phase7-git-'));t.after(()=>{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true})});
 const repo=path.join(root,'repo'),source=path.join(root,'source'),destination=path.join(root,'candidate');fs.mkdirSync(repo);
 await git(repo,['init','-q','-b','main']);for(const [file,text] of Object.entries({'a.txt':'before\nbase\nafter\n','other.txt':'unrelated\n','.gitignore':'.env\n'}))fs.writeFileSync(path.join(repo,file),text);
 await git(repo,['add','.']);await git(repo,['commit','-qm','base']);const base=(await git(repo,['rev-parse','HEAD'])).trim();await git(repo,['worktree','add','--detach',source,base]);await git(repo,['worktree','add','--detach',destination,base]);
 return{root,repo,source,destination,base,temp:root};}

test('comparison fingerprints change for staging-only edits even when working bytes remain identical',async t=>{
 const input=await fixture(t);fs.writeFileSync(path.join(input.source,'a.txt'),'before\nchanged\nafter\n');
 const before=await transferPreview(git,{...input,includeDiff:false,includeIndex:true});await git(input.source,['add','a.txt']);
 const after=await transferPreview(git,{...input,includeDiff:false,includeIndex:true});assert.notEqual(before.stamp,after.stamp);
 await git(input.source,['checkout','-qb','same-head-new-branch']);const renamed=await transferPreview(git,{...input,includeDiff:false,includeIndex:true});assert.notEqual(after.stamp,renamed.stamp);
});

test('a source index change during replay invalidates the candidate without resetting source staging',async t=>{
 const input=await fixture(t);fs.writeFileSync(path.join(input.source,'a.txt'),'before\nchanged\nafter\n');let changed=false;
 const race=async(cwd,args,options)=>{const value=await git(cwd,args,options);if(cwd===input.destination&&args.includes('apply')&&!changed){changed=true;await git(input.source,['add','a.txt'])}return value};
 await assert.rejects(copyOnBase(race,input),/source changed|source identity|staging/iu);assert.equal(changed,true);assert.match(await git(input.source,['diff','--cached']),/changed/);
});

test('a source branch change during replay cannot reuse an otherwise identical working patch',async t=>{
 const input=await fixture(t);fs.writeFileSync(path.join(input.source,'a.txt'),'source edit\n');let changed=false;
 const race=async(cwd,args,options)=>{const result=await git(cwd,args,options);if(cwd===input.destination&&args.includes('apply')&&!changed){changed=true;await git(input.source,['checkout','-qb','new-branch-same-head'])}return result};
 await assert.rejects(copyOnBase(race,input),/source changed/iu);assert.equal((await git(input.source,['branch','--show-current'])).trim(),'new-branch-same-head');assert.equal(fs.readFileSync(path.join(input.source,'a.txt'),'utf8'),'source edit\n');
});

test('replay rejects a foreign repository with the same commit and a source equal to its destination',async t=>{
 const input=await fixture(t),foreign=path.join(input.root,'foreign');await git(input.repo,['clone','-q','--shared',input.repo,foreign]);fs.writeFileSync(path.join(foreign,'a.txt'),'foreign edit\n');
 await assert.rejects(copyOnBase(git,{...input,source:foreign}),/same Git repository|different Git repository/iu);
 await assert.rejects(copyOnBase(git,{...input,destination:input.source}),/different.*checkout|same.*checkout/iu);
});

test('a verified project alias still replays, while an alias of the source cannot become its destination',async t=>{
 const input=await fixture(t),alias=path.join(input.root,'source-alias');fs.symlinkSync(input.source,alias,process.platform==='win32'?'junction':'dir');fs.writeFileSync(path.join(input.source,'a.txt'),'aliased project edit\n');
 await copyOnBase(git,{...input,source:alias});assert.equal(fs.readFileSync(path.join(input.destination,'a.txt'),'utf8'),'aliased project edit\n');
 await assert.rejects(copyOnBase(git,{...input,destination:alias}),/different.*checkout/iu);
});

test('scoped undo refuses a relocated copy of the postimage after the original applied lines were edited',async t=>{
 const input=await fixture(t),file=path.join(input.source,'a.txt');fs.writeFileSync(file,'before\napplied\nafter\n');
 const patch=splitFilePatch('a.txt',await git(input.source,['diff','--no-ext-diff','--no-textconv','--no-renames','HEAD','--','a.txt'])),guards=undoGuards(input.source,[patch]);
 fs.writeFileSync(file,'before\nnew user edit\nafter\nseparate block\nbefore\napplied\nafter\n');
 assert.throws(()=>verifyUndoGuards(input.source,[patch],guards),/applied lines or file changed/);
});

test('rename plus edit and deletion replay preserves partial staging, untracked and ignored source files',async t=>{
 const input=await fixture(t);await git(input.source,['mv','a.txt','renamed.txt']);fs.appendFileSync(path.join(input.source,'renamed.txt'),'working edit\n');await git(input.source,['rm','other.txt']);
 fs.writeFileSync(path.join(input.source,'new.txt'),'new file\n');fs.writeFileSync(path.join(input.source,'.env'),'PRIVATE_FIXTURE=preserve\n');
 const index=await git(input.source,['diff','--cached','--binary']);await copyOnBase(git,input);
 assert.equal(fs.existsSync(path.join(input.destination,'a.txt')),false);assert.equal(fs.existsSync(path.join(input.destination,'other.txt')),false);
 assert.match(fs.readFileSync(path.join(input.destination,'renamed.txt'),'utf8'),/working edit/);assert.equal(fs.readFileSync(path.join(input.destination,'new.txt'),'utf8'),'new file\n');
 assert.equal(await git(input.source,['diff','--cached','--binary']),index);assert.equal(fs.readFileSync(path.join(input.source,'.env'),'utf8'),'PRIVATE_FIXTURE=preserve\n');assert.equal(fs.existsSync(path.join(input.destination,'.env')),false);assert.equal(await git(input.destination,['diff','--cached']), '');
});

test('rename/edit and rename/delete conflicts stop on an updated base and keep the source rename intact',async t=>{
 for(const deleted of [false,true]){const input=await fixture(t);await git(input.source,['mv','a.txt','renamed.txt']);fs.appendFileSync(path.join(input.source,'renamed.txt'),'source tail\n');
  if(deleted)await git(input.repo,['rm','a.txt']);else{fs.writeFileSync(path.join(input.repo,'a.txt'),'upstream changed\n');await git(input.repo,['add','a.txt'])}await git(input.repo,['commit','-qm','upstream']);
  await git(input.destination,['reset','--hard','HEAD']);await git(input.destination,['checkout','--detach',(await git(input.repo,['rev-parse','HEAD'])).trim()]);
  const index=await git(input.source,['diff','--cached','--binary']);await assert.rejects(copyOnBase(git,input),/could not be replayed/);assert.equal(await git(input.source,['diff','--cached','--binary']),index);assert.match(fs.readFileSync(path.join(input.source,'renamed.txt'),'utf8'),/source tail/);
 }
});

test('same-line conflicts preserve original working copies',async t=>{
 const input=await fixture(t);fs.writeFileSync(path.join(input.source,'a.txt'),'source line\n');fs.writeFileSync(path.join(input.repo,'a.txt'),'upstream line\n');await git(input.repo,['add','a.txt']);await git(input.repo,['commit','-qm','collision']);await git(input.destination,['checkout','--detach',(await git(input.repo,['rev-parse','HEAD'])).trim()]);
 await assert.rejects(copyOnBase(git,input),/could not be replayed/);assert.equal(fs.readFileSync(path.join(input.source,'a.txt'),'utf8'),'source line\n');
});

test('file/directory collisions stop replay without removing either source path',async t=>{
 const input=await fixture(t);fs.mkdirSync(path.join(input.source,'folder'));fs.writeFileSync(path.join(input.source,'folder','new.txt'),'source new file\n');
 fs.writeFileSync(path.join(input.repo,'folder'),'upstream file\n');await git(input.repo,['add','folder']);await git(input.repo,['commit','-qm','file directory collision']);await git(input.destination,['checkout','--detach',(await git(input.repo,['rev-parse','HEAD'])).trim()]);
 await assert.rejects(copyOnBase(git,input),/linked folder|already exists|ENOTDIR/);assert.equal(fs.readFileSync(path.join(input.source,'folder','new.txt'),'utf8'),'source new file\n');assert.equal(fs.readFileSync(path.join(input.repo,'folder'),'utf8'),'upstream file\n');
});

test('binary changes replay exactly and an existing source Git operation prevents any destination write',async t=>{
 const input=await fixture(t),binary=path.join(input.repo,'image.bin');fs.writeFileSync(binary,Buffer.from([0,1,2,3]));await git(input.repo,['add','image.bin']);await git(input.repo,['commit','-qm','binary base']);const base=(await git(input.repo,['rev-parse','HEAD'])).trim();
 for(const folder of [input.source,input.destination])await git(folder,['checkout','--detach',base]);const expected=Buffer.from([0,9,8,7,6]);fs.writeFileSync(path.join(input.source,'image.bin'),expected);
 await copyOnBase(git,{...input,base});assert.deepEqual(fs.readFileSync(path.join(input.destination,'image.bin')),expected);
 fs.writeFileSync(binary,Buffer.from([0,44,55]));await git(input.repo,['add','image.bin']);await git(input.repo,['commit','-qm','binary conflict']);const conflict=path.join(input.root,'binary-conflict');await git(input.repo,['worktree','add','--detach',conflict,'HEAD']);
 await assert.rejects(copyOnBase(git,{...input,base,destination:conflict}),/could not be replayed/);assert.deepEqual(fs.readFileSync(path.join(input.source,'image.bin')),expected);
 const gitDir=(await git(input.source,['rev-parse','--absolute-git-dir'])).trim();fs.writeFileSync(path.join(gitDir,'MERGE_HEAD'),base+'\n');const before=await git(input.destination,['diff','--binary']);
 await assert.rejects(copyOnBase(git,{...input,base}),/existing Git operation/);assert.equal(await git(input.destination,['diff','--binary']),before);
});

test('undo of added and deleted text files preserves unrelated staging and rejects a replaced deletion',async t=>{
 const input=await fixture(t);await git(input.source,['rm','a.txt']);const deletedText=await git(input.source,['diff','--no-renames','HEAD','--','a.txt']),deleted=splitFilePatch('a.txt',deletedText),guards=undoGuards(input.source,[deleted]);
 fs.writeFileSync(path.join(input.source,'a.txt'),'new unrelated replacement\n');assert.throws(()=>verifyUndoGuards(input.source,[deleted],guards),/applied lines or file changed/);fs.unlinkSync(path.join(input.source,'a.txt'));
 const undo=path.join(input.root,'undo-delete.patch');fs.writeFileSync(undo,deletedText);await git(input.source,['apply','--reverse','--',undo]);assert.equal(fs.readFileSync(path.join(input.source,'a.txt'),'utf8'),'before\nbase\nafter\n');
 fs.writeFileSync(path.join(input.source,'added.txt'),'applied addition\n');const addedText=await git(input.source,['diff','--no-index','--','/dev/null','added.txt']).catch(error=>error.stdout),added=splitFilePatch('added.txt',addedText),addedGuards=undoGuards(input.source,[added]);
 fs.writeFileSync(path.join(input.source,'other.txt'),'staged unrelated\n');await git(input.source,['add','other.txt']);const index=await git(input.source,['diff','--cached','--binary']);verifyUndoGuards(input.source,[added],addedGuards);fs.writeFileSync(undo,addedText);await git(input.source,['apply','--reverse','--',undo]);
 assert.equal(fs.existsSync(path.join(input.source,'added.txt')),false);assert.equal(await git(input.source,['diff','--cached','--binary']),index);
});

test('scoped undo keeps a later unrelated edit and actually reverses only the selected applied patch',async t=>{
 const input=await fixture(t),file=path.join(input.source,'a.txt');fs.writeFileSync(file,'before\napplied\nafter\n');
 const text=await git(input.source,['diff','HEAD','--','a.txt']),patch=splitFilePatch('a.txt',text),guards=JSON.parse(JSON.stringify(undoGuards(input.source,[patch])));fs.appendFileSync(file,'unrelated later edit\n');
 verifyUndoGuards(input.source,[patch],guards);const selection=path.join(input.root,'undo.patch');fs.writeFileSync(selection,text);await git(input.source,['apply','--reverse','--',selection]);
 assert.equal(fs.readFileSync(file,'utf8'),'before\nbase\nafter\nunrelated later edit\n');assert.equal(await git(input.source,['diff','--cached']),'');
});
