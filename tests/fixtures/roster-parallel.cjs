// Production main/preload/renderer and real Git; controlled native transports.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process'),{setTimeout:delay}=require('node:timers/promises'),{app,ipcMain}=require('electron');
app.disableHardwareAcceleration();
const root=process.env.AI_DECK_QA_ROOT,appDir=process.env.AI_DECK_QA_APP,profile=process.env.AI_DECK_PROFILE_DIRECTORY=path.join(root,'profile'),repo=path.join(root,'project');
const live=process.env.AI_DECK_QA_LIVE_ROSTER==='1';
if(live)assert.equal(process.env.AI_DECK_QA_LIVE,'1','Explicit local live-account opt-in required');
else{process.env.CODEX_HOME=path.join(root,'codex');process.env.CLAUDE_CONFIG_DIR=path.join(root,'claude')}
for(const folder of [profile,repo,...(!live?[process.env.CODEX_HOME,process.env.CLAUDE_CONFIG_DIR]:[])])fs.mkdirSync(folder,{recursive:true});
const git=args=>execFileSync('git',args,{cwd:repo,windowsHide:true,encoding:'utf8'}).trim();
git(['init','-q','-b','main']);fs.writeFileSync(path.join(repo,'source.js'),'module.exports = true;\n');git(['add','.']);git(['-c','user.name=QA','-c','user.email=qa@example.invalid','commit','-qm','fixture']);
const {newTask}=require(path.join(appDir,'tasks.cjs'));
const cases=[{name:'cross-provider',second:'claude'},{name:'same-provider',second:'codex'},{name:'low-ram',second:'claude',low:true},{name:'stop-all-members',second:'claude',stop:true}];
if(live)cases.splice(0,cases.length,{name:'live-codex-claude',second:'claude'});
const tasks=cases.map(entry=>{
 const task=newTask();entry.task=task;task.title=entry.name;
 const lead={id:'member-'+randomUUID(),name:'Lead',provider:'codex',position:live?'summarize':'plan',parentId:null};
 task.sessionTeam={topology:'tree',members:[lead,{id:'member-'+randomUUID(),name:'Left',provider:'codex',position:'review',parentId:lead.id},
  {id:'member-'+randomUUID(),name:'Right',provider:entry.second,position:'review',parentId:lead.id}]};return task;
});
const executables=live?JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,'AI Deck/workspace-state.json'))).executables:{};
if(!live)for(const provider of ['codex','claude']){executables[provider]=path.join(root,provider+'.exe');fs.writeFileSync(executables[provider],'fixture')}
fs.writeFileSync(path.join(profile,'workspace-state.json'),JSON.stringify({executables,currentRepo:repo,closeToTray:false,lowMemory:false,agentSettings:live?{codex:{model:'gpt-6.1-sol',effort:'low',speed:'standard'},claude:{model:'sonnet',effort:'low',speed:'standard'}}:{},preferences:{notifications:'off'},workspaces:{[repo]:{repo,tasks,currentTask:tasks[0].id,notes:[],plugins:[],instructions:''}}}));
const report={calls:[],decisions:[],answers:[],stops:[],cases:[]};let current,active=0,maximum=0;
const save=()=>fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2));
process.on('uncaughtException',error=>{report.error=error.stack;save();app.exit(1)});
process.on('unhandledRejection',error=>{report.error=String(error?.stack??error);save();app.exit(1)});
const engines=require(path.join(appDir,'engines.cjs')),capture=engines.capture,RealCodex=engines.CodexEngine,realClaude=engines.runClaude;
engines.capture=(exe,args,options)=>/^git(?:\.exe)?$/i.test(path.basename(exe))?capture(exe,args,options):Promise.resolve({code:0,stderr:'',stdout:args[0]==='--version'?/claude/.test(exe)?'2.1.319 (Claude Code)':'codex-cli 0.0.0':args[0]==='auth'?JSON.stringify({loggedIn:true}):'Logged in using ChatGPT'});
engines.inspectClaude=async()=>({models:[{value:'sonnet',displayName:'Sonnet',supportsEffort:true,supportedEffortLevels:['low']}]});
const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve}};
async function turn(engine,id,cwd,prompt,emit){
 const name=/You are (Lead|Left|Right),/.exec(prompt)?.[1];assert.ok(name);engine.name=name;
 report.calls.push({case:current.name,name,id,cwd});emit({type:'provider-call'});
 if(name==='Lead'){emit({type:'message',key:randomUUID(),text:'Use source.js as the shared read-only evidence.'});return{status:'completed',sessionId:id}}
 assert.ok(prompt.includes('Use source.js as the shared read-only evidence.'));
 active++;maximum=Math.max(maximum,active);engine.pending=gate();
 try{
  emit({type:'approval',key:'shared-key',title:'Fixture approval '+name,subject:'Read local evidence'});
  await engine.pending.promise;
  if(engine.stopped)return{status:'interrupted',sessionId:id};
  engine.pending=gate();emit({type:'question',key:'shared-question',questions:[{id:'answer',header:'Fixture',question:'Answer for '+name,options:[]}]});
  await engine.pending.promise;
  if(engine.stopped)return{status:'interrupted',sessionId:id};
  const text='AI_DECK_REVIEW: PASS\nRead-only evidence checked by '+name;
  emit({type:'message',key:randomUUID(),text});return{status:'completed',answer:text,sessionId:id};
 }finally{active--;engine.pending=null}
}
class Controls{
 decide(key,accept){if(key!=='shared-key'||!this.pending)return false;report.decisions.push([current.name,this.name,accept]);this.pending.resolve();return true}
 answer(key,answers){if(key!=='shared-question'||!this.pending)return false;report.answers.push([current.name,this.name,answers]);this.pending.resolve();return true}
 async interrupt(){this.stopped=true;report.stops.push([current.name,this.name]);this.pending?.resolve()}
 async stop(){return this.interrupt()}
 close(){this.stopped=true;this.pending?.resolve()}
}
engines.CodexEngine=class extends Controls{
 constructor(_exe,cwd,_plugins,emit){super();this.cwd=cwd;this.emit=emit}
 async initialize(){}async shutdown(){}
 async request(method,payload){if(method==='config/read')return{config:{}};if(method==='model/list')return{data:[{model:'gpt-fixture',displayName:'GPT'}]};if(['thread/start','thread/resume'].includes(method))return{thread:{id:payload.threadId??randomUUID()},model:'gpt-fixture'};if(method==='thread/name/set')return{};if(method==='thread/list')return{data:[]};throw Error(method)}
 async run(id,cwd,prompt){return turn(this,id,cwd,prompt,this.emit)}
};
engines.runClaude=(_exe,cwd,prompt,_plugins,resume,emit,options)=>{const engine=new Controls(),id=resume??randomUUID();options.onSessionId?.(id);engine.done=turn(engine,id,cwd,prompt,emit);return engine};
if(live){
 const observe=(provider,id,prompt,emit)=>{let started=false;const row={provider,id,name:/You are (Lead|Left|Right),/.exec(prompt)?.[1]};return{emit(event){if(event.type==='provider-call'&&!started){started=true;active++;maximum=Math.max(maximum,active);row.started=Date.now();report.calls.push(row)}emit(event)},finish(){if(started){active--;row.finished=Date.now()}}}};
 engines.CodexEngine=class extends RealCodex{
  async request(method,payload){if(method==='thread/list')return{data:[]};if(method==='account/rateLimits/read')return{};return super.request(method,payload)}
  async run(id,cwd,prompt,...rest){const original=this.emit;const observer=observe('codex',id,prompt,event=>original(event));this.emit=observer.emit;try{return await super.run(id,cwd,prompt,...rest)}finally{observer.finish();this.emit=original}}
 };
 engines.runClaude=(exe,cwd,prompt,plugins,id,emit,options)=>{const observer=observe('claude',id,prompt,emit);const runner=realClaude(exe,cwd,prompt,plugins,id,observer.emit,options);runner.done=runner.done.finally(observer.finish);return runner};
}
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(key,fn)=>handle(key,(...args)=>key==='deck:quota-summary'?null:fn(...args));
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{
 const js=code=>win.webContents.executeJavaScript(code,true),api=(key,payload)=>js(`window.aiDeck[${JSON.stringify(key)}](${JSON.stringify(payload)??''})`);
 const wait=async(fn,label)=>{const end=Date.now()+(live?60000:15000);while(Date.now()<end){if(await fn())return;await delay(25)}report.dom=await js(`({controls:document.querySelectorAll('.thread-approval').length,text:document.body.innerText.slice(-4500)})`);throw Error('Timeout '+label)};
 const openTask=async(task)=>{
  if(await js(`document.querySelector('h1[title]')?.title===${JSON.stringify(task.title)}`))return;
  assert.equal(await js(`(()=>{const b=[...document.querySelectorAll('button.thread-task-row')].find(b=>b.querySelector('.thread-native-title')?.textContent===${JSON.stringify(task.title)});if(!b||b.disabled)return false;b.click();return true})()`),true);
  await wait(()=>js(`document.querySelector('h1[title]')?.title===${JSON.stringify(task.title)}`),'selected '+task.title);
 };
 try{
  await wait(()=>js(`Boolean(document.querySelector('header.thread-top'))&&!document.querySelector('.deck-startup')`),'startup');
  if(!await js(`Boolean(document.querySelector('.thread-task-row'))`))await js(`document.querySelector('button[aria-label="Toggle projects"]').click()`);
  for(current of cases){
   maximum=0;await api('save-low-memory',Boolean(current.low));await openTask(current.task);
   const begin=report.calls.length;
   await api('run',{repo,taskId:current.task.id,mode:'session-team',prompt:live?'This is an isolated AI Deck parallel test. Do not use any tools, read files, or edit anything. Lead: reply only SHARED_PARALLEL_READY. Left and Right: from the upstream report repeat its exact marker on 40 numbered lines, then finish with PARALLEL_DONE. Do not ask questions.':'Inspect the same source evidence independently. Do not edit files.'});
   const members=current.task.sessionTeam.members.slice(1);
   if(live){
    await wait(async()=>{const state=await api('state');return state.jobs.length===0&&state.workspace.runHistory.at(-1)?.finishedAt},'real native replies');
    const state=await api('state'),run=state.workspace.runHistory.at(-1);
    assert.equal(report.calls.length-begin,3);assert.equal(maximum,2);
    for(const member of members){assert.equal(run.agents[member.id].status,'completed');assert.match(JSON.stringify(run.agents[member.id]),/SHARED_PARALLEL_READY/);assert.match(JSON.stringify(run.agents[member.id]),/PARALLEL_DONE/)}
    assert.equal(run.teamReview.needsReview,false);report.cases.push({name:current.name,maximum,calls:3});save();continue;
   }else if(current.stop){
    await wait(async()=>{const s=await api('state');return s.approvals.length===2&&s.jobs[0]?.nativeSessions.length===2},'two owned turns');
    await api('stop');
   }else if(current.low){
    for(const member of members){
     await wait(async()=>(await api('state')).approvals.some(a=>a.agent===member.id&&a.type==='approval'),'serial approval');
     await api('approve',{agent:member.id,key:'shared-key',accept:true});
     await wait(async()=>(await api('state')).approvals.some(a=>a.agent===member.id&&a.type==='question'),'serial question');
     await api('answer-question',{agent:member.id,key:'shared-question',answers:{answer:[member.name]}});
    }
   }else{
    await wait(async()=>(await api('state')).approvals.filter(a=>a.type==='approval').length===2,'concurrent approvals');
    const other=tasks.find(task=>task.id!==current.task.id);
    await openTask(other);await openTask(current.task);
    await wait(()=>js(`document.querySelectorAll('.thread-approval').length===2&&document.body.innerText.includes('Fixture approval Left')&&document.body.innerText.includes('Fixture approval Right')`),'restored member controls');
    for(const member of members){assert.equal(await api('approve',{agent:member.id,key:'shared-key',accept:true}),true)}
    await wait(async()=>(await api('state')).approvals.filter(a=>a.type==='question').length===2,'concurrent questions');
    for(const member of members){assert.equal(await api('answer-question',{agent:member.id,key:'shared-question',answers:{answer:[member.name]}}),true)}
   }
   await wait(async()=>{const state=await api('state');return state.jobs.length===0&&state.workspace.runHistory.at(-1)?.finishedAt},'settled '+current.name);
   const state=await api('state'),run=state.workspace.runHistory.at(-1);
   assert.equal(report.calls.length-begin,3);assert.equal(maximum,current.low?1:2);assert.equal(state.approvals.length,0);
   if(current.stop){assert.deepEqual(report.stops.filter(row=>row[0]===current.name).map(row=>row[1]).sort(),['Left','Right']);for(const m of members)assert.equal(run.agents[m.id].status,'interrupted')}
   else{assert.equal(run.teamReview.needsReview,false);for(const m of members)assert.equal(run.agents[m.id].status,'completed');assert.deepEqual(report.answers.filter(row=>row[0]===current.name).map(row=>[row[1],row[2].answer[0]]),[['Left','Left'],['Right','Right']])}
   report.cases.push({name:current.name,maximum,calls:3,stopped:Boolean(current.stop)});save();
  }
  report.passed=true;
 }catch(error){report.error=error.stack}finally{save();app.quit()}
}));
const main=path.join(appDir,'main.cjs'),boot=new Module(main,module);boot.filename=main;boot.paths=Module._nodeModulePaths(appDir);boot._compile(fs.readFileSync(main,'utf8').replace('width: 1240, height: 800','show: false, width: 1240, height: 800').replace('preload: path.join(__dirname, "preload.cjs"), contextIsolation','offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation').replace('read: createUpdateReader({ capture,','read: async () => [], unusedReader: createUpdateReader({ capture,'),main);
