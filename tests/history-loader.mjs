/** Unit-test-only TS overlay loader. Production uses ordinary static imports, never this code. */
import {readFileSync,existsSync} from 'node:fs';import{resolve,dirname,extname}from'node:path';import{fileURLToPath,pathToFileURL}from'node:url';import{createRequire}from'node:module';import{randomUUID}from'node:crypto';
export const proposedRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const sourceRoot=process.env.HISTORY_TEST_SOURCE_ROOT?resolve(process.env.HISTORY_TEST_SOURCE_ROOT):proposedRoot;
const require=createRequire(pathToFileURL(resolve(sourceRoot,'package.json'))),ts=require('typescript');
const caches=new Map(),store=globalThis[Symbol.for('sureword.history.test.modules')]??new Map();globalThis[Symbol.for('sureword.history.test.modules')]=store;
function locate(path){const paths=[resolve(proposedRoot,path),resolve(sourceRoot,path)];for(const base of paths)for(const suffix of ['', '.ts','.mjs','.js'])if(existsSync(base+suffix))return base+suffix;throw Error('Test source missing '+path);}
export async function loadHistoryModule(path,mocks={}){
 const scope=randomUUID();
 async function load(filename){
  const absolute=locate(filename),key=scope+':'+absolute;
  if(caches.has(key))return caches.get(key);
  if(Object.hasOwn(mocks,filename)){const value=mocks[filename];store.set(key,value);const exports=Object.keys(value).map(name=>{if(!/^[A-Za-z_$][\w$]*$/.test(name))throw Error('Invalid mock export');return `export const ${name}=value[${JSON.stringify(name)}];`;}).join('\n');const url='data:text/javascript;base64,'+Buffer.from(`const value=globalThis[Symbol.for('sureword.history.test.modules')].get(${JSON.stringify(key)});\n${exports}`).toString('base64');caches.set(key,url);return url;}
  if(extname(absolute)==='.mjs'||extname(absolute)==='.js'){const url=pathToFileURL(absolute).href;caches.set(key,url);return url;}
  let js=ts.transpileModule(readFileSync(absolute,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  js=js.replace(/^import ["']server-only["'];?\s*$/gm,'');
  const imports=[...js.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)];
  for(const match of imports){const spec=match[1];if(spec.startsWith('node:'))continue;const target=spec.startsWith('@/')?'src/'+spec.slice(2):spec.startsWith('.')?resolve(dirname(absolute),spec):null;if(!target)throw Error('Unexpected executable test dependency '+spec);let relativePath=target;if(target.startsWith(proposedRoot+'/'))relativePath=target.slice(proposedRoot.length+1);else if(target.startsWith(sourceRoot+'/'))relativePath=target.slice(sourceRoot.length+1);const url=await load(relativePath);js=js.replaceAll(JSON.stringify(spec),JSON.stringify(url)).replaceAll("'"+spec+"'",JSON.stringify(url));}
  const url='data:text/javascript;base64,'+Buffer.from(js).toString('base64');caches.set(key,url);return url;
 }
 return import(await load(path));
}
