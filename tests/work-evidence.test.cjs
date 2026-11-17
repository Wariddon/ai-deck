const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readWorkContract}=require('../desktop/work-contract.mjs'),{collectWorkEvidence,captureWorkArtifacts,workEvidencePrompt}=require('../desktop/work-evidence.cjs');
const condition='service behavior has observed tests';
const contract={readyWhen:[condition],evidenceRefs:[{condition,paths:['service.js'],checks:['node --test']} ]};
function fixture(t){const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'deck-work-evidence-'));t.after(()=>fs.rmSync(cwd,{recursive:true}));fs.writeFileSync(path.join(cwd,'service.js'),'export const value = 1;');return{cwd,observation:{cwd,head:'commit',branch:'main',stamp:'snapshot'}};}

test('plan references remain bounded, condition-specific and repository-relative',()=>{
  assert.deepEqual(readWorkContract(contract),contract);
  for(const evidenceRefs of [[{condition:'unrelated',paths:['service.js']}],[{condition,paths:['../outside.js']}],[{condition,paths:['C:\\secret']}],[{condition,paths:[],checks:[]}],Array(7).fill(contract.evidenceRefs[0])])assert.throws(()=>readWorkContract({...contract,evidenceRefs}));
});
test('handoff evidence records file hashes and matched test results under the exact checkout',async t=>{
  const input=fixture(t),result=await collectWorkEvidence(contract,{...input,checks:[{command:'node --test',freshness:'matched',exitCode:0}]});
  assert.equal(result.conditions[0].status,'evidence recorded');assert.match(result.conditions[0].files[0].sha256,/^[a-f0-9]{64}$/);assert.equal(result.conditions[0].tests[0].status,'passed');assert.equal(result.head,'commit');assert.equal(result.stamp,'snapshot');assert.match(workEvidencePrompt(result),/do not prove every semantic requirement/);
});
test('missing or stale checks never pass, failed checks remain failed, and checkout races invalidate evidence',async t=>{
  const input=fixture(t);
  for(const [checks,status] of [[[],'incomplete'],[[{command:'node --test',freshness:'changed',exitCode:0}],'stale']])assert.equal((await collectWorkEvidence(contract,{...input,checks})).conditions[0].status,status);
  assert.equal((await collectWorkEvidence(contract,{...input,checks:[{command:'node --test',freshness:'matched',exitCode:1}]})).conditions[0].status,'failed');
  const stale=await collectWorkEvidence(contract,{...input,checks:[{command:'node --test',freshness:'matched',exitCode:0}],observe:async()=>({...input.observation,stamp:'changed'})});assert.equal(stale.current,false);assert.equal(stale.conditions[0].status,'stale');assert.equal(stale.stamp,undefined);
});
test('free-form conditions stay unverified and command text is never executed',async t=>{
  const input=fixture(t),marker=path.join(input.cwd,'should-not-exist');
  const result=await collectWorkEvidence({readyWhen:['human acceptance',condition],evidenceRefs:[{condition,checks:['echo unsafe > '+marker]}]},input);
  assert.equal(result.conditions[0].status,'unverified');assert.equal(result.conditions[1].status,'incomplete');assert.equal(fs.existsSync(marker),false);
  fs.writeFileSync(path.join(input.cwd,'large.js'),'x'.repeat(512*1024+1));
  const limited=await collectWorkEvidence({readyWhen:[condition],evidenceRefs:[{condition,paths:['large.js','.env']}]},input);assert.ok(limited.conditions[0].files.every(row=>row.status==='unverified'));
});
test('known noninteractive PowerShell wrappers match the observed test without accepting extra commands',async t=>{
 const input=fixture(t),command='"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -NonInteractive -Command "node --test"';
 const observed=await collectWorkEvidence(contract,{...input,checks:[{command,freshness:'matched',exitCode:0}]});assert.equal(observed.conditions[0].tests[0].status,'passed');
 const different=await collectWorkEvidence(contract,{...input,checks:[{command:command.replace('node --test','node --test; echo other'),freshness:'matched',exitCode:0}]});assert.equal(different.conditions[0].tests[0].status,'unverified');
});
test('native completion survives saved run evidence and supports a condition with no fabricated exit value',async t=>{
 const {newRun,recordEvent}=require('../desktop/run-history.cjs'),{reviewTestChecks}=require('../desktop/delivery.cjs');const input=fixture(t),run=newRun('claude-write','verify',['claude']);
 recordEvent(run,'claude',{type:'command-result',key:'check',command:'node --test',status:'returned',completion:'succeeded',completionSource:'claude-tool-result'});run.evidence[0].checkout=input.observation;
 const restored=JSON.parse(JSON.stringify(run)),checks=reviewTestChecks(restored,input.observation);assert.equal(checks[0].exitCode,undefined);
 const evidence=await collectWorkEvidence(contract,{...input,checks});assert.equal(evidence.conditions[0].status,'evidence recorded');assert.equal(evidence.conditions[0].tests[0].exitCode,undefined);assert.equal(evidence.conditions[0].tests[0].completionSource,'claude-tool-result');
});

test('measurable handoff conditions require actual matching checks and exact observed JSON values',async t=>{
 const input=fixture(t),metric={readyWhen:[condition],evidenceRefs:[{condition,paths:['metrics.json'],checks:['node --test'],assertions:[{path:'metrics.json',pointer:'/typing/p95Ms',operator:'atMost',value:100}]}]};
 const observe=async()=>input.observation,checks=[{command:'node --test',freshness:'matched',exitCode:0}];
 fs.writeFileSync(path.join(input.cwd,'metrics.json'),JSON.stringify({typing:{p95Ms:75}}));
 checks[0].artifactSnapshot=await captureWorkArtifacts([metric],input.cwd);
 let result=await collectWorkEvidence(metric,{...input,checks,observe});assert.equal(result.conditions[0].status,'verified');assert.equal(result.conditions[0].assertions[0].actual,75);
 fs.writeFileSync(path.join(input.cwd,'metrics.json'),JSON.stringify({typing:{p95Ms:125}}));
 checks[0].artifactSnapshot=await captureWorkArtifacts([metric],input.cwd);
 result=await collectWorkEvidence(metric,{...input,checks,observe});assert.equal(result.conditions[0].status,'failed');
 result=await collectWorkEvidence(metric,{...input,checks:[],observe});assert.equal(result.conditions[0].status,'incomplete');
 fs.writeFileSync(path.join(input.cwd,'metrics.json'),'{broken');
 checks[0].artifactSnapshot=await captureWorkArtifacts([metric],input.cwd);
 result=await collectWorkEvidence(metric,{...input,checks,observe});assert.equal(result.conditions[0].status,'incomplete');
 fs.writeFileSync(path.join(input.cwd,'metrics.json'),JSON.stringify({typing:{p95Ms:75}}));
 result=await collectWorkEvidence(metric,{...input,checks,observe:async()=>({...input.observation,stamp:'different'})});assert.equal(result.conditions[0].status,'stale');
});

test('required check evidence binds the actual command definition and exact candidate folder, HEAD and staging snapshot',()=>{
 const {requiredCheckEvidence}=require('../desktop/work-evidence.cjs'),{createHash}=require('node:crypto');
 const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const definitions=[{name:'Combined suite',command:'node --test',owner:'both'}],observation={cwd:process.cwd(),head:'base',branch:'',stamp:'content-and-index'};
 const execution={requiredChecks:[{name:'Combined suite',commandHash:hash('node --test'),status:'passed',code:0}],checkSnapshot:{observation,checksHash:hash(definitions)}};
 assert.equal(requiredCheckEvidence(definitions,execution,observation)[0].exitCode,0);
 assert.deepEqual(requiredCheckEvidence(definitions,execution,{...observation,stamp:'other-index'}),[]);
 assert.deepEqual(requiredCheckEvidence(definitions,execution,{...observation,cwd:path.dirname(process.cwd())}),[]);
 assert.deepEqual(requiredCheckEvidence([{...definitions[0],command:'node --test different.test.cjs'}],execution,observation),[]);
 assert.deepEqual(requiredCheckEvidence(definitions,{...execution,requiredChecks:[{...execution.requiredChecks[0],code:1}]},observation),[]);
});

test('a JSON observation changed after its read stays unverified even if Git ignores that artifact',async t=>{
 const input=fixture(t),file=path.join(input.cwd,'metrics.json'),metric={readyWhen:[condition],evidenceRefs:[{condition,paths:['metrics.json'],checks:['node --test'],assertions:[{path:'metrics.json',pointer:'/value',operator:'equals',value:10}]}]};
 fs.writeFileSync(file,'{"value":10}');
 const result=await collectWorkEvidence(metric,{...input,checks:[{command:'node --test',freshness:'matched',exitCode:0}],observe:async()=>{fs.writeFileSync(file,'{"value":100}');return input.observation}});
 assert.equal(result.current,false);assert.equal(result.conditions[0].status,'stale');
});

test('multiple handoff contracts share one final Git observation and invalidate stale evidence together',async t=>{
 const {collectWorkEvidenceBatch}=require('../desktop/work-evidence.cjs'),input=fixture(t);let reads=0;
 const checks=[{command:'node --test',freshness:'matched',exitCode:0}],contracts={first:contract,second:contract};
 const result=await collectWorkEvidenceBatch(contracts,{...input,checks,observe:async()=>{reads++;return input.observation}});
 assert.equal(reads,1);assert.equal(result.first.conditions[0].status,'evidence recorded');assert.equal(result.second.stamp,result.first.stamp);
 const stale=await collectWorkEvidenceBatch(contracts,{...input,checks,observe:async()=>({...input.observation,stamp:'later edit'})});
 assert.ok(Object.values(stale).every(evidence=>evidence.current===false&&evidence.conditions[0].status==='stale'));
});
