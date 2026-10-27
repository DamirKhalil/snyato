import { createHash } from 'node:crypto';

// Receives service access through hidden stdin only. No credential files or argv.
process.stdout.write('Ready for Dropbox sync JSON on stdin (input is hidden).\n');
const input = await new Promise((resolve,reject)=>{
  let buffer='';
  const raw=!!process.stdin.isTTY;
  if(raw)process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');process.stdin.resume();
  const restore=()=>{if(raw)process.stdin.setRawMode(false);process.stdin.pause();};
  const onData=chunk=>{buffer+=chunk;const end=buffer.indexOf('\n');if(end<0)return;process.stdin.off('data',onData);restore();try{resolve(JSON.parse(buffer.slice(0,end).trim()));}catch{reject(new Error('Invalid sync input'));}};
  process.stdin.on('data',onData);
  process.stdin.on('error',error=>{restore();reject(error)});
});
try{
  if(typeof input.token!=='string'||!input.token)throw new Error('Site service access is unavailable');
  if(input.action==='token-hash'){
    process.stdout.write(JSON.stringify({sha256:createHash('sha256').update(input.token).digest('hex')})+'\n');
  }else{
    const origin=new URL(input.origin).origin;
    if(!origin.startsWith('https://')||!new URL(origin).hostname.endsWith('.chatgpt.site'))throw new Error('Expected the canonical HTTPS Site origin');
    const isImport=input.action==='import';
    if(!isImport&&input.action!=='status')throw new Error('Unknown sync action');
    const response=await fetch(origin+'/api/dropbox-sync',{
      method:isImport?'POST':'GET',
      headers:{'OAI-Sites-Authorization':'Bearer '+input.token,'Authorization':'Bearer '+input.token,...(isImport?{'Content-Type':'application/json'}:{})},
      body:isImport?JSON.stringify(input.snapshot):undefined,
      signal:AbortSignal.timeout(55000),
    });
    const body=await response.json().catch(()=>({error:'The Site did not return JSON'}));
    process.stdout.write(JSON.stringify({ok:response.ok,status:response.status,result:body})+'\n');
    if(!response.ok)process.exitCode=1;
  }
}catch(error){process.stderr.write((error instanceof Error?error.message:'Sync failed')+'\n');process.exitCode=1;}
