const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util'),{setTimeout:delay}=require('node:timers/promises');
for(const kind of ['native','team'])for(const provider of ['codex','claude'])test('forced process termination restores '+kind+' '+provider+' send fences, drafts and partial progress without replay',{
 timeout:180000,skip:process.platform!=='win32'
},async()=>{
 const base=process.env.AI_DECK_QA_ROOT??fs.mkdtempSync(path.join(os.tmpdir(),'deck-native-recovery-')),appDir=process.env.AI_DECK_QA_APP??path.resolve(__dirname,'../desktop');
 for(const scenario of kind==='team'?['writer','reviewer']:['waiting','preparing','accepted','approval','partial','receipt','transport','newer-draft','unknown']){
  const root=path.join(base,kind+'-'+provider+'-'+scenario);fs.mkdirSync(root,{recursive:true});
  const env={...process.env,AI_DECK_QA_ROOT:root,AI_DECK_QA_APP:appDir,AI_DECK_QA_PROVIDER:provider,AI_DECK_QA_SCENARIO:scenario};
  const script=path.join(__dirname,'fixtures/'+(kind==='team'?'team':'native')+'-recovery.cjs'),child=spawn(require('electron'),[script],{windowsHide:true,env:{...env,AI_DECK_QA_PHASE:'crash'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output=(output+b).slice(-6000));child.stderr.on('data',b=>output=(output+b).slice(-6000));
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));let error;
  try{
   const until=Date.now()+22000;while(!fs.existsSync(path.join(root,'kill-ready.json'))){if(child.exitCode!==null)throw Error('Fixture exited early: '+output+' '+(fs.existsSync(path.join(root,'crash.json'))?fs.readFileSync(path.join(root,'crash.json')):''));if(Date.now()>until)throw Error('Missing crash marker: '+output);await delay(80)}
   const marker=JSON.parse(fs.readFileSync(path.join(root,'kill-ready.json')));assert.equal(marker.pid,child.pid);
   await promisify(execFile)('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});await exited;
   await promisify(execFile)(require('electron'),[script],{windowsHide:true,timeout:25000,maxBuffer:1024*1024,env:{...env,AI_DECK_QA_PHASE:'restore'}});
   const result=JSON.parse(fs.readFileSync(path.join(root,'restore.json')));assert.equal(result.error,undefined,result.error);assert.equal(result.passed,true);assert.equal(result.calls.length,0);
  }catch(e){error=e;if(child.exitCode===null)await promisify(execFile)('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});throw Error(provider+' '+scenario+' ('+root+'): '+e.message,{cause:e})}
  finally{if(!error&&!process.env.AI_DECK_QA_ROOT)fs.rmSync(root,{recursive:true,force:true})}
 }
 if(!process.env.AI_DECK_QA_ROOT)fs.rmdirSync(base);
});
