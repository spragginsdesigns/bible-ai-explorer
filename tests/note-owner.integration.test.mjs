import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {stripTypeScriptTypes,createRequire} from 'node:module';
import {PrismaClient,Prisma} from '@prisma/client';
import {writeNoteIndex,EMBEDDING_MODEL_ID,EMBEDDING_DIMENSIONS} from '../src/lib/embedding-index.ts';
import {runAccountDeletion,accountBlobPrefixes,uniquePathnames,isDeletionConfirmed} from '../src/lib/account-deletion.ts';

const target=process.env.SUREWORD_TEST_DATABASE_URL;
const {NextResponse}=createRequire(import.meta.url)('next/server');
function moduleWith(file,deps,extra){
 const source=fs.readFileSync(new URL(file,import.meta.url),'utf8').replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/^export \{[^;]+;\s*$/gm,'').replace(/^export /gm,'');
 return new Function(...Object.keys(deps),stripTypeScriptTypes(source)+extra)(...Object.values(deps));
}

test('account rekeying preserves semantic access and rejects the old actor, including trailing chunks',{skip:!target},async()=>{
 const url=new URL(target);
 assert.equal(process.env.SUREWORD_TEST_DATABASE_ISOLATED,'yes','Fixture writes require an explicitly isolated database.');
 assert.notEqual(url.hostname.replace('-pooler',''),'ep-mute-waterfall-akrqxqaz.c-3.us-west-2.aws.neon.tech','Never mutate production from this test.');
 const db=new PrismaClient({datasources:{db:{url:target}}});
 const oldId='note-owner-test-old-'+crypto.randomUUID(),newId='note-owner-test-new-'+crypto.randomUUID();
 const vector=[1,...Array(EMBEDDING_DIMENSIONS-1).fill(0)];
 const {searchQuery}=moduleWith('../src/lib/search-query.ts',{prisma:db},';return {searchQuery};');
 const {searchNoteEmbeddings}=moduleWith('../src/lib/note-embeddings.ts',{Prisma,prisma:db,EMBEDDING_MODEL_ID,EMBEDDING_DIMENSIONS,queryEmbedding:async()=>vector,searchQuery},';return {searchNoteEmbeddings};');
 try{
  await db.user.create({data:{id:oldId,name:'Public ownership fixture'}});
  const note=await db.note.create({data:{userId:oldId,title:'Grace',plainText:'Public KJV fixture',content:'',htmlContent:''}});
  const source={userId:oldId,noteId:note.id,title:note.title,plainText:note.plainText};
  await writeNoteIndex(db,source,['public first','public trailing'],[vector,vector]);
  await db.noteLink.create({data:{sourceNoteId:note.id,targetKey:'public-target',targetTitle:'Public target',snippet:'Public link fixture',userId:oldId}});
  assert.equal((await searchNoteEmbeddings(oldId,'fixture')).length,1);
  await db.user.update({where:{id:oldId},data:{id:newId}});
  assert.equal((await searchNoteEmbeddings(oldId,'fixture')).length,0);
  assert.equal((await searchNoteEmbeddings(newId,'fixture')).length,1);
  assert.equal(await writeNoteIndex(db,{...source,userId:newId},['public first','public trailing'],[vector,vector]),'unchanged');
  // Exercise the real handler and real cascades, with external services stubbed.
  let deletingId=oldId;
  const {DELETE}=moduleWith('../src/app/api/account/route.ts',{
   prisma:db,NextResponse,billingAvailable:()=>true,auth:async()=>({userId:deletingId}),clerkClient:async()=>({users:{deleteUser:async()=>{}}}),
   stripeClient:()=>{throw Error('No fixture subscription should require Stripe.');},
   list:async()=>({blobs:[],hasMore:false}),del:async()=>{},
   runAccountDeletion,accountBlobPrefixes,uniquePathnames,isDeletionConfirmed,
  },';return {DELETE};');
  const deletionRequest=()=>new Request('http://localhost/api/account',{method:'DELETE',body:JSON.stringify({confirm:'DELETE'})});
  assert.equal((await DELETE(deletionRequest())).status,200);
  assert.equal((await db.$queryRaw`SELECT count(*)::int count FROM "NoteEmbedding" WHERE "noteId"=${note.id}`)[0].count,2);
  assert.equal(await db.noteLink.count({where:{sourceNoteId:note.id}}),1);
  await db.note.update({where:{id:note.id},data:{plainText:'A shorter fixture'}});
  assert.equal(await writeNoteIndex(db,{...source,userId:newId,plainText:'A shorter fixture'},['latest only'],[vector]),'indexed');
  assert.deepEqual(await db.$queryRaw`SELECT "content" FROM "NoteEmbedding" WHERE "noteId"=${note.id}`,[{content:'latest only'}]);
  deletingId=newId;
  assert.equal((await DELETE(deletionRequest())).status,200);
  assert.equal(await db.note.count({where:{id:note.id}}),0);
  assert.equal((await db.$queryRaw`SELECT count(*)::int count FROM "NoteEmbedding" WHERE "noteId"=${note.id}`)[0].count,0);
  assert.equal(await db.noteLink.count({where:{sourceNoteId:note.id}}),0);
 }finally{
  await db.user.deleteMany({where:{id:{in:[oldId,newId]}}});
  await db.$disconnect();
 }
});
