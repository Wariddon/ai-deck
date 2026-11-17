const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {collectWorkEvidence,collectWorkEvidenceBatch,captureWorkArtifacts,unmetObservableConditions}=require('../desktop/work-evidence.cjs');
const {newRun,recordEvent}=require('../desktop/run-history.cjs'),{reviewTestChecks,workCheckCommand}=require('../desktop/delivery.cjs');
const condition='The requested local endpoint and environment have the expected result';
const contract={readyWhen:[condition],evidenceRefs:[{condition,paths:['receipt.json','screen.png'],checks:['node verify-api.cjs'],assertions:[
 {path:'receipt.json',pointer:'/environment',operator:'equals',value:'local'},
 {path:'receipt.json',pointer:'/target',operator:'equals',value:'http://127.0.0.1:1234/health'},
 {path:'receipt.json',pointer:'/status',operator:'equals',value:200}]}]};
function fixture(t){const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'deck-phase6-evidence-'));t.after(()=>fs.rmSync(cwd,{recursive:true}));
 fs.writeFileSync(path.join(cwd,'receipt.json'),JSON.stringify({environment:'local',target:'http://127.0.0.1:1234/health',status:200}));
 fs.writeFileSync(path.join(cwd,'screen.png'),Buffer.from([137,80,78,71,13,10,26,10]));return{cwd,observation:{cwd,head:'base',branch:'main',stamp:'code-and-index'}};}
async function check(input){return{command:'node verify-api.cjs',freshness:'matched',exitCode:0,artifactSnapshot:await captureWorkArtifacts([contract],input.cwd)}}

test('verified checkout aliases bind local artifacts while linked and outside artifacts remain withheld',async t=>{
 const input=fixture(t),alias=input.cwd+'-alias';fs.symlinkSync(input.cwd,alias,process.platform==='win32'?'junction':'dir');
 t.after(()=>fs.unlinkSync(alias));
 const observed=await captureWorkArtifacts([contract],alias);
 assert.ok(observed.files.every(file=>file.status==='recorded'));
 const checks=[{command:'node verify-api.cjs',freshness:'matched',exitCode:0,artifactSnapshot:observed}];
 const result=await collectWorkEvidence(contract,{...input,cwd:alias,observation:{...input.observation,cwd:alias},checks});
 assert.equal(result.conditions[0].status,'verified');
 const outside=fs.mkdtempSync(path.join(os.tmpdir(),'deck-outside-artifact-'));t.after(()=>fs.rmSync(outside,{recursive:true}));
 const outsideFile=path.join(outside,'receipt.json');fs.writeFileSync(outsideFile,'{"status":200}');
 fs.symlinkSync(outside,path.join(input.cwd,'escape'),process.platform==='win32'?'junction':'dir');
 fs.linkSync(outsideFile,path.join(input.cwd,'linked.json'));
 const rejected=await captureWorkArtifacts([{evidenceRefs:[{paths:['escape/receipt.json','linked.json']}]}],alias);
 assert.ok(rejected.files.every(file=>file.status==='unverified'));
});

test('API/UI artifact receipts need a command-time observation and bind exact target and environment',async t=>{
 const input=fixture(t);let checks=[await check(input)],result=await collectWorkEvidence(contract,{...input,checks});
 assert.equal(result.conditions[0].status,'verified');assert.equal(result.conditions[0].tests[0].host.platform,process.platform);
 assert.deepEqual(unmetObservableConditions({one:result}),[]);
 result=await collectWorkEvidence(contract,{...input,checks:[{...checks[0],artifactSnapshot:undefined}]});assert.equal(result.conditions[0].status,'incomplete');
 fs.writeFileSync(path.join(input.cwd,'receipt.json'),JSON.stringify({environment:'production',target:'http://127.0.0.1:1234/health',status:200}));
 checks=[await check(input)];result=await collectWorkEvidence(contract,{...input,checks});assert.equal(result.conditions[0].status,'failed');assert.equal(unmetObservableConditions({one:result}).length,1);
});

test('ignored or same-size receipts and images changed after the check cannot inherit its pass after serialization',async t=>{
 const input=fixture(t),checks=JSON.parse(JSON.stringify([await check(input)])),filename=path.join(input.cwd,'receipt.json'),before=fs.statSync(filename);
 fs.writeFileSync(filename,fs.readFileSync(filename,'utf8').replace('200','201'));fs.utimesSync(filename,before.atime,before.mtime);
 let result=await collectWorkEvidence(contract,{...input,checks});assert.equal(result.conditions[0].status,'stale');assert.ok(result.conditions[0].assertions.every(a=>!Object.hasOwn(a,'actual')));
 fs.writeFileSync(filename,fs.readFileSync(filename,'utf8').replace('201','200'));fs.appendFileSync(path.join(input.cwd,'screen.png'),'changed');
 result=await collectWorkEvidence(contract,{...input,checks});assert.equal(result.conditions[0].status,'stale');
});

test('handoff rehash detects a same-size rewrite even when timestamps and Git snapshot remain unchanged',async t=>{
 const input=fixture(t),checks=[await check(input)],filename=path.join(input.cwd,'receipt.json'),before=fs.statSync(filename);
 const result=await collectWorkEvidence(contract,{...input,checks,observe:async()=>{fs.writeFileSync(filename,fs.readFileSync(filename,'utf8').replace('200','201'));fs.utimesSync(filename,before.atime,before.mtime);return input.observation}});
 assert.equal(result.current,false);assert.equal(result.conditions[0].status,'stale');
});

test('exact referenced build/API commands survive saved evidence and latest failure cannot reuse an older pass',async t=>{
 const input=fixture(t),run=newRun('codex','verify',['codex']);run.workContracts={writer:contract};
 assert.equal(workCheckCommand('node verify-api.cjs',run),true);assert.equal(workCheckCommand('node verify-api.cjs; echo different',run),false);
 for(const code of [0,7]){recordEvent(run,'codex',{type:'command-result',key:'result-'+code,command:'node verify-api.cjs',exitCode:code,status:'completed'});run.evidence.at(-1).checkout=input.observation;run.evidence.at(-1).artifactSnapshot=await captureWorkArtifacts([contract],input.cwd)}
 const checks=reviewTestChecks(JSON.parse(JSON.stringify(run)),input.observation),result=await collectWorkEvidence(contract,{...input,checks});
 assert.equal(checks[0].exitCode,7);assert.equal(result.conditions[0].status,'failed');
});

test('missing, sensitive, linked or oversized artifacts stay incomplete and do not authorize reference execution',async t=>{
 const input=fixture(t),filename=path.join(input.cwd,'receipt.json'),previous=await check(input);fs.unlinkSync(filename);
 let result=await collectWorkEvidence(contract,{...input,checks:[previous]});assert.equal(result.conditions[0].status,'stale');
 // A recorded check with no readable receipt cannot substantiate even a successful process.
 const missing=await check(input);result=await collectWorkEvidence(contract,{...input,checks:[missing]});assert.equal(result.conditions[0].status,'incomplete');
 fs.writeFileSync(filename,'x'.repeat(512*1024+1));assert.equal((await captureWorkArtifacts([contract],input.cwd)).files.find(f=>f.path==='receipt.json').status,'unverified');
 const secret={...contract,evidenceRefs:[{...contract.evidenceRefs[0],paths:['.env.json'],assertions:[{...contract.evidenceRefs[0].assertions[0],path:'.env.json'}]}]};
 fs.writeFileSync(path.join(input.cwd,'.env.json'),'{"environment":"local"}');assert.equal((await captureWorkArtifacts([secret],input.cwd)).files[0].status,'unverified');
 fs.writeFileSync(filename,'{}');fs.linkSync(filename,path.join(input.cwd,'hardlink.json'));assert.equal((await captureWorkArtifacts([contract],input.cwd)).files.find(f=>f.path==='receipt.json').status,'unverified');
});

test('explicit missing references hold automation while free-form acceptance stays honestly unverified',async t=>{
 const input=fixture(t),result=await collectWorkEvidence({readyWhen:['Human approval',condition],evidenceRefs:contract.evidenceRefs},input);
 assert.equal(result.conditions[0].status,'unverified');assert.equal(result.conditions[0].required,false);assert.equal(unmetObservableConditions({one:result}).length,1);
});

test('a fresh second verifier can bind a receipt that the first verifier observed before it changed',async t=>{
 const input=fixture(t),first=await check(input);fs.writeFileSync(path.join(input.cwd,'screen.png'),Buffer.from('new capture'));
 const second={...await check(input),command:'node verify-screen.cjs'};
 const value={...contract,evidenceRefs:[{...contract.evidenceRefs[0],checks:['node verify-api.cjs','node verify-screen.cjs']}]};
 const result=await collectWorkEvidence(value,{...input,checks:[first,second]});assert.equal(result.conditions[0].status,'verified');
});

test('historical unbound verified values cannot certify a new automated handoff',()=>{
 assert.equal(unmetObservableConditions({old:{conditions:[{condition,status:'verified',assertions:[{}]}]}}).length,1);
});

test('a plain JSON artifact without predicates is recorded without a semantic pass',async t=>{
 const input=fixture(t),value={readyWhen:[condition],evidenceRefs:[{condition,paths:['receipt.json']}]};
 const result=await collectWorkEvidence(value,input);assert.equal(result.conditions[0].status,'evidence recorded');
});

test('multiple contracts share two bounded artifact passes and one Git barrier instead of multiplying IO',async t=>{
 const input=fixture(t),value={readyWhen:[condition],evidenceRefs:[{condition,paths:['receipt.json']}]},fsp=require('node:fs/promises'),open=fsp.open;let opens=0,observations=0;
 fsp.open=async(...args)=>{if(args[0]===path.join(input.cwd,'receipt.json'))opens++;return open(...args)};t.after(()=>{fsp.open=open});
 const result=await collectWorkEvidenceBatch({first:value,second:value},{...input,observe:async()=>{observations++;return input.observation}});
 assert.equal(opens,2);assert.equal(observations,1);assert.ok(Object.values(result).every(e=>e.conditions[0].status==='evidence recorded'));
});
