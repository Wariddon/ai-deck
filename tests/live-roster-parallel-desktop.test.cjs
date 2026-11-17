const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
test('opt-in real Codex and Claude run independent Session Team reader branches concurrently',{timeout:100000,skip:process.platform!=='win32'||process.env.AI_DECK_QA_LIVE!=='1'},async()=>{
 const root=process.env.AI_DECK_QA_ROOT??fs.mkdtempSync(path.join(os.tmpdir(),'deck-live-roster-'));
 await promisify(execFile)(require('electron'),[path.join(__dirname,'fixtures/roster-parallel.cjs')],{windowsHide:true,timeout:90000,maxBuffer:2*1024**2,env:{...process.env,AI_DECK_QA_ROOT:root,AI_DECK_QA_LIVE_ROSTER:'1',AI_DECK_QA_APP:process.env.AI_DECK_QA_APP??path.resolve(__dirname,'../desktop')}}).catch(error=>{const file=path.join(root,'result.json');if(fs.existsSync(file))throw Error(JSON.parse(fs.readFileSync(file)).error??error.message);throw error});
 const report=JSON.parse(fs.readFileSync(path.join(root,'result.json')));assert.equal(report.error,undefined,report.error+' '+root);assert.equal(report.passed,true);assert.equal(report.cases.length,1);
});
