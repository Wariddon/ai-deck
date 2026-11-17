import test from 'node:test';
import assert from 'node:assert/strict';
import { observedCheckOutcome } from '../desktop/claude-command-result.cjs';
import { verifiedCheck, savedCriterionChecks } from '../desktop/team-criteria.mjs';
import { decideReview, resolvedCheckNote } from '../desktop/decision-shadow.mjs';
import { verifiedTeamSummary, economySummary } from '../desktop/team-result.mjs';

const native = { command:'node --test',freshness:'matched',status:'returned',completion:'succeeded',completionSource:'claude-tool-result' };
function run(check) {
 return { reviewSnapshot:{phase:'after-build',sha256:'snapshot'},collaboration:{verdict:'pass',reviewObservation:{stamp:'current'},
  criteria:[{id:'R1'}],findings:'R1 PASS — Current test passed.',
  criterionResults:[{id:'R1',status:'pass',detail:'Current test passed.',evidence:{snapshot:'snapshot',checks:[check]}}],
  handoffs:[{sent:true,sha256:'snapshot',checks:[check]}]} };
}

test('standard review accepts a correlated standalone native result without inventing an exit code',()=>{
 const scenario=run(native);assert.equal(native.exitCode,undefined);assert.equal(verifiedCheck(native),true);
 assert.equal(decideReview(scenario,true).decision,'finish');assert.equal(verifiedTeamSummary(scenario),'R1 · Current test passed.');
 assert.equal(resolvedCheckNote('RESOLVED_CHECK E1',[native]),true);
 assert.equal(savedCriterionChecks(scenario,'R1').checks[0].completionSource,'claude-tool-result');
 assert.equal(savedCriterionChecks(scenario,'R1').checks[0].exitCode,undefined);
});

test('native failures, interruption and stale/uncorrelated results cannot finish or resolve a review',()=>{
 for(const patch of [{completion:'failed'},{completion:'interrupted'},{freshness:'changed'},{completionSource:'model-prose'},{completion:undefined}]) {
  const check={...native,...patch},scenario=run(check);assert.notEqual(decideReview(scenario,true).decision,'finish');assert.equal(verifiedTeamSummary(scenario),undefined);assert.equal(resolvedCheckNote('RESOLVED_CHECK E1',[check]),false);
 }
 const failed={...native,completion:'failed'};assert.equal(decideReview(run(failed),true).decision,'repair');
 const economical=run(failed);economical.collaboration.policy='economy';assert.equal(economySummary(economical),undefined);
 const mixed=run(native);mixed.collaboration.handoffs[0].checks.push(failed);
 assert.equal(decideReview(mixed,true).decision,'repair');assert.equal(verifiedTeamSummary(mixed),undefined);
 mixed.collaboration.handoffs[0].checks[1]={command:'node --test',freshness:'changed',exitCode:1};
 assert.equal(decideReview(mixed,true).decision,'finish');assert.equal(verifiedTeamSummary(mixed),'R1 · Current test passed.');
});

test('pipelines and compound tool results never certify the inner test, including saved numeric success',()=>{
 for(const command of ['node --test | tail -40','cat service.js; node --test; git status --short','node --test && echo done','node --test > result.txt','node --test &','$(node --test)','pwsh -Command "node --test; echo done"']) {
  for(const extra of [{},{exitCode:0}]) {
   const check={...native,...extra,command};assert.equal(observedCheckOutcome(check),'unverified',command);assert.equal(verifiedCheck(check),false);assert.notEqual(decideReview(run(check),true).decision,'finish');assert.equal(verifiedTeamSummary(run(check)),undefined);
  }
 }
 assert.equal(observedCheckOutcome({...native,command:'pwsh -NoProfile -Command "node --test"'}),'passed');
 // Explicit configured checks certify their entire approved command, not an inferred inner test.
 assert.equal(observedCheckOutcome({...native,source:'required-check',command:'npm test && node build.cjs',exitCode:0}),'passed');
});
