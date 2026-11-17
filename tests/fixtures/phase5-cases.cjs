const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const extra = (name, provider, position, parentId) => ({ id:'member-'+randomUUID(), name, provider, position, ...(parentId !== undefined && { parentId }) });
const cases = [
  { writer:'codex', crossOwner:true, expected:5 },
  { writer:'claude', ancestor:true, expected:5 },
  { writer:'codex', dependent:true, budget:3, expected:2 },
  { writer:'claude', plan:true, planBlocked:true, expected:1 },
  { writer:'codex', setupRace:true, expected:1 },
  { writer:'codex', unavailable:true, expected:4 },
  { writer:'claude', crossBranch:true, expected:5 },
  { writer:'codex', longReview:true, expected:6 },
  { writer:'claude', longFalsePass:true, crossOwner:true, expected:5 },
  { writer:'codex', staleAncestor:true, expected:3 },
];
function team(entry, writer, reviewer, other) {
  const side=extra('Sidewriter',other,'write');
  if(entry.crossOwner || entry.longReview) return { members:[writer,side,reviewer] };
  if(entry.ancestor) return { topology:'tree',members:[{...writer,parentId:null},{...side,parentId:writer.id},{...reviewer,parentId:side.id}] };
  if(entry.dependent) return { members:[writer,reviewer,extra('Dependent',entry.writer,'write')] };
  if(entry.planBlocked) return { members:[extra('Planner',other,'plan'),writer,reviewer] };
  if(entry.unavailable) {
    const missing=extra('Unavailable','gemini','review',writer.id); missing.model='fixture';
    return { topology:'tree',members:[{...writer,parentId:null},missing,extra('Dependent',other,'write',missing.id),{...reviewer,parentId:writer.id}] };
  }
  if(entry.crossBranch) return { topology:'tree',summaryMemberId:writer.id,members:[{...writer,parentId:null},{...side,parentId:writer.id},{...reviewer,parentId:writer.id},
    extra('Dependent',entry.writer,'write',reviewer.id),extra('Independent',other,'summarize',side.id)] };
  if(entry.staleAncestor) {
    const observer=extra('Observer',other,'summarize',reviewer.id);
    return {topology:'tree',members:[{...writer,parentId:null},{...reviewer,parentId:writer.id},observer,extra('Dependent',entry.writer,'write',observer.id)]};
  }
  return { members:[writer,reviewer] };
}
function validate(entry, state, calls) {
  const run=state.workspace.runHistory.at(-1), members=run.sessionTeam.members;
  const byName=name=>members.find(member=>member.name===name);
  if(entry.crossOwner || entry.ancestor || entry.unavailable) {
    assert.equal(run.teamReview.cycles[0].writer,byName('Builder').id);
    assert.equal(run.teamReview.cycles[0].status,'reviewed');
    const writes=calls.filter(call=>call.role==='write'&&!call.side); assert.equal(writes[0].id,writes[1].id);
  }
  if(entry.crossOwner || entry.ancestor) assert.equal(run.teamReview.needsReview,false);
  else assert.equal(run.teamReview.needsReview,true);
  if(entry.planBlocked) {
    assert.equal(Object.values(run.teamReview.plans)[0].state,'blocked');
    assert.equal(run.agents[byName('Builder').id].status,'skipped');
  }
  if(entry.dependent || entry.unavailable || entry.crossBranch || entry.staleAncestor) {
    assert.equal(run.agents[byName('Dependent').id].status,'skipped');
    assert.ok(run.teamReview.handoffHolds[byName('Dependent').id]);
    assert.ok(!calls.some(call=>call.prompt.includes('You are Dependent,')));
  }
  if(entry.crossBranch) {
    assert.equal(run.agents[byName('Independent').id].status,'completed');
    assert.equal(run.teamReview.cycles.length,0);
    const wrap=calls.find(call=>call.prompt.includes('Write the final wrap-up'));
    assert.ok(wrap.prompt.includes('Recorded review disposition: changes'));assert.ok(wrap.prompt.includes('other.js:1'));
  }
  if(entry.staleAncestor)assert.equal(run.teamReview.reviews[byName('Reviewer').id].current,false);
  if(entry.setupRace) { assert.ok(run.teamReview.setupChanged.length); assert.equal(run.agents[byName('Reviewer').id].status,'skipped'); }
  if(entry.longReview) {
    const review=run.teamReview.reviews[byName('Reviewer').id];
    assert.equal(review.findings.length,2); assert.ok(!review.text.includes('FINDING'));
    assert.equal(run.teamReview.cycles.length,1); assert.equal(run.teamReview.cycles[0].writers.length,2);
  }
}
const selected=process.env.AI_DECK_QA_PHASE5_CASES;
module.exports={cases:selected?selected.split(',').map(index=>{const value=cases[Number(index)];if(!value)throw Error('Unknown phase-five case');return value}):cases,team,validate};
