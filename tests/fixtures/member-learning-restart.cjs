const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const {app,ipcMain}=require('electron'),{setTimeout:delay}=require('node:timers/promises');
app.disableHardwareAcceleration();const root=process.env.AI_DECK_QA_ROOT,appDir=process.env.AI_DECK_QA_APP;
const profile=process.env.AI_DECK_PROFILE_DIRECTORY=path.join(root,'profile');
process.env.CODEX_HOME=path.join(root,'codex');process.env.CLAUDE_CONFIG_DIR=path.join(root,'claude');
const filename=path.join(profile,'workspace-state.json'),before=JSON.parse(fs.readFileSync(filename));
const selected=state=>Object.values(state.workspaces).map(workspace=>({learning:workspace.memberLearning,
 tasks:workspace.tasks.map(task=>({id:task.id,codexThread:task.codexThread,claudeSession:task.claudeSession,sessionTeamChats:task.sessionTeamChats,
  agentModels:task.agentModels,savedDraft:task.savedDraft,runIds:task.runHistory.map(run=>run.id)}))}));
const expected=selected(before),result={calls:0};
const engines=require(path.join(appDir,'engines.cjs'));
engines.capture=async(exe,args)=>({code:0,stderr:'',stdout:args[0]==='--version'?/claude/.test(exe)?'2.1.319 (Claude Code)':'codex-cli 0.0.0':args[0]==='auth'?'{"loggedIn":true}':'Logged in using ChatGPT'});
engines.inspectClaude=async()=>({models:[]});
engines.CodexEngine=class{async initialize(){}async shutdown(){}close(){}async request(method){if(method==='thread/list')return{data:[]};if(method==='config/read')return{config:{}};throw Error(method)}async run(){result.calls++;throw Error('Unexpected model call')}};
engines.runClaude=()=>{result.calls++;throw Error('Unexpected Claude call')};
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(key,fn)=>handle(key,(...args)=>key==='deck:quota-summary'?null:fn(...args));
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{
 try{const end=Date.now()+15000;let ready=false;while(Date.now()<end){ready=await win.webContents.executeJavaScript(`Boolean(document.querySelector('header.thread-top'))&&!document.querySelector('.deck-startup')`);if(ready)break;await delay(25)}assert.equal(ready,true);
  const state=await win.webContents.executeJavaScript(`window.aiDeck.state()`);assert.equal(state.jobs.length,0);result.ready=true;
 }catch(error){result.error=error.stack}finally{app.quit()}
}));
app.on('will-quit',()=>{try{assert.deepEqual(selected(JSON.parse(fs.readFileSync(filename))),expected);assert.equal(result.calls,0);result.passed=result.ready&&!result.error}catch(error){result.error=error.stack}fs.writeFileSync(path.join(root,'restart.json'),JSON.stringify(result,null,2))});
const main=path.join(appDir,'main.cjs'),boot=new Module(main,module);boot.filename=main;boot.paths=Module._nodeModulePaths(appDir);
boot._compile(fs.readFileSync(main,'utf8').replace('width: 1240, height: 800','show: false, width: 1240, height: 800')
 .replace('preload: path.join(__dirname, "preload.cjs"), contextIsolation','offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation')
 .replace('read: createUpdateReader({ capture,','read: async () => [], unusedReader: createUpdateReader({ capture,'),main);
