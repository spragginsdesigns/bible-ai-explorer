import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url);
const clerkRequire=createRequire(require.resolve('@clerk/nextjs/server'));
const {verifyToken}=await import(pathToFileURL(clerkRequire.resolve('@clerk/backend')).href);
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwtKey=publicKey.export({format:'pem',type:'spki'});
function token(overrides={}){
 const now=Math.floor(Date.now()/1000);
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const body=[encode({alg:'RS256',typ:'JWT',kid:'local-test'}),encode({iss:'https://test.clerk.accounts.dev',sub:'user_test',sid:'sess_test',iat:now,nbf:now-1,exp:now+60,azp:'http://localhost:3000',...overrides})].join('.');
 return `${body}.${sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url')}`;
}

test('Clerk public-key verification accepts a valid signed session',async()=>{
 const payload=await verifyToken(token(),{jwtKey});
 assert.equal(payload.sub,'user_test');
});

test('configured public key never bypasses signature or expiry checks',async()=>{
 const jwt=token();const pieces=jwt.split('.');
 pieces[2]=(pieces[2][0]==='A'?'B':'A')+pieces[2].slice(1);
 await assert.rejects(verifyToken(pieces.join('.'),{jwtKey}));
 await assert.rejects(verifyToken(token({exp:Math.floor(Date.now()/1000)-60}),{jwtKey}));
});

test('middleware keeps normal Clerk lookup when no public key is configured',()=>{
 const source=readFileSync(new URL('../src/middleware.ts',import.meta.url),'utf8');
 assert.match(source,/jwtKey: process\.env\.CLERK_JWT_KEY\?\.replace\(/);
 assert.match(source,/\|\| undefined/);
 assert.match(source,/const \{ userId \} = await auth\(\)/);
 assert.match(source,/status: 401/);
});
