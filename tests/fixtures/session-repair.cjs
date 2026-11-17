// Actual app, Git checkouts, file edits and test commands; only providers are simulated.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{execFileSync,spawnSync}=require('node:child_process'),{setTimeout:delay}=require('node:timers/promises'),{app,ipcMain}=require('electron');
app.disableHardwareAcceleration();const root=process.env.AI_DECK_QA_ROOT,appDir=process.env.AI_DECK_QA_APP,profile=process.env.AI_DECK_PROFILE_DIRECTORY=path.join(root,'profile'),repo=path.join(root,'project');
const phase5=process.env.AI_DECK_QA_REPAIR180==='1'?require('./roster-repair-cases.cjs'):process.env.AI_DECK_QA_PHASE5==='1'?require('./phase5-cases.cjs'):null;
if(phase5)delete process.env.GEMINI_API_KEY;
process.env.CODEX_HOME=path.join(root,'codex');process.env.CLAUDE_CONFIG_DIR=path.join(root,'claude');
for(const dir of [repo,profile,process.env.CLAUDE_CONFIG_DIR])fs.mkdirSync(dir,{recursive:true});
const git=args=>execFileSync('git',args,{cwd:repo,windowsHide:true,encoding:'utf8'}).trim();git(['init','-q','-b','main']);
fs.writeFileSync(path.join(repo,'service.js'),'module.exports = value => value;\n');fs.writeFileSync(path.join(repo,'service.test.cjs'),"const assert=require('node:assert/strict'),normalize=require('./service.js');assert.equal(normalize(' a '),'a');assert.equal(normalize(null),'');\n");git(['add','.']);git(['-c','user.name=QA','-c','user.email=qa@example.test','commit','-qm','fixture']);
const condition='Null input and trimming have observed tests';
const contract={readyWhen:[condition],evidenceRefs:[{condition,paths:['service.js'],checks:['node --test']}]};
const cases=phase5?.cases??[{writer:'codex',plan:true,expected:5},{writer:'claude',plan:true,expected:5},{writer:'codex',budget:2,expected:2},{writer:'claude',escape:true,expected:3},{writer:'codex',falsePass:true,expected:2},{writer:'claude',race:true,expected:2},{writer:'codex',repeat:true,expected:6},{writer:'codex',unchanged:true,falsePass:true,expected:2},{writer:'codex',treeOther:true,expected:5}];
const {newTask}=require(path.join(appDir,'tasks.cjs'));
const tasks=cases.map((entry,index)=>{
 const task=newTask();entry.id=task.id;entry.index=index;task.title='Repair case '+index;const other=entry.writer==='codex'?'claude':'codex';
 const writer={id:'member-'+randomUUID(),name:'Builder',provider:entry.writer,position:'write'};
 const reviewer={id:'member-'+randomUUID(),name:'Reviewer',provider:other,position:'review'};
 task.sessionTeam=phase5?phase5.team(entry,writer,reviewer,other):entry.treeOther?{topology:'tree',members:[{...writer,parentId:null},{id:'member-'+randomUUID(),name:'Sidewriter',provider:other,position:'write',parentId:writer.id},{...reviewer,parentId:writer.id}]}:
  {members:[...(entry.plan?[{id:'member-'+randomUUID(),name:'Planner',provider:other,position:'plan'}]:[]),writer,reviewer]};return task;
});
const executables={};for(const p of ['codex','claude']){executables[p]=path.join(root,p+'.exe');fs.writeFileSync(executables[p],'fixture')}
fs.writeFileSync(path.join(profile,'workspace-state.json'),JSON.stringify({executables,currentRepo:repo,closeToTray:false,lowMemory:false,preferences:{notifications:'off'},workspaces:{[repo]:{repo,tasks,currentTask:tasks[0].id,notes:[],plugins:[],instructions:'',shareNewFiles:true}}}));
const report={calls:[],cases:[]};let current,releaseReview;const save=()=>fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2));process.on('uncaughtException',e=>{report.error=e.stack;save();app.exit(1)});
const engines=require(path.join(appDir,'engines.cjs')),capture=engines.capture;
engines.capture=(exe,args,options)=>/^git(?:\.exe)?$/i.test(path.basename(exe))?capture(exe,args,options):Promise.resolve({code:0,stderr:'',stdout:args[0]==='--version'?/claude/.test(exe)?'2.1.319 (Claude Code)':'codex-cli 0.0.0':args[0]==='auth'?JSON.stringify({loggedIn:true}):'Logged in using ChatGPT'});
engines.inspectClaude=async()=>({models:[{value:'sonnet',displayName:'Sonnet',supportsEffort:true,supportedEffortLevels:['low']}]});
async function turn(provider,id,cwd,prompt,role,emit){
 const repair=prompt.includes('One bounded repair of the current task.'),planner=prompt.includes('You are Planner, the Planner');
 const side=prompt.includes('You are Sidewriter,');const record={case:current.index,provider,id,role,repair,side,prompt};report.calls.push(record);emit({type:'provider-call'});let text;
 if(phase5?.turn)text=await phase5.turn({current,cwd,prompt,role,emit,record,repair,side});
 else if(planner)text=current.planBlocked?'AI_DECK_PLAN: BLOCKED\n'+JSON.stringify({summary:'A source decision is required before editing.',blockers:['Choose the contract.']}):'AI_DECK_PLAN: READY\n'+JSON.stringify({summary:'Normalize service.js and verify node tests.',...contract});
 else if(role==='write'&&side){fs.writeFileSync(path.join(cwd,'other.js'),'module.exports = 42;\n');text='Updated other.js only.';}
 else if(role==='write'){
  if(!current.unchanged)fs.writeFileSync(path.join(cwd,'service.js'),repair||current.staleAncestor?"module.exports = value => typeof value === 'string' ? value.trim() : '';\n":"module.exports = value => value.trim();\n");
  if(repair&&current.escape)fs.writeFileSync(path.join(cwd,'outside.js'),'Unexpected scope\n');
  const checkEnvironment={...process.env};delete checkEnvironment.NODE_TEST_CONTEXT;
  const result=spawnSync(process.env.AI_DECK_QA_NODE??'node',['--test'],{cwd,windowsHide:true,encoding:'utf8',env:checkEnvironment});
  record.checkOutput=((result.stdout??'')+(result.stderr??'')).slice(-1800);
  record.checkExit=result.status;assert.equal(result.error,undefined);assert.equal(result.status,repair||current.staleAncestor?0:1,'Actual fixture tests must detect the original defect');
  emit({type:'command-result',key:randomUUID(),command:'node --test',exitCode:result.status,status:'completed',output:(result.stdout||'')+(result.stderr||'')});
  text='Updated service.js; observed test exit '+result.status;
 }else{
  const good=fs.readFileSync(path.join(cwd,'service.js'),'utf8').includes('typeof');
  text=good&&!current.repeat||current.falsePass?'AI_DECK_REVIEW: PASS\nCurrent source is verified.':'AI_DECK_REVIEW: CHANGES\nFINDING MAJOR | service.js:1 | Null input must return an empty string, verified by the failing test.';
  if(current.race)fs.appendFileSync(path.join(cwd,'service.js'),'// concurrent edit\n');
  if(current.crossBranch)text='AI_DECK_REVIEW: CHANGES\nFINDING MAJOR | other.js:1 | The other branch needs a source decision.';
  if(current.longReview)text='AI_DECK_REVIEW: CHANGES\n'+'Context. '.repeat(800)+'\nFINDING MAJOR | service.js:1 | Null input fails.\nFINDING MAJOR | other.js:1 | Another owner must verify the contract.';
  if(current.longFalsePass&&!good)text='AI_DECK_REVIEW: PASS\n'+'Context. '.repeat(800)+'\nFINDING MAJOR | service.js:1 | Null input still fails despite the claimed pass.';
  // Simulate an independent editor after an ancestor review, not a model tool.
  if(current.staleAncestor&&prompt.includes('You are Observer,'))fs.appendFileSync(path.join(cwd,'service.js'),'// external editor changed the reviewed snapshot\n');
 }
 emit({type:'message',key:randomUUID(),text});if(current.budget&&!planner&&role!=='write'||current.setupRace&&role==='write')await new Promise(resolve=>{releaseReview=resolve});
 if(current.setupRace&&role==='write'){fs.mkdirSync(path.join(repo,'.claude'),{recursive:true});fs.writeFileSync(path.join(repo,'.claude','settings.json'),JSON.stringify({hooks:{PreToolUse:[{matcher:'Read',hooks:[{type:'command',command:'echo phase5-changed-contract'}]}]}}));}
 await delay(20);return{status:'completed',answer:text,sessionId:id};
}
engines.CodexEngine=class{constructor(_exe,cwd,_plugins,emit){this.cwd=cwd;this.emit=emit}async initialize(){}async shutdown(){}close(){}async interrupt(){}async request(method,payload){if(method==='config/read')return{config:{}};if(method==='model/list')return{data:[{model:'gpt-fixture',displayName:'GPT'}]};if(method==='thread/start'||method==='thread/resume')return{thread:{id:payload.threadId??randomUUID()},model:'gpt-fixture'};if(method==='thread/name/set')return{};if(method==='thread/list')return{data:[]};throw Error(method)}async run(id,cwd,prompt,readOnly){return turn('codex',id,cwd,prompt,readOnly?'review':'write',this.emit)}};
engines.runClaude=(_exe,cwd,prompt,_plugins,resume,emit,options)=>({done:turn('claude',resume??randomUUID(),cwd,prompt,options.role,emit),close(){},async stop(){}});
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(key,fn)=>handle(key,(...args)=>key==='deck:quota-summary'?null:fn(...args));
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{
 const js=c=>win.webContents.executeJavaScript(c,true),api=(key,payload)=>js(`window.aiDeck[${JSON.stringify(key)}](${JSON.stringify(payload)??''})`);
 const caseDeadline=Math.min(45000,Math.max(25000,Number(process.env.AI_DECK_QA_CASE_TIMEOUT_MS)||25000));
 const wait=async(fn,label)=>{const end=Date.now()+caseDeadline;while(Date.now()<end){if(await fn())return;await delay(50)}throw Error('Timeout '+label)};
 try{
  await wait(()=>js(`Boolean(document.querySelector('header.thread-top'))&&!document.querySelector('.deck-startup')`),'startup');
  for(current of cases){
   await api('switch-task',{repo,id:current.id});const before=report.calls.length;
   await api('run',{repo,taskId:current.id,mode:'session-team',prompt:'Normalize service.js: trim strings and return empty text for null. Observe node --test. Preserve other files.',...((current.budget||current.turnBudget)&&{teamOptions:{turnLimit:current.budget||current.turnBudget}})});
   if(current.budget||current.setupRace){await wait(()=>Boolean(releaseReview),'held member');await api('queue-message',{repo,taskId:current.id,mode:'session-team',prompt:'Queued follow-up must remain paused while this review needs changes.'});releaseReview();releaseReview=null;}
   await wait(async()=>{const s=await api('state');return !s.jobs.length&&s.workspace.runHistory.at(-1)?.finishedAt},'case '+current.index);
   const state=await api('state'),run=state.workspace.runHistory.at(-1),calls=report.calls.slice(before);assert.equal(calls.length,current.expected,'provider count case '+current.index);
   if(current.budget||current.setupRace){assert.equal(state.workspace.queue.length,1);assert.equal(state.workspace.queuePaused,true);}
   if(phase5)phase5.validate(current,state,calls);
   else if(current.plan||current.treeOther){assert.equal(run.teamReview.cycles[0].status,'reviewed');assert.equal(run.teamReview.needsReview,false);const builder=calls.filter(c=>c.role==='write'&&!c.side);assert.equal(builder[0].id,builder[1].id,'reuse writer ID');if(current.plan){const evidence=Object.values(run.teamReview.evidence)[0];assert.equal(evidence.conditions[0].status,'evidence recorded');assert.equal(evidence.conditions[0].tests[0].status,'passed');assert.ok(calls.at(-1).prompt.includes('Observed handoff evidence'));}}
   else{assert.equal(run.teamReview.needsReview,true);if(current.escape)assert.equal(run.teamReview.cycles[0].status,'scope needs review');if(current.repeat)assert.equal(run.teamReview.cycles[0].status,'needs review');if(current.budget)assert.equal(run.teamReview.cycles.length,0);if(current.race)assert.equal(run.teamReview.reviews[Object.keys(run.teamReview.reviews)[0]].current,false);}
   assert.deepEqual(JSON.parse(JSON.stringify(run.teamReview)),run.teamReview,'repair evidence survives serialization');report.cases.push({index:current.index,calls:calls.length,cycles:run.teamReview.cycles.map(c=>c.status),needsReview:run.teamReview.needsReview});save();
   if(current.setupRace)fs.unlinkSync(path.join(repo,'.claude','settings.json'));
  }
  report.passed=true;
 }catch(e){report.error=e.stack}finally{save();app.quit()}
}));
const main=path.join(appDir,'main.cjs'),boot=new Module(main,module);boot.filename=main;boot.paths=Module._nodeModulePaths(appDir);boot._compile(fs.readFileSync(main,'utf8').replace('width: 1240, height: 800','show: false, width: 1240, height: 800').replace('preload: path.join(__dirname, "preload.cjs"), contextIsolation','offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation').replace('read: createUpdateReader({ capture,','read: async () => [], unusedReader: createUpdateReader({ capture,'),main);
