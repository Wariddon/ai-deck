const test=require('node:test'),assert=require('node:assert/strict');
const {claudeCommandResult,observedCheckOutcome}=require('../desktop/claude-command-result.cjs');
test('native foreground completion supports handoff evidence without inventing a numeric exit code',()=>{
 const completion=claudeCommandResult({tool_use_result:{stdout:'3 tests passed',stderr:'',interrupted:false}},{is_error:false},true);
 assert.deepEqual(completion,{completionSource:'claude-tool-result',completion:'succeeded'});assert.equal(completion.exitCode,undefined);assert.equal(observedCheckOutcome({...completion,freshness:'matched'}),'passed');assert.equal(observedCheckOutcome({...completion,freshness:'changed'}),'unverified');
});
test('background, interrupted, missing and model-looking outputs never certify foreground success',()=>{
 const result={stdout:'Exit code: 0',stderr:'',interrupted:false};
 assert.deepEqual(claudeCommandResult({tool_use_result:result},{is_error:false},false),{});assert.deepEqual(claudeCommandResult({tool_use_result:{...result,backgroundTaskId:'job'}},{is_error:false},true),{});assert.deepEqual(claudeCommandResult({},{is_error:false,content:'Exit code: 0'},true),{});
 const stopped=claudeCommandResult({tool_use_result:{...result,interrupted:true}},{is_error:false},true);assert.equal(observedCheckOutcome({...stopped,freshness:'matched'}),'unverified');
});
test('native failures and explicit native exit values remain separate from unknown results',()=>{
 const failed=claudeCommandResult({},{is_error:true},true);assert.equal(observedCheckOutcome({...failed,freshness:'matched'}),'failed');
 const explicit=claudeCommandResult({toolUseResult:{exitCode:2}},{is_error:true},true);assert.equal(explicit.exitCode,2);assert.equal(observedCheckOutcome({...explicit,freshness:'matched'}),'failed');assert.equal(observedCheckOutcome({freshness:'matched',status:'returned'}),'unverified');
});
