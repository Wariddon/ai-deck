// Production desktop, real Git/Node tests; native model transports are controlled.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const {execFileSync,spawnSync}=require('node:child_process'),{randomUUID}=require('node:crypto'),{setTimeout:delay}=require('node:timers/promises'),{app,ipcMain}=require('electron');
app.disableHardwareAcceleration();
const root=process.env.AI_DECK_QA_ROOT,appDir=process.env.AI_DECK_QA_APP,profile=process.env.AI_DECK_PROFILE_DIRECTORY=path.join(root,'profile');
process.env.CODEX_HOME=path.join(root,'codex');process.env.CLAUDE_CONFIG_DIR=path.join(root,'claude');
for(const folder of [profile,process.env.CODEX_HOME,process.env.CLAUDE_CONFIG_DIR])fs.mkdirSync(folder,{recursive:true});
process.on('uncaughtException',error=>{fs.writeFileSync(path.join(root,'boot-error.txt'),error.stack);app.exit(1)});
const report={calls:[],cases:[],passed:false};let current,round,releaseHold,held=false;
const git=(repo,args)=>execFileSync('git',['-c','core.hooksPath=NUL','-c','core.autocrlf=false','-c','user.name=QA','-c','user.email=qa@example.invalid',...args],{cwd:repo,windowsHide:true,encoding:'utf8'}).trim();
const settings={codex:{model:'gpt-fixture',effort:'high',speed:'standard'},claude:{model:'sonnet',effort:'low',speed:'standard'}};
const selectedCases=process.env.AI_DECK_QA_MEMBER_CASES?.split(',').map(Number);
const cases=['codex','claude','codex','claude','codex','claude'].map((writer,index)=>({writer,index,team:index>=2&&index<4,disabled:index>=4,repo:path.join(root,String(index),'app'),sessions:[]}))
 .filter(entry=>!selectedCases||selectedCases.includes(entry.index)),workspaces={};
for(const entry of cases){fs.mkdirSync(entry.repo,{recursive:true});git(entry.repo,['init','-q','-b','main']);
 fs.writeFileSync(path.join(entry.repo,'source.js'),'module.exports=1;\n');
 fs.writeFileSync(path.join(entry.repo,'probe.test.cjs'),"require('node:assert/strict').equal(require('./source.js'),1);\n");
 git(entry.repo,['add','.']);git(entry.repo,['commit','-qm','fixture']);
 const task=require(path.join(appDir,'tasks.cjs')).newTask();entry.id=task.id;task.agentModels=structuredClone(settings);
 if(entry.team)task.sessionTeam={members:[{id:'member-'+randomUUID(),provider:entry.writer,position:'write',name:'Builder',model:settings[entry.writer].model},
  {id:'member-'+randomUUID(),provider:entry.writer==='codex'?'claude':'codex',position:'review',name:'Reviewer',model:settings[entry.writer==='codex'?'claude':'codex'].model}]};
 workspaces[entry.repo]={repo:entry.repo,tasks:[task],currentTask:task.id,notes:[],plugins:[],instructions:'',shareNewFiles:true};
}
const executables={};for(const provider of ['codex','claude']){executables[provider]=path.join(root,provider+'.exe');fs.writeFileSync(executables[provider],'fixture')}
fs.writeFileSync(path.join(profile,'workspace-state.json'),JSON.stringify({executables,currentRepo:cases[0].repo,closeToTray:false,lowMemory:false,preferences:{notifications:'off'},workspaces}));
const engines=require(path.join(appDir,'engines.cjs')),capture=engines.capture;
engines.capture=(exe,args,options)=>/^git(?:\.exe)?$/i.test(path.basename(exe))?capture(exe,args,options):Promise.resolve({code:0,stderr:'',stdout:args[0]==='--version'?/claude/.test(exe)?'2.1.319 (Claude Code)':'codex-cli 0.0.0':args[0]==='auth'?'{"loggedIn":true}':'Logged in using ChatGPT'});
engines.inspectClaude=async()=>({models:[{value:'sonnet',displayName:'Sonnet',supportsEffort:true,supportedEffortLevels:['low','high']}]});
async function turn(provider,id,cwd,prompt,readOnly,emit,options){
 const selected=settings[provider];assert.equal(options.model,selected.model);assert.equal(options.effort,selected.effort);assert.equal(options.speed,selected.speed);
 const coaching=prompt.includes('Member-specific verification guide');assert.equal(coaching,!current.disabled);
 report.calls.push({case:current.index,round,provider,id,readOnly,coaching});emit({type:'provider-call'});
 if(!readOnly){current.sessions.push(id);if(current.index===0&&round===1)await new Promise(resolve=>{releaseHold=resolve;held=true});fs.appendFileSync(path.join(cwd,'source.js'),'// round '+round+'\n');
  const key=randomUUID(),command='node --test probe.test.cjs';emit({type:'command-start',key,command});
  const checkEnv={...process.env,ELECTRON_RUN_AS_NODE:'1'};delete checkEnv.NODE_TEST_CONTEXT;
  const checked=spawnSync(process.execPath,['--test','probe.test.cjs'],{cwd,windowsHide:true,encoding:'utf8',env:checkEnv});
  assert.equal(checked.status,0,checked.stderr);assert.match(checked.stdout,/(?:tests 1|test[s]?: 1)/);assert.doesNotMatch(checked.stderr,/recursively/);
  emit({type:'command-result',key,command,status:'completed',exitCode:checked.status,output:checked.stdout});
 }
 const text=readOnly?current.index===0&&round===1?'AI_DECK_REVIEW: BLOCKED\nR1 BLOCKED — Keep the follow-up paused for the user to continue.':'AI_DECK_REVIEW: PASS\nR1 PASS — The scoped source is supported by the observed node test.':'Updated source with the assigned scope and ran node --test probe.test.cjs.';
 emit({type:'message',key:randomUUID(),text});return{status:'completed',answer:text,sessionId:id};
}
engines.CodexEngine=class{constructor(_exe,cwd,_plugins,emit){this.cwd=cwd;this.emit=emit}async initialize(){}async shutdown(){}close(){}async interrupt(){}
 async request(method,payload){if(method==='thread/list')return{data:[]};if(method==='config/read')return{config:{}};if(method==='model/list')return{data:[{model:'gpt-fixture',displayName:'GPT',supportedReasoningEfforts:[{reasoningEffort:'high'}]}]};if(method==='thread/start'||method==='thread/resume')return{thread:{id:payload.threadId??randomUUID()},model:'gpt-fixture'};if(method==='thread/name/set')return{};throw Error(method)}
 async run(id,cwd,prompt,readOnly,options){return turn('codex',id,cwd,prompt,readOnly,this.emit,options)}};
engines.runClaude=(_exe,cwd,prompt,_plugins,id,emit,options)=>({done:turn('claude',id??randomUUID(),cwd,prompt,options.role!=='write',emit,options),canSteer(){return false},close(){},async stop(){}});
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(key,fn)=>handle(key,(...args)=>key==='deck:quota-summary'?null:fn(...args));
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{
 const js=code=>win.webContents.executeJavaScript(code,true),api=(key,value)=>js(`window.aiDeck[${JSON.stringify(key)}](${JSON.stringify(value)??''})`),wait=async(fn,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await delay(25)}throw Error('Timeout '+label)};
 try{await wait(()=>js(`Boolean(document.querySelector('header.thread-top'))&&!document.querySelector('.deck-startup')`),'startup');
  for(current of cases){await api('switch-task',{repo:current.repo,id:current.id});
   for(round=1;round<=(current.disabled?1:2);round++){const count=report.calls.length;
    const payload={repo:current.repo,taskId:current.id,mode:current.team?'session-team':current.writer==='codex'?'build-review':'claude-build-review',messageIntent:'edit',prompt:'Edit source.js within its assigned scope. R1: Preserve the existing behavior and verify its test.',teamOptions:{turnLimit:2,...(current.index===4?{context:{history:false}}:current.index===5?{teamReviewSkill:false}:{})}};
    if(current.index===0&&round===2)await api('run-next');else await api('run',payload);
    if(current.index===0&&round===1){await wait(()=>held,'held writer');await api('queue-message',payload);const state=await api('state');assert.equal(state.workspace.queue[0].memberSnapshot.rows.length,0);releaseHold();}
    await wait(async()=>{const state=await api('state');return !state.jobs.length&&state.workspace.runHistory.at(-1)?.finishedAt},'completion');
    const state=await api('state'),run=state.workspace.runHistory.at(-1);assert.equal(report.calls.length-count,2,'No extra model call');
    const saved=JSON.parse(fs.readFileSync(path.join(profile,'workspace-state.json'))),learning=saved.workspaces[current.repo].memberLearning;
    if(current.disabled){assert.equal(learning,undefined);assert.equal(run.memberLearning,undefined)}else{
     assert.equal(learning.rows.length,1);assert.equal(learning.rows[0].skills.tests.passed,round);assert.equal(learning.rows[0].skills.tests.failed,0);
     assert.equal(run.memberLearning.observations.length,1);
     const writer=run.memberLearning.applied.find(entry=>entry.role==='write');assert.ok(writer);assert.equal(writer.stats[0]?.samples??0,current.index===0?0:round-1);
     if(current.index===0&&round===1){assert.equal(state.workspace.queue.length,1);assert.equal(state.workspace.queue[0].memberSnapshot.rows.length,0);report.queueFrozen=true}
    }
    assert.deepEqual(state.workspace.agentModels,settings);
   }
   if(!current.disabled)assert.equal(current.sessions[0],current.sessions[1],'Reuse the original builder conversation');report.cases.push({writer:current.writer,team:current.team,disabled:current.disabled,passed:true});
  }report.passed=true;
 }catch(error){report.error=error.stack}finally{fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2));app.quit()}
}));
const main=path.join(appDir,'main.cjs'),boot=new Module(main,module);boot.filename=main;boot.paths=Module._nodeModulePaths(appDir);
boot._compile(fs.readFileSync(main,'utf8').replace('width: 1240, height: 800','show: false, width: 1240, height: 800')
 .replace('preload: path.join(__dirname, "preload.cjs"), contextIsolation','offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation')
 .replace('read: createUpdateReader({ capture,','read: async () => [], unusedReader: createUpdateReader({ capture,'),main);
