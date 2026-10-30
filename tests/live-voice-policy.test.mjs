import assert from 'node:assert/strict';
import test from 'node:test';
import { liveLimits, signLiveTicket, verifyLiveTicket, relaySignature, validRelaySignature, liveAppOrigin, liveRelayUrl } from '../src/lib/voice/live-policy.ts';
const secret='private-test-secret-with-at-least-thirty-two-characters';

test('default Pro trial allowances are bounded; invalid values fail closed',()=>{
 assert.deepEqual(liveLimits({}),{sessionSeconds:300,dailySeconds:600,monthlySeconds:3600});
 assert.equal(liveLimits({SUREWORD_LIVE_SESSION_SECONDS:'bad'}).sessionSeconds,0);
 assert.equal(liveLimits({SUREWORD_LIVE_MONTHLY_SECONDS:'-1'}).monthlySeconds,0);
 assert.equal(liveLimits({SUREWORD_LIVE_SESSION_SECONDS:'9999999'}).sessionSeconds,600);
});
test('voice ticket rejects tampering, expired and implausibly long TTL',()=>{
 const now=1793280000000,ticket={sessionId:'s',userId:'u',expiresAt:now+30000};
 const token=signLiveTicket(ticket,secret);assert.deepEqual(verifyLiveTicket(token,secret,now),ticket);
 assert.throws(()=>verifyLiveTicket(token+'x',secret,now));
 assert.throws(()=>verifyLiveTicket(token,secret,now+30001));
 assert.throws(()=>verifyLiveTicket(signLiveTicket({...ticket,expiresAt:now+61000},secret),secret,now));
 const payload=Buffer.from(JSON.stringify({...ticket,userId:'other'})).toString('base64url');
 assert.throws(()=>verifyLiveTicket(payload+'.'+token.split('.')[1],secret,now));
});
test('relay RPC signatures bind exact body and a short time window',()=>{
 const now=1793280000000,stamp=String(now),body='{"op":"authorize"}';
 const sig=relaySignature(body,stamp,secret);
 assert.equal(validRelaySignature(body,stamp,sig,secret,now),true);
 assert.equal(validRelaySignature(body+' ',stamp,sig,secret,now),false);
 assert.equal(validRelaySignature(body,stamp,sig,secret,now+30001),false);
 assert.equal(validRelaySignature(body,stamp,null,secret,now),false);
});
test('relay destinations reject insecure remote origins and credential-bearing URLs',()=>{
 assert.equal(liveAppOrigin({}),'http://localhost:3144');
 assert.throws(()=>liveAppOrigin({SUREWORD_LIVE_APP_ORIGIN:'http://example.com'}));
 assert.throws(()=>liveAppOrigin({SUREWORD_LIVE_APP_ORIGIN:'https://example.com/api'}));
 assert.throws(()=>liveRelayUrl({SUREWORD_LIVE_RELAY_URL:'ws://example.com'}));
 assert.throws(()=>liveRelayUrl({SUREWORD_LIVE_RELAY_URL:'wss://user:password@example.com'}));
});
