import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function cachingRules(){
 const context={withPWA:options=>config=>({...config,pwa:options}),withBotId:config=>config,process:{env:{}}};
 vm.runInNewContext(readFileSync(new URL('../next.config.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default','globalThis.config ='),context);
 return context.config.pwa.runtimeCaching;
}
test('API and public share paths always use NetworkOnly before suffix caches',()=>{
 const rules=cachingRules();
 for(const path of ['/api/shared/abcdefghijklmnop/image','/api/shared/abcdefghijklmnop/image?probe=.png','/shared/abcdefghijklmnop?probe=.png','/api/conversations/owned?probe=.js','/api/ai/history/state?x=.css']){
  const url=new URL(path,'https://sureword.app');const selected=rules.find(rule=>typeof rule.urlPattern==='function'?rule.urlPattern({url}):rule.urlPattern.test(url.href));
  assert.equal(selected?.handler,'NetworkOnly',path);
 }
 for(const [path,expected]of [['/_next/static/chunks/bible.js','StaleWhileRevalidate'],['/atlas/map.png','CacheFirst']]){
  const url=new URL(path,'https://sureword.app');const selected=rules.find(rule=>typeof rule.urlPattern==='function'?rule.urlPattern({url}):rule.urlPattern.test(url.href));
  assert.equal(selected?.handler,expected);
 }
});
test('worker activation purges old dynamic cache entries while preserving offline assets',async()=>{
 const handlers=new Map(),deleted=[];const paths=['/api/shared/id/image?x=.png','/shared/id?x=.js','/api/conversations/owned?x=.png','/atlas/map.png','/_next/static/chunks/bible.js','https://other.example/api/picture.png'];
 const requests=paths.map(path=>({url:new URL(path,'https://sureword.app').href}));let activation;
 const context={URL,self:{location:{origin:'https://sureword.app'},addEventListener:(name,handler)=>handlers.set(name,handler)},caches:{keys:async()=>['images','static-resources'],open:async name=>({keys:async()=>requests,delete:async request=>{deleted.push([name,request.url]);return true;}})}};
 vm.runInNewContext(readFileSync(new URL('../public/push-handlers.js',import.meta.url),'utf8'),context);
 handlers.get('activate')({waitUntil:promise=>{activation=promise;}});await activation;
 assert.equal(deleted.length,6);assert.ok(deleted.every(([,url])=>/^https:\/\/sureword.app\/(?:api|shared)\//.test(url)));
});
