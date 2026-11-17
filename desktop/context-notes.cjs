const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('hex');
const projectKey=repo=>{if(!path.isAbsolute(repo))return hash('virtual:'+repo).slice(0,24);let folder;try{folder=fs.realpathSync.native(repo)}catch{folder=path.resolve(repo)}return hash(process.platform==='win32'?folder.toLowerCase():folder).slice(0,24)};

function contextSnapshot(repo,text,{kind='saved',file,relative,revision}={}){
 return{kind,project:projectKey(repo),sha256:hash(text),capturedAt:new Date().toISOString(),
  ...(file&&{sourcePath:fs.realpathSync.native(file)}),...(relative&&{relative}),...(revision&&{revision:String(revision).slice(0,64)})};
}

function contextNoteStatus(repo,note){
 const proof=note.provenance;
 if(!proof)return'legacy saved snapshot; original revision unrecorded';
 if(proof.project!==projectKey(repo))return'other project; content withheld';
 if(proof.sha256!==hash(note.text))return'saved text changed; origin unverified';
 if(!['file','git'].includes(proof.kind))return'saved snapshot; not a live source';
 try{
  const filename=proof.kind==='file'?proof.sourcePath:path.resolve(repo,proof.relative),real=fs.realpathSync.native(filename);
  if(proof.kind==='file'&&real!==filename)return'source unavailable; saved snapshot only';
  if(proof.kind==='git'){const rel=path.relative(fs.realpathSync.native(repo),real);if(path.isAbsolute(rel)||rel==='..'||rel.startsWith('..'+path.sep))return'source unavailable; saved snapshot only'}
  const stat=fs.statSync(real);if(!stat.isFile()||stat.nlink>1||stat.size>24000)return'source unavailable; saved snapshot only';
  const fd=fs.openSync(real,'r');let bytes,after;
  try{const buffer=Buffer.alloc(stat.size+1),read=fs.readSync(fd,buffer,0,buffer.length,0);bytes=buffer.subarray(0,read);after=fs.fstatSync(fd)}finally{fs.closeSync(fd)}
  if(bytes.length!==stat.size||stat.mtimeMs!==after.mtimeMs||stat.size!==after.size||stat.ino!==after.ino)return'source changed during check; saved snapshot only';
  return hash(bytes)===proof.sha256?'source bytes match at prompt preparation; recheck the task checkout':'source changed since capture; saved snapshot only';
 }catch{return'source unavailable; saved snapshot only'}
}

function contextNotesPrompt(repo,notes){
 if(notes.reduce((size,note)=>size+note.text.length,0)>60000)throw Error('Selected context exceeds 60,000 characters. Turn off some sources.');
 return notes.map(note=>{
  const status=contextNoteStatus(repo,note),proof=note.provenance;
  if(status.startsWith('other project'))return 'Saved supporting context from another project was withheld. Explicitly copy the source into this project before reuse.';
  const metadata={id:note.id,source:note.source,name:note.name,project:projectKey(repo),sha256:hash(note.text),status,
   ...(proof?.capturedAt&&{capturedAt:proof.capturedAt}),...(proof?.revision&&{revision:proof.revision}),...(proof?.relative&&{path:proof.relative})};
  return 'Saved supporting context '+JSON.stringify(metadata)+'\n'+note.text+
   '\nThis is a saved context snapshot, not proof of current code or completed work. Follow the current user request and native project instructions.';
 }).join('\n\n');
}
module.exports={contextSnapshot,contextNoteStatus,contextNotesPrompt,projectKey};
