import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionReviewWriter, sessionRepairOwner, sessionWriterFilesCurrent, sessionReviewHandoff, sessionHandoffIssue, sessionRepairDecision, sessionRepairPrompt } from '../desktop/session-review-cycle.mjs';

test('repairs target the preceding writer or the actual ancestor, never a different branch', () => {
  const a={id:'a',provider:'codex',position:'write',parentId:null},b={id:'b',provider:'claude',position:'write',parentId:'a'},r={id:'r',provider:'codex',position:'review',parentId:'a'};
  assert.equal(sessionReviewWriter([a,b,r],r,'tree'),a);
  assert.equal(sessionReviewWriter([a,b,r],r,'sequence'),b);
  assert.equal(sessionReviewWriter([r],r,'sequence'),undefined);
});

test('cross-owner findings route to one recorded upstream writer rather than the latest writer', () => {
  const a={id:'a',name:'A',provider:'codex',position:'write',parentId:null},b={id:'b',name:'B',provider:'claude',position:'write',parentId:'a'},r={id:'r',provider:'codex',position:'review',parentId:'b'};
  const writes={a:{paths:['service.js']},b:{paths:['other.js']}};
  const finding=scope=>({severity:'major',scope,detail:'Needs a correction.'});
  for(const topology of ['sequence','tree']) assert.equal(sessionRepairOwner({members:[a,b,r],reviewer:r,topology,writes,findings:[finding('service.js:4:2')]}).writer,a);
  for(const findings of [[finding('unknown.js')],[finding('service.js'),finding('other.js')],[finding('../outside.js')],[{severity:'major'}]]) {
    assert.equal(sessionRepairOwner({members:[a,b,r],reviewer:r,topology:'sequence',writes,findings}).writer,undefined);
  }
  assert.equal(sessionRepairOwner({members:[a,b,r],reviewer:{...r,parentId:'a'},topology:'tree',writes,findings:[finding('other.js')]}).writer,undefined);
  assert.equal(sessionRepairOwner({members:[a,b,r],reviewer:r,topology:'sequence',writes:{a:writes.a,b:{paths:['service.js']}},findings:[finding('service.js')]}).writer,undefined);
  assert.equal(sessionReviewWriter([a,b,r],{id:'missing'},'sequence'),undefined);
});

test('repair ownership checks unchanged writer files without rejecting unrelated later files', () => {
  const after={head:'head',branch:'main',staged:'index',fileDigests:[['service.js','one'],['other.js','old']]};
  const written={paths:['service.js'],after};
  assert.equal(sessionWriterFilesCurrent(written,{...after,fileDigests:[['service.js','one'],['other.js','new']]}),true);
  for(const patch of [{head:'other'},{branch:'other'},{staged:'changed'},{fileDigests:[]},{fileDigests:[['service.js','changed']]},{fileDigests:null}]) {
    assert.equal(sessionWriterFilesCurrent(written,{...after,...patch}),false);
  }
  assert.equal(sessionWriterFilesCurrent({paths:['deleted.js'],after},{...after}),true);
});

test('dependent handoffs hold unresolved plans and reviews while independent branches keep their own reports', () => {
  const root={id:'root',name:'Root',parentId:null},r={id:'r',name:'Review',parentId:'root'},child={id:'child',name:'Child',parentId:'r'},peer={id:'peer',name:'Peer',parentId:'root'};
  const members=[root,r,child,peer],reports=new Map([['root',{text:'Done'}],['r',{text:'Findings'}]]);
  const review={status:'completed',hasChanges:true,verdict:'changes',current:true,partial:false};
  assert.match(sessionHandoffIssue({member:child,members,topology:'tree',reports,reviews:{r:review}}),/unresolved/);
  assert.equal(sessionHandoffIssue({member:peer,members,topology:'tree',reports,reviews:{r:review}}),undefined);
  assert.equal(sessionHandoffIssue({member:child,members,topology:'tree',reports,reviews:{r:{...review,verdict:'pass'}}}),undefined);
  reports.set('r',{planState:'blocked'}); assert.match(sessionHandoffIssue({member:child,members,topology:'tree',reports}),/unresolved plan/);
  reports.delete('r'); assert.match(sessionHandoffIssue({member:child,members,topology:'tree',reports}),/did not finish/);
  reports.set('r',{text:'An ordinary discussion report'});
  assert.equal(sessionHandoffIssue({member:child,members,topology:'tree',reports,reviews:{r:{verdict:'blocked',hasChanges:false}}}),undefined);
});

test('readiness follows all ancestors even when an intermediate report completed', () => {
  const members=[{id:'r',name:'Review',parentId:null},{id:'s',name:'Observer',parentId:'r'},{id:'d',name:'Dependent',parentId:'s'}];
  const reports=new Map(members.slice(0,2).map(member=>[member.id,{text:'Report'}]));
  assert.match(sessionHandoffIssue({member:members[2],members,topology:'tree',reports,reviews:{r:{status:'completed',hasChanges:true,verdict:'pass',current:false,partial:false}}}),/unverified/);
});

test('structured review handoffs stay bounded and report omitted findings explicitly', () => {
  const packet=sessionReviewHandoff({verdict:'changes',current:true,partial:false,findings:Array.from({length:14},()=>({severity:'major',scope:'service.js:1',detail:'x'.repeat(500)}))});
  assert.equal(packet.findings.length,12);assert.equal(packet.omitted,2);assert.equal(packet.findings[0].detail.length,360);
});

test('one repair requires a fresh complete snapshot, scoped findings and two available turns', () => {
  const input={verdict:'changes',findings:[{severity:'major',scope:'service.js:4',detail:'Null input throws.'}],paths:['service.js'],turnsLeft:2,current:true,partial:false};
  assert.equal(sessionRepairDecision(input).repair,true);
  for(const extra of [{used:1},{turnsLeft:1},{current:false},{partial:true},{stopped:true},{available:false},{paths:null},{paths:['other.js']},{findings:[{severity:'major',scope:'brief',detail:'Need a decision'}]}]) {
    const result=sessionRepairDecision({...input,...extra});assert.equal(result.repair,false);assert.equal(result.needsReview,true);
  }
  assert.deepEqual(sessionRepairDecision({...input,verdict:'pass'}),{repair:false});
  assert.deepEqual(sessionRepairDecision({...input,verdict:'blocked'}),{repair:false});
  assert.match(sessionRepairPrompt({...input,paths:input.paths}),/Preserve all other edits/);
});
