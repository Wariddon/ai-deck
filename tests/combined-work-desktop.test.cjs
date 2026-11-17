const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
test('combined work verifies real candidate tests, measured conditions, Git conflicts and source identities',{
 timeout:process.env.AI_DECK_QA_COMBINED_CASES?100000:400000,skip:process.platform!=='win32'
},async()=>{
 const root=process.env.AI_DECK_QA_ROOT??fs.mkdtempSync(path.join(os.tmpdir(),'deck-combined-work-'));let passed=false;
 try{await promisify(execFile)(require('electron'),[path.join(__dirname,'fixtures/combined-work.cjs')],{windowsHide:true,timeout:process.env.AI_DECK_QA_COMBINED_CASES?90000:390000,maxBuffer:1024*1024,env:{...process.env,AI_DECK_QA_ROOT:root,AI_DECK_QA_APP:process.env.AI_DECK_QA_APP??path.resolve(__dirname,'../desktop'),AI_DECK_QA_NODE:process.execPath}});const result=JSON.parse(fs.readFileSync(path.join(root,'result.json')));assert.equal(result.error,undefined,result.error);assert.equal(result.passed,true);assert.equal(result.cases.length,process.env.AI_DECK_QA_COMBINED_CASES?process.env.AI_DECK_QA_COMBINED_CASES.split(',').length:5);assert.equal(result.evidenceUi,true);assert.ok(Object.values(result.conflicts).every(Boolean));passed=true;}
 finally{if(passed&&!process.env.AI_DECK_QA_ROOT&&path.dirname(fs.realpathSync(root))===fs.realpathSync(os.tmpdir()))fs.rmSync(root,{recursive:true,force:true})}
});
