const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const appDir=process.env.AI_DECK_QA_APP??path.resolve(__dirname,'../desktop');
// The Node-only service probe does not use images; Electron supplies this in the desktop test.
const Module=require('node:module'),nativeLoad=Module._load;if(process.env.AI_DECK_QA_APP)Module._load=(name,...args)=>name==='electron'?{nativeImage:{}}:nativeLoad(name,...args);
const {createProjectTools}=require(path.join(appDir,'project-tools.cjs')),{closeCodeGraph}=require(path.join(appDir,'code-graph-worker.cjs'));
Module._load=nativeLoad;
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck-phase8-tools-')),a=path.join(root,'one','app'),b=path.join(root,'two','app');for(const folder of [a,b])fs.mkdirSync(folder,{recursive:true});
 t.after(async()=>{await closeCodeGraph();assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true})});return{root,a,b,runtimeRoot:path.join(root,'runtime')};}

test('same-name project tools keep independent Serena homes and project metadata while reusing a checkout backend',async t=>{
 const {a,b,runtimeRoot}=fixture(t),started=[],closed=[];
 // Pre-existing valid config files keep this protocol fixture independent of Python.
 for(const folder of [path.join(runtimeRoot,'serena-profile'),...[a,b].map(root=>path.join(runtimeRoot,'serena-profiles',createHash('sha256').update(process.platform==='win32'?fs.realpathSync.native(root).toLowerCase():fs.realpathSync.native(root)).digest('hex').slice(0,24)))]){fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'serena_config.yml'),'project_serena_folder_location: old\n')}
 const startSerena=(_exe,_args,options)=>{started.push(options);return{initialize:async()=>{},request:async()=>({content:[{type:'text',text:'Symbols from '+options.cwd}]}),close:async()=>closed.push(options.cwd)}};
 const first=createProjectTools({cwd:a,runtimeRoot,runtime:async()=>process.execPath,startSerena}),second=createProjectTools({cwd:b,runtimeRoot,runtime:async()=>process.execPath,startSerena});t.after(()=>Promise.all([first.close(),second.close()]));
 const query={action:'find',symbol:'sameSymbol'};await Promise.all([first.call('code_read',query,'codex'),second.call('code_read',query,'claude')]);await first.call('code_read',query,'claude');
 assert.equal(started.length,2);assert.notEqual(started[0].env.SERENA_HOME,started[1].env.SERENA_HOME);
 const locations=started.map(item=>fs.readFileSync(path.join(item.env.SERENA_HOME,'serena_config.yml'),'utf8'));assert.notEqual(locations[0],locations[1]);
 assert.ok(first.context('claude').includes('checkout'));assert.ok(!first.context('claude').includes(b));await first.close();assert.equal(closed.length,1);assert.ok((await second.call('code_read',query,'codex')).content[0].text.includes('Serena'));
});

test('unavailable semantic lookup gives honest bounded Python and PHP literal evidence in its own project',async t=>{
 const {a,b,runtimeRoot}=fixture(t);for(const [folder,marker] of [[a,'A_ONLY'],[b,'B_ONLY']]){fs.writeFileSync(path.join(folder,'math.py'),`def calculate(): return '${marker}'\n`);fs.writeFileSync(path.join(folder,'math.php'),`<?php function calculate(){return '${marker}';}\n`);fs.writeFileSync(path.join(folder,'.env'),`calculate PRIVATE_${marker}`)}
 const runtime=async()=>{throw Error('Controlled unavailable Serena')},first=createProjectTools({cwd:a,runtimeRoot,runtime,allowInstall:false}),second=createProjectTools({cwd:b,runtimeRoot,runtime,allowInstall:false});t.after(()=>Promise.all([first.close(),second.close()]));
 const results=await Promise.all([first.call('code_read',{action:'find',symbol:'calculate',file:'math.py'},'codex'),second.call('code_read',{action:'references',symbol:'calculate',file:'math.php'},'claude')]);
 for(const [index,result] of results.entries()){const text=result.content[0].text;assert.match(text,/Local literal search/);assert.match(text,/not semantic/);assert.ok(text.includes(index?'B_ONLY':'A_ONLY'));assert.ok(!text.includes(index?'A_ONLY':'B_ONLY'));assert.ok(!text.includes('PRIVATE_'))}
 await assert.rejects(first.call('code_read',{action:'find',symbol:'calculate',file:'../outside.py'},'codex'),/inside this task/);
});
