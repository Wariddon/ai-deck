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
function runner(provider,id,prompt,emit,options,plugins=[]){
 assert.equal(id,provider==='codex'?codexId:claudeId);active=true;
 const files=options.images??[]; prompt=require(path.join(appDir,'task-images.cjs')).attachmentInput(prompt,files);
 result.calls.push({provider,id,prompt,files:files.map(({id,kind})=>({id,kind})),model:options.model,effort:options.effort,speed:options.speed,permissionMode:options.permissionMode});
 const turn={id:randomUUID(),status:'inProgress',items:[{type:'userMessage',id:randomUUID(),content:[{type:'text',text:prompt}]}]};
 if(provider==='codex'){codexTurns.unshift(turn);updatedAt++;}else append('user',prompt);
 const done=delay(runnerDelay).then(async()=>{const screen=plugins.find(p=>p.name==='ai_deck_computer');if(screen){const r=await fetch(screen.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'screenshot',arguments:{}}})}).then(r=>r.json());assert.equal(r.result.content[0].type,'image');(result.screens??=[]).push(provider); }active=false;turn.status='completed';if(provider==='codex'){turn.items.push({type:'agentMessage',id:randomUUID(),text:'Same chat: '+prompt});fs.writeFileSync(codexFile,JSON.stringify(codexTurns));}else append('assistant','Same chat: '+prompt);return{status:'completed',sessionId:id};});
 return{done,close(){},stop:async()=>{},interrupt:async()=>{}};
}
engines.CodexEngine=class{
 constructor(_exe,_cwd,plugins,emit){this.emit=emit;this.plugins=plugins;}
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
 async run(id,_cwd,prompt,_readOnly,options){return runner('codex',id,prompt,this.emit,options,this.plugins).done;}
};
engines.runClaude=(_exe,_cwd,prompt,plugins,id,emit,options)=>{assert.equal(options.permissionMode,'chat');assert.equal(options.role,options.computer?'review':'test');if(options.computer){assert.equal(options.persistSession,true);assert.equal(options.nativeComputer,true);}return runner('claude',id,prompt,emit,options,plugins);};
const fixtureImage=require('electron').nativeImage.createFromBitmap(Buffer.alloc(16,255),{width:2,height:2});
require('electron').desktopCapturer.getSources=async()=>[{id:'window:123456:0',name:'QA evidence viewer',thumbnail:fixtureImage}];
require(path.join(appDir,'computer-use.cjs')).windowsUi=async()=>({identity:'7777/1234',application:'qa-viewer',controls:[]});
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(key,fn)=>handle(key,async(...args)=>{if(key==='deck:quota-summary')return null; const out=await fn(...args); if(key==='deck:native-chat-send'){returnedPreview=out.chat;if(holdDelivery)await delay(900);}return out;});
const wait=async(fn,label)=>{for(let i=0;i<500;i++){if(await fn())return;await delay(60);}throw Error('Timeout '+label);};
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{
 win.webContents.on('console-message',(_e,d)=>{if(d.level==='error')(result.console??=[]).push(d.message);});
 const js=c=>win.webContents.executeJavaScript(c,true),api=async(key,payload)=>{const value=await js('(async()=>{try{return await window.aiDeck['+JSON.stringify(key)+']('+(JSON.stringify(payload)??'')+')}catch(e){return {__error:e.message}}})()');if(value?.__error)throw Error(key+': '+value.__error);return value;};
 const click=label=>js('(()=>{const e=[...document.querySelectorAll("button")].find(e=>!e.disabled&&(e.getAttribute("aria-label")==='+JSON.stringify(label)+'||e.textContent.trim()==='+JSON.stringify(label)+'));if(!e)return false;e.click();return true;})()');
 const select=async(label,value)=>{assert.equal(await js('(()=>{const e=[...document.querySelectorAll("select")].find(e=>e.getAttribute("aria-label")==='+JSON.stringify(label)+');if(!e||e.disabled)return false;e.value='+JSON.stringify(value)+';e.dispatchEvent(new Event("change",{bubbles:true}));return true;})()'),true);await delay(60);};
 const type=text=>js('(()=>{const e=document.querySelector(".deck-native-chat textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(e,'+JSON.stringify(text)+');e.dispatchEvent(new Event("input",{bubbles:true}));})()');
 const open=async provider=>{await click('Recents');await wait(()=>click((provider==='codex'?'Codex':'Claude Code')+': '+(provider==='codex'?'Codex model QA':'Claude model QA')),'open '+provider);await wait(()=>js('/Chat only|original chat is working|Sending to/.test(document.querySelector(".deck-native-chat .thread-hint")?.textContent??"")'),'verified');};
 const picker=async provider=>{assert.equal(await click((provider==='codex'?'Codex':'Claude Code')+' model, effort and speed'),true);await wait(()=>js('!document.querySelector(".deck-native-model-panel select")?.disabled&&document.querySelector(".deck-native-model-panel select")?.options.length>2'),'catalog');};

 try{
  await wait(()=>js('Boolean(document.querySelector("header.thread-top"))&&!document.querySelector(".deck-startup")'),'startup');
  await api('pull-native-recents');
  if(restoring){
   await open('claude');
   assert.equal(await js('document.querySelector(".deck-native-chat textarea").value'),'Unsent files after restart');
   assert.ok(await js('Boolean(document.querySelector(".deck-native-chat .composer-attachments [data-attachment-id]"))'));
   const page=await api('native-session-preview',{provider:'claude',id:claudeId});assert.ok(page.messages.some(m=>m.images?.length===2));
   result.checks.push('Original transcript attachments and unsent file draft survive full app restart');result.passed=true;return;
  }
  for(const provider of ['codex','claude']){
   const native={provider,id:provider==='codex'?codexId:claudeId};
   await open(provider);
   const txt=path.join(profile,provider+'-report.txt');fs.writeFileSync(txt,'สวัสดี Local attachment '+provider);
   const png=require('electron').nativeImage.createFromBitmap(Buffer.alloc(16,255),{width:2,height:2}).toPNG();
   const img=path.join(profile,provider+'-diagram.png');fs.writeFileSync(img,png);
   require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[txt,img]});
   result.stage=provider+' store';const rows=await api('choose-task-attachments',{native,existing:[]});
   assert.equal(rows.length,2);
   const storageKey=JSON.stringify([provider,'',native.id]);
   result.stage=provider+' storage';await js('localStorage.setItem("ai-deck-native-files",JSON.stringify([['+JSON.stringify(storageKey)+','+JSON.stringify({images:rows,version:1})+']]))');
   await click('Back to workspace');await open(provider);
   await wait(()=>js('document.querySelectorAll(".deck-native-chat .composer-attachments [data-attachment-id]").length===1'),'image tile');
   assert.ok((await js('document.querySelector(".deck-native-chat .composer-attachments").innerText')).includes(provider+'-report.txt'));
   result.stage=provider+' send';await type('Read my attachment '+provider);await click('Send');
   await wait(()=>js('!document.querySelector(".deck-native-chat textarea").readOnly&&!document.querySelector(".deck-native-chat").innerText.includes("Sending to")'),'reply');
   await wait(()=>js('!document.querySelector(".deck-native-chat .composer-attachments")'),'clear verified files');
   const page=await api('native-session-preview',native);
   const sent=page.messages.find(m=>m.text==='Read my attachment '+provider);
   assert.equal(sent.images.length,2);assert.ok(sent.attachmentRequestId);
   assert.ok(!sent.text.includes('User-attached files'));
   assert.equal(result.calls.at(-1).files.length,2);
   assert.match(result.calls.at(-1).prompt,/Local attachment/);
   const state=JSON.parse(fs.readFileSync(path.join(profile,'workspace-state.json'),'utf8'));
   assert.equal(state.nativeAttachmentMessages.filter(r=>r.sessionKey===provider+':'+native.id).length,1);
   await assert.rejects(api('native-chat-send',{...native,prompt:'Read my attachment '+provider,requestId:sent.attachmentRequestId,revision:page.chat.revision,permissionMode:'chat',images:rows}),/previously sent attachment/);
   const again=await api('native-session-preview',native);assert.equal(again.messages.find(m=>m.id===sent.id).images.length,2);
   result.checks.push(provider+': same original ID, image and text payload, saved receipt, rendered file chip, cleared sent draft, duplicate request rejected');
  }
  for(const provider of ['codex','claude']){
   const native={provider,id:provider==='codex'?codexId:claudeId};
   await api('capture-windows',{native});
   const shot=await api('preview-window-capture','window:123456:0');
   const image=await api('attach-window-capture',{token:shot.token,existing:[]});assert.ok(image.id.endsWith('.png'));
   await api('capture-windows',{native});
   const preview=await api('preview-computer-window','window:123456:0');
   const share=await api('computer-arm',{token:preview.token,agent:provider,access:'browse'});
   const page=await api('native-session-preview',native);
   const wrong={provider:provider==='codex'?'claude':'codex',id:provider==='codex'?claudeId:codexId};
   await assert.rejects(api('native-chat-send',{...wrong,prompt:'wrong share',computerToken:share.token}),/Share the window again/);
   await api('native-chat-send',{...native,prompt:'Read the shared window',revision:page.chat.revision,permissionMode:'chat',requestId:randomUUID(),computerToken:share.token});
   result.checks.push(provider+': original chat capture and scoped MCP screenshot, wrong-chat grant rejected');
  }
  assert.deepEqual(result.screens,['codex','claude']);
  await open('claude');
  const draftRows=await api('choose-task-attachments',{native:{provider:'claude',id:claudeId},existing:[]});
  await js('localStorage.setItem("ai-deck-native-files",JSON.stringify([['+JSON.stringify(JSON.stringify(['claude','',claudeId]))+','+JSON.stringify({images:draftRows,version:9})+']]))');
  await click('Back to workspace');await open('claude');
  await type('Unsent files after restart');
  result.passed=true;
 }catch(error){result.passed=false;result.error=error.stack;result.ui=await js('document.body.innerText.slice(-4500)').catch(()=> '');}
 finally{save();app.quit();}
}));
let code=fs.readFileSync(main,'utf8').replace('if (!window?.isVisible() || window.isMinimized() || quitting)', 'if (quitting)').replace('window?.isVisible() && !window.isMinimized()', 'true').replace('createWindowTools({ target, enabled,', 'createWindowTools({ target, enabled, ui: windowsUi,').replace('read: createUpdateReader({ capture,','read: async () => [], unusedReader: createUpdateReader({ capture,').replace('width: 1240, height: 800','show: false, width: 1240, height: 800').replace('preload: path.join(__dirname, "preload.cjs"), contextIsolation','offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation');
const boot=new Module(main,module);boot.filename=main;boot.paths=Module._nodeModulePaths(appDir);boot._compile(code,main);
