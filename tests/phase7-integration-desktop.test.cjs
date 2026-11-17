const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
test('Phase 7 integrates reviewed candidates and verifies rename/delete, changed staging, base replay and rejected-candidate cleanup',{timeout:120000,skip:process.platform!=='win32'},async()=>{
 const root=process.env.AI_DECK_QA_ROOT??fs.mkdtempSync(path.join(os.tmpdir(),'deck-phase7-desktop-'));let passed=false;
 try{await promisify(execFile)(require('electron'),[path.join(__dirname,'fixtures/combined-work.cjs')],{windowsHide:true,timeout:110000,maxBuffer:1024*1024,env:{...process.env,AI_DECK_QA_ROOT:root,AI_DECK_QA_APP:process.env.AI_DECK_QA_APP??path.resolve(__dirname,'../desktop'),AI_DECK_QA_NODE:process.execPath,AI_DECK_QA_COMBINED_CASES:'normal',AI_DECK_QA_PHASE7:'1'}});
  const result=JSON.parse(fs.readFileSync(path.join(root,'result.json')));assert.equal(result.error,undefined,result.error+' '+root);assert.equal(result.passed,true);assert.ok(Object.values(result.conflicts).every(Boolean));assert.equal(Object.keys(result.phase7).length,8);assert.ok(Object.values(result.phase7).every(Boolean));passed=true;
 }finally{if(passed&&!process.env.AI_DECK_QA_ROOT&&path.dirname(fs.realpathSync(root))===fs.realpathSync(os.tmpdir()))fs.rmSync(root,{recursive:true})}
});
