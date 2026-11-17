const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {command,serenaPython,serenaPin}=require('../desktop/tool-runtime.cjs');
test('an older Serena marker cannot declare a runtime ready when uv and uvx are missing',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck-runtime-ready-'));t.after(()=>{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true})});
 const folder=path.join(root,'serena-'+serenaPin.slice(0,8)),scripts=path.join(folder,process.platform==='win32'?'Scripts':'bin'),python=path.join(scripts,process.platform==='win32'?'python.exe':'python');fs.mkdirSync(scripts,{recursive:true});fs.writeFileSync(python,'fixture');fs.writeFileSync(path.join(folder,'ai-deck-runtime.json'),JSON.stringify({pin:serenaPin}));
 const previous=process.env.AI_DECK_SERENA_PYTHON;delete process.env.AI_DECK_SERENA_PYTHON;t.after(()=>{if(previous===undefined)delete process.env.AI_DECK_SERENA_PYTHON;else process.env.AI_DECK_SERENA_PYTHON=previous});
 await assert.rejects(serenaPython(root,{allowInstall:false}),/uv\/uvx/);for(const name of ['uv','uvx'])fs.writeFileSync(path.join(scripts,name+(process.platform==='win32'?'.exe':'')),'fixture');assert.equal(await serenaPython(root,{allowInstall:false}),python);
});
test('runtime commands preserve real completion and release an aborted owned process',async()=>{
 assert.equal(await command(process.execPath,['-e','process.stdout.write("ready")']), 'ready');const controller=new AbortController();const pending=command(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:controller.signal});const rejected=assert.rejects(pending,/abort/iu);controller.abort();await rejected;
});
