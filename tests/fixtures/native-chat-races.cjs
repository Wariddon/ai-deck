// Exercise the shipped renderer and backend with isolated local provider fixtures; no authentication or model calls.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{setTimeout:delay}=require('node:timers/promises'),{app,ipcMain}=require('electron');
app.disableHardwareAcceleration();
const root=process.env.AI_DECK_QA_ROOT,appDir=process.env.AI_DECK_QA_APP,main=path.join(appDir,'main.cjs');
const restoring=process.env.AI_DECK_QA_RESTORE==='1';
const previous=restoring?JSON.parse(fs.readFileSync(path.join(root,'result.json'),'utf8')):null;
const profile=process.env.AI_DECK_PROFILE_DIRECTORY=previous?.profile??path.join(root,'profile-'+Date.now());
const cwd=path.join(profile,'folder without git'),claudeRoot=process.env.CLAUDE_CONFIG_DIR=path.join(profile,'claude'),claudeFolder=path.join(claudeRoot,'projects','fixture');
fs.mkdirSync(cwd,{recursive:true});fs.mkdirSync(claudeFolder,{recursive:true});process.env.CODEX_HOME=path.join(profile,'codex');
const codexId=previous?.ids.codex??randomUUID(),claudeId=previous?.ids.claude??randomUUID(),claudeFile=path.join(claudeFolder,claudeId+'.jsonl');
const codexFile=path.join(profile,'codex-turns.json');let codexTurns=restoring?JSON.parse(fs.readFileSync(codexFile,'utf8')):[];
let updatedAt=1000,active=false; let releaseModels; let modelGate; let metadataReads=0; let holdDelivery=false; let returnedPreview; let runnerDelay=350; let failModels=false;
const append=(type,text)=>fs.appendFileSync(claudeFile,JSON.stringify({uuid:randomUUID(),sessionId:claudeId,type,cwd,message:{content:[{type:'text',text}]},timestamp:new Date().toISOString()})+'\n');
if(!restoring){
 append('user','Claude model QA');append('assistant','Original Claude answer.');
 codexTurns.unshift({id:randomUUID(),status:'completed',items:[{type:'userMessage',id:randomUUID(),content:[{type:'text',text:'Codex model QA'}]},{type:'agentMessage',id:randomUUID(),text:'Original Codex answer.'}]});
 fs.writeFileSync(codexFile,JSON.stringify(codexTurns));
 const executables={};for(const provider of ['codex','claude']){executables[provider]=path.join(profile,'fixture-'+provider+'.exe');fs.writeFileSync(executables[provider],'fixture');}
 const {newTask}=require(path.join(appDir,'tasks.cjs'));const source=newTask();source.title='Linked fixture task';
 const session={provider:'codex',id:codexId,title:'Codex model QA',cwd};source.nativeHandoff={source:session,sources:[{session,messages:[]}]};
 fs.writeFileSync(path.join(profile,'workspace-state.json'),JSON.stringify({executables,currentRepo:cwd,workspaces:{[cwd]:{repo:cwd,tasks:[source],currentTask:source.id,notes:[],plugins:[],instructions:'',readOnly:false}},lowMemory:false,closeToTray:false,
  agentSettings:{codex:{model:'wrong-global-model',effort:'ultra'},claude:{model:'wrong-global-model',effort:'max'}},preferences:{notifications:'off',sendOnEnter:true}}));
}
const result={version:require(path.join(appDir,'package.json')).version,profile,ids:{codex:codexId,claude:claudeId},calls:[],checks:[],layouts:[],restoring};
const save=()=>fs.writeFileSync(path.join(root,restoring?'restore-result.json':'result.json'),JSON.stringify(result,null,2));
process.on('uncaughtException',error=>{result.passed=false;result.error=error.stack;save();app.exit(1);});
const engines=require(path.join(appDir,'engines.cjs'));
engines.capture=async(exe,args)=>({code:0,stdout:args[0]==='--version'?(/claude/i.test(exe)?'2.1.259 (Claude Code)':'codex-cli 0.0.0'):args[0]==='auth'?JSON.stringify({loggedIn:true,subscriptionType:'pro',authMethod:'claudeAi'}):'Logged in using ChatGPT',stderr:''});
engines.inspectClaude=async()=>{metadataReads++; if(modelGate)await modelGate; if(failModels)throw Error("Fixture metadata failure"); return ({models:[{value:'opus',displayName:'Opus fixture',supportsEffort:true,supportedEffortLevels:['low','high'],supportsFastMode:true},{value:'sonnet',displayName:'Sonnet fixture',supportsEffort:true,supportedEffortLevels:['low'],supportsFastMode:false}],fast_mode_disabled_reason:'sdk_opt_in_required'});};
function runner(provider,id,prompt,emit,options){
 assert.equal(id,provider==='codex'?codexId:claudeId);active=true;
 result.calls.push({provider,id,prompt,model:options.model,effort:options.effort,speed:options.speed,permissionMode:options.permissionMode});
 const turn={id:randomUUID(),status:'inProgress',items:[{type:'userMessage',id:randomUUID(),content:[{type:'text',text:prompt}]}]};
 if(provider==='codex'){codexTurns.unshift(turn);updatedAt++;}else append('user',prompt);
 const done=delay(runnerDelay).then(()=>{active=false;turn.status='completed';if(provider==='codex'){turn.items.push({type:'agentMessage',id:randomUUID(),text:'Same chat: '+prompt});fs.writeFileSync(codexFile,JSON.stringify(codexTurns));}else append('assistant','Same chat: '+prompt);return{status:'completed',sessionId:id};});
 return{done,close(){},stop:async()=>{},interrupt:async()=>{}};
}
engines.CodexEngine=class{
 constructor(_exe,_cwd,_plugins,emit){this.emit=emit;}
 async initialize(){}async shutdown(){}close(){}async interrupt(){}
 async request(method,payload){
  if(method==='thread/list')return{data:payload.archived?[]:[{id:codexId,name:'Codex model QA',cwd,updatedAt}]};
  if(method==='thread/read')return{thread:{id:codexId,updatedAt,status:{type:active?'active':'idle'}}};
  if(method==='thread/turns/list')return{data:codexTurns};
  if(method==='config/read')return{config:{model:'gpt-fixture-a'}};
  if(method==='model/list')return{data:[{model:'gpt-fixture-a',displayName:'GPT fixture A',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],serviceTiers:[{id:'priority'}]},
   {model:'gpt-fixture-b',displayName:'GPT fixture B',supportedReasoningEfforts:[{reasoningEffort:'low'}],serviceTiers:[]}]};
  if(method==='thread/resume'){assert.equal(payload.threadId,codexId);assert.equal(payload.sandbox,'read-only');return{thread:{id:codexId},model:payload.model};}
  throw new Error('Unexpected native operation '+method);
 }
 async run(id,_cwd,prompt,_readOnly,options){return runner('codex',id,prompt,this.emit,options).done;}
};
engines.runClaude=(_exe,_cwd,prompt,_plugins,id,emit,options)=>{assert.equal(options.permissionMode,'chat');assert.equal(options.role,'test');return runner('claude',id,prompt,emit,options);};
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(key,fn)=>handle(key,async(...args)=>{if(key==='deck:quota-summary')return null; const out=await fn(...args); if(key==='deck:native-chat-send'){returnedPreview=out.chat;if(holdDelivery)await delay(900);}return out;});
const wait=async(fn,label)=>{for(let i=0;i<500;i++){if(await fn())return;await delay(60);}throw Error('Timeout '+label);};
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{
 const js=c=>win.webContents.executeJavaScript(c,true),api=(key,payload)=>js('window.aiDeck['+JSON.stringify(key)+']('+(JSON.stringify(payload)??'')+')');
 const click=label=>js('(()=>{const e=[...document.querySelectorAll("button")].find(e=>!e.disabled&&(e.getAttribute("aria-label")==='+JSON.stringify(label)+'||e.textContent.trim()==='+JSON.stringify(label)+'));if(!e)return false;e.click();return true;})()');
 const select=async(label,value)=>{assert.equal(await js('(()=>{const e=[...document.querySelectorAll("select")].find(e=>e.getAttribute("aria-label")==='+JSON.stringify(label)+');if(!e||e.disabled)return false;e.value='+JSON.stringify(value)+';e.dispatchEvent(new Event("change",{bubbles:true}));return true;})()'),true);await delay(60);};
 const type=text=>js('(()=>{const e=document.querySelector(".deck-native-chat textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(e,'+JSON.stringify(text)+');e.dispatchEvent(new Event("input",{bubbles:true}));})()');
 const open=async provider=>{await click('Recents');await wait(()=>click((provider==='codex'?'Codex':'Claude Code')+': '+(provider==='codex'?'Codex model QA':'Claude model QA')),'open '+provider);await wait(()=>js('/Chat only|original chat is working|Sending to/.test(document.querySelector(".deck-native-chat .thread-hint")?.textContent??"")'),'verified');};
 const picker=async provider=>{assert.equal(await click((provider==='codex'?'Codex':'Claude Code')+' model, effort and speed'),true);await wait(()=>js('!document.querySelector(".deck-native-model-panel select")?.disabled&&document.querySelector(".deck-native-model-panel select")?.options.length>2'),'catalog');};
 try{
  await wait(()=>js('Boolean(document.querySelector("header.thread-top"))&&!document.querySelector(".deck-startup")'),'startup');
  await api('pull-native-recents');
  await wait(()=>click('Codex · Codex model QA'),'read-only source link');
  await wait(()=>js('document.querySelector(".deck-native-chat .thread-hint")?.textContent.includes("Read only")'),'read-only source');
  await open('codex');
  let page=await api('native-session-preview',{provider:'codex',id:codexId});
  modelGate=new Promise(resolve=>{releaseModels=resolve;});
  await js('window.modelAudit={}; void window.aiDeck["provider-models"]({agent:"claude",refresh:true}).then(r=>window.modelAudit.first=r,e=>window.modelAudit.firstError=String(e));');
  await wait(()=>metadataReads>0,'model reader started');
  const during=await api('native-session-preview',{provider:'codex',id:codexId}).then(()=>({ok:true}),e=>({error:String(e)}));
  result.metadataNavigation=during;
  await js('void window.aiDeck["provider-models"]({agent:"claude",refresh:true}).then(r=>window.modelAudit.second=r,e=>window.modelAudit.secondError=String(e));');
  await delay(100); releaseModels(); modelGate=null;
  await wait(()=>js('Boolean(window.modelAudit.first||window.modelAudit.firstError)&&Boolean(window.modelAudit.second||window.modelAudit.secondError)'),'model readers');
  result.metadataReads=metadataReads; result.catalogResults=await js('window.modelAudit');
  holdDelivery=true;
  await type('Sent before next draft'); await click('Send');
  await wait(()=>returnedPreview,'completed backend response');
  result.returnedActive=returnedPreview.active; result.returnedPending=Boolean(returnedPreview.pending);
  await wait(()=>js('!document.querySelector(".deck-native-chat textarea").readOnly'),'finished event');
  await type(''); await type('Sent before next draft');
  await delay(1200);
  result.draftAfterLateReply=await js('document.querySelector(".deck-native-chat textarea").value');
  result.expectedDraft='Sent before next draft';
  assert.equal(await js('new Map(JSON.parse(localStorage.getItem("ai-deck-native-drafts"))).get('+JSON.stringify(JSON.stringify(['codex','',codexId]))+')'),result.expectedDraft,'A newer identical draft must remain autosaved');
  result.passed=Boolean(result.metadataNavigation.ok)&&!result.catalogResults.firstError&&!result.catalogResults.secondError&&metadataReads===1&&!result.returnedActive&&!result.returnedPending&&result.draftAfterLateReply===result.expectedDraft;
  result.checks.push('Metadata reads must not block other chats; concurrent reads coalesce; a completed turn has no pending marker; late delivery preserves a newer draft');
  assert.ok(await js('Boolean(document.querySelector(".deck-native-chat textarea"))'),'Recents must remain editable after opening its read-only source');
  result.checks.push('A source link followed by Recents stays editable after the reply');
  failModels=true;
  await assert.rejects(api('provider-models',{agent:'claude',refresh:true}),/Fixture metadata failure/);
  failModels=false; await api('provider-models',{agent:'claude',refresh:true});
  assert.equal(metadataReads,3);
  await api('connections'); await api('provider-models',{agent:'claude'}); assert.equal(metadataReads,4);
  modelGate=new Promise(resolve=>{releaseModels=resolve;});
  await js('window.changedModelRead=null;void window.aiDeck["provider-models"]({agent:"claude",refresh:true}).then(()=>window.changedModelRead={ok:true},e=>window.changedModelRead={error:String(e)});');
  await wait(()=>metadataReads===5,'pending model read');
  await api('connections'); releaseModels();modelGate=null;
  await wait(()=>js('Boolean(window.changedModelRead)'),'cancelled catalog read');
  assert.match((await js('window.changedModelRead')).error,/connection changed/);
  await api('provider-models',{agent:'claude'});assert.equal(metadataReads,6);
  result.checks.push('Failed metadata can retry; reconnect invalidates cached capabilities and rejects old in-flight results');
  returnedPreview=null;runnerDelay=350;
  await type('Sent while switching chats');await click('Send');await click('Back to workspace');
  await wait(()=>returnedPreview,'completed send while away');
  await open('codex');await delay(1100);
  assert.equal(await js('document.querySelector(".deck-native-chat textarea").value'),'','Reopening a delivered send must not leave a sendable duplicate draft');
  assert.equal(result.calls.length,2);
  result.checks.push('Reopening a chat before delayed delivery clears only the verified sent draft');
  holdDelivery=false;runnerDelay=3500;
  await api('save-low-memory',true);
  const a=await api('native-session-preview',{provider:'codex',id:codexId});
  const b=await api('native-session-preview',{provider:'claude',id:claudeId});
  const firstRequest=randomUUID();
  await js('window.queueAudit={};void window.aiDeck["native-chat-send"]('+JSON.stringify({provider:'codex',id:codexId,prompt:'Held first job',requestId:firstRequest,revision:a.chat.revision,permissionMode:'chat',modelStamp:a.chat.modelStamp})+').then(r=>window.queueAudit.first=r,e=>window.queueAudit.firstError=String(e));');
  await wait(()=>result.calls.length===3,'held runner');
  await open('claude');await type('Waiting chat');await click('Send');
  await wait(async()=>{const s=await api('state');return s.jobs.some(j=>j.key==='native:claude:'+claudeId&&j.state==='waiting');},'waiting native job');
  await delay(120);
  assert.match(await js('document.querySelector(".deck-native-chat").innerText'),/Low RAM: one job at a time/,'A queued provider must show its waiting reason instead of claiming to work');
  assert.ok(await js('Boolean(document.querySelector(".thread-native-row[aria-current=page] .thread-job-waiting"))'),'The waiting Recents row must show a clock, not a working spinner');
  result.waitingReason=await js('document.querySelector(".deck-native-chat [role=status]")?.textContent');
  await assert.rejects(api('save-native-chat-permission',{provider:'claude',id:claudeId,revision:b.chat.revision,mode:'full'}),/finish before changing/);
  await assert.rejects(api('save-native-chat-models',{provider:'claude',id:claudeId,revision:b.chat.revision,modelStamp:b.chat.modelStamp,options:{}}),/finish before changing/);
  await click('Back to workspace');await open('claude');
  assert.equal(await click('Stop'),true,'A reopened waiting chat must expose its Stop control');
  await wait(async()=>!(await api('state')).jobs.some(j=>j.key==='native:claude:'+claudeId),'waiting job stopped');
  await wait(()=>js('!document.querySelector(".deck-native-chat textarea").readOnly&&!document.querySelector(".deck-native-chat").innerText.includes("Sending to")'),'waiting UI released');
  assert.equal(await js('document.querySelector(".deck-native-chat textarea").value'),'Waiting chat');
  await wait(()=>js('Boolean(window.queueAudit.first)'),'queue completion');
  assert.equal(result.calls.filter(c=>c.provider==='claude').length,0);
  assert.equal((await api('native-session-preview',{provider:'claude',id:claudeId})).chat.permissionMode,'chat');
  result.checks.push('Waiting jobs freeze model and permission choices; Stop cancels only the waiting chat without a model call');
  result.checks.push('Reopening a waiting chat restores Stop and cancellation preserves its draft');

 }catch(error){result.passed=false;result.error=error.stack;result.ui=await js('document.body.innerText.slice(-4500)').catch(()=> '');}
 finally{save();app.quit();}
}));
let code=fs.readFileSync(main,'utf8').replace('read: createUpdateReader({ capture,','read: async () => [], unusedReader: createUpdateReader({ capture,').replace('width: 1240, height: 800','show: false, width: 1240, height: 800').replace('preload: path.join(__dirname, "preload.cjs"), contextIsolation','offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation');
const boot=new Module(main,module);boot.filename=main;boot.paths=Module._nodeModulePaths(appDir);boot._compile(code,main);
