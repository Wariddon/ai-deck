const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util'),{setTimeout:delay}=require('node:timers/promises');
for(const provider of ['codex','claude'])test('opt-in live '+provider+' recovery retains original context and refuses replay after an owned app crash',{
 timeout:150000,skip:process.platform!=='win32'||process.env.AI_DECK_QA_LIVE!=='1'
},async()=>{
 const base=process.env.AI_DECK_QA_ROOT??fs.mkdtempSync(path.join(os.tmpdir(),'deck-live-native-')),root=path.join(base,provider);fs.mkdirSync(root,{recursive:true});
 const script=path.join(__dirname,'fixtures/live-native-recovery.cjs'),env={...process.env,AI_DECK_QA_ROOT:root,AI_DECK_QA_APP:process.env.AI_DECK_QA_APP??path.resolve(__dirname,'../desktop'),AI_DECK_QA_PROVIDER:provider};
 for(const phase of ['seed','crash','restore']){
  const child=spawn(require('electron'),[script],{windowsHide:true,env:{...env,AI_DECK_QA_PHASE:phase},stdio:['ignore','pipe','pipe']});let output='';
  for(const stream of [child.stdout,child.stderr])stream.on('data',data=>output=(output+data).slice(-5000));
  const exited=new Promise(resolve=>child.once('exit',code=>resolve(code)));let killed=false;
  try{
   const end=Date.now()+45000;
   while(child.exitCode===null){
    if(phase==='crash'&&fs.existsSync(path.join(root,'kill-ready.json'))){const marker=JSON.parse(fs.readFileSync(path.join(root,'kill-ready.json')));assert.equal(marker.pid,child.pid);await promisify(execFile)('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});killed=true;break;}
    if(Date.now()>end)throw Error('Live '+provider+' '+phase+' timed out: '+output);await delay(80);
   }
   await exited;
   if(phase==='crash')assert.equal(killed,true,'The owned QA app must reach a real streaming boundary: '+output+(fs.existsSync(path.join(root,'crash.json'))?fs.readFileSync(path.join(root,'crash.json')):''));
   else{const result=JSON.parse(fs.readFileSync(path.join(root,phase+'.json')));assert.equal(result.error,undefined,result.error);assert.equal(result.passed,true);if(phase==='restore'){assert.equal(result.replayedCalls,0);assert.equal(result.contextPreserved,true)}}
  }finally{if(child.exitCode===null)await promisify(execFile)('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true}).catch(()=>{})}
 }
});
