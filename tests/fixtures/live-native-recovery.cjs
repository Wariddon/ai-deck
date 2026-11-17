// Opt-in only: real signed-in native providers in a disposable AI Deck profile.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{app,ipcMain}=require('electron'),{setTimeout:delay}=require('node:timers/promises');
assert.equal(process.env.AI_DECK_QA_LIVE,'1','Live native calls require explicit local opt-in');
app.disableHardwareAcceleration();
const root=process.env.AI_DECK_QA_ROOT,appDir=process.env.AI_DECK_QA_APP,provider=process.env.AI_DECK_QA_PROVIDER,phase=process.env.AI_DECK_QA_PHASE;
const profile=process.env.AI_DECK_PROFILE_DIRECTORY=path.join(root,'profile'),cwd=path.join(root,'folder');
for(const folder of [root,profile,cwd])fs.mkdirSync(folder,{recursive:true});
const original=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,'AI Deck/workspace-state.json'))),exe=original.executables[provider];
const sessionFile=path.join(root,'live-session.json'),report={provider,phase,calls:[],ownedPids:[]};
const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2));
process.on('uncaughtException',e=>{report.error=e.stack;write(phase+'.json',report);app.exit(1)});
process.on('unhandledRejection',e=>{report.error=String(e?.stack??e);write(phase+'.json',report);app.exit(1)});
const engines=require(path.join(appDir,'engines.cjs')),RealCodex=engines.CodexEngine,realClaude=engines.runClaude;
if(phase==='seed'){
 app.whenReady().then(async()=>{
  let engine,runner;
  try{
   const marker='AIDECK_'+provider.toUpperCase()+'_'+randomUUID().slice(0,8),messages=new Map();
   const emit=e=>{if(e.type==='message')messages.set(e.key,e.text);if(e.type==='delta')messages.set(e.key,(messages.get(e.key)??'')+e.text)};
   const prompt='This is an isolated AI Deck reliability test. Remember the exact retained marker '+marker+'. Reply exactly READY. Do not use tools or edit files.';
   let id,settings;
   if(provider==='codex'){
    const options={nativeExtensions:false,nativeHooks:false,textOnly:true,unattended:true};
    engine=new RealCodex(exe,cwd,[],emit,options);report.ownedPids.push(engine.child.pid);await engine.initialize();
    const config=await engine.request('config/read',{includeLayers:false}),servers=Object.keys(config.config?.mcp_servers??{});
    if(servers.length){await engine.shutdown();engine=new RealCodex(exe,cwd,[],emit,{...options,disabledServers:servers});report.ownedPids.push(engine.child.pid);await engine.initialize()}
    const catalog=await engine.request('model/list',{limit:100}),model=catalog.data.find(m=>m.model==='gpt-6.1-sol')??catalog.data.find(m=>m.isDefault&&!m.hidden)??catalog.data.find(m=>!m.hidden);
    assert.ok(model?.model);const supported=model.supportedReasoningEfforts?.map(e=>e.reasoningEffort)??[];
    settings={model:model.model,effort:supported.includes('low')?'low':model.defaultReasoningEffort??'medium',speed:'standard'};
    const thread=await engine.request('thread/start',{cwd,approvalPolicy:'never',sandbox:'read-only',model:settings.model});id=thread.thread.id;
    await engine.request('thread/name/set',{threadId:id,name:'AI Deck live recovery QA'});
    const result=await engine.run(id,cwd,prompt,true,settings);assert.equal(result.status,'completed');
   }else{
    settings={model:'sonnet',effort:'low',speed:'standard'};
    runner=realClaude(exe,cwd,prompt,[],null,emit,{...settings,role:'review',permissionMode:'chat',persistSession:true,sessionName:'AI Deck live recovery QA'});
    const result=await runner.done;assert.equal(result.status,'completed',result.error);id=result.sessionId;
   }
   assert.ok(id);assert.match([...messages.values()].join('\n'),/READY/);
   const saved={provider,id,cwd,marker,settings,requestId:randomUUID(),draftToken:randomUUID(),prompt:'AIDECK_RECOVERY_STREAM_'+randomUUID()+': Output the numbers 1 through 300, one number per line. Do not use tools. This bounded diagnostic turn will be interrupted.'};
   write('live-session.json',saved);report.calls.push({operation:'seed',id});report.passed=true;
  }catch(e){report.error=e.stack}finally{await engine?.shutdown().catch(()=>{});write('seed.json',report);app.quit()}
 });
}else{
 const session=JSON.parse(fs.readFileSync(sessionFile));let marked=false,completed=false;
 const observed=(emit)=>(event)=>{
  emit(event);
  if(phase==='crash'&&event.type==='delta'&&event.text&&!marked){marked=true;setTimeout(()=>{
   if(completed){report.error='The turn completed before the intended crash boundary';write('crash.json',report);app.exit(1);return}
   write('kill-ready.json',{pid:process.pid,provider,id:session.id,boundary:'real-first-delta',ownedPids:report.ownedPids});
  },400)}
 };
 engines.capture=async(_exe,args)=>({code:0,stderr:'',stdout:args[0]==='--version'?provider==='claude'?'2.1.319 (Claude Code)':'codex-cli 0.169.0':args[0]==='auth'?'{"loggedIn":true}':'Logged in using ChatGPT'});
 engines.inspectClaude=async()=>({models:[{value:'sonnet',supportsEffort:true,supportedEffortLevels:['low','medium','high']}]});
 engines.CodexEngine=class extends RealCodex{
  constructor(exe,cwd,plugins,emit,options){super(exe,cwd,plugins,observed(emit),options);report.ownedPids.push(this.child.pid)}
  async request(method,payload){if(method==='thread/list')return{data:provider==='codex'?[{id:session.id,name:'AI Deck live recovery QA',cwd:session.cwd,updatedAt:Date.now()}]:[]};if(method==='account/rateLimits/read')return{};return super.request(method,payload)}
  async run(id,...args){assert.equal(provider,'codex');assert.equal(id,session.id);report.calls.push({operation:phase,id});return super.run(id,...args)}
 };
 engines.runClaude=(exe,cwd,prompt,plugins,id,emit,options)=>{assert.equal(provider,'claude');assert.equal(id,session.id);report.calls.push({operation:phase,id});return realClaude(exe,cwd,prompt,plugins,id,observed(emit),options)};
 if(phase==='crash'){
  const {newTask}=require(path.join(appDir,'tasks.cjs')),task=newTask();
  write('profile/workspace-state.json',{executables:{[provider]:exe},currentRepo:cwd,closeToTray:false,preferences:{notifications:'off'},workspaces:{[cwd]:{repo:cwd,chatOnly:true,tasks:[task],currentTask:task.id,notes:[],plugins:[],instructions:''}}});
 }
 const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(key,fn)=>handle(key,(...args)=>key==='deck:quota-summary'?null:fn(...args));
 app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{
  const js=code=>win.webContents.executeJavaScript(code,true),api=(key,value)=>js(`window.aiDeck[${JSON.stringify(key)}](${JSON.stringify(value)??''})`);
  const wait=async(fn,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await delay(60)}throw Error('Timeout '+label)};
  try{
   await wait(()=>js("Boolean(document.querySelector('header.thread-top'))&&!document.querySelector('.deck-startup')"),'startup');
   await api('pull-native-recents');let preview=await api('native-session-preview',{provider,id:session.id});assert.equal(preview.chat.available,true);
   if(phase==='crash'){
    await api('provider-models',{agent:provider});
    await api('save-native-chat-models',{provider,id:session.id,options:session.settings,revision:preview.chat.revision,modelStamp:preview.chat.modelStamp});
    preview=await api('native-session-preview',{provider,id:session.id});
    const rows=JSON.stringify([[JSON.stringify([provider,'',session.id]),'Keep this unsent live QA draft',randomUUID()]]);
    await js(`window.aiDeck.nativeTextCheckpoint({value:${JSON.stringify(rows)}})`);
    void api('native-chat-send',{provider,id:session.id,prompt:session.prompt,revision:preview.chat.revision,permissionMode:preview.chat.permissionMode,requestId:session.requestId,draftToken:session.draftToken}).then(()=>{completed=true}).catch(e=>{report.error=e.stack;write('crash.json',report);app.exit(1)});
    return;
   }
   assert.equal(report.calls.length,0);assert.equal((await api('state')).jobs.length,0);
   const draft=await js('window.aiDeck.nativeTextCheckpoint({read:true})');assert.match(draft.value,/Keep this unsent live QA draft/);
   const matching=preview.messages.filter(message=>message.role==='user'&&message.text.includes(session.prompt.split(':')[0]));assert.equal(matching.length,1,'Exactly one accepted diagnostic user message');
   await assert.rejects(api('native-chat-send',{provider,id:session.id,prompt:session.prompt,revision:preview.chat.revision,permissionMode:preview.chat.permissionMode,requestId:session.requestId,draftToken:session.draftToken}),/previously submitted|twice|Refresh/i);
   assert.equal(report.calls.length,0);report.replayedCalls=0;report.recovery=preview.chat.recovery?.status??preview.delivered?.status;
   assert.equal(preview.chat.modelSettings.model,session.settings.model);
   const reply=await api('native-chat-send',{provider,id:session.id,prompt:'What exact retained QA marker did I ask you to remember in the first message? Reply only with that marker. Do not use tools.',revision:preview.chat.revision,permissionMode:preview.chat.permissionMode,requestId:randomUUID(),draftToken:randomUUID()});
   assert.ok(reply.messages.some(message=>message.role==='assistant'&&message.text.includes(session.marker)),'The original native context survives restart');
   assert.equal(report.calls.length,1);report.contextPreserved=true;report.passed=true;
  }catch(e){report.error=e.stack}finally{if(phase!=='crash'||report.error){write(phase+'.json',report);app.quit()}}
 }));
 const main=path.join(appDir,'main.cjs'),boot=new Module(main,module);boot.filename=main;boot.paths=Module._nodeModulePaths(appDir);
 boot._compile(fs.readFileSync(main,'utf8').replace('width: 1240, height: 800','show: false, width: 1240, height: 800').replace('preload: path.join(__dirname, "preload.cjs"), contextIsolation','offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation').replace('read: createUpdateReader({ capture,','read: async () => [], unusedReader: createUpdateReader({ capture,'),main);
}
