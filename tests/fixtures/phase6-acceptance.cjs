// Production app IPC; real Git, loopback HTTP, build checks and renderer captures.
// Provider transports are controlled fixtures and never authenticate or infer.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),http=require('node:http');
const {randomUUID}=require('node:crypto'),{execFileSync,execFile}=require('node:child_process'),{promisify}=require('node:util'),{setTimeout:delay}=require('node:timers/promises'),{app,ipcMain}=require('electron');
app.disableHardwareAcceleration();delete process.env.NODE_TEST_CONTEXT;
const root=process.env.AI_DECK_QA_ROOT,appDir=process.env.AI_DECK_QA_APP,repo=path.join(root,'project'),profile=process.env.AI_DECK_PROFILE_DIRECTORY=path.join(root,'profile');
process.env.CODEX_HOME=path.join(root,'codex');process.env.CLAUDE_CONFIG_DIR=path.join(root,'claude');
for(const folder of [profile,repo,process.env.CODEX_HOME,process.env.CLAUDE_CONFIG_DIR])fs.mkdirSync(folder,{recursive:true});
const git=args=>execFileSync('git',['-c','core.hooksPath=NUL','-c','user.name=QA','-c','user.email=qa@example.invalid',...args],{cwd:repo,windowsHide:true,encoding:'utf8'}).trim();
git(['init','-q','-b','main']);
const files={'.gitignore':'qa-*\n','service.cjs':'module.exports=false;\n',
 'verify-api.cjs':"(async()=>{const target=process.argv[2],response=await fetch(target),body=await response.json();require('node:fs').writeFileSync('qa-api.json',JSON.stringify({target,environment:process.env.QA_RESULT_ENV,status:response.status,ready:body.ready}));if(response.status!==200||!body.ready)process.exitCode=1})().catch(e=>{console.error(e);process.exitCode=1});",
 'verify-build.cjs':"const fs=require('node:fs');fs.writeFileSync('qa-build.cjs',fs.readFileSync('service.cjs'));fs.writeFileSync('qa-build.json',JSON.stringify({built:require('./qa-build.cjs')===true,environment:'local'}));if(process.env.QA_FAIL_BUILD==='1')process.exitCode=7;",
 'verify-screen.cjs':"const fs=require('node:fs'),input=JSON.parse(fs.readFileSync('qa-screen-input.json'));if(!fs.readFileSync('qa-screen.png').subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))process.exitCode=2;if(process.env.QA_MISSING_SCREEN!=='1')fs.writeFileSync('qa-screen.json',JSON.stringify(input));"};
for(const [name,text] of Object.entries(files))fs.writeFileSync(path.join(repo,name),text);git(['add','.']);git(['commit','-qm','fixture']);
const cases=[{writer:'codex'},{writer:'claude'},{writer:'codex',stale:true},{writer:'claude',missing:true},{writer:'codex',wrongEnvironment:true},{writer:'claude',failed:true}];
const {newTask}=require(path.join(appDir,'tasks.cjs'));
const tasks=cases.map((entry,index)=>{const task=newTask(),other=entry.writer==='codex'?'claude':'codex';Object.assign(entry,{id:task.id,index,title:'Acceptance case '+index});task.title=entry.title;
 task.sessionTeam={members:[{id:'member-'+randomUUID(),name:'Planner',provider:other,position:'plan'},{id:'member-'+randomUUID(),name:'Builder',provider:entry.writer,position:'write'},{id:'member-'+randomUUID(),name:'Reviewer',provider:other,position:'review'}]};return task});
const executables={};for(const provider of ['codex','claude']){executables[provider]=path.join(root,provider+'.exe');fs.writeFileSync(executables[provider],'fixture')}
fs.writeFileSync(path.join(profile,'workspace-state.json'),JSON.stringify({executables,currentRepo:repo,closeToTray:false,lowMemory:false,preferences:{notifications:'off'},workspaces:{[repo]:{repo,tasks,currentTask:tasks[0].id,notes:[],plugins:[],instructions:'',shareNewFiles:true}}}));
const report={calls:[],cases:[]},save=()=>fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2));let current,window,release,url;
const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','application/json');const source=fs.readFileSync(path.join(current.worktree,'service.cjs'),'utf8');res.end(JSON.stringify({ready:source.includes('=true')}))});
const wait=async(fn,label)=>{const end=Date.now()+18000;while(Date.now()<end){if(await fn())return;await delay(30)}throw Error('Timeout '+label)};
function contract(){return{readyWhen:['Local API matches the selected target','Local build exports the expected value','The selected chat and composer are rendered'],evidenceRefs:[
 {condition:'Local API matches the selected target',paths:['qa-api.json'],checks:['node verify-api.cjs '+url],assertions:[{path:'qa-api.json',pointer:'/target',operator:'equals',value:url},{path:'qa-api.json',pointer:'/environment',operator:'equals',value:'local'},{path:'qa-api.json',pointer:'/status',operator:'equals',value:200},{path:'qa-api.json',pointer:'/ready',operator:'equals',value:true}]},
 {condition:'Local build exports the expected value',paths:['qa-build.json'],checks:['node verify-build.cjs'],assertions:[{path:'qa-build.json',pointer:'/built',operator:'equals',value:true}]},
 {condition:'The selected chat and composer are rendered',paths:['qa-screen.json','qa-screen.png'],checks:['node verify-screen.cjs'],assertions:[{path:'qa-screen.json',pointer:'/heading',operator:'equals',value:current.title},{path:'qa-screen.json',pointer:'/composer',operator:'equals',value:true},{path:'qa-screen.json',pointer:'/environment',operator:'equals',value:'local'}]}]}}
const engines=require(path.join(appDir,'engines.cjs')),capture=engines.capture;
engines.capture=(exe,args,options)=>/^git(?:\.exe)?$/i.test(path.basename(exe))?capture(exe,args,options):Promise.resolve({code:0,stderr:'',stdout:args[0]==='--version'?/claude/.test(exe)?'2.1.319 (Claude Code)':'codex-cli 0.0.0':args[0]==='auth'?JSON.stringify({loggedIn:true}):'Logged in using ChatGPT'});
engines.inspectClaude=async()=>({models:[]});
async function turn(provider,id,cwd,prompt,role,emit){
 const planner=prompt.includes('You are Planner,');report.calls.push({case:current.index,provider,id,role,planner});emit({type:'provider-call'});let text;
 if(planner)text='AI_DECK_PLAN: READY\n'+JSON.stringify({summary:'Build locally, verify the loopback API and record the selected renderer.',...contract()});
 else if(role==='write'){
  current.worktree=cwd;fs.writeFileSync(path.join(cwd,'service.cjs'),'module.exports=true;\n');
  for(const [script,args] of [['verify-api.cjs',[url]],['verify-build.cjs',[]],['verify-screen.cjs',[]]]){
   if(script==='verify-screen.cjs'){
    const observed=await window.webContents.executeJavaScript(`({heading:document.querySelector('header.thread-taskbar h1')?.textContent,composer:Boolean(document.querySelector('textarea[aria-label="Task message"]')),environment:'local'})`);
    fs.writeFileSync(path.join(cwd,'qa-screen-input.json'),JSON.stringify(observed));fs.writeFileSync(path.join(cwd,'qa-screen.png'),(await window.webContents.capturePage()).toPNG());
   }
   const result=await promisify(execFile)(process.env.AI_DECK_QA_NODE,[script,...args],{cwd,windowsHide:true,env:{...process.env,QA_RESULT_ENV:current.wrongEnvironment?'staging':'local',QA_FAIL_BUILD:current.failed?'1':'0',QA_MISSING_SCREEN:current.missing?'1':'0'}}).then(value=>({...value,code:0}),error=>({stdout:error.stdout??'',stderr:error.stderr??'',code:error.code}));
   const key=randomUUID();emit({type:'command-result',key,command:'node '+script+(args.length?' '+args.join(' '):''),exitCode:result.code,status:'completed',output:result.stdout+result.stderr});
   await wait(()=>Object.values(globalThis.__phase6Storage.workspaces).flatMap(w=>w.tasks).flatMap(t=>t.runHistory??[]).flatMap(r=>r.evidence??[]).some(e=>e.id===key&&e.checkout?.stamp),'command-time artifact observation');
  }
  if(current.stale){const filename=path.join(cwd,'qa-api.json');fs.writeFileSync(filename,fs.readFileSync(filename,'utf8').replace('"status":200','"status":201'))}
  text='Local checks have returned; use the recorded evidence, not this summary.';
 }else text='AI_DECK_REVIEW: PASS\nThe source edit is scoped. Recorded acceptance outcomes must still control automatic handoff.';
 emit({type:'message',key:randomUUID(),text});
 if(!planner&&role!=='write'&&(current.stale||current.missing||current.wrongEnvironment||current.failed))await new Promise(resolve=>{release=resolve});
 return{status:'completed',answer:text,sessionId:id};
}
engines.CodexEngine=class{constructor(_exe,cwd,_plugins,emit){this.cwd=cwd;this.emit=emit}async initialize(){}async shutdown(){}close(){}async interrupt(){}async request(method,payload){if(method==='config/read')return{config:{}};if(method==='model/list')return{data:[{model:'gpt-fixture',displayName:'GPT'}]};if(method==='thread/start'||method==='thread/resume')return{thread:{id:payload.threadId??randomUUID()},model:'gpt-fixture'};if(method==='thread/name/set')return{};if(method==='thread/list')return{data:[]};throw Error(method)}async run(id,cwd,prompt,readOnly){return turn('codex',id,cwd,prompt,readOnly?'review':'write',this.emit)}};
engines.runClaude=(_exe,cwd,prompt,_plugins,resume,emit,options)=>({done:turn('claude',resume??randomUUID(),cwd,prompt,options.role,emit),close(){},async stop(){}});
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(key,fn)=>handle(key,(...args)=>key==='deck:quota-summary'?null:fn(...args));
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{window=win;
 const js=code=>win.webContents.executeJavaScript(code,true),api=(key,payload)=>js(`window.aiDeck[${JSON.stringify(key)}](${JSON.stringify(payload)??''})`);
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url='http://127.0.0.1:'+server.address().port+'/health';
  await wait(()=>js(`Boolean(document.querySelector('header.thread-top'))&&!document.querySelector('.deck-startup')`),'startup');
  if(!await js(`Boolean(document.querySelector('.thread-task-row'))`))await js(`document.querySelector('button[aria-label="Toggle projects"]').click()`);
  for(current of cases){
   await wait(()=>js(`Array.from(document.querySelectorAll('.thread-task-row')).some(row=>row.textContent.trim()===${JSON.stringify(current.title)})`),'task row');
   await js(`Array.from(document.querySelectorAll('.thread-task-row')).find(row=>row.textContent.trim()===${JSON.stringify(current.title)}).click()`);
   await wait(()=>js(`document.querySelector('header.thread-taskbar h1')?.textContent===${JSON.stringify(current.title)}`),'selected chat');
   const before=report.calls.length;await api('run',{repo,taskId:current.id,mode:'session-team',prompt:'Verify the local build, exact loopback API target and selected chat rendering. Preserve code and test scope.'});
   if(current.stale||current.missing||current.wrongEnvironment||current.failed){await wait(()=>Boolean(release),'review hold');await api('queue-message',{repo,taskId:current.id,mode:'session-team',prompt:'This follow-up must stay paused until its explicit evidence is ready.'});release();release=null;}
   await wait(async()=>{const s=await api('state');return !s.jobs.length&&s.workspace.runHistory.at(-1)?.finishedAt},'finished case');
   const state=await api('state'),run=state.workspace.runHistory.at(-1),evidence=Object.values(run.teamReview.evidence)[0],statuses=evidence.conditions.map(c=>c.status);
   assert.equal(report.calls.length-before,3,'one planner, one builder, one reviewer');assert.equal(run.teamReview.cycles.length,0);
   if(current.stale)assert.equal(statuses[0],'stale');else if(current.missing)assert.equal(statuses[2],'incomplete');else if(current.wrongEnvironment)assert.equal(statuses[0],'failed');else if(current.failed)assert.equal(statuses[1],'failed');else assert.deepEqual(statuses,['verified','verified','verified']);
   assert.equal(run.teamReview.needsReview,Boolean(current.stale||current.missing||current.wrongEnvironment||current.failed));
   if(run.teamReview.needsReview){assert.equal(state.workspace.queue.length,1);assert.equal(state.workspace.queuePaused,true)}
   assert.deepEqual(JSON.parse(JSON.stringify(evidence)),evidence);report.cases.push({index:current.index,writer:current.writer,calls:report.calls.length-before,statuses});save();
   if(current.index===0){await js(`document.querySelector('button[aria-label="Run history"]').click()`);await wait(()=>js(`Array.from(document.querySelectorAll('dialog[open] summary')).some(s=>s.textContent==='Handoff evidence')`),'evidence UI');
    const text=await js(`(()=>{const summary=Array.from(document.querySelectorAll('dialog[open] summary')).find(s=>s.textContent==='Handoff evidence');summary.parentElement.open=true;return summary.parentElement.innerText})()`);assert.ok(text.includes('verified')&&text.includes('runner host')&&text.includes('image hashes do not certify appearance'),text);report.evidenceUi=true;await js(`document.querySelector('dialog[open] button[aria-label="Close dialog"]').click()`);await wait(()=>js(`!document.querySelector('dialog[open]')`),'closed history')}
  }
  report.passed=true;
 }catch(error){report.error=error.stack;report.ui=await js(`({heading:document.querySelector('.thread-taskbar h1')?.textContent,rows:Array.from(document.querySelectorAll('.thread-task-row')).map(r=>r.textContent.trim()),dialog:Boolean(document.querySelector('dialog[open]'))})`).catch(()=>null)}finally{save();server.close();app.quit()}
}));
const main=path.join(appDir,'main.cjs'),boot=new Module(main,module);boot.filename=main;boot.paths=Module._nodeModulePaths(appDir);boot._compile(fs.readFileSync(main,'utf8').replace('storage = loadState();','storage = globalThis.__phase6Storage = loadState();').replace('width: 1240, height: 800','show: false, width: 1240, height: 800').replace('preload: path.join(__dirname, "preload.cjs"), contextIsolation','offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation').replace('read: createUpdateReader({ capture,','read: async () => [], unusedReader: createUpdateReader({ capture,'),main);
