import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";

test("web and Android NKJV chapter loaders share cold requests and retry after a failure",async()=>{
	for(const path of ["src/lib/bible/translations.ts","mobile/src/features/bible/translations.ts"]){
		const source=readFileSync(path,"utf8").replace(/^import\s[^;]*?;\s*$/gm,"").replace(/^export /gm,"");
		let calls=0,finish;
		const fetch=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
		const {getChapter}=new Function("fetch","getBsbChapter","loadBsbChapter","getKjvChapter",`${stripTypeScriptTypes(source)};return {getChapter};`)(fetch,()=>[],async()=>[],async()=>[]);
		const a=getChapter("NKJV",43,3),b=getChapter("NKJV",43,3);assert.equal(calls,1,path);
		finish({ok:true,json:async()=>[{verse:1,text:"For God so loved the world"}]});
		assert.deepEqual(await a,await b);await getChapter("NKJV",43,3);assert.equal(calls,1,path);
		const failed=getChapter("NKJV",43,4);finish({ok:false});await assert.rejects(failed,/could not be loaded/);
		const retried=getChapter("NKJV",43,4);assert.equal(calls,3,path);finish({ok:true,json:async()=>[{verse:1,text:"Retry worked"}]});assert.deepEqual(await retried,["Retry worked"]);
	}
});
