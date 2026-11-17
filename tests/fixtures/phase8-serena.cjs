// Bounded optional probe of an already-installed local Serena, never a model call.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const appDir=process.env.AI_DECK_QA_APP??path.resolve(__dirname,'../../desktop');
const Module=require('node:module'),nativeLoad=Module._load;if(process.env.AI_DECK_QA_APP)Module._load=(name,...args)=>name==='electron'?{nativeImage:{}}:nativeLoad(name,...args);
const {createProjectTools}=require(path.join(appDir,'project-tools.cjs')),{stdioClient}=require(path.join(appDir,'mcp-client.cjs'));
Module._load=nativeLoad;
const root=process.env.AI_DECK_QA_ROOT,python=process.env.AI_DECK_QA_SERENA_PYTHON,report={cases:[],errors:[]};
if(!root||!python||!fs.existsSync(python))throw Error('Choose an existing local Serena Python and an isolated QA folder.');fs.mkdirSync(root,{recursive:true});
Object.assign(process.env,{PIP_NO_INDEX:'1',UV_OFFLINE:'1',NPM_CONFIG_OFFLINE:'true'});
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('Bounded Serena probe ended')),30000),services=[];
(async()=>{try{
 for(const [index,marker] of ['ACTUAL_SERENA_A','ACTUAL_SERENA_B'].entries()){
  const cwd=path.join(root,String(index),'app');fs.mkdirSync(cwd,{recursive:true});fs.writeFileSync(path.join(cwd,'sample.py'),`def calculate(value: int) -> str:\n    return '${marker}'\n`);fs.writeFileSync(path.join(cwd,'usage.py'),`from sample import calculate\nresult = calculate(1) # ${marker}\n`);execFileSync('git',['init','-q',cwd],{windowsHide:true});
  services.push(createProjectTools({cwd,runtimeRoot:path.join(root,'runtime'),runtime:async()=>python,allowInstall:false,signal:controller.signal,
   startSerena:(...args)=>{const client=stdioClient(...args);return{...client,initialize:async()=>{try{return await client.initialize()}catch(error){report.errors.push(error.message);throw error}},request:async(...request)=>{try{const value=await client.request(...request);if(value.isError)report.errors.push(JSON.stringify(value.content).slice(0,1800));return value}catch(error){report.errors.push(error.message);throw error}}}}}));
 }
 const results=await Promise.allSettled(services.map(service=>service.call('code_read',{action:'find',symbol:'calculate',file:'sample.py'},'codex')));
 for(const [index,result] of results.entries()){const text=result.status==='fulfilled'?result.value.content[0].text:'';report.cases.push({index,status:result.status,serena:text.startsWith('Source: Serena'),ownMarker:text.includes(index?'ACTUAL_SERENA_B':'ACTUAL_SERENA_A'),otherMarker:text.includes(index?'ACTUAL_SERENA_A':'ACTUAL_SERENA_B'),...(result.status==='rejected'&&{error:result.reason.message})})}
 for(const row of report.cases){if(!row.serena)continue;const index=row.index,marker=index?'ACTUAL_SERENA_B':'ACTUAL_SERENA_A';const refs=(await services[index].call('code_read',{action:'references',symbol:'calculate',file:'sample.py'},'claude')).content[0].text;row.references=refs.startsWith('Source: Serena')&&refs.includes('usage.py')&&!refs.includes(index?'ACTUAL_SERENA_A':'ACTUAL_SERENA_B');
  fs.writeFileSync(path.join(root,String(index),'app','sample.py'),`def calculate(value: int) -> str:\n    return '${marker}_FRESH'\n`);const fresh=(await services[index].call('code_read',{action:'find',symbol:'calculate',file:'sample.py'},'codex')).content[0].text;row.freshSource=fresh.startsWith('Source: Serena')&&fresh.includes(marker+'_FRESH');}
 report.passed=report.cases.every(row=>row.serena&&row.ownMarker&&!row.otherMarker&&row.references&&row.freshSource);
}catch(error){report.error=error.stack}finally{clearTimeout(timer);await Promise.allSettled(services.map(service=>service.close()));fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1}})();
