const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
module.exports = async ({ root, report, js, api, click, type, open, picker, saveOptions, assertOptions, options, draft, wait, win }) => {
  const p95 = rows => [...rows].sort((a, b) => a - b)[Math.ceil(rows.length * .95) - 1];
  const menus = {}, switching = [], typing = [];
  for (const key of ['a', 'b', 'c']) {
    await open(key); await picker(key); await saveOptions(key);
    await wait(() => js("!document.querySelector('.deck-native-model-panel:popover-open')"), 'saved choices');
    menus[key] = [];
  }
  for (let i = 0; i < 10; i++) for (const key of ['a', 'b', 'c']) {
    let began = performance.now(); await open(key); switching.push(performance.now() - began);
    began = performance.now(); await assertOptions(key); menus[key].push(performance.now() - began);
    await type('Interaction draft ' + key); assert.equal(await draft(), 'Interaction draft ' + key);
  }
  await open('a');
  const sources = Array.from({ length: 20 }, (_, i) => ({ name: 'image-' + i + '.png', bytes: [...require('electron').nativeImage.createFromBitmap(Buffer.alloc(512 * 512 * 4, i + 50), { width: 512, height: 512 }).toPNG()] }));
  const began = performance.now();
  await js(`(()=>{const dt=new DataTransfer();for(const image of ${JSON.stringify(sources)})dt.items.add(new File([new Uint8Array(image.bytes)],image.name,{type:'image/png'}));document.querySelector('.deck-native-chat form').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}))})()`);
  await wait(() => js("document.querySelectorAll('.deck-native-chat .composer-image-tile[data-attachment-id]').length===20"), 'twenty image draft');
  await wait(() => js("document.querySelectorAll('.composer-image-tile img').length>0"), 'nearby thumbnails');
  const importMs = performance.now() - began;
  await delay(100); const nearbyReads = report.previewReads.length;
  assert.ok(nearbyReads > 0 && nearbyReads < 10, 'The offscreen thumbnails must stay unread');
  for (let i = 0; i < 12; i++) typing.push(await js(`(async()=>{const t=performance.now(),e=document.querySelector('.deck-native-chat textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Image draft ${i}');e.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-t})()`));
  assert.ok(await js("(()=>{const b=[...document.querySelectorAll('.deck-native-chat button[type=submit]')][0],r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()"), 'Send stays within the window with many images');
  assert.ok(await js("(()=>{const e=document.querySelector('.composer-image-row');if(!e)return false;e.scrollLeft=e.scrollWidth;e.dispatchEvent(new Event('scroll'));return true})()"), 'Image row is scrollable');
  await wait(() => js("Boolean([...document.querySelectorAll('.composer-image-open')].find(e=>e.title==='image-19.png')?.querySelector('img'))"), 'last thumbnail on scroll');
  assert.ok(report.previewReads.every(row => row.thumbnail));
  await open('b'); assert.equal(await js("document.querySelectorAll('.deck-native-chat .composer-image-tile[data-attachment-id]').length"), 0);
  await open('a'); assert.equal(await js("document.querySelectorAll('.deck-native-chat .composer-image-tile[data-attachment-id]').length"), 20);
  assert.equal(await draft(), 'Image draft 11'); assert.equal(report.calls.length, 0);
  report.interactions = { images: 20, nearbyReads, importMs, typingP95Ms: p95(typing), switchingP95Ms: p95(switching), menuP95Ms: Object.fromEntries(Object.entries(menus).map(([key, rows]) => [key, p95(rows)])), draftAndSettingsPreserved: true };
  await delay(100); fs.writeFileSync(path.join(root, 'many-images.png'), (await win.webContents.capturePage()).toPNG());
};
