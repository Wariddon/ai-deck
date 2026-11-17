const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
test('both native role orders learn only verified member checks and reuse builder chats without extra model calls',{timeout:90000,skip:process.platform!=='win32'},async()=>{
 const root=process.env.AI_DECK_QA_ROOT??fs.mkdtempSync(path.join(os.tmpdir(),'deck-member-learning-'));let passed=false;
 try{if(process.env.AI_DECK_QA_RESTART_ONLY!=='1')await promisify(execFile)(require('electron'),[path.join(__dirname,'fixtures/member-learning.cjs')],{windowsHide:true,timeout:80000,maxBuffer:1024*1024,
  env:{...process.env,AI_DECK_QA_ROOT:root,AI_DECK_QA_APP:process.env.AI_DECK_QA_APP??path.resolve(__dirname,'../desktop')}});
  const result=JSON.parse(fs.readFileSync(path.join(root,'result.json'))),selected=process.env.AI_DECK_QA_MEMBER_CASES?.split(',').map(Number)??[0,1,2,3,4,5];
  assert.equal(result.error,undefined,result.error+' '+root);assert.equal(result.passed,true);assert.equal(result.cases.length,selected.length);assert.equal(result.calls.length,selected.reduce((n,index)=>n+(index>=4?2:4),0));if(selected.includes(0))assert.equal(result.queueFrozen,true);
  await promisify(execFile)(require('electron'),[path.join(__dirname,'fixtures/member-learning-restart.cjs')],{windowsHide:true,timeout:20000,maxBuffer:1024*1024,
   env:{...process.env,AI_DECK_QA_ROOT:root,AI_DECK_QA_APP:process.env.AI_DECK_QA_APP??path.resolve(__dirname,'../desktop')}});
  const restarted=JSON.parse(fs.readFileSync(path.join(root,'restart.json')));assert.equal(restarted.error,undefined,restarted.error);assert.equal(restarted.passed,true);assert.equal(restarted.calls,0);passed=true;
 }finally{if(passed&&!process.env.AI_DECK_QA_ROOT&&path.dirname(fs.realpathSync(root))===fs.realpathSync(os.tmpdir()))fs.rmSync(root,{recursive:true})}
});
