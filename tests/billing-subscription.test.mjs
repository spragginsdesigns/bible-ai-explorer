import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const state = { stripe: null, play: null, playReads: 0 };
const prisma = {
  billingSubscription: { findUnique: async () => state.stripe },
  googlePlaySubscription: { findUnique: async () => { state.playReads++; return state.play; } },
};
const mod = { exports: {} };
const code = ts.transpileModule(fs.readFileSync('src/lib/billing/subscription.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function('require','module','exports',code)(id => {
  if(id==='server-only')return {};
  if(id==='@/lib/prisma')return {prisma};
  if(id==='./plans')return {activeSubscription:s=>['active','trialing'].includes(s.status)&&s.periodEnd>new Date()};
  throw new Error('Unexpected import '+id);
},mod,mod.exports);
const { accountSubscription }=mod.exports;
const active = {status:'active',periodStart:new Date(Date.now()-86400000),periodEnd:new Date(Date.now()+86400000)};
test('Play data stays untouched until its complete configuration is enabled',async()=>{
  process.env.SUREWORD_USAGE_ENABLED='true';
  process.env.SUREWORD_PLAY_BILLING_ENABLED='false';
  state.play={...active};state.stripe=null;state.playReads=0;
  assert.equal(await accountSubscription('test'),null);
  assert.equal(state.playReads,0);
  process.env.SUREWORD_PLAY_BILLING_ENABLED='true';
  delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  assert.equal(await accountSubscription('test'),null);
  assert.equal(state.playReads,0);
});
test('an active Play subscription supersedes expired Stripe history',async()=>{
  process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON='fixture';
  state.stripe={...active,status:'canceled',periodEnd:new Date(0)};
  const result=await accountSubscription('test');
  assert.equal(result.provider,'google-play');
  assert.equal(result.periodStart,state.play.periodStart);
});
test('both storefronts share one account period without doubling the allowance',async()=>{
  state.stripe={...active};
  const result=await accountSubscription('test');
  assert.equal(result.provider,'stripe');
  assert.equal(result.periodEnd,state.stripe.periodEnd);
});
