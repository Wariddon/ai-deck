const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util'),{setTimeout:delay}=require('node:timers/promises');
const selected=process.env.AI_DECK_QA_CYCLE_PROVIDERS?.split(',')??['codex','claude'];
if(selected.some(provider=>!['codex','claude'].includes(provider))||!selected.length)throw Error('Choose native providers for the live cycle');
for(const provider of selected)test('opt-in real '+provider+' builder completes review repair, Ask, original Recents, fork draft and restart continuation',{
 timeout:310000,skip:process.platform!=='win32'||process.env.AI_DECK_QA_LIVE!=='1',
},async()=>{
 const base=process.env.AI_DECK_QA_ROOT??fs.mkdtempSync(path.join(os.tmpdir(),'deck-live-team-')),root=path.join(base,provider);fs.mkdirSync(root,{recursive:true});
 for(const phase of [process.env.AI_DECK_QA_CYCLE_RESUME_POST==='1'?'post':'first','restore']){
  const child=spawn(require('electron'),[path.join(__dirname,'fixtures/live-team-cycle.cjs')],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,AI_DECK_QA_ROOT:root,AI_DECK_QA_APP:process.env.AI_DECK_QA_APP??path.resolve(__dirname,'../desktop'),AI_DECK_QA_NODE:process.execPath,AI_DECK_QA_PROVIDER:provider,AI_DECK_QA_PHASE:phase}});
  let output='',exited=false;for(const stream of [child.stdout,child.stderr])stream.on('data',data=>output=(output+data).slice(-4000));child.once('exit',()=>{exited=true});
  try{
   const end=Date.now()+(phase==='first'?190000:105000);while(!exited){if(Date.now()>end)throw Error('Live '+provider+' '+phase+' timed out at '+root);await delay(100)}
   const file=path.join(root,phase+'.json');assert.ok(fs.existsSync(file),output);const result=JSON.parse(fs.readFileSync(file));assert.equal(result.error,undefined,(result.error??output)+' '+root);assert.equal(result.passed,true);if(phase==='restore'){assert.equal(result.zeroReplayOnOpen,true);assert.equal(result.sameWriterAfterAskRecentsRestart,true)}
  }finally{if(!exited)await promisify(execFile)('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true}).catch(()=>{})}
 }
});
