#!/usr/bin/env node
// 需求文件同步客户端。只读取 Git 配置，远端操作使用 DevOps。
import {readFile,writeFile,mkdir,readdir,rename,lstat,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,dirname,relative} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [command,operation]=process.argv.slice(2),root=process.cwd();
const origin=process.env.DEVOPS_URL,token=process.env.DEVOPS_TOKEN,project=process.env.DEVOPS_PROJECT;
if(!origin||!token||!project)throw Error('请设置 DEVOPS_URL、DEVOPS_TOKEN、DEVOPS_PROJECT');
const base=join(root,'.devops'),hash=v=>createHash('sha256').update(v).digest('hex');
async function api(path,body,key=randomUUID()){
 const r=await fetch(origin.replace(/\/$/,'')+'/api'+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json','Idempotency-Key':key}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.message);return data;
}
async function safeFile(path){
 if(!path||path.includes('\\')||path.split('/').some(p=>!p||p==='..'||p==='.')||path.startsWith('/'))throw Error('不安全的路径');
 let current=base;for(const part of ['',...path.split('/')]){if(part)current=join(current,part);const info=await lstat(current).catch(e=>{if(e.code!=='ENOENT')throw e;});if(info?.isSymbolicLink())throw Error('通信目录不允许符号链接');}
 return join(base,path);
}
async function atomic(path,content){const file=await safeFile(path);await mkdir(dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,content,{flag:'wx',mode:0o600});await rename(temp,file);}
function validateRemote(){
 const remote=execFileSync('git',['remote','get-url','origin'],{encoding:'utf8'}).trim(),url=new URL(remote);
 if(url.origin!==new URL(origin).origin||!url.pathname.startsWith('/git/'))throw Error('origin 必须使用 DevOps Git 网关');
}
async function sync(){
 validateRemote();let manifest={};const manifestPath=await safeFile('.manifest.json');if(existsSync(manifestPath))manifest=JSON.parse(await readFile(manifestPath,'utf8'));
 for(const [path,digest]of Object.entries(manifest)){const file=await safeFile(path);if(existsSync(file)&&hash(await readFile(file))!==digest)throw Error('只读投影被修改：'+path+'。请保存修改并删除该本地文件后重新同步。');}
 const outbox=await safeFile('outbox');await mkdir(outbox,{recursive:true});
 for(const entry of await readdir(outbox,{withFileTypes:true})){
  if(entry.isSymbolicLink()||entry.isDirectory())throw Error('outbox 只允许普通 JSON 文件');if(!entry.name.endsWith('.json'))continue;
  const body=JSON.parse(await readFile(await safeFile('outbox/'+entry.name),'utf8'));
  if(body.projectId!==project||body.protocolVersion!==2||!['requirement.create','requirement.update'].includes(body.action))throw Error('outbox 只支持本项目 v2 需求请求');
  const {result}=await api('/actions/workspace.sync',body,'sync:'+body.requestId);console.log(body.requestId+': '+result.status);
 }
 const {files}=await api('/projects/'+encodeURIComponent(project)+'/workspace'),next={};
 for(const [path,value] of Object.entries(files)){
  if(!(path==='state.json'||/^(inbox\/requirements|receipts)\/[a-zA-Z0-9_-]+\.json$/.test(path)))throw Error('不支持的投影路径');
  const content=JSON.stringify(value,null,2)+'\n';await atomic(path,content);next[path]=hash(content);
 }
 for(const path of Object.keys(manifest))if(!(path in next))await rm(await safeFile(path),{force:true});
 await atomic('.manifest.json',JSON.stringify(next,null,2));console.log('需求工作区同步完成');
}
if(command==='workspace'&&operation==='init'){
 validateRemote();const file=resolve(execFileSync('git',['rev-parse','--git-path','info/exclude'],{encoding:'utf8'}).trim());await mkdir(dirname(file),{recursive:true});const old=existsSync(file)?await readFile(file,'utf8'):'';if(!old.split('\n').includes('/.devops/'))await writeFile(file,old+'\n/.devops/\n');await sync();
}else if(command==='workspace'&&operation==='sync')await sync();
else if(command==='identity')console.log(JSON.stringify(await api('/session'),null,2));
else console.log('使用方法：devops workspace init | devops workspace sync | devops identity');
