import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvidenceAssertions, evaluateEvidenceAssertions } from '../desktop/work-assertions.mjs';
import { readWorkContract } from '../desktop/work-contract.mjs';

const condition='Typing p95 is at most 100 ms';
const assertion={path:'metrics.json',pointer:'/typing/p95Ms',operator:'atMost',value:100};
const reference={condition,paths:['metrics.json'],checks:['node --test performance.test.cjs'],assertions:[assertion]};
test('observable work predicates survive the existing contract while malformed or unbounded predicates are rejected',()=>{
 const contract={readyWhen:[condition],evidenceRefs:[reference]};assert.deepEqual(readWorkContract(contract),contract);
 for(const value of [{...assertion,path:'outside.json'},{...assertion,pointer:'/bad~2escape'},{...assertion,pointer:'.typing'},{...assertion,operator:'execute'},{...assertion,value:'100'},{...assertion,value:Infinity},...Array(9).fill(null).map(()=>null)]){
  assert.throws(()=>normalizeEvidenceAssertions([value],reference.paths));
 }
 assert.throws(()=>normalizeEvidenceAssertions(Array(9).fill(assertion),reference.paths));
 assert.throws(()=>readWorkContract({readyWhen:[condition],evidenceRefs:[{...reference,checks:[]}]}));
});
test('numeric bounds and exact scalar assertions use typed observed JSON, not coercion or model prose',()=>{
 const documents=new Map([['metrics.json',{value:{typing:{p95Ms:75},success:true,rows:['expected'],'a/b':{'~':false}}}]]);
 const rows=[assertion,{...assertion,pointer:'/success',operator:'equals',value:true},{...assertion,pointer:'/rows/0',operator:'equals',value:'expected'},{...assertion,pointer:'/a~1b/~0',operator:'equals',value:false}];
 assert.ok(evaluateEvidenceAssertions(rows,documents,true).every(row=>row.status==='passed'));
 for(const value of [101,'75',null,{value:75}]){documents.set('metrics.json',{value:{typing:{p95Ms:value}}});assert.equal(evaluateEvidenceAssertions([assertion],documents,true)[0].status,'failed')}
 documents.set('metrics.json',{value:{}});assert.equal(evaluateEvidenceAssertions([assertion],documents,true)[0].status,'failed');
 assert.equal(evaluateEvidenceAssertions([assertion],documents,false)[0].status,'unverified');
 assert.equal(evaluateEvidenceAssertions([assertion],new Map([['metrics.json',{error:true}]]),true)[0].status,'unverified');
});
