const assert = require('node:assert/strict'), { app } = require('electron');
const { setTimeout: delay } = require('node:timers/promises');
module.exports = async ({ report, js, api, click, type, open, picker, saveOptions, assertOptions, draft, wait, holdTurn, ids }) => {
  await api('pull-native-recents');
  for (const key of ['a', 'b', 'c']) { await open(key); await picker(key); await saveOptions(key); await wait(() => js("!document.querySelector('.deck-native-model-panel:popover-open')"), 'saved ' + key); }
  const sample = async (collect = true) => {
    if (collect) assert.equal(await js("(()=>{if(typeof gc!=='function')return false;gc();return true})()"), true, 'Comparable retained-heap samples require the QA-only GC flag');
    const processes = app.getAppMetrics().map(metric => ({ pid: metric.pid, type: metric.type, workingSetMiB: metric.memory.workingSetSize / 1024, cpuSeconds: metric.cpu.cumulativeCPUUsage }));
    return { at: performance.now(), mainHeapMiB: process.memoryUsage().heapUsed / 1024 ** 2,
      rendererHeapMiB: await js('performance.memory.usedJSHeapSize / 1024 ** 2'), processes,
      jobs: (await api('state')).jobs.length };
  };
  await open('a'); await delay(250);
  const baseline = await sample(), samples = [], idleCpu = [], typing = [], switching = [];
  for (let cycle = 0; cycle < 10; cycle++) {
    const submit = async (key, gate) => { await open(key); await type('Resource cycle ' + cycle + ' ' + key); await click('Send'); if(gate)await wait(()=>gate.entered,'entered '+key); };
    const a = holdTurn('codex'); await submit('a', a);
    const c = holdTurn('claude'); await submit('c', c);
    const b = holdTurn('codex'); await submit('b');
    await wait(async () => (await api('state')).jobs.some(job => job.key === 'native:codex:' + ids.b && job.state === 'waiting'), 'third waiter');
    assert.equal(report.calls.length, cycle * 3 + 2);
    a.release(); await wait(() => b.entered, 'waiter released');
    const expected = {};
    for (const key of ['a', 'b', 'c']) {
      const began = performance.now(); await open(key); switching.push(performance.now() - began);
      expected[key] = 'Unsent resource draft ' + cycle + ' ' + key;
      typing.push(await js(`(async()=>{const began=performance.now(),e=document.querySelector('.deck-native-chat textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(expected[key])});e.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return performance.now()-began})()`));
    }
    b.release(); c.release(); await wait(async () => !(await api('state')).jobs.length, 'all complete');
    for (const key of ['a', 'b', 'c']) { await open(key); assert.equal(await draft(), expected[key]); await assertOptions(key); }
    await open('a'); await delay(150); const beforeIdle = await sample(false); await delay(650); const afterIdle = await sample(false);
    const seconds = snapshot => snapshot.processes.reduce((n, p) => n + (p.cpuSeconds || 0), 0);
    idleCpu.push(100 * Math.max(0, seconds(afterIdle) - seconds(beforeIdle)) / ((afterIdle.at - beforeIdle.at) / 1000));
    const retained = await sample(); samples.push(retained);
    assert.equal(afterIdle.jobs, 0); assert.ok(afterIdle.processes.length <= baseline.processes.length + 1, 'Completed cycles must not accumulate app-owned processes');
    assert.ok(retained.rendererHeapMiB - baseline.rendererHeapMiB < 64, 'Retained renderer heap grew more than the bounded 64 MiB budget');
  }
  const p95 = rows => [...rows].sort((a,b)=>a-b)[Math.ceil(rows.length*.95)-1];
  assert.equal(report.calls.length, 30);
  report.resources = { cycles: 10, messages: 2400, baseline, samples, idleOneCoreCpuPercent: idleCpu,
    rendererRetainedGrowthMiB: samples.at(-1).rendererHeapMiB - baseline.rendererHeapMiB,
    typingP95Ms: p95(typing), switchingP95Ms: p95(switching), modelCalls: report.calls.length };
  report.checks.push('ten short two-active/one-waiting cycles return idle with scoped drafts, controls and bounded retained heap/processes');
};
