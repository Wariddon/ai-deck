const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
test('Phase 5 routes recorded owners, holds dependent work and frozen-setup changes, and keeps independent branches usable',{timeout:90000,skip:process.platform!=='win32'},async()=>{
 const root=process.env.AI_DECK_QA_ROOT??fs.mkdtempSync(path.join(os.tmpdir(),'deck-phase5-'));let passed=false;
 try{
  await promisify(execFile)(require('electron'),[path.join(__dirname,'fixtures/session-repair.cjs')],{windowsHide:true,timeout:80000,maxBuffer:2*1024*1024,
   env:{...process.env,AI_DECK_QA_ROOT:root,AI_DECK_QA_APP:process.env.AI_DECK_QA_APP??path.resolve(__dirname,'../desktop'),AI_DECK_QA_NODE:process.execPath,AI_DECK_QA_PHASE5:'1'}});
  const report=JSON.parse(fs.readFileSync(path.join(root,'result.json')));assert.equal(report.error,undefined,report.error+' '+root);assert.equal(report.passed,true);assert.equal(report.cases.length,process.env.AI_DECK_QA_PHASE5_CASES?process.env.AI_DECK_QA_PHASE5_CASES.split(',').length:10);passed=true;
 }finally{if(passed&&!process.env.AI_DECK_QA_ROOT&&path.dirname(fs.realpathSync(root))===fs.realpathSync(os.tmpdir()))fs.rmSync(root,{recursive:true});}
});
