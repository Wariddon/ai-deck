const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
test('bounded multi-round and multi-owner repairs preserve native chats, atomic ownership checks, turn budgets and failed evidence',{timeout:120000,skip:process.platform!=='win32'},async()=>{
 const root=process.env.AI_DECK_QA_ROOT??fs.mkdtempSync(path.join(os.tmpdir(),'deck-roster-repair-'));let passed=false;
 try{
  await promisify(execFile)(require('electron'),[path.join(__dirname,'fixtures/session-repair.cjs')],{windowsHide:true,timeout:110000,maxBuffer:2*1024**2,env:{...process.env,AI_DECK_QA_ROOT:root,AI_DECK_QA_REPAIR180:'1',AI_DECK_QA_NODE:process.execPath,AI_DECK_QA_APP:process.env.AI_DECK_QA_APP??path.resolve(__dirname,'../desktop')}}).catch(error=>{const file=path.join(root,'result.json');if(fs.existsSync(file))throw Error(JSON.parse(fs.readFileSync(file)).error??error.message);throw error});
  const report=JSON.parse(fs.readFileSync(path.join(root,'result.json')));assert.equal(report.error,undefined,report.error+' '+root);assert.equal(report.passed,true);assert.equal(report.cases.length,9);passed=true;
 }finally{if(passed&&!process.env.AI_DECK_QA_ROOT&&path.dirname(fs.realpathSync.native(root))===fs.realpathSync.native(os.tmpdir()))fs.rmSync(root,{recursive:true})}
});
