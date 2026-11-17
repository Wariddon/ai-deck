// Local opt-in only. Inference, native tools, Git, transcript reads and Node tests are real.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{execFileSync,spawnSync}=require('node:child_process'),{setTimeout:delay}=require('node:timers/promises'),{app,ipcMain}=require('electron');
assert.equal(process.env.AI_DECK_QA_LIVE,'1');delete process.env.NODE_TEST_CONTEXT;app.disableHardwareAcceleration();
const root=process.env.AI_DECK_QA_ROOT,appDir=process.env.AI_DECK_QA_APP,provider=process.env.AI_DECK_QA_PROVIDER,phase=process.env.AI_DECK_QA_PHASE;
assert.ok(['codex','claude'].includes(provider));
const peer=provider==='codex'?'claude':'codex',profile=process.env.AI_DECK_PROFILE_DIRECTORY=path.join(root,'profile'),repo=path.join(root,'project');
for(const folder of [root,profile,repo])fs.mkdirSync(folder,{recursive:true});
const settings={codex:{model:'gpt-6.1-sol',effort:'low',speed:'standard'},claude:{model:'sonnet',effort:'low',speed:'standard'}};
const git=(cwd,args)=>execFileSync('git',['-c','core.hooksPath=NUL','-c','user.name=QA','-c','user.email=qa@example.invalid',...args],{cwd,windowsHide:true,encoding:'utf8'}).trim();
const mode=provider==='codex'?'session-team':'claude-build-review';
const marker=phase==='first'?'AIDECK_LIVE_'+randomUUID().slice(0,8):JSON.parse(fs.readFileSync(path.join(root,'identity.json'))).marker;
const initial='Isolated AI Deck end-to-end QA. Remember the exact marker '+marker+'. Only edit service.js; leave tests, instructions, HEAD and staging unchanged. This deliberately exercises review-driven repair: on the FIRST builder pass only, implement normalize(value) as value.trim() and run node --test, reporting its actual expected failure for null. Do not fix null until the reviewer sends a repair. Reviewer: inspect the real diff/source and recorded failing check, flag missing null handling as a MAJOR finding in service.js:1. During REPAIR, implement the full contract: trim strings, return empty text for null and other non-strings, and run node --test again. On RECHECK, verify the fixed source and current observed tests. Run each node --test as its own exact foreground tool command, with edits and inspection in separate tool calls. Never combine the test with another command, pipeline, redirection, grep or tail. No installs, network, extra agents, Git commits or pushes.';
const follow='Continue our same QA task. Preserve normalize behavior and add a single source comment // QA continuation verified to service.js, then run node --test as its own exact foreground tool call without pipes, redirection or command chains. Do not repeat the deliberate first-pass defect. Reviewer verifies the current source and observed tests. Only service.js may change. Do not commit or push.';
const draft=prompt=>({mode,prompt,messageIntent:'edit',...(mode!=='session-team'&&{reviewPolicy:'thorough'}),teamOptions:{turnLimit:prompt===initial?4:2}});
const report=phase==='post'?{...JSON.parse(fs.readFileSync(path.join(root,'first.json'))),phase,error:undefined,passed:false}:{provider,phase,calls:[],checks:[],events:[],passed:false};
const save=()=>fs.writeFileSync(path.join(root,phase+'.json'),JSON.stringify(report,null,2));
process.on('uncaughtException',error=>{report.error=error.stack;save();app.exit(1)});
process.on('unhandledRejection',error=>{report.error=String(error?.stack??error);save();app.exit(1)});
if(phase==='first'){
 git(repo,['init','-q','-b','main']);
 fs.writeFileSync(path.join(repo,'service.js'),'module.exports = value => value;\n');
 fs.writeFileSync(path.join(repo,'service.test.cjs'),"const test=require('node:test'),assert=require('node:assert/strict'),normalize=require('./service.js');test('trim and null contract',()=>{assert.equal(normalize(' a '),'a');assert.equal(normalize(null),'');assert.equal(normalize(42),'')});\n");
 fs.writeFileSync(path.join(repo,'AGENTS.md'),'This is a disposable offline QA checkout. Edit only service.js, preserving CommonJS exports. No dependency install, network, other agents, Git commits or pushes. Run node --test for verification as a separate exact foreground tool command, without output filters, redirects or command chains. The initial task deliberately leaves null handling for reviewer-driven repair; subsequent repairs and follow-ups implement the full contract. Reviewers use read-only source tools and actual recorded checks.\n');
 git(repo,['add','.']);git(repo,['commit','-qm','isolated live QA baseline']);
 const task=require(path.join(appDir,'tasks.cjs')).newTask();task.title='AI Deck live full cycle · '+provider;task.agentModels=structuredClone(settings);task.permissionMode='full';task.sessionTeamPermissionMode='full';task.savedDraft=draft(initial);
 if(mode==='session-team')task.sessionTeam={useByDefault:true,members:[{id:'member-'+randomUUID(),name:'Builder',provider,position:'write'},{id:'member-'+randomUUID(),name:'Reviewer',provider:peer,position:'review'}]};
 const original=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,'AI Deck/workspace-state.json')));
 fs.writeFileSync(path.join(profile,'workspace-state.json'),JSON.stringify({executables:original.executables,currentRepo:repo,closeToTray:false,lowMemory:false,preferences:{notifications:'off'},workspaces:{[repo]:{repo,tasks:[task],currentTask:task.id,notes:[],plugins:[],instructions:'',shareNewFiles:true,claudeCommands:true}}}));
 fs.writeFileSync(path.join(root,'identity.json'),JSON.stringify({taskId:task.id,base:git(repo,['rev-parse','HEAD']),marker}));
}
const identity=JSON.parse(fs.readFileSync(path.join(root,'identity.json')));
const engines=require(path.join(appDir,'engines.cjs')),RealCodex=engines.CodexEngine,realClaude=engines.runClaude;
function observation(agent,id,cwd,prompt,options,emit){
 const row={provider:agent,id,cwd,model:options.model,effort:options.effort,speed:options.speed,readOnly:options.readOnly,role:options.role,started:Date.now(),dispatched:0,promptTail:prompt.slice(-900)};
 assert.equal(options.model,settings[agent].model);assert.equal(options.effort,settings[agent].effort);assert.equal(options.speed,'standard');
 report.calls.push(row);save();
 return{row,emit(event){
  if(event.type==='provider-call')row.dispatched++;
  if(event.type==='command-result')report.checks.push({provider:agent,call:report.calls.indexOf(row),...event});
  if(['activity','command-start','approval','question','run-model'].includes(event.type)){report.events.push({provider:agent,type:event.type,text:(event.text??event.command??event.title??event.model??'').slice(0,800)});if(report.events.length>100)report.events.shift()}
  if(['message','answer'].includes(event.type))row.answer=(event.text??'').slice(-6000);
  save();emit(event);
 },finish(result){row.status=result?.status;row.error=result?.error;row.finished=Date.now();if(result?.sessionId)row.id=result.sessionId;save()}};
}
engines.CodexEngine=class extends RealCodex{
 async run(id,cwd,prompt,readOnly,options){const original=this.emit,o=observation('codex',id,cwd,prompt,{...options,readOnly},event=>original(event));this.emit=o.emit;try{const result=await super.run(id,cwd,prompt,readOnly,options);o.finish(result);return result}finally{this.emit=original}}
};
engines.runClaude=(exe,cwd,prompt,plugins,id,emit,options)=>{
 const o=observation('claude',id,cwd,prompt,{...options,readOnly:options.role!=='write'},emit);
 const runner=realClaude(exe,cwd,prompt,plugins,id,o.emit,{...options,onSessionId:session=>{o.row.id=session;options.onSessionId?.(session)}});
 runner.done=runner.done.then(result=>{o.finish(result);return result});return runner;
};
// Quota and release checks are outside the coding scenario; auth/catalog discovery stays native.
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(key,fn)=>handle(key,(...args)=>key==='deck:quota-summary'?null:fn(...args));
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{
 const js=code=>win.webContents.executeJavaScript(code,true),api=(key,value)=>js(`window.aiDeck[${JSON.stringify(key)}](${JSON.stringify(value)??''})`);
 const wait=async(fn,label,ms=100000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await delay(70)}report.lastState=await api('state').then(s=>({connections:Object.fromEntries(Object.entries(s.connections).map(([key,c])=>[key,{status:c.status,reason:c.reason}])),jobs:s.jobs,run:s.workspace?.runHistory.at(-1)}));throw Error('Timeout '+label)};
 const check=cwd=>{const env={...process.env};delete env.NODE_TEST_CONTEXT;const checked=spawnSync(process.env.AI_DECK_QA_NODE,['--test'],{cwd,env,windowsHide:true,encoding:'utf8',timeout:10000});assert.equal(checked.status,0,checked.stdout+'\n'+checked.stderr);assert.match(checked.stdout,/tests 1/);assert.match(checked.stdout,/pass 1/);return{exit:checked.status,output:checked.stdout.slice(-1500)}};
 const readSaved=()=>JSON.parse(fs.readFileSync(path.join(profile,'workspace-state.json'))).workspaces[repo].tasks.find(task=>task.id===identity.taskId);
 const settled=async()=>{const s=await api('state');return !s.jobs.length&&s.workspace?.runHistory.at(-1)?.finishedAt};
 const type=async text=>{await js(`(()=>{const e=document.querySelector('textarea[aria-label="Task message"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await delay(100)};
 try{
  await wait(()=>js(`Boolean(document.querySelector('header.thread-top'))&&!document.querySelector('.deck-startup')`),'startup',40000);
  if(phase==='first'||phase==='post'){
   const payload={repo,taskId:identity.taskId,...draft(initial)};
   if(phase==='first'){
    await api('run',payload);await assert.rejects(api('run',payload),/already|running|Queue|finish|job/i);
    await wait(settled,'first build/review/repair/recheck');
   }else{assert.equal((await api('state')).jobs.length,0);assert.equal(report.calls.length,4,'Resume only the completed initial QA cycle without replay')}
   const state=await api('state'),run=state.workspace.runHistory.at(-1),saved=readSaved();
   report.initialRun=run;assert.equal(report.calls.length,4,'Exactly one builder, review, repair and recheck');
   assert.ok(report.calls.every(call=>call.status==='completed'&&call.dispatched===1));
   const writers=report.calls.filter(call=>call.provider===provider&&!call.readOnly);assert.equal(writers.length,2);assert.equal(writers[0].id,writers[1].id);
   if(mode==='session-team'){assert.equal(run.teamReview.cycles[0]?.status,'reviewed');assert.equal(run.teamReview.needsReview,false)}
   else{assert.equal(run.collaboration.verdict,'pass')}
   report.independentCheck=check(saved.worktree);assert.deepEqual(git(saved.worktree,['diff','--name-only']).split(/\r?\n/),['service.js']);assert.equal(git(saved.worktree,['diff','--cached','--name-only']),'');assert.equal(git(saved.worktree,['rev-parse','HEAD']),identity.base);
   identity.nativeId=writers[0].id;identity.worktree=saved.worktree;fs.writeFileSync(path.join(root,'identity.json'),JSON.stringify(identity));
   const beforeAsk=report.calls.length;await api('run',{repo,taskId:identity.taskId,mode,askAgent:peer,prompt:'What function did our team just fix, and which edge case required repair? Answer briefly from the current chat context. Do not use tools.'});await wait(settled,'Ask '+peer);
   assert.equal(report.calls.length,beforeAsk+1);assert.equal(report.calls.at(-1).provider,peer);assert.match(report.calls.at(-1).answer??'',/null|non.string|normalize/i);assert.equal(readSaved().worktree,identity.worktree);
   await type('KEEP_TEAM_DRAFT_'+provider);await js(`window.aiDeck.autosaveDraft({repo:${JSON.stringify(repo)},taskId:${JSON.stringify(identity.taskId)},draft:${JSON.stringify(draft('KEEP_TEAM_DRAFT_'+provider))}})`);
   await api('pull-native-recents');let preview=await api('native-session-preview',{provider,id:identity.nativeId});assert.equal(preview.chat.available,true);
   await api('provider-models',{agent:provider});await api('save-native-chat-models',{provider,id:identity.nativeId,options:settings[provider],revision:preview.chat.revision,modelStamp:preview.chat.modelStamp});preview=await api('native-session-preview',{provider,id:identity.nativeId});
   const nativeDraft=JSON.stringify([[JSON.stringify([provider,'',identity.nativeId]),'KEEP_NATIVE_DRAFT_'+provider,randomUUID()]]);await js(`window.aiDeck.nativeTextCheckpoint({value:${JSON.stringify(nativeDraft)}})`);
   const count=report.calls.length,requestId=randomUUID(),draftToken=randomUUID(),nativePayload={provider,id:identity.nativeId,permissionMode:preview.chat.permissionMode,revision:preview.chat.revision,requestId,draftToken,prompt:'What exact retained QA marker did the initial coding task give? Reply only with that marker. Do not use tools.'};
   const reply=await api('native-chat-send',nativePayload);assert.equal(report.calls.length,count+1);assert.equal(report.calls.at(-1).id,identity.nativeId);assert.ok(reply.messages.some(message=>message.role==='assistant'&&message.text.includes(marker)));
   await assert.rejects(api('native-chat-send',nativePayload),/already|previously|twice|Refresh/i);assert.equal(report.calls.length,count+1);
   report.nativeContinuation=true;
   const beforeFork=report.calls.length;const fork=await api('native-handoff-draft',{provider,id:identity.nativeId,quick:true,recipient:'team'});assert.equal(fork.workspace.nativeHandoff.source.id,identity.nativeId);assert.notEqual(fork.workspace.taskId,identity.taskId);assert.equal(report.calls.length,beforeFork);report.forkDraftOnly=true;
   await api('switch-task',{repo,id:identity.taskId});
   assert.match(readSaved().recoveryDraft?.draft.prompt??readSaved().savedDraft?.prompt??'',/KEEP_TEAM_DRAFT/);
   report.nativeId=identity.nativeId;report.passed=true;
  }else{
   assert.equal(report.calls.length,0);const state=await api('state');assert.equal(state.jobs.length,0);assert.deepEqual(state.workspace.agentModels,settings);
   assert.match(readSaved().recoveryDraft?.draft.prompt??readSaved().savedDraft?.prompt??'',/KEEP_TEAM_DRAFT/);
   const nativeDraft=await js('window.aiDeck.nativeTextCheckpoint({read:true})');assert.match(nativeDraft.value,/KEEP_NATIVE_DRAFT/);
   await api('pull-native-recents');const preview=await api('native-session-preview',{provider,id:identity.nativeId});assert.equal(preview.chat.modelSettings.model,settings[provider].model);
   await api('run',{repo,taskId:identity.taskId,...draft(follow)});await wait(settled,'continued team after restart');
   assert.equal(report.calls.length,2);assert.ok(report.calls.every(call=>call.status==='completed'&&call.dispatched===1));assert.equal(report.calls.find(call=>call.provider===provider&&!call.readOnly).id,identity.nativeId);
   const saved=readSaved();assert.equal(saved.worktree,identity.worktree);assert.match(fs.readFileSync(path.join(saved.worktree,'service.js'),'utf8'),/QA continuation verified/);report.independentCheck=check(saved.worktree);report.zeroReplayOnOpen=true;report.sameWriterAfterAskRecentsRestart=true;report.passed=true;
  }
 }catch(error){report.error=error.stack}finally{save();app.quit()}
}));
const main=path.join(appDir,'main.cjs'),boot=new Module(main,module);boot.filename=main;boot.paths=Module._nodeModulePaths(appDir);boot._compile(fs.readFileSync(main,'utf8').replace('width: 1240, height: 800','show: false, width: 1240, height: 800').replace('preload: path.join(__dirname, "preload.cjs"), contextIsolation','offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation').replace('read: createUpdateReader({ capture,','read: async () => [], unusedReader: createUpdateReader({ capture,'),main);
