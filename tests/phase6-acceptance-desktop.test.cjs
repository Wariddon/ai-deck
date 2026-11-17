const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
test('observable acceptance binds real local API/build/renderer results and holds stale, incomplete or failed follow-ups',{timeout:100000,skip:process.platform!=='win32'},async()=>{
 const root=process.env.AI_DECK_QA_ROOT??fs.mkdtempSync(path.join(os.tmpdir(),'deck-phase6-desktop-'));let passed=false;
 try{await promisify(execFile)(require('electron'),[path.join(__dirname,'fixtures/phase6-acceptance.cjs')],{windowsHide:true,timeout:90000,maxBuffer:1024*1024,env:{...process.env,AI_DECK_QA_ROOT:root,AI_DECK_QA_APP:process.env.AI_DECK_QA_APP??path.resolve(__dirname,'../desktop'),AI_DECK_QA_NODE:process.execPath}});
  const result=JSON.parse(fs.readFileSync(path.join(root,'result.json')));assert.equal(result.error,undefined,result.error+' '+root);assert.equal(result.passed,true);assert.equal(result.cases.length,6);assert.equal(result.calls.length,18);assert.equal(result.evidenceUi,true);passed=true;
 }finally{if(passed&&!process.env.AI_DECK_QA_ROOT&&path.dirname(fs.realpathSync(root))===fs.realpathSync(os.tmpdir()))fs.rmSync(root,{recursive:true})}
});
