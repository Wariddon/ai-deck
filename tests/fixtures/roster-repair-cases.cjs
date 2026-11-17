const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const cases=[
 {writer:'codex',rounds:2,expected:6},
 {writer:'claude',rounds:2,expected:6},
 {writer:'codex',multi:true,rounds:1,expected:6},
 {writer:'claude',multi:true,rounds:2,turnBudget:9,expected:9},
 {writer:'codex',multi:true,ambiguous:true,expected:3},
 {writer:'claude',multi:true,unknown:true,expected:3},
 {writer:'codex',multi:true,turnBudget:5,expected:3},
 {writer:'claude',multi:true,rounds:1,escape:true,expected:5},
 {writer:'codex',repeat:true,rounds:99,turnBudget:10,expected:8},
];
function team(entry,writer,reviewer,other){return{members:[writer,...(entry.multi?[{id:'member-'+randomUUID(),name:'Sidewriter',provider:other,position:'write'}]:[]),reviewer]}}
function source(round,entry){return round>=entry.rounds?"module.exports = value => typeof value === 'string' ? value.trim() : '';\n":round?"module.exports = value => typeof value === 'string' ? value : '';\n":'module.exports = value => value.trim();\n'}
async function turn({current:entry,cwd,role,emit,record,repair,side}){
 if(role==='write'){
  entry.counts??={};const who=side?'side':'main';entry.counts[who]=(entry.counts[who]??-1)+1;const round=entry.counts[who];
  if(side&&entry.ambiguous)fs.writeFileSync(path.join(cwd,'service.js'),source(0,entry)+'// another recorded writer\n');
  else if(side){fs.writeFileSync(path.join(cwd,'other.js'),'module.exports = '+(round>=entry.rounds?42:41)+';\n');fs.writeFileSync(path.join(cwd,'other.test.cjs'),"require('node:assert/strict').equal(require('./other.js'),42);\n")}
  else fs.writeFileSync(path.join(cwd,'service.js'),source(round,entry));
  // Test creation is part of the original sidewriter scope, never its repair.
  if(side&&repair&&entry.escape)fs.writeFileSync(path.join(cwd,'outside.js'),'scope escape\n');
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const result=spawnSync(process.env.AI_DECK_QA_NODE??process.execPath,['--test'],{cwd,env,windowsHide:true,encoding:'utf8'});
  assert.equal(result.error,undefined);assert.match(result.stdout,/tests [1-9]/);record.checkExit=result.status;
  emit({type:'command-result',key:randomUUID(),command:'node --test',exitCode:result.status,status:'completed',output:(result.stdout??'')+(result.stderr??'')});
  return 'Updated '+(side?'other.js':'service.js')+'; actual node --test exit '+result.status;
 }
 const findings=[];
 if(!fs.readFileSync(path.join(cwd,'service.js'),'utf8').includes('typeof')||!fs.readFileSync(path.join(cwd,'service.js'),'utf8').includes('value.trim()'))findings.push('FINDING MAJOR | service.js:1 | Return empty for null and trim string input.');
 if(entry.multi&&!entry.ambiguous&&fs.readFileSync(path.join(cwd,'other.js'),'utf8').includes('41'))findings.push('FINDING MAJOR | other.js:1 | The verified return value must be 42.');
 if(entry.unknown)findings.push('FINDING MAJOR | unowned.js:1 | An unrecorded owner must decide this contract.');
 return findings.length?'AI_DECK_REVIEW: CHANGES\n'+findings.join('\n'):'AI_DECK_REVIEW: PASS\nCurrent source and observed tests pass.';
}
function validate(entry,state,calls){
 const run=state.workspace.runHistory.at(-1),cycles=run.teamReview.cycles;
 assert.equal(calls.length,entry.expected);assert.ok(calls.length<=run.teamReview.turnLimit);
 const held=entry.ambiguous||entry.unknown||entry.turnBudget===5||entry.escape||entry.repeat;
 assert.equal(run.teamReview.needsReview,Boolean(held));
 if(entry.ambiguous||entry.unknown||entry.turnBudget===5){assert.equal(cycles.length,0);assert.ok(!calls.some(call=>call.repair))}
 else if(entry.escape){assert.equal(cycles[0].status,'scope needs review');assert.equal(cycles[0].repairs.length,2)}
 else if(entry.repeat){assert.equal(cycles.length,3);assert.ok(cycles.every(cycle=>cycle.status==='needs review'))}
 else{assert.equal(cycles.length,entry.rounds);assert.equal(cycles.at(-1).status,'reviewed');assert.ok(cycles.slice(0,-1).every(cycle=>cycle.status==='superseded'));assert.ok(cycles.every(cycle=>cycle.writers.length===(entry.multi?2:1)))}
 for(const side of [false,true]){const ids=calls.filter(call=>call.role==='write'&&call.side===side).map(call=>call.id);if(ids.length)assert.equal(new Set(ids).size,1,'each original writer chat is reused')}
 if(!held){assert.equal(calls.filter(call=>call.role==='write').at(-1).checkExit,0);assert.ok(run.teamReview.findings.every(finding=>finding.resolvedBy))}
}
module.exports={cases,team,turn,validate};
