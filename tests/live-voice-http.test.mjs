import assert from 'node:assert/strict';
import test from 'node:test';
import { readLiveBody } from '../src/lib/voice/live-http.ts';

test('chunked body without a length is cancelled as soon as byte limit is exceeded',async()=>{
 let cancelled=false;
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(80));c.enqueue(new Uint8Array(80));},cancel(){cancelled=true;}});
 const req=new Request('http://localhost',{method:'POST',body:stream,duplex:'half'});
 assert.equal(await readLiveBody(req,100),null);assert.equal(cancelled,true);
});
test('byte counting handles multibyte UTF-8 split across chunks and preserves exact signed body',async()=>{
 const bytes=new TextEncoder().encode('{"text":"é"}');
 const stream=new ReadableStream({start(c){c.enqueue(bytes.slice(0,10));c.enqueue(bytes.slice(10));c.close();}});
 const req=new Request('http://localhost',{method:'POST',body:stream,duplex:'half'});
 assert.equal(await readLiveBody(req,bytes.length),'{"text":"é"}');
});
