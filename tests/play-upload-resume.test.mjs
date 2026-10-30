import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,symlinkSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {publishBundle} from '../mobile/scripts/play-upload.mjs';
const bytes=Buffer.from('synthetic frozen AAB payload'),sha256=createHash('sha256').update(bytes).digest('hex');
const different='f'.repeat(64),exact={versionCode:131,sha256};
function scenario({bundles=[],uploaded=exact,failAt}={}){
 const calls=[];
 const call=async(method,path,options)=>{calls.push({method,path,options});if(path.includes(failAt??'NO_MATCH'))throw new Error('synthetic_api_failure');if(path==='/edits')return{id:'owned-edit'};if(method==='GET')return{bundles};if(path.includes('/upload/'))return uploaded;return{};};
 return{calls,call};
}
const options={bytes,expectedVersionCode:131,versionName:'1.112.0',notes:'Exact changelog release notes'};
test('new payload uploads once, validates receipt and preserves normal completed internal release',async()=>{
 const api=scenario({bundles:[{versionCode:129,sha256:different}]});const result=await publishBundle(options,api.call);assert.deepEqual(result,{versionCode:131,sha256,reused:false});
 assert.deepEqual(api.calls.map(row=>row.method),['POST','GET','POST','PUT','POST']);assert.equal(api.calls[2].options.raw,bytes);assert.equal(api.calls[3].path,'/edits/owned-edit/tracks/internal');
 assert.deepEqual(api.calls[3].options.body,{track:'internal',releases:[{name:'1.112.0',versionCodes:['131'],status:'completed',releaseNotes:[{language:'en-US',text:options.notes}]}]});
 assert.equal(api.calls.at(-1).path,'/edits/owned-edit:commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW');
});
test('exact uploaded draft payload reuses immutable versionCode without re-upload',async()=>{
 const api=scenario({bundles:[{versionCode:129,sha256:different},exact]});const result=await publishBundle(options,api.call);assert.equal(result.reused,true);assert.deepEqual(api.calls.map(row=>row.method),['POST','GET','PUT','POST']);assert.equal(api.calls.some(row=>row.options?.raw),false);
});
test('normal caller without expected-code also reuses the exact payload and defaults',async()=>{
 const api=scenario({bundles:[exact]});await publishBundle({bytes},api.call);assert.deepEqual(api.calls[2].options.body,{track:'internal',releases:[{versionCodes:['131'],status:'completed'}]});
});
test('expected-code collision and exact hash under another code fail before upload or track write',async()=>{
 for(const bundles of [[{versionCode:131,sha256:different}],[{versionCode:132,sha256}]]){const api=scenario({bundles});await assert.rejects(publishBundle(options,api.call),/different/);assert.equal(api.calls.length,2);}
});
test('new upload wrong SHA or wrong expected-code never advances the track',async()=>{
 for(const uploaded of [{versionCode:131,sha256:different},{versionCode:132,sha256}]){const api=scenario({uploaded});await assert.rejects(publishBundle(options,api.call),/receipt does not match/);assert.equal(api.calls.some(row=>row.method==='PUT'),false);assert.equal(api.calls.length,3);}
});
test('malformed bundle lists, ambiguous payloads and nonliteral expected code are refused',async()=>{
 for(const bundles of [{},[{versionCode:131,sha256:'invalid'}],[exact,exact]]){const api=scenario({bundles});await assert.rejects(publishBundle(options,api.call));assert.equal(api.calls.length,2);}
 const api=scenario();await assert.rejects(publishBundle({...options,expectedVersionCode:[131]},api.call),/Invalid/);assert.equal(api.calls.length,0);
});
test('listing/upload/track/commit errors propagate without retries or successful receipt',async()=>{
 for(const failAt of ['/bundles','/upload/','/tracks/',':commit']){const api=scenario({failAt});await assert.rejects(publishBundle(options,api.call),/synthetic_api_failure/);assert.equal(api.calls.filter(row=>row.path.includes(failAt)).length,1);if(failAt!==':commit')assert.equal(api.calls.some(row=>row.path.includes(':commit')),false);}
});
test('direct and symlink CLI invocation still reach usage validation without reading credentials',()=>{
 const directory=mkdtempSync(resolve(tmpdir(),'sureword-uploader-cli-'));
 try{const script=fileURLToPath(new URL('../mobile/scripts/play-upload.mjs',import.meta.url)),linked=resolve(directory,'upload.mjs');symlinkSync(script,linked);
  for(const path of [script,linked]){const result=spawnSync(process.execPath,[path],{encoding:'utf8',env:{PATH:process.env.PATH,HOME:directory}});assert.equal(result.status,1);assert.match(result.stderr,/usage: play-upload/);assert.doesNotMatch(result.stderr,/play-publisher\.json|ENOENT/);}
 }finally{rmSync(directory,{recursive:true,force:true});}
});

const fakePrivateKey=generateKeyPairSync('rsa',{modulusLength:1024,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey;
function cliFixture(t,{mode='positive',tokenUri='https://oauth2.googleapis.com/token',privateKey=fakePrivateKey,invalidKeyJson=false}={}){
 const directory=mkdtempSync(resolve(tmpdir(),'sureword-uploader-net-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const keyPath=resolve(directory,'synthetic-key.json'),aabPath=resolve(directory,'synthetic.aab'),stubPath=resolve(directory,'network-stub.mjs'),requestsPath=resolve(directory,'requests.json');
 writeFileSync(keyPath,invalidKeyJson?'SECRET_DO_NOT_PRINT invalid JSON':JSON.stringify({client_email:'synthetic-only@example.invalid',token_uri:tokenUri,private_key:privateKey}));writeFileSync(aabPath,bytes);
 writeFileSync(stubPath,`import{writeFileSync}from'node:fs';
 const requests=[];globalThis.fetch=async(url,init)=>{const endpoint=new URL(url);requests.push({host:endpoint.hostname,path:endpoint.pathname,redirect:init.redirect,method:init.method});writeFileSync(process.env.QA_REQUESTS,JSON.stringify(requests));
 const mode=process.env.QA_MODE;if(endpoint.hostname==='oauth2.googleapis.com'){
  if(mode==='oauth-throw')throw Error('SECRET_DO_NOT_PRINT transport');
  if(mode==='oauth-redirect')return new Response('SECRET_DO_NOT_PRINT redirect',{status:302,headers:{location:'https://untrusted.invalid'}});
  if(mode==='oauth-error')return new Response('SECRET_DO_NOT_PRINT auth body',{status:400});
  if(mode==='oauth-json')return new Response('SECRET_DO_NOT_PRINT invalid JSON');
  return Response.json({access_token:mode==='oauth-empty'?'   ':'SYNTHETIC_PRIVATE_ACCESS_TOKEN'});
 }
 if(endpoint.hostname!=='androidpublisher.googleapis.com')throw Error('SECRET_DO_NOT_PRINT unexpected destination');
 if(mode==='api-throw')throw Error('SECRET_DO_NOT_PRINT api transport');
 if(mode==='api-redirect')return new Response('SECRET_DO_NOT_PRINT api redirect',{status:302,headers:{location:'https://untrusted.invalid'}});
 if(mode==='api-error')return new Response('SECRET_DO_NOT_PRINT api body',{status:403});
 if(mode==='api-json')return new Response('SECRET_DO_NOT_PRINT invalid API JSON');
 if(endpoint.pathname.endsWith('/edits'))return Response.json({id:'owned-edit'});
 if(endpoint.pathname.endsWith('/bundles'))return Response.json({bundles:[{versionCode:131,sha256:process.env.QA_SHA}]});
 if(endpoint.pathname.includes('/tracks/')){const body=JSON.parse(init.body);if(body.releases[0].status!=='completed')throw Error('Unexpected status');}
 return Response.json({});};`);
 const script=fileURLToPath(new URL('../mobile/scripts/play-upload.mjs',import.meta.url));
 const result=spawnSync(process.execPath,['--import',stubPath,script,'--aab',aabPath,'--expected-code','131','--notes','Candidate notes','--version-name','1.112.0'],{encoding:'utf8',env:{PATH:process.env.PATH,HOME:directory,SUREWORD_PLAY_KEY:keyPath,QA_MODE:mode,QA_REQUESTS:requestsPath,QA_SHA:sha256}});
 let requests=[];try{requests=JSON.parse(readFileSync(requestsPath,'utf8'));}catch{}
 const output=result.stdout+result.stderr;assert.doesNotMatch(output,/SECRET_DO_NOT_PRINT|SYNTHETIC_PRIVATE_ACCESS_TOKEN|BEGIN PRIVATE KEY/);assert.ok(requests.every(row=>row.redirect==='error'));assert.ok(requests.every(row=>['oauth2.googleapis.com','androidpublisher.googleapis.com'].includes(row.host)));
 return{result,requests,output};
}
test('actual CLI pins OAuth destination and rejects malformed credentials before a network request',t=>{
 for(const options of [{tokenUri:'https://untrusted.invalid/token'},{privateKey:'SECRET_DO_NOT_PRINT broken key'},{invalidKeyJson:true}]){const f=cliFixture(t,options);assert.equal(f.result.status,1);assert.equal(f.requests.length,0);assert.match(f.output,/credentials|authentication request/);}
});
test('actual CLI OAuth redirect, transport, status, JSON and empty-token failures never echo secret response text or follow',t=>{
 for(const mode of ['oauth-redirect','oauth-throw','oauth-error','oauth-json','oauth-empty']){const f=cliFixture(t,{mode});assert.equal(f.result.status,1);assert.equal(f.requests.length,1);assert.match(f.output,/Play authentication/);}
});
test('actual CLI Publisher redirect, transport, status and JSON failures never echo token, key or raw response',t=>{
 for(const mode of ['api-redirect','api-throw','api-error','api-json']){const f=cliFixture(t,{mode});assert.equal(f.result.status,1);assert.equal(f.requests.length,2);assert.match(f.output,/Play API/);}
});
test('actual CLI positive existing entrypoint still authenticates, reuses exact payload and completes normally',t=>{
 const f=cliFixture(t);assert.equal(f.result.status,0);assert.match(f.output,/Reusing exact AAB versionCode 131/);assert.match(f.output,/Released versionCode 131/);assert.equal(f.requests.length,5);assert.equal(f.requests.some(row=>row.path.startsWith('/upload/')),false);
});
