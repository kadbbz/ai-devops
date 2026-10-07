#!/usr/bin/env node
// 本地工作区协议客户端。只调用 DevOps，Git 远端不得直连 Gitea。
import {readFile,writeFile,mkdir,readdir,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createHash,sign,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [command,operation]=process.argv.slice(2),root=process.cwd();
const origin=process.env.DEVOPS_URL,token=process.env.DEVOPS_TOKEN,project=process.env.DEVOPS_PROJECT;
if(!origin||!token||!project)throw Error('请设置 DEVOPS_URL、DEVOPS_TOKEN、DEVOPS_PROJECT（项目 ID）');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical).join(',')}]`:`{${Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')}}`;
async function api(path,body,key=randomUUID()){
 const headers={Authorization:'Bearer '+token};if(body){headers['Content-Type']='application/json';headers['Idempotency-Key']=key;if(process.env.DEVOPS_SIGNING_KEY){headers['X-Receipt-Signature']=sign(null,Buffer.from(canonical({action:path.split('/').at(-1),body,key})),await readFile(process.env.DEVOPS_SIGNING_KEY)).toString('base64');}}
 const r=await fetch(origin.replace(/\/$/,'')+'/api'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.message);return data;
}
async function atomic(path,value){await mkdir(dirname(path),{recursive:true});await writeFile(path+'.tmp',value);await rename(path+'.tmp',path);}
const hash=v=>createHash('sha256').update(v).digest('hex');
async function sync(){
 const base=join(root,'.devops');let manifest={};try{manifest=JSON.parse(await readFile(join(base,'.manifest.json'),'utf8'))}catch{}
 // 程序投影被本地修改时先拒绝，不能静默覆盖。
 for(const [path,digest]of Object.entries(manifest)){const file=join(base,path);if(existsSync(file)&&hash(await readFile(file))!==digest)throw Error('只读投影被修改：'+path+'。请保存你的修改并删除该本地文件后重新同步。');}
 const walk=async dir=>{const result=[];for(const entry of await readdir(dir,{withFileTypes:true}).catch(()=>[])){const full=join(dir,entry.name);if(entry.isDirectory())result.push(...await walk(full));else if(entry.name.endsWith('.json'))result.push(full);}return result;};
 for(const path of await walk(join(base,'outbox'))){const body=JSON.parse(await readFile(path,'utf8'));if(body.projectId!==project)throw Error('outbox 项目不匹配');const {result}=await api('/actions/workspace.sync',body,'sync:'+body.requestId);console.log(body.requestId+': '+result.status);}
 const data=await api('/projects/'+encodeURIComponent(project)+'/workspace'),next={};
 for(const [path,value]of Object.entries(data.files)){if(path.includes('..')||path.startsWith('/')||!['inbox/','receipts/','state.json'].some(p=>path.startsWith(p)))throw Error('不安全的投影路径');const content=JSON.stringify(value,null,2)+'\n';await atomic(join(base,path),content);next[path]=hash(content);}
 await atomic(join(base,'.manifest.json'),JSON.stringify(next,null,2));console.log('工作区同步完成');
}
if(command==='workspace'&&operation==='init'){
 const remotes=execFileSync('git',['remote','get-url','origin'],{encoding:'utf8'}).trim();const url=new URL(remotes);if(url.origin!==new URL(origin).origin||!url.pathname.startsWith('/git/'))throw Error('origin 必须使用 DevOps Git 网关');
 const exclude=execFileSync('git',['rev-parse','--git-path','info/exclude'],{encoding:'utf8'}).trim();const file=resolve(exclude);await mkdir(dirname(file),{recursive:true});const old=existsSync(file)?await readFile(file,'utf8'):'';if(!old.split('\n').includes('/.devops/'))await writeFile(file,old+'\n/.devops/\n');await mkdir(join(root,'.devops','outbox'),{recursive:true});await sync();
}else if(command==='workspace'&&operation==='sync')await sync();
else if(command==='identity')console.log(JSON.stringify(await api('/session'),null,2));
else console.log('使用方法：devops workspace init | devops workspace sync | devops identity');
