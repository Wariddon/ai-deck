// The test parent terminates this actual Electron process tree at a durable marker.
// Providers are controlled fixtures; the renderer, IPC, native readers and journal are real.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{setTimeout:delay}=require('node:timers/promises'),{app,ipcMain}=require('electron');
app.disableHardwareAcceleration();
const root=process.env.AI_DECK_QA_ROOT,appDir=process.env.AI_DECK_QA_APP,phase=process.env.AI_DECK_QA_PHASE,provider=process.env.AI_DECK_QA_PROVIDER,scenario=process.env.AI_DECK_QA_SCENARIO;
const profile=process.env.AI_DECK_PROFILE_DIRECTORY=path.join(root,'profile'),cwd=path.join(root,'folder'),restore=phase==='restore';
process.env.CODEX_HOME=path.join(root,'codex');const claudeRoot=process.env.CLAUDE_CONFIG_DIR=path.join(root,'claude'),claudeFolder=path.join(claudeRoot,'projects','fixture');
for(const dir of [profile,cwd,claudeFolder])fs.mkdirSync(dir,{recursive:true});
const stateFile=path.join(profile,'workspace-state.json'),idsFile=path.join(root,'ids.json'),turnsFile=path.join(root,'turns.json');
const ids=restore?JSON.parse(fs.readFileSync(idsFile)):{codex:randomUUID(),claude:randomUUID(),request:randomUUID(),draft:randomUUID()};
const prompt='Crash recovery '+provider+' '+scenario,claudeFile=path.join(claudeFolder,ids.claude+'.jsonl');
const append=(role,text)=>fs.appendFileSync(claudeFile,JSON.stringify({uuid:randomUUID(),sessionId:ids.claude,type:role,cwd,timestamp:new Date().toISOString(),message:{content:[{type:'text',text}]}})+'\n');
let turns=restore?JSON.parse(fs.readFileSync(turnsFile)): [{id:randomUUID(),status:'completed',items:[{id:randomUUID(),type:'userMessage',content:[{type:'text',text:'Original'}]},{id:randomUUID(),type:'agentMessage',text:'Original answer'}]}];
if(!restore){
 fs.writeFileSync(idsFile,JSON.stringify(ids));fs.writeFileSync(turnsFile,JSON.stringify(turns));append('user','Claude recovery');append('assistant','Original answer');
 const executables={};for(const p of ['codex','claude']){executables[p]=path.join(root,p+'.exe');fs.writeFileSync(executables[p],'fixture')}
 const {newTask}=require(path.join(appDir,'tasks.cjs'));const task=newTask();
 fs.writeFileSync(stateFile,JSON.stringify({executables,currentRepo:cwd,closeToTray:false,lowMemory:scenario==='waiting',preferences:{notifications:'off'},workspaces:{[cwd]:{repo:cwd,chatOnly:true,tasks:[task],currentTask:task.id,notes:[],plugins:[],instructions:''}}}));
}
const report={provider,scenario,phase,calls:[]};const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2));
const mark=()=>write('kill-ready.json',{pid:process.pid,provider,scenario,calls:report.calls});
process.on('uncaughtException',e=>{report.error=e.stack;write(phase+'.json',report);app.exit(1)});
const engines=require(path.join(appDir,'engines.cjs'));
engines.capture=async(exe,args)=>({code:0,stderr:'',stdout:args[0]==='--version'?/claude/.test(path.basename(exe))?'2.1.319 (Claude Code)':'codex-cli 0.0.0':args[0]==='auth'?JSON.stringify({loggedIn:true}):'Logged in using ChatGPT'});
engines.inspectClaude=async()=>({models:[]});
function runner(p,id,text,emit){
 report.calls.push({provider:p,id,prompt:text});write('calls.json',report.calls);
 if(restore)throw Error('Restart dispatched a provider turn');
 if(scenario==='waiting')return new Promise(()=>{}); // Other provider occupies Low RAM slot.
 if(scenario!=='unknown'){
  if(p==='codex'){turns.unshift({id:randomUUID(),status:'interrupted',items:[{id:randomUUID(),type:'userMessage',content:[{type:'text',text}]}]});fs.writeFileSync(turnsFile,JSON.stringify(turns))}
  else append('user',text);
 }
 if(scenario==='partial')emit({type:'delta',key:'partial',text:'A real partial checkpoint.'});
 if(scenario==='approval')emit({type:'approval',key:'obsolete-control',title:'Fixture command',text:'A request that must not revive after restart'});
 if(scenario==='receipt'){
  if(p==='codex'){turns[0].status='completed';turns[0].items.push({id:randomUUID(),type:'agentMessage',text:'Completed once'});fs.writeFileSync(turnsFile,JSON.stringify(turns))}else append('assistant','Completed once');
  return Promise.resolve({status:'completed',sessionId:id});
 }
 if(scenario==='transport')return Promise.reject(Error('Fixture provider transport closed after acceptance (EPIPE)'));
 if(scenario==='newer-draft'){
  fs.writeFileSync(path.join(profile,'native-text-drafts.json'),JSON.stringify([[JSON.stringify([p,'',id]),prompt,randomUUID()]]));
 }
 void delay(scenario==='partial'?650:30).then(mark);
 return new Promise(()=>{});
}
engines.CodexEngine=class{constructor(_exe,_cwd,_plugins,emit){this.emit=emit}async initialize(){}async shutdown(){}close(){}async interrupt(){}
 async request(method,p){if(method==='thread/list')return{data:p.archived?[]:[{id:ids.codex,name:'Codex recovery',cwd,updatedAt:1}]};if(method==='thread/read')return{thread:{id:ids.codex,status:{type:'idle'},updatedAt:1}};if(method==='thread/turns/list')return{data:turns};if(method==='config/read')return{config:{}};if(method==='model/list')return{data:[]};if(method==='thread/resume')return{thread:{id:p.threadId}};throw Error(method)}
 async run(id,_cwd,text,_readOnly){return runner('codex',id,text,this.emit)}};
engines.runClaude=(_exe,_cwd,text,_plugins,id,emit)=>({done:runner('claude',id,text,emit),close(){},async stop(){}});
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(key,fn)=>handle(key,async(...args)=>{if(key==='deck:quota-summary')return null;const result=await fn(...args);if(!restore&&['receipt','transport'].includes(scenario)&&key==='deck:native-chat-send'){mark();await new Promise(()=>{})}return result});
if(!restore&&scenario==='preparing'){
 const {NativeSendJournal}=require(path.join(appDir,'native-send-journal.cjs')),update=NativeSendJournal.prototype.update;
 NativeSendJournal.prototype.update=function(...args){const out=update.apply(this,args);if(args[3].status==='preparing'){mark();Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000)}return out};
}
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{
 const js=c=>win.webContents.executeJavaScript(c,true),api=(key,p)=>js(`window.aiDeck[${JSON.stringify(key)}](${JSON.stringify(p)??''})`);
 const wait=async(fn,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await delay(60)}throw Error('Timeout '+label)};
 const open=async()=>{await js(`(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Recents')?.click()})()`);await wait(()=>js(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')===${JSON.stringify((provider==='codex'?'Codex':'Claude Code')+': '+(provider==='codex'?'Codex recovery':'Claude recovery'))});if(!e)return false;e.click();return true})()`),'Recents row');await wait(()=>js(`Boolean(document.querySelector('.deck-native-chat textarea'))&&!document.querySelector('.deck-native-chat .thread-hint')?.textContent.includes('Loading')`),'native composer')};
 try{
  await wait(()=>js(`Boolean(document.querySelector('header.thread-top'))&&!document.querySelector('.deck-startup')`),'startup');await api('pull-native-recents');
  if(!restore){
   const rows=JSON.stringify([[JSON.stringify([provider,'',ids[provider]]),prompt,ids.draft]]);
   await js(`localStorage.setItem('ai-deck-native-drafts',${JSON.stringify(rows)});window.aiDeck.nativeTextCheckpoint({value:${JSON.stringify(rows)}})`);
   await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});
   const p=await api('native-session-preview',{provider,id:ids[provider]});
   const send={provider,id:ids[provider],prompt,requestId:ids.request,draftToken:ids.draft,revision:p.chat.revision,permissionMode:'chat'};
   write('send.json',send);
   if(scenario==='waiting'){
    const other=provider==='codex'?'claude':'codex',q=await api('native-session-preview',{provider:other,id:ids[other]});
    await js(`void window.aiDeck['native-chat-send'](${JSON.stringify({provider:other,id:ids[other],prompt:'Occupy test slot',requestId:randomUUID(),revision:q.chat.revision,permissionMode:'chat'})}).catch(()=>{})`);
    await wait(()=>report.calls.length===1,'blocker started');
   }
   await js(`void window.aiDeck['native-chat-send'](${JSON.stringify(send)}).catch(e=>window.sendError=String(e))`);
   if(scenario==='waiting'){await wait(async()=> (await api('state')).jobs.some(j=>j.key==='native:'+provider+':'+ids[provider]&&j.state==='waiting'),'waiting target');mark()}
  }else{
   await delay(100);assert.equal(report.calls.length,0);
   await open();const p=await api('native-session-preview',{provider,id:ids[provider]});
   const draft=await js(`document.querySelector('.deck-native-chat textarea').value`);
   if(['waiting','preparing','unknown','newer-draft'].includes(scenario))assert.equal(draft,prompt);else assert.equal(draft,'','Confirmed original draft is cleared by its persisted identity');
   if(['waiting','preparing'].includes(scenario))assert.equal(p.chat.recovery.status,'not-sent');
   else if(scenario==='unknown'){assert.equal(p.chat.recovery.status,'unverified');assert.equal(await js(`document.querySelector('.deck-native-chat button[type=submit]').disabled`),true)}
   else assert.equal(p.delivered.status,scenario==='receipt'?'replied':'saved');
   assert.equal(p.chat.pending,undefined);assert.equal((await api('state')).jobs.length,0);
   assert.equal(await js(`document.querySelectorAll('.deck-native-chat .thread-approval button').length`),0);
   if(scenario==='partial'){
    const {NativeSendJournal}=require(path.join(appDir,'native-send-journal.cjs'));
    assert.equal(new NativeSendJournal(profile).read({provider,id:ids[provider]},cwd).records.at(-1).partialText,'A real partial checkpoint.');
    assert.equal(p.chat.recovery.partialText,'A real partial checkpoint.');
    assert.ok(await js(`document.querySelector('.deck-native-chat').innerText.includes('Saved partial reply')`));
    await js(`document.querySelector('.deck-native-work').open=true`);
    fs.writeFileSync(path.join(root,'restored-partial.png'),(await win.webContents.capturePage()).toPNG());
   }
   const before=report.calls.length,saved=JSON.parse(fs.readFileSync(path.join(root,'send.json')));
   await assert.rejects(api('native-chat-send',{...saved,revision:p.chat.revision}),/previously submitted/);
   assert.equal(report.calls.length,before);
   report.delivery=p.delivered?.status;report.recovery=p.chat.recovery?.status;report.draftPreserved=draft===prompt;report.passed=true;
   write('restore.json',report);app.quit();
  }
 }catch(e){report.error=e.stack;report.ui=await js(`document.body.innerText.slice(-2000)`).catch(()=> '');write(phase+'.json',report);app.exit(1)}
}));
const main=path.join(appDir,'main.cjs'),boot=new Module(main,module);boot.filename=main;boot.paths=Module._nodeModulePaths(appDir);boot._compile(fs.readFileSync(main,'utf8').replace('width: 1240, height: 800','show: false, width: 1240, height: 800').replace('preload: path.join(__dirname, "preload.cjs"), contextIsolation','offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation').replace('read: createUpdateReader({ capture,','read: async () => [], unusedReader: createUpdateReader({ capture,'),main);
