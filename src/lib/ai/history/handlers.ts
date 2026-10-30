import type { HistoryLocator, HistoryResult, HistoryService } from "./contracts";
import { locatorValid } from "./service.mjs";

const json = (result: HistoryResult): Response => Response.json(result.body, {status: result.status, headers: {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}});
const fail = (status: number, code: string): Response => json({status, body: {code}});
async function limitedJson(request: Request): Promise<unknown> {
 if (!request.body) return null;
 const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", {fatal: true});
 let text = "", bytes = 0;
 try {
  for (;;) {const {done, value} = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 4096) {await reader.cancel(); return null;} text += decoder.decode(value, {stream: true});}
  return JSON.parse(text + decoder.decode());
 } catch {return null;}
}
function query(request: Request, allowed: readonly string[]): Record<string,string> | null {
 const values = new URL(request.url).searchParams;
 if ([...values.keys()].some(key => !allowed.includes(key) || values.getAll(key).length !== 1)) return null;
 return Object.fromEntries(values);
}
export function createHistoryHandlers(service: HistoryService, auth: {read(): Promise<string>; write(): Promise<string>}) {
 const run = async (getOwner: () => Promise<string>, callback: (owner: string) => Promise<Response>): Promise<Response> => {
  try {return await callback(await getOwner());}
  catch (error) {if (error instanceof Response) return error; return fail(503,"history_unavailable");}
 };
 return {
  state: (request: Request) => run(auth.read, async owner => {
   const input = query(request,["surface","parentId","messageId"]);
   if (!locatorValid(input)) return fail(400,"invalid_request");
   const result=await service.get(owner,input);
   if(result.status===200&&result.body&&typeof result.body==='object'){
    const body=result.body as Record<string,unknown>;
    if((body.state==='pending'||body.state==='withheld')&&body.row&&typeof body.row==='object'){
     const row=body.row as Record<string,unknown>;
     const metadata=row.metadata&&typeof row.metadata==='object'?row.metadata as Record<string,unknown>:{};
     const verification=metadata.historyVerification&&typeof metadata.historyVerification==='object'?metadata.historyVerification as Record<string,unknown>:{};
     return json({...result,body:{...body,row:{...row,metadata:{...metadata,historyVerification:{...verification,surface:input.surface,parentId:input.parentId,messageId:input.messageId}}}}});
    }
   }
   return json(result);
  }),
  recheck: (request: Request) => run(auth.write, async owner => {
   const input = await limitedJson(request);
   if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).sort().join(",") !== "expectedSourceDigest,messageId,parentId,surface") return fail(400,"invalid_request");
   const record = input as Record<string,unknown>;
   const locator = {surface: record.surface, parentId: record.parentId, messageId: record.messageId};
   if (!locatorValid(locator) || typeof record.expectedSourceDigest !== "string" || !/^[a-f0-9]{64}$/.test(record.expectedSourceDigest)) return fail(400,"invalid_request");
   return json(await service.recheck(owner,locator,record.expectedSourceDigest,{signal: request.signal}));
  }),
  original: (request: Request) => run(auth.read, async owner => {
   const input = query(request,["surface","parentId","messageId","mode","reviewId","after"]);
   if (!input) return fail(400,"invalid_request");
   const {mode, reviewId, after, ...locator} = input;
   if (!locatorValid(locator) || [reviewId,after].some(value => value !== undefined && !/^[A-Za-z0-9_-]{1,160}$/.test(value))) return fail(400,"invalid_request");
   if (mode === "versions") {if (reviewId !== undefined) return fail(400,"invalid_request"); return json(await service.versions(owner,locator,after ?? null));}
   if (mode !== undefined || after !== undefined) return fail(400,"invalid_request");
   const result = await service.download(owner,locator,reviewId ?? null);
   return result.headers ? new Response(String(result.body),{status: result.status, headers: result.headers}) : json(result);
  }),
 };
}
