// Rebuild notes atomically from current source. --check validates the target without embeddings or writes.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {parseEnv} from "node:util";
import {PrismaClient} from "@prisma/client";
import {chunkNoteText, writeNoteIndex, EMBEDDING_MODEL_ID, EMBEDDING_DIMENSIONS} from "../src/lib/embedding-index.ts";
import {assertBackfillTarget} from "./lib/backfill-target.mjs";

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env=parseEnv(fs.readFileSync(path.join(root,".env.local"),"utf8"));
if(!env.DATABASE_URL_UNPOOLED)throw new Error("Missing configured unpooled database URL.");
assertBackfillTarget(env.DATABASE_URL_UNPOOLED);
const prisma=new PrismaClient({datasources:{db:{url:env.DATABASE_URL_UNPOOLED}}});
async function embedBatch(texts){
 const signal=AbortSignal.timeout(20000);
 for(let attempt=0;attempt<2;attempt++){
  const response=await fetch("https://api.openai.com/v1/embeddings",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${env.OPENAI_API_KEY}`},body:JSON.stringify({model:EMBEDDING_MODEL_ID,dimensions:EMBEDDING_DIMENSIONS,input:texts}),signal});
  if(response.ok){
   const data=await response.json();
   if(!Array.isArray(data.data))throw new Error("Invalid embedding response.");
   return data.data.sort((a,b)=>a.index-b.index).map(row=>row.embedding);
  }
  if(attempt===1||!(response.status===429||response.status>=500))throw new Error(`Embedding provider returned HTTP ${response.status}.`);
  await new Promise(resolve=>setTimeout(resolve,500));
 }
}
try{
 const [identity]=await prisma.$queryRaw`SELECT current_database() AS db,(SELECT count(*)::int FROM "VerseEmbedding") AS verses`;
 if(identity.db!=="neondb"||identity.verses!==31102)throw new Error("Unexpected production index identity.");
 if(process.argv.includes("--check"))console.log(JSON.stringify({targetChecksPassed:true,verses:identity.verses}));
 else{
  if(!env.OPENAI_API_KEY)throw new Error("Missing configured OpenAI key.");
  const only=process.argv.indexOf("--note-id");
  if(only>=0&&!process.argv[only+1])throw new Error("--note-id requires an ID.");
  const notes=await prisma.note.findMany({where:only>=0?{id:process.argv[only+1]}:undefined,select:{id:true,userId:true,title:true,plainText:true}});
  let indexed=0,stale=0;
  for(const note of notes){
   const source={userId:note.userId,noteId:note.id,title:note.title,plainText:note.plainText??""};
   const chunks=chunkNoteText(source.title,source.plainText);
   const vectors=chunks.length?await embedBatch(chunks):[];
   // Force rebuild heals damaged/missing chunks. The shared writer still refuses stale or deleted source.
   const status=await writeNoteIndex(prisma,source,chunks,vectors,{force:true});
   if(status==="indexed")indexed++;else stale++;
   console.log(JSON.stringify({processed:indexed+stale,indexed,stale}));
  }
 }
}catch(error){console.error("Note backfill failed; existing indexes were retained.",error instanceof Error?error.message:"UnknownError");process.exitCode=1;}
finally{await prisma.$disconnect();}
