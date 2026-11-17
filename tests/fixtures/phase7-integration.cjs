const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');

module.exports=async({api,repo,profile,git,storage,appDir,report})=>{
 const calls=report.calls.length,rootIndex=git(repo,['diff','--cached','--binary']),workspace=storage.workspaces[repo],original=workspace.tasks.find(task=>task.id===workspace.currentTask);
 // A foreign checkout under the managed folder must not be admitted by Update base.
 const saved=original.worktree,foreign=path.join(profile,'worktrees','foreign');original.worktree=foreign;
 const count=workspace.tasks.length,list=git(repo,['worktree','list','--porcelain']);
 await assert.rejects(api('update-worktree-base',{taskId:original.id,lane:'main',commit:git(repo,['rev-parse','HEAD'])}),/different Git repository/);
 assert.equal(workspace.tasks.length,count);assert.equal(git(repo,['worktree','list','--porcelain']),list);original.worktree=saved;

 const {newTask}=require(path.join(appDir,'tasks.cjs')),base=original.base,main=path.join(profile,'worktrees','phase7-main'),other=path.join(profile,'worktrees','phase7-peer');
 for(const folder of [main,other])git(repo,['worktree','add','--detach',folder,base]);
 const task={...newTask(),title:'Phase 7 rename and delete',base,worktree:main,claudeWorktree:other};workspace.tasks.push(task);await api('switch-task',{repo,id:task.id});
 git(main,['mv','shared.cjs','renamed.cjs']);git(other,['rm','right.cjs']);fs.writeFileSync(path.join(main,'user-note.txt'),'keep my untracked note\n');fs.writeFileSync(path.join(main,'.env'),'PRIVATE_FIXTURE=keep\n');
 const mainIndex=git(main,['diff','--cached','--binary']),otherIndex=git(other,['diff','--cached','--binary']);
 const preview=await api('compare-worktrees');const combined=await api('combine-worktrees',{taskId:task.id,stamps:{main:preview.main.stamp,claude:preview.claude.stamp},paths:{main:['shared.cjs','renamed.cjs'],claude:['right.cjs']}});
 assert.equal(fs.existsSync(path.join(combined.workspace.worktree,'shared.cjs')),false);assert.equal(fs.existsSync(path.join(combined.workspace.worktree,'right.cjs')),false);assert.equal(fs.readFileSync(path.join(combined.workspace.worktree,'renamed.cjs'),'utf8').replaceAll('\r\n','\n'),'module.exports=0;\n');
 assert.equal(git(combined.workspace.worktree,['diff','--cached','--binary']),'');assert.equal(git(main,['diff','--cached','--binary']),mainIndex);assert.equal(git(other,['diff','--cached','--binary']),otherIndex);

 await api('switch-task',{repo,id:task.id});const stagedPreview=await api('compare-worktrees');git(other,['reset','--quiet','HEAD','--','right.cjs']);const changed=await api('compare-worktrees');assert.notEqual(stagedPreview.claude.stamp,changed.claude.stamp);
 const beforeRejected=workspace.tasks.length,worktreesBefore=git(repo,['worktree','list','--porcelain']);
 await assert.rejects(api('combine-worktrees',{taskId:task.id,stamps:{main:stagedPreview.main.stamp,claude:stagedPreview.claude.stamp},paths:{main:['shared.cjs','renamed.cjs'],claude:['right.cjs']}}),/changed after the preview/);
 assert.equal(workspace.tasks.length,beforeRejected);assert.equal(git(repo,['worktree','list','--porcelain']),worktreesBefore);

 // A non-overlapping upstream addition can be replayed without touching either source.
 fs.writeFileSync(path.join(repo,'upstream-only.cjs'),'module.exports="upstream";\n');git(repo,['add','upstream-only.cjs']);git(repo,['commit','--only','-qm','QA non-overlapping base','--','upstream-only.cjs']);
 const updated=await api('update-worktree-base',{taskId:task.id,lane:'main',commit:git(repo,['rev-parse','HEAD'])});
 assert.equal(fs.readFileSync(path.join(updated.workspace.worktree,'upstream-only.cjs'),'utf8').replaceAll('\r\n','\n'),'module.exports="upstream";\n');assert.equal(fs.existsSync(path.join(updated.workspace.worktree,'shared.cjs')),false);assert.equal(fs.readFileSync(path.join(updated.workspace.worktree,'renamed.cjs'),'utf8').replaceAll('\r\n','\n'),'module.exports=0;\n');
 assert.equal(fs.readFileSync(path.join(updated.workspace.worktree,'user-note.txt'),'utf8'),'keep my untracked note\n');assert.equal(fs.existsSync(path.join(updated.workspace.worktree,'.env')),false);assert.equal(git(main,['diff','--cached','--binary']),mainIndex);
 assert.equal(fs.readFileSync(path.join(main,'.env'),'utf8'),'PRIVATE_FIXTURE=keep\n');assert.equal(git(repo,['diff','--cached','--binary']),rootIndex);assert.equal(report.calls.length,calls,'Git operations must not dispatch another model turn');
 report.phase7={foreignUpdateRejected:true,rejectedCandidateNotPublished:true,renamedAndDeletedFilesCombined:true,sourceStagingPreserved:true,stagingOnlyPreviewInvalidated:true,upstreamReplayPreserved:true,untrackedAndIgnoredSourcesPreserved:true,noAdditionalProviderCalls:true};
};
