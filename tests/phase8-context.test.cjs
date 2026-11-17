const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const appDir=process.env.AI_DECK_QA_APP??path.resolve(__dirname,'../desktop');
const {readCodeGraph,closeCodeGraph}=require(path.join(appDir,'code-graph-worker.cjs'));
const {matchingDecision,usableDecisions}=require(path.join(appDir,'team-handoff.mjs'));
const {claudeMemoryPreferences}=require(path.join(appDir,'native-capabilities.cjs'));
const {contextSnapshot,contextNoteStatus,contextNotesPrompt,projectKey}=require(path.join(appDir,'context-notes.cjs'));
const {queryCodeGraph}=require(path.join(appDir,'code-graph.cjs'));
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck-phase8-'));t.after(async()=>{await closeCodeGraph();assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true})});
 const a=path.join(root,'first','app'),b=path.join(root,'second','app');for(const [folder,marker] of [[a,'PROJECT_A'],[b,'PROJECT_B']]){fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'source.js'),`export function sameSymbol(){ return '${marker}'; }\n`)}return{root,a,b};}

test('concurrent code lookups with identical symbols and folder names return only their own project',async t=>{
 const {a,b}=fixture(t),listing=async()=> 'source.js\0';
 const [left,right]=await Promise.all([readCodeGraph(listing,a,{symbol:'sameSymbol',kind:'impact'},false),readCodeGraph(listing,b,{symbol:'sameSymbol',kind:'impact'},false)]);
 assert.match(left.rows[0].text,/PROJECT_A/);assert.match(right.rows[0].text,/PROJECT_B/);assert.notEqual(left.snapshot,right.snapshot);
});

test('cancelling one graph lookup rejects only that request and leaves its concurrent peer usable',async t=>{
 const {a,b}=fixture(t),controller=new AbortController(),listing=async()=> 'source.js\0';
 const cancelled=readCodeGraph(listing,a,{symbol:'sameSymbol',kind:'impact'},false,controller.signal),rejected=assert.rejects(cancelled,/cancel|abort|ended/iu);
 const peer=readCodeGraph(listing,b,{symbol:'sameSymbol',kind:'impact'},false);await new Promise(resolve=>setImmediate(resolve));controller.abort(new Error('Lookup cancelled'));
 await rejected;assert.match((await peer).rows[0].text,/PROJECT_B/);
});

test('decisions with a shared branch and commit remain bound to their actual project',()=>{
 const scope={repo:'C:/projects/a',branch:'main',base:'same-shared-commit'},decision={text:'Only project A',scope};
 assert.equal(matchingDecision(decision,scope),true);assert.deepEqual(usableDecisions([decision],{...scope,repo:'C:/projects/b'}),[]);
 assert.equal(matchingDecision({text:'Legacy',scope:{branch:'main',base:'same-shared-commit'}},scope),false);
});

test('native memory project opt-outs do not redirect the user store or bleed into another project',t=>{
 const {root,a,b}=fixture(t),home=path.join(root,'native-home');fs.mkdirSync(home);fs.writeFileSync(path.join(home,'settings.json'),JSON.stringify({autoMemoryEnabled:true,autoMemoryDirectory:path.join(home,'memory')}));
 fs.mkdirSync(path.join(a,'.claude'));fs.writeFileSync(path.join(a,'.claude','settings.local.json'),JSON.stringify({autoMemoryEnabled:false,autoMemoryDirectory:path.join(a,'other')}));
 assert.deepEqual(claudeMemoryPreferences(a,{home,env:{}}),{autoMemoryEnabled:false,autoMemoryDirectory:path.join(home,'memory')});assert.equal(claudeMemoryPreferences(b,{home,env:{}}).autoMemoryEnabled,true);
 assert.equal(claudeMemoryPreferences(b,{home,env:{CLAUDE_CODE_DISABLE_AUTO_MEMORY:'1'}}).autoMemoryEnabled,false);
});

test('context snapshots cite their source and mark edits or missing origins without replacing saved content',t=>{
 const {a}=fixture(t),file=path.join(a,'AGENTS.md');fs.writeFileSync(file,'Saved project guidance');
 const note={id:'note-a',name:'AGENTS.md',source:'Codex',text:'Saved project guidance',provenance:contextSnapshot(a,'Saved project guidance',{kind:'git',relative:'AGENTS.md',revision:'original-commit'})};
 assert.match(contextNoteStatus(a,note),/bytes match/);assert.match(contextNotesPrompt(a,[note]),/original-commit/);
 fs.writeFileSync(file,'New private instructions that were never selected');const prompt=contextNotesPrompt(a,[note]);assert.match(prompt,/source changed since capture/);assert.ok(prompt.includes(note.text));assert.ok(!prompt.includes('New private instructions'));
 fs.unlinkSync(file);assert.match(contextNoteStatus(a,note),/unavailable/);assert.match(contextNotesPrompt(a,[{...note,provenance:undefined}]),/original revision unrecorded/);
});

test('a context snapshot from another project withholds its title, content and source path',t=>{
 const {a,b}=fixture(t),note={id:'private',name:'PRIVATE_PROJECT_A_TITLE',source:'Project',text:'PRIVATE_PROJECT_A_BODY',provenance:contextSnapshot(a,'PRIVATE_PROJECT_A_BODY')};
 const prompt=contextNotesPrompt(b,[note]);assert.match(prompt,/withheld/);assert.ok(!prompt.includes('PRIVATE_PROJECT_A'));
 const copied={...note,provenance:contextSnapshot(b,note.text,{kind:'library',revision:2})};assert.ok(contextNotesPrompt(b,[copied]).includes(note.text),'An explicit library copy belongs to its destination project');
});

test('conversation-only context identity survives a different application working folder',t=>{
 const {a}=fixture(t),cwd=process.cwd(),before=projectKey('ai-deck://chats');try{process.chdir(a);assert.equal(projectKey('ai-deck://chats'),before)}finally{process.chdir(cwd)}
});

test('binary source candidates count against graph IO limits and cannot force an unbounded skipped scan',t=>{
 const {a}=fixture(t),files=[];for(let index=0;index<52;index++){const file='binary-'+index+'.js';files.push(file);fs.writeFileSync(path.join(a,file),Buffer.alloc(256*1024))}
 const graph=queryCodeGraph(a,files,{symbol:'sameSymbol',kind:'impact'});assert.equal(graph.indexedFiles,0);assert.equal(graph.partial,true);assert.ok(graph.bytesRead<=12*1024*1024+1);assert.ok(graph.bytesRead>=11*1024*1024);
});

test('source changes refresh cached graph content and long cross-project tool requests retain their own query',async t=>{
 const {a,b}=fixture(t),listing=async()=> 'source.js\0';
 const jobs=Array.from({length:12},(_,index)=>readCodeGraph(listing,index%2?a:b,{symbol:'sameSymbol',kind:'impact'},false));
 const graphs=await Promise.all(jobs);graphs.forEach((graph,index)=>assert.match(graph.rows[0].text,index%2?/PROJECT_A/:/PROJECT_B/));
 fs.writeFileSync(path.join(a,'source.js'),"export function sameSymbol(){return 'FRESH_A'}");const updated=await readCodeGraph(listing,a,{symbol:'sameSymbol',kind:'impact'},false);assert.match(updated.rows[0].text,/FRESH_A/);assert.notEqual(updated.snapshot,graphs[1].snapshot);
});
