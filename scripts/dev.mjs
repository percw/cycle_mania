import { spawn } from 'node:child_process';
const children=[];
let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM')};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
function run(args){const child=spawn(process.execPath,args,{stdio:'inherit'});children.push(child);child.on('exit',code=>{if(!stopping){stop();process.exitCode=code??0}});return child}
let existing=false;
try{const response=await fetch('http://127.0.0.1:3001/api/health',{signal:AbortSignal.timeout(600)});const health=await response.json();existing=health.ok&&health.storage==='sqlite'}catch{}
if(existing)console.log('Bruker SUMMIT-backend som allerede kjører på port 3001.');else run(['--watch','server/index.mjs']);
run(['node_modules/vite/bin/vite.js','--host','127.0.0.1']);
